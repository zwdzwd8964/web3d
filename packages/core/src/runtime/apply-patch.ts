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
  /**
   * v1.0 / schema v3 hooks. 与上面三个同形（单参 `doc`，返回 void），缺席时行为一字不变。
   *
   *   applyPages        `/pages/**`        —— 消费者在 **v1.2**（覆盖层渲染）
   *   applyFlows        `/flows/**`        —— 消费者在 **v1.2**（流程运行时）
   *   applyDataSources  `/dataSources/**`  —— 消费者在 **v1.5**（外部数据源轮询）
   *   applyPrefabs      `/prefabs/**`      —— 消费者在 **v2**（prefab 实例化）
   *
   * ⚠ **本卡一个都不注入。** `scene-runtime.ts` 的装配段里这四个仍然是 undefined，
   * 所以单测绿 ≠ 生产有效。它们现在的价值是「路径被认领」——缺了钩子的那一条
   * `return true` 让 `/dataSources/0/intervalMs` 这种补丁不至于触发一次整图重建
   * （1000 节点实测 97 ms）。接线各归各的卡。
   */
  readonly applyPages?: (doc: SceneDocument) => void
  readonly applyFlows?: (doc: SceneDocument) => void
  readonly applyDataSources?: (doc: SceneDocument) => void
  readonly applyPrefabs?: (doc: SceneDocument) => void
  /**
   * `/variables/**` —— **与上面四个不同，这一个在 v1.0 就有生产消费者。**
   *
   * 运行时把变量的**当前值**存在一个 Map 里，而文档里存的是 `default`。编辑器新建一个
   * 变量时，如果没人告诉运行时，那个变量在预览里就不存在——一条写它的规则会撞上
   * 「写入了未声明的变量」并被忽略，而 `fullRebuildCount` 全程是 0（铁律 11 的
   * 「静默失效」形状：没有回落，所以没有告警，功能就是不工作）。
   */
  readonly applyVariables?: (doc: SceneDocument) => void
  /**
   * `/animations/**` —— T-237。**收到的是被动过的那几条动画的 id，不是整份文档。**
   *
   * ClipPlayer 现在按 `(animationId, object.uuid)` 缓存 scoped clip 与它背后那条
   * `AnimationAction`（复用它才是「重播 20 次不堆 20 条 action」的实现）。代价是：
   * 一条动画的 `clipName` / `assetId` 被改过之后，缓存里那份是**按旧定义绑的**，
   * 不交回去的话下一次播放会安静地继续播老片段。谁改了谁负责通知。
   */
  readonly applyAnimations?: (animationIds: readonly string[]) => void
  /**
   * T-243 · `/nodes/**` 里任何可能改变剖切结果的东西变了：section 块、transform、
   * visible、parent，以及整份 `/nodes` 被替换。
   *
   * **给整份文档而不是给一个 nodeId**：平面是一个全局集合（渲染器只吃前 3 条，按文档序），
   * 改一个节点的可见性会改变**其余平面的名次**。逐节点增量在这里是错的抽象。
   */
  readonly applySections?: (doc: SceneDocument) => void
  /** T-243 · 爆炸分组的参数或逐件偏移变了。消费者是 T-244 的叠加层。 */
  readonly applyExplode?: (doc: SceneDocument) => void
  /**
   * T-244 · 这个节点的 transform 刚被文档值覆盖，爆炸叠加层的账本要清。
   *
   * **按节点，不是整片**：没被覆盖的成员仍停在「base + 偏移」上，把它们的账本一起清
   * 会让下一帧再叠一次，位置直接翻倍。
   */
  readonly forgetExplodeFor?: (nodeId: string) => void
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
      case 'media':
        // The hotspot layer and the media bus read `doc.media` directly; the pool of
        // <audio> elements is the only thing that mirrors it (T-163).
        this.targets.applyMedia?.(next)
        return true
      // v3 的四个集合各自有一个**可选**钩子。
      //
      // **认领它们、（在没有钩子时）什么都不做，是正确行为而不是偷懒**：掉进 default 会让
      // 「改一个数据源的轮询间隔」触发一次整图重建（1000 节点实测 97 ms，IMPL_NOTES T-176）。
      // 而给它们各自一个槽位，是为了 v1.2/v1.5/v2 接线时不必再动这个 switch。
      //
      // 四个分开写而不是共用一个钩子：一个「四个一起调」的实现在「只断某一个被调用」的
      // 测试下照样绿，所以测试那边也逐个断了「另外三个没被调」。
      case 'pages':
        this.targets.applyPages?.(next)
        return true
      case 'flows':
        this.targets.applyFlows?.(next)
        return true
      case 'dataSources':
        this.targets.applyDataSources?.(next)
        return true
      case 'prefabs':
        this.targets.applyPrefabs?.(next)
        return true
      // 后面这一组没有渲染侧镜像，认领即可。
      //
      // **`case 'id'` 删掉了：`SceneDocument` 根本没有 `id` 字段**（顶层是
      // schemaVersion / projectId / sceneId / name / meta + 13 个集合），所以那一支从写下
      // 那天起就不可达。而真正存在的 `projectId` 反倒走 default —— 改一次项目 id 会触发
      // 一次整图重建。`sceneId` 与 `projectId` 分两行写、不合并成一行：合并之后没法
      // 单独删掉一个来做变异检验。
      case 'variables':
        this.targets.applyVariables?.(next)
        return true
      case 'animations': {
        // 整条数组被替换（`indexRaw` 为 undefined）时新旧两侧的 id 全交出去：
        // 删掉一条动画同样要释放，而它在 `next` 里已经不存在了。
        const ids =
          typeof indexRaw === 'number'
            ? [next.animations[indexRaw]?.id, prev.animations[indexRaw]?.id]
            : [...next.animations.map((a) => a.id), ...prev.animations.map((a) => a.id)]
        this.targets.applyAnimations?.([...new Set(ids.filter((id): id is string => id !== undefined))])
        return true
      }
      case 'rules':
      case 'viewpoints':
      case 'hotspots':
      case 'name':
      case 'schemaVersion':
      case 'sceneId':
      case 'projectId':
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
        const gone = graph.removeNode(removed.id)
        // 删掉的可能正是一把刀 —— 不重算的话它删了还在切
        this.targets.applySections?.(next)
        if (gone) return true

        // D-02 · **`removeNode` 返回 false 有两个完全不同的意思**，而这里以前把它们
        // 当成了同一件事，代价是一次全量重建（铁律 11 的报警器被一个正常操作触发）。
        //
        // (a) 它刚刚**随祖先一起**被删掉了。删一个有子节点的节点时，immer 发的补丁是
        //     「若干条位移 replace + 尾部 k 条 remove」，而尾部那几条里有一部分指向的
        //     正是被删子树里的节点——它们的 three 对象在更早那条 replace 触发的
        //     `reconcileNodes` 里已经没了。同一件事在一批补丁里被算了两次，不是失败。
        //     `reconcileNodes` 自己对这件事一直是知情且宽容的（见它下面那句注释），
        //     只有逐 index 这条路把它当成了错误。
        //
        // (b) 图与文档**本来就不同步**。这一种必须继续回落——那正是
        //     `fullRebuildCount` 存在的全部理由，把它一起吞掉等于把报警器拆了。
        //
        // 判据走 `prev` 里的父链：只要有一个祖先也从 `next` 里消失了，就是 (a)。
        return removedWithAncestor(removed, prev, next)
      }
      const added = next.nodes[index]
      if (!added) return false
      // `addNode` returns null for two different reasons — the node is already in the
      // graph (an index shift), or its parent has not been added yet (a subtree arriving
      // in one batch). Reconcile handles both, and is the only thing that can.
      const ok = graph.addNode(added) !== null || this.reconcileNodes(next, prev)
      // T-252 · **新增 / 删除一个节点也要重算剖切面。**
      //
      // 「新建剖切平面」走的正是这条 O(1) 快路：`addNode` 成功之后直接 return，
      // `applySections` 一次都不会被调用。表现是**层级树里多了一把刀、面板参数都在、
      // 而画面一刀没切**，且 `fullRebuildCount` 全程是 0（铁律 11 的静默失效形状）。
      //
      // 单测抓不到它：单测都是逐字段发补丁的，走不到这条快路。是 T-252 的 E2E 在真
      // 浏览器里把它抓出来的——三条断言全红在 `clipPlanes === 0` 上。
      this.targets.applySections?.(next)
      return ok
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
      case 'transform': {
        // Covers both `/transform` and `/transform/p`: the node's whole transform is
        // re-applied either way, and it is three numbers.
        const ok = graph.setTransform(node.id, node)
        // T-243 · 拖一把剖切刀就是在改它的 transform，而平面**就是**那个 transform。
        // 不在这里重算的话，拖动时指示矩形动了、切面不动。
        this.targets.applySections?.(next)
        // T-244 · 这一行刚把文档值原样写回对象，爆炸叠加层的账本因此过期了。
        // 不告诉它的话下一帧算出的增量是 0，零件停在未爆炸的位置——**爆炸塌了，
        // 而没有任何报错**（D29 逐字要求「被 patch 覆盖后下一帧自动补回」）。
        this.targets.forgetExplodeFor?.(node.id)
        return ok
      }
      case 'visible': {
        const ok = graph.setVisible(node.id, node.visible)
        // 启停剖切走的正是 `node.visible`（X-03 的整个便宜之处）。而且隐藏的是**父节点**
        // 时同样要重算——世界可见性变了。
        this.targets.applySections?.(next)
        return ok
      }
      case 'name':
        graph.setName(node.id, node.name)
        return true
      case 'parent': {
        const ok = graph.setParent(node.id, node.parent)
        // 换父节点 = 换世界矩阵，平面跟着走
        this.targets.applySections?.(next)
        return ok
      }
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
      // T-243 · v3 的三个节点字段。三个分开写、不合并成一行：合并之后没法单独删掉
      // 一个来做变异检验（与 `sceneId` / `projectId` 那一对同一条纪律）。
      case 'section':
        // 覆盖 `/section` 整块与 `/section/size/0`：承载体两种都要重读，
        // 由工厂决定是不是原地改。**平面本身由 `applySections` 重算**，见下。
        this.targets.applySections?.(next)
        return graph.setSection(node.id, node)
      case 'explode':
        // 分组参数（模式 / 轴 / 中心）。T-244 的叠加层消费它；本卡先认领，
        // 掉进 default 会让「改一下爆炸轴」触发一次整图重建。
        this.targets.applyExplode?.(next)
        return true
      case 'explodeOffset':
        this.targets.applyExplode?.(next)
        return true
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
    // T-243 / T-252 · **整份 `/nodes` 被替换也要重算剖切面。**
    //
    // 「新建剖切平面」走的正是这条路（immer 对 `draft.nodes.push` 发的是整数组替换），
    // 而逐 index 的 `case 'section'` 在这里一次都不会被调用。漏掉的表现是：层级树里
    // 多了一把刀、面板上参数都在、**而画面一刀没切**，且 `fullRebuildCount` 全程是 0。
    //
    // T-252 的 E2E 在真浏览器里把它抓了出来——三条断言全红在 `clipPlanes === 0` 上。
    // 单测抓不到它，因为单测都是逐 index 发补丁的。
    this.targets.applySections?.(next)
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
      node.primitive !== null
        ? graph.setPrimitive(nodeId, node)
        : node.light !== null
          ? graph.setLight(nodeId, node)
          : // T-243 · 第四种承载体也要在这里同步。`resyncNode` 是「整份 /nodes 被替换」
            // 那条路的收口，而导入、删节点、保存视点三种日常操作都走它——漏掉的话
            // 剖切面从那一刻起就不再同步，**而 `fullRebuildCount` 全程是 0**
            // （铁律 11 的静默失效形状：没有回落，所以没有告警，功能就是不工作）。
            node.section !== null
            ? graph.setSection(nodeId, node)
            : true

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

/**
 * D-02 · 这个节点是不是**随某个祖先一起**从文档里消失的。
 *
 * 用 `prev` 的父链，因为 `next` 里这些节点已经不在了。只要链上任意一个祖先也不在
 * `next` 里，`graph.removeNode(那个祖先)` 就已经把整棵子树一起抹掉了——于是针对
 * 子节点的那条 remove 找不到对象是**预期之内**的。
 *
 * 祖先全都还活着却已经不在图里，是另一回事：那说明图与文档不同步，必须回落。
 *
 * @param node 被删的那个节点（来自 `prev`）。
 * @param prev 改动前的文档，父链从这里走。
 * @param next 改动后的文档，「还在不在」按它判断。
 */
function removedWithAncestor(node: Node, prev: SceneDocument, next: SceneDocument): boolean {
  const alive = new Set(next.nodes.map((n) => n.id))
  const byId = new Map(prev.nodes.map((n) => [n.id, n]))
  let cursor = node.parent
  // 上界是节点总数：一份 parent 成环的文档不该让这里转不出来。`checkIntegrity` 会
  // 单独报那种文档，但一个死循环会先把页面卡住，而卡住比报错难查得多。
  let guard = prev.nodes.length
  while (cursor !== null && guard-- > 0) {
    if (!alive.has(cursor)) return true
    cursor = byId.get(cursor)?.parent ?? null
  }
  return false
}
