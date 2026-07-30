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
  /** Re-reads `doc.meta` — background colour, mostly. */
  readonly applyMeta?: (doc: SceneDocument) => void
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
      case 'meta':
        // Background and unit/up-axis live here. Re-reading the whole meta block is
        // cheaper than the switch that would tell them apart.
        this.targets.applyMeta?.(next)
        return true
      case 'assets':
        // Asset BYTES are loaded asynchronously and therefore cannot be handled from a
        // synchronous patch. The host is responsible for awaiting `ensureAssets` BEFORE
        // handing these patches over — `createPatchForwarder` does exactly that. By the
        // time we get here the loader already has them, and the node patches that follow
        // in the same batch materialise the geometry.
        return true
      // Collections with no renderer-side representation: the ECA engine and the hotspot
      // projector read them straight from the document, so there is nothing to mirror.
      case 'rules':
      case 'variables':
      case 'viewpoints':
      case 'animations':
      case 'hotspots':
      case 'pages':
      case 'flows':
      case 'media':
      case 'name':
      case 'schemaVersion':
      case 'id':
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

    // `/nodes` wholesale. Immer emits this whenever the array is REPLACED rather than
    // mutated — `draft.nodes = draft.nodes.filter(...)` is the common way to write a
    // delete, and an import that appends can produce it too. Falling back to a full
    // rebuild here made `fullRebuildCount` non-zero on three ordinary operations
    // (import / save viewpoint / delete node), which destroys its value as D1's alarm.
    // Diffing the two lists is strictly more work than the fallback in the worst case and
    // dramatically less in every real one.
    if (indexRaw === undefined) return this.reconcileNodes(next, prev)

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

  /**
   * Brings the scene graph in line with `next.nodes` without rebuilding it.
   *
   * Adds run parent-first: `graph.addNode` refuses a node whose parent is not in the
   * graph yet, and an import hands us a whole subtree at once. Removes run first so an
   * id that was deleted and re-added in one commit does not collide.
   */
  private reconcileNodes(next: SceneDocument, prev: SceneDocument): boolean {
    const { graph } = this.targets
    const before = new Map(prev.nodes.map((n) => [n.id, n]))
    const after = new Map(next.nodes.map((n) => [n.id, n]))

    for (const id of before.keys()) {
      // removeNode drops the whole subtree, so a child removed alongside its parent is
      // already gone by the time we reach it — not an error.
      if (!after.has(id)) graph.removeNode(id)
    }

    const pending = next.nodes.filter((n) => !before.has(n.id))
    let guard = pending.length + 1
    while (pending.length > 0 && guard-- > 0) {
      const remaining: typeof pending = []
      for (const node of pending) {
        if (graph.addNode(node) === null && !graph.objectFor(node.id)) remaining.push(node)
      }
      // No progress this pass means the rest are unreachable — a parent chain pointing at
      // a node that does not exist. Report it rather than looping.
      if (remaining.length === pending.length) return false
      pending.length = 0
      pending.push(...remaining)
    }
    if (pending.length > 0) return false

    for (const node of next.nodes) {
      if (before.get(node.id) === node) continue // untouched by this commit
      if (!before.has(node.id)) continue // freshly added above, already current
      if (!this.resyncNode(node.id, next)) return false
    }
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
