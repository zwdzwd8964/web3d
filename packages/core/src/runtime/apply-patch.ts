import type { Material as MaterialDef, Node, SceneDocument } from '@w3/schema'
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
  /**
   * v0.5 hooks. Each is optional and each has a defined meaning when absent:
   *
   *   applyEnvironment  `/meta/environment/**` — the IBL map, intensity and exposure (T-133)
   *   applyNodeShadow   `/nodes/i/overrides/{castShadow,receiveShadow}` (T-132)
   *   applyMedia        `/media/**` — the media element pool (T-163)
   *
   * Absent means "this build renders nothing that depends on it", which is why the paths
   * still count as handled. That is NOT the same as ignoring an unknown path: these are
   * recognised paths whose consumer has not shipped yet, and the day it does, the wiring
   * is already here rather than being invented alongside the feature.
   */
  readonly applyEnvironment?: (doc: SceneDocument) => void
  readonly applyNodeShadow?: (doc: SceneDocument, nodeId: string) => void
  readonly applyMedia?: (doc: SceneDocument) => void
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
        return this.applyMaterialPatch(patch, indexRaw, rest, next, prev)
      case 'meta': {
        // `/meta/environment/**` gets its own consumer because rebuilding a PMREM
        // environment is expensive and must not happen when the user typed a background
        // colour. Everything else in meta re-reads the whole block, which is cheaper than
        // the switch that would tell unit from upAxis.
        if (indexRaw === 'environment') this.targets.applyEnvironment?.(next)
        // The fallthrough is deliberate and load-bearing: an unrecognised key under meta
        // must still be handled, or adding a meta field later silently starts triggering
        // full rebuilds.
        this.targets.applyMeta?.(next)
        return true
      }
      case 'assets':
        // Asset BYTES are loaded asynchronously and therefore cannot be handled from a
        // synchronous patch. The host is responsible for awaiting `ensureAssets` BEFORE
        // handing these patches over — `createPatchForwarder` does exactly that. By the
        // time we get here the loader already has them, and the node patches that follow
        // in the same batch materialise the geometry.
        return true
      // Collections with no renderer-side representation: the ECA engine and the hotspot
      // projector read them straight from the document, so there is nothing to mirror.
      //
      // v3 的 `dataSources` / `prefabs` 也在这一组。**认领它们、什么都不做，是正确行为而不是
      // 偷懒**：掉进 default 会让「改一个数据源的轮询间隔」触发一次整图重建（1000 节点实测
      // 97 ms，IMPL_NOTES T-176），而数据源和 prefab 库跟场景图没有任何关系。
      case 'media':
        // The hotspot layer and the media bus read `doc.media` directly; the pool of
        // <audio> elements is the only thing that mirrors it (T-163).
        this.targets.applyMedia?.(next)
        return true
      case 'rules':
      case 'variables':
      case 'viewpoints':
      case 'animations':
      case 'hotspots':
      case 'pages':
      case 'flows':
      case 'dataSources':
      case 'prefabs':
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

    // A whole element of `nodes` moved, arrived or left.
    //
    // The trap is that `add` / `replace` / `remove` at an INDEX rarely mean what they say.
    // Immer describes `nodes.splice(2, 1)` on a five-element array as
    // `replace /nodes/2`, `replace /nodes/3`, `remove /nodes/4` — three patches, and the
    // only one naming the deleted node is the trailing remove, whose index now points at
    // a different node entirely. Undo replays the same shifts in the other direction.
    //
    // Reading them literally (drop whatever used to be at this index, add whatever is
    // there now) removed a LIVE node and then failed to re-add it, because `addNode`
    // refuses a duplicate. The batch came back unhandled and rebuilt: that is the
    // `fullRebuildCount === 1` recorded against the golden path in IMPL_NOTES §4, invisible
    // to every unit test in this file.
    //
    // So the index is treated as a hint and the ID as the truth. Try the O(1) move; when
    // it does not apply, diff the two node lists. `reconcileNodes` is idempotent, so one
    // splice costs one reconcile and then a couple of no-ops.
    if (rest.length === 0) {
      if (patch.op === 'remove') {
        const removed = prev.nodes[index]
        if (!removed) return false
        // Still present under a different index: this remove is the vacated slot, not a
        // deletion. Removing it here is the live-node bug in its purest form.
        if (next.nodes.some((n) => n.id === removed.id)) return this.reconcileNodes(next, prev)
        return graph.removeNode(removed.id)
      }
      const added = next.nodes[index]
      if (!added) return false
      // `addNode` returns null for two different reasons — the node is already in the
      // graph (an index shift), or its parent has not been added yet (a subtree arriving
      // in one batch). Reconcile handles both, and is the only thing that can.
      return graph.addNode(added) !== null || this.reconcileNodes(next, prev)
    }

    const node = next.nodes[index]
    if (!node) {
      // A field patch about a node this same batch REMOVES. Immer emits inverse batches in
      // that shape routinely: restore the old value, then delete its owner. Aborting a
      // drag-and-drop ghost produces exactly `replace /nodes/3/transform/p` followed by
      // `remove /nodes/3` (T-146), and reading the first as unrecognised rebuilt the whole
      // scene every time a drag was cancelled — D1's alarm firing on an ordinary gesture,
      // which is how an alarm stops meaning anything.
      //
      // Narrow on purpose: only when the node was there BEFORE and is gone by id AFTER.
      // Any other missing index is still a fallback, because it is still a surprise.
      const removed = prev.nodes[index]
      return removed !== undefined && !next.nodes.some((n) => n.id === removed.id)
    }
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
      case 'primitive':
        // Covers `/primitive` wholesale and `/primitive/size/1`: the carrier is re-read
        // either way, and the factory decides whether that is an in-place update.
        return graph.setPrimitive(node.id, node)
      case 'light':
        // Same, and it is the path that carries `/light/shadow/bias` and
        // `/light/intensity` — every `setLight` action and every slider drag.
        return graph.setLight(node.id, node)
      case 'overrides': {
        if (sub === 'castShadow' || sub === 'receiveShadow') {
          // v1 defined these and nothing read them; v2's shadow pipeline (T-132) does.
          this.targets.applyNodeShadow?.(next, node.id)
          return true
        }
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
    prev: SceneDocument,
  ): boolean {
    if (indexRaw === undefined) return false
    const index = Number(indexRaw)
    if (!Number.isInteger(index)) return false

    // A removed material means every node overriding it must fall back to its source.
    //
    // This used to answer "rebuild the whole scene", which is correct but expensive — and
    // it fires on an everyday action: undoing the first primitive placed in a project also
    // undoes the 默认材质 record created alongside it (T-146). Restoring the affected nodes
    // is what the rebuild would have achieved anyway, and it is bounded by the number of
    // nodes that actually referenced the material.
    if (rest.length === 0 && patch.op === 'remove') {
      const removed = prev.materials[index]
      if (!removed) return false
      // Present under a different index: an index shift, not a deletion.
      if (next.materials.some((m) => m.id === removed.id)) return true

      const defs = new Map(next.materials.map((m) => [m.id, m]))
      for (const node of next.nodes) {
        // A node removed in the same batch is not in `next` at all — nothing to restore.
        if (node.overrides.materialId !== removed.id) continue
        this.targets.materials.applyToNode(node.id, null, defs, this.targets.graph)
      }
      return true
    }

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

    // A node whose ASSET changed cannot be reconciled: its geometry has to be built again
    // from different bytes, and only a rebuild knows how. The per-index path has always
    // said so (`case 'assetRef': return false`), but the WHOLE-`/nodes` path did not — and
    // that is the path a re-upload takes, because §5.3's remap keeps every node id and
    // replaces the array wholesale. So `before`/`after` had identical id sets, every node
    // resynced "successfully", the batch counted as handled, and the viewport kept drawing
    // the OLD model while the tree, the asset panel and the 「已迁移 N 项」 dialog all
    // showed the new one. `fullRebuildCount` stayed 0 — the alarm for exactly this.
    //
    // Found by T-176's review; three independent readers failed to refute it.
    for (const [id, was] of before) {
      const now = after.get(id)
      if (now && was.assetRef?.assetId !== now.assetRef?.assetId) return false
    }

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

    // Built once for the whole batch. `resyncNode` used to build it per node, so a commit
    // that touched every node rebuilt this map n times (T-184).
    const defs = new Map(next.materials.map((m) => [m.id, m]))
    for (const node of next.nodes) {
      if (before.get(node.id) === node) continue // untouched by this commit
      if (!before.has(node.id)) continue // freshly added above, already current
      if (!this.resyncNode(node, defs)) return false
    }
    return true
  }

  /**
   * Re-applies everything about one node that the graph mirrors.
   *
   * Takes the node and the material defs rather than looking either up: every caller
   * already holds the node, and the `find` plus the per-call `Map` rebuild made a
   * whole-array commit O(n²) — 97 ms to delete one node out of 1000 (T-184).
   */
  private resyncNode(node: Node, defs: Map<string, MaterialDef>): boolean {
    const nodeId = node.id
    const { graph, materials } = this.targets
    const carrierOk =
      node.primitive !== null ? graph.setPrimitive(nodeId, node) : node.light !== null ? graph.setLight(nodeId, node) : true

    // `applyToNode`'s return value is deliberately dropped, for the same reason the
    // `overrides` branch above drops it: it answers false for a node with no mesh — a
    // grouping node, an unresolved placeholder, and now every light — and that is
    // "nothing to render", not "unrecognised patch".
    //
    // It used to be `&& … !== false`, which meant that from the first light a document
    // contained, ANY wholesale `/nodes` change fell back to a full rebuild. The counter
    // that is supposed to be D1's alarm would have been ringing continuously.
    materials.applyToNode(nodeId, node.overrides.materialId ?? null, defs, graph)
    return (
      carrierOk &&
      graph.setTransform(nodeId, node) &&
      graph.setVisible(nodeId, node.visible) &&
      graph.setName(nodeId, node.name) &&
      graph.setParent(nodeId, node.parent)
    )
  }
}
