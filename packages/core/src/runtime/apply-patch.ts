import type { Material as MaterialDef, SceneDocument } from '@w3/schema'
import type { HighlightLayer } from './highlight.js'
import type { MaterialRegistry } from './material-registry.js'
import type { SceneGraph } from './scene-graph.js'

/**
 * T-034 · MVP_V0 D1 · incremental application, never a full rebuild.
 *
 * Dragging a gizmo produces a patch every frame. `runtime.load(doc)` on each one drops
 * the frame rate to unusable on any real model, so the document's patch path is
 * dispatched to the one Object3D it names:
 *
 *     /nodes/3/transform/p   ->  that mesh's position, nothing else
 *
 * The full-rebuild fallback exists only for paths this file does not recognise. It
 * warns and increments a counter, and the E2E run asserts the counter is zero: an
 * unnoticed fallback is exactly how "it got slow and nobody knows when" happens.
 */

/** Structurally compatible with Immer's `Patch`; core does not depend on immer. */
export interface DocumentPatch {
  readonly op: 'replace' | 'add' | 'remove'
  readonly path: readonly (string | number)[]
  readonly value?: unknown
}

export interface PatchApplierTargets {
  readonly graph: SceneGraph
  readonly materials: MaterialRegistry
  readonly highlights?: HighlightLayer
  /** Called when a patch cannot be handled incrementally. */
  readonly rebuild: (doc: SceneDocument) => void
  readonly log?: (level: 'debug' | 'warn' | 'error', message: string, data?: unknown) => void
}

export interface ApplyPatchResult {
  readonly handled: number
  readonly rebuilt: boolean
  readonly unhandled: readonly string[]
}

const pathOf = (patch: DocumentPatch) => `/${patch.path.join('/')}`

export class PatchApplier {
  /** D1's fallback counter. Asserted to be 0 in the golden-path E2E (T-112). */
  fullRebuildCount = 0

  constructor(private readonly targets: PatchApplierTargets) {}

  /**
   * @param patches  the patches Immer produced
   * @param next     the document AFTER they were applied
   * @param prev     the document BEFORE — needed because `remove` names an index whose
   *                 element is already gone from `next`
   */
  apply(patches: readonly DocumentPatch[], next: SceneDocument, prev: SceneDocument): ApplyPatchResult {
    const unhandled: string[] = []
    let handled = 0

    for (const patch of patches) {
      if (this.applyOne(patch, next, prev)) handled++
      else unhandled.push(`${patch.op} ${pathOf(patch)}`)
    }

    if (unhandled.length === 0) return { handled, rebuilt: false, unhandled }

    this.fullRebuildCount++
    this.targets.log?.(
      'warn',
      `applyPatch 回落到全量重建（第 ${this.fullRebuildCount} 次）：${unhandled.length} 条 patch 未被识别`,
      unhandled,
    )
    this.targets.rebuild(next)
    return { handled, rebuilt: true, unhandled }
  }

  private applyOne(patch: DocumentPatch, next: SceneDocument, prev: SceneDocument): boolean {
    const [collection, indexRaw, ...rest] = patch.path
    if (typeof collection !== 'string') return false

    switch (collection) {
      case 'nodes':
        return this.applyNodePatch(patch, indexRaw, rest, next, prev)
      case 'materials':
        return this.applyMaterialPatch(patch, indexRaw, rest, next)
      // Collections with no renderer-side representation: the ECA engine reads them
      // straight from the document, so there is nothing to update here.
      case 'rules':
      case 'variables':
      case 'pages':
      case 'flows':
      case 'media':
      case 'name':
        return true
      default:
        return false
    }
  }

  private applyNodePatch(
    patch: DocumentPatch,
    indexRaw: string | number | undefined,
    rest: readonly (string | number)[],
    next: SceneDocument,
    prev: SceneDocument,
  ): boolean {
    const { graph, materials } = this.targets

    // `/nodes` wholesale — an import or an undo of one. Nothing incremental to do.
    if (indexRaw === undefined) return false

    const index = Number(indexRaw)
    if (!Number.isInteger(index)) return false

    // A whole node was added or removed.
    if (rest.length === 0) {
      if (patch.op === 'remove') {
        const removed = prev.nodes[index]
        return removed ? graph.removeNode(removed.id) : false
      }
      const added = next.nodes[index]
      if (!added) return false
      // `replace` on a whole element means the node at this index is a different node.
      if (patch.op === 'replace') {
        const before = prev.nodes[index]
        if (before && before.id !== added.id) graph.removeNode(before.id)
        else if (before) return this.resyncNode(added.id, next)
      }
      return graph.addNode(added) !== null
    }

    const node = next.nodes[index]
    if (!node) return false
    const [field, sub] = rest

    switch (field) {
      case 'transform':
        // Covers both `/transform` and `/transform/p`: the node's whole transform is
        // re-applied either way, and it is three numbers.
        return graph.setTransform(node.id, node)
      case 'visible':
        return graph.setVisible(node.id, node.visible)
      case 'name':
        graph.setName(node.id, node.name)
        return true
      case 'parent':
        return graph.setParent(node.id, node.parent)
      case 'order':
        // Sibling order is a document concern; three renders by scene-graph order, which
        // does not affect appearance. Nothing to do, and that is not a fallback.
        return true
      case 'locked':
        return true
      case 'overrides': {
        if (sub !== undefined && sub !== 'materialId') return false
        const defs = new Map(next.materials.map((m) => [m.id, m]))
        // The return value is deliberately ignored. `applyToNode` reports false when the
        // node has no mesh (a grouping node) or the material id does not resolve — both
        // are "nothing to render", not "unrecognised patch". Treating a no-op as a
        // fallback would make fullRebuildCount fire on an ordinary edit, and a counter
        // that cries wolf is worth nothing as the E2E's signal.
        materials.applyToNode(node.id, node.overrides.materialId ?? null, defs, graph)
        return true
      }
      case 'assetRef':
        // The asset changed under this node: its geometry has to be re-materialised, and
        // only a rebuild knows how. Honest fallback rather than a silent no-op.
        return false
      default:
        return false
    }
  }

  private applyMaterialPatch(
    patch: DocumentPatch,
    indexRaw: string | number | undefined,
    rest: readonly (string | number)[],
    next: SceneDocument,
  ): boolean {
    if (indexRaw === undefined) return false
    const index = Number(indexRaw)
    if (!Number.isInteger(index)) return false

    // A removed material means every node overriding it must fall back to its source.
    if (rest.length === 0 && patch.op === 'remove') return false

    const def: MaterialDef | undefined = next.materials[index]
    if (!def) return false
    this.targets.materials.updateDefinition(def, next, this.targets.graph)
    return true
  }

  /** Re-applies everything about one node that the graph mirrors. */
  private resyncNode(nodeId: string, doc: SceneDocument): boolean {
    const node = doc.nodes.find((n) => n.id === nodeId)
    if (!node) return false
    const { graph, materials } = this.targets
    const defs = new Map(doc.materials.map((m) => [m.id, m]))
    return (
      graph.setTransform(nodeId, node) &&
      graph.setVisible(nodeId, node.visible) &&
      graph.setName(nodeId, node.name) &&
      graph.setParent(nodeId, node.parent) &&
      materials.applyToNode(nodeId, node.overrides.materialId ?? null, defs, graph) !== false
    )
  }
}
