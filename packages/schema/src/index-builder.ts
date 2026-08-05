import type { Animation } from './animation.js'
import { getFlowChain } from './selectors.js'
import type { Asset } from './asset.js'
import type { SceneDocument } from './document.js'
import type { Hotspot } from './hotspot.js'
import type { Material } from './material.js'
import type { Media } from './media.js'
import type { Node } from './node.js'
import type { Action, Condition, EventType, Rule, ValueExpr } from './rule.js'
import { groupChildren } from './selectors.js'
import type { Variable } from './variable.js'
import type { Viewpoint } from './viewpoint.js'

/**
 * SCHEMA_SPEC §8 · the runtime index.
 *
 * The document stays arrays; lookup speed comes from here. Built once at load and
 * maintained incrementally as patches arrive. Never persisted, never on the undo stack.
 */

/** What a reference points at. Strings rather than a union so core can add ref kinds. */
export interface RefTarget {
  readonly kind: string
  readonly id: string
  /**
   * v2 · what `type` the target record must declare, when the referrer constrains it.
   *
   * `playMedia` may only point at an audio media record (v0.5 规划 §4.2 I14) — but that is
   * ACTION knowledge, and it lives in core's registry (ECA_SPEC §4.1). Hard-coding the
   * action name in this package would put ECA semantics inside the one package that must
   * not know ECA exists. So the resolver reports the constraint and `checkIntegrity`
   * enforces it, exactly like it already does for the ids themselves.
   */
  readonly expectType?: string
}

/** One inbound reference: who points at something, and from where. */
export interface Ref {
  /** The referencing entity, e.g. `{ kind: 'rule', id: 'rl_m8o2q4s6' }`. */
  readonly from: RefTarget
  /** Document path of the referring field, e.g. `rules[0].then[1].params.nodeId`. */
  readonly path: string
  /** What kind of thing is being referenced. */
  readonly targetKind: string
}

/**
 * Extracts the ids an action's params point at.
 *
 * @w3/schema cannot know what `params` means — per-action schemas live in core's
 * registry (ECA_SPEC §4.1). Core injects a resolver backed by `ActionDefinition.refs`.
 * Without one, action parameters are simply not indexed, and integrity says so rather
 * than pretending it checked (see `checkIntegrity`'s `actionRefsResolved` note).
 */
export interface ActionRefResolver {
  (action: Action): readonly RefTarget[]
}

export interface BuildIndexOptions {
  readonly actionRefs?: ActionRefResolver
}

export interface DocIndex {
  readonly nodeById: Map<string, Node>
  /** Children per parent id (null key = roots), already sorted by `order`. */
  readonly childrenOf: Map<string | null, Node[]>
  readonly assetById: Map<string, Asset>
  readonly materialById: Map<string, Material>
  readonly animationById: Map<string, Animation>
  readonly hotspotById: Map<string, Hotspot>
  readonly viewpointById: Map<string, Viewpoint>
  readonly variableById: Map<string, Variable>
  /** v2 · media got a runtime in v0.5, so it gets an index like every other collection. */
  readonly mediaById: Map<string, Media>
  /** ECA dispatch entry point. Never iterate all rules per event (ECA_SPEC §2.3). */
  readonly rulesByEvent: Map<EventType, Rule[]>
  /** Reverse references: which entities point at this id. */
  readonly refsTo: Map<string, Ref[]>
  /** False when no ActionRefResolver was supplied, so callers can avoid over-claiming. */
  readonly actionRefsResolved: boolean
}

function pushRef(map: Map<string, Ref[]>, targetId: string, ref: Ref): void {
  const list = map.get(targetId)
  if (list) list.push(ref)
  else map.set(targetId, [ref])
}

function valueExprRefs(expr: ValueExpr): RefTarget[] {
  if ('var' in expr) return [{ kind: 'variable', id: expr.var }]
  if ('prop' in expr) return [{ kind: 'node', id: expr.prop.nodeId }]
  return []
}

function conditionRefs(cond: Condition): RefTarget[] {
  switch (cond.op) {
    case 'isVisible':
      return [{ kind: 'node', id: cond.nodeId }]
    case 'isPlaying':
      return [{ kind: 'animation', id: cond.animationId }]
    case 'isPanelOpen':
      return [{ kind: 'hotspot', id: cond.hotspotId }]
    case 'isPageVisible':
      // T-227 · 页面成为引用目标。
      //
      // `ID_COLLECTIONS.pages.refKind` 仍是 `null`，**故意不翻**：那个字段同时被
      // `checkIntegrity` 的 sets 派生读（T-226 的独占文件），翻它要两张卡一起改。
      // `RefTarget.kind` 本来就是自由字符串，反向索引不需要注册表点头。
      return [{ kind: 'page', id: cond.pageId }]
    case 'in':
      return valueExprRefs(cond.left)
    default:
      return [...valueExprRefs(cond.left), ...valueExprRefs(cond.right)]
  }
}

/** Ids a rule's trigger points at. */
export function eventDescriptorRefs(rule: Rule): RefTarget[] {
  const w = rule.when
  switch (w.event) {
    case 'click':
    case 'hoverEnter':
    case 'hoverLeave':
      return 'nodeId' in w.target ? [{ kind: 'node', id: w.target.nodeId }] : []
    case 'hotspotClick':
      return [{ kind: 'hotspot', id: w.hotspotId }]
    case 'animationEnd':
      return [{ kind: 'animation', id: w.animationId }]
    case 'variableChange':
      return [{ kind: 'variable', id: w.variableId }]
    // T-227 · v3 的三个新事件。
    case 'pageEnter':
      return [{ kind: 'page', id: w.pageId }]
    case 'flowStepEnter':
      // **两条，不是一条。** 卡面验收把 step 的引用说成「startStepId / next 两类」，
      // 而这一支让它变成三类：删掉一个步骤，指着它的 flowStepEnter 规则也会失效，
      // 删除确认必须说得出这件事。
      return [
        { kind: 'flow', id: w.flowId },
        { kind: 'step', id: w.stepId },
      ]
    case 'overlayClick':
      return [{ kind: 'overlay', id: w.overlayId }]
    // 这两支确实没有引用。**显式列出来而不是让它们掉进 default**：default 留给
    // 「有人加了第 12 种事件却忘了改这里」，那时它应该是不可达的。
    case 'sceneReady':
    case 'timer':
      return []
    default:
      return []
  }
}

export function buildIndex(doc: SceneDocument, options: BuildIndexOptions = {}): DocIndex {
  const nodeById = new Map(doc.nodes.map((n) => [n.id, n]))
  const assetById = new Map(doc.assets.map((a) => [a.id, a]))
  const materialById = new Map(doc.materials.map((m) => [m.id, m]))
  const animationById = new Map(doc.animations.map((a) => [a.id, a]))
  const hotspotById = new Map(doc.hotspots.map((h) => [h.id, h]))
  const viewpointById = new Map(doc.viewpoints.map((v) => [v.id, v]))
  const variableById = new Map(doc.variables.map((v) => [v.id, v]))
  const mediaById = new Map(doc.media.map((m) => [m.id, m]))

  // One grouping pass, not one filter per node — see `groupChildren` for the measurements.
  const childrenOf = groupChildren(doc)

  const rulesByEvent = new Map<EventType, Rule[]>()
  for (const rule of doc.rules) {
    const list = rulesByEvent.get(rule.when.event)
    if (list) list.push(rule)
    else rulesByEvent.set(rule.when.event, [rule])
  }

  const refsTo = new Map<string, Ref[]>()

  // v2 · the environment map is referenced by the document itself, not by any node. It
  // still has to appear here: without it, deleting the .hdr asset takes the scene's
  // lighting with it and the delete dialog says "nothing references this".
  if (doc.meta.environment.hdriAssetId != null) {
    pushRef(refsTo, doc.meta.environment.hdriAssetId, {
      from: { kind: 'document', id: doc.projectId },
      path: 'meta.environment.hdriAssetId',
      targetKind: 'asset',
    })
  }

  doc.nodes.forEach((node, i) => {
    const from: RefTarget = { kind: 'node', id: node.id }
    if (node.parent != null) {
      pushRef(refsTo, node.parent, { from, path: `nodes[${i}].parent`, targetKind: 'node' })
    }
    if (node.assetRef) {
      pushRef(refsTo, node.assetRef.assetId, { from, path: `nodes[${i}].assetRef.assetId`, targetKind: 'asset' })
    }
    if (node.overrides.materialId != null) {
      pushRef(refsTo, node.overrides.materialId, {
        from,
        path: `nodes[${i}].overrides.materialId`,
        targetKind: 'material',
      })
    }
  })

  doc.materials.forEach((material, i) => {
    const from: RefTarget = { kind: 'material', id: material.id }
    for (const [slot, assetId] of Object.entries(material.params.maps)) {
      if (assetId == null) continue
      pushRef(refsTo, assetId, { from, path: `materials[${i}].params.maps.${slot}`, targetKind: 'asset' })
    }
  })

  doc.animations.forEach((animation, i) => {
    const from: RefTarget = { kind: 'animation', id: animation.id }
    if (animation.kind === 'imported') {
      pushRef(refsTo, animation.assetId, { from, path: `animations[${i}].assetId`, targetKind: 'asset' })
    } else {
      animation.targets.forEach((t, j) => {
        pushRef(refsTo, t.nodeId, { from, path: `animations[${i}].targets[${j}].nodeId`, targetKind: 'node' })
      })
    }
  })

  doc.hotspots.forEach((hotspot, i) => {
    const from: RefTarget = { kind: 'hotspot', id: hotspot.id }
    pushRef(refsTo, hotspot.anchor.nodeId, { from, path: `hotspots[${i}].anchor.nodeId`, targetKind: 'node' })
    if (hotspot.content.mediaId != null) {
      pushRef(refsTo, hotspot.content.mediaId, { from, path: `hotspots[${i}].content.mediaId`, targetKind: 'media' })
    }
  })

  doc.rules.forEach((rule, i) => {
    const from: RefTarget = { kind: 'rule', id: rule.id }
    for (const target of eventDescriptorRefs(rule)) {
      pushRef(refsTo, target.id, { from, path: `rules[${i}].when`, targetKind: target.kind })
    }
    const conditions: [keyof Rule & ('if' | 'ifAny'), readonly Condition[]][] = [
      ['if', rule.if],
      ['ifAny', rule.ifAny],
    ]
    for (const [key, list] of conditions) {
      list.forEach((cond, j) => {
        for (const target of conditionRefs(cond)) {
          pushRef(refsTo, target.id, { from, path: `rules[${i}].${key}[${j}]`, targetKind: target.kind })
        }
      })
    }
    if (options.actionRefs) {
      rule.then.forEach((action, j) => {
        for (const target of options.actionRefs!(action)) {
          pushRef(refsTo, target.id, { from, path: `rules[${i}].then[${j}]`, targetKind: target.kind })
        }
      })
    }
  })

  doc.media.forEach((media, i) => {
    pushRef(refsTo, media.assetId, {
      from: { kind: 'media', id: media.id },
      path: `media[${i}].assetId`,
      targetKind: 'asset',
    })
  })

  // T-227 · 覆盖层的两条出边。
  //
  // **只有 media 与 flow 两类。** 卡面写的是「mediaId / bind / flowId 三条」，而
  // `props.bind` 在 v3 冻结的 schema 里根本不存在（四支 props 都是 `.strict()`）。
  // 加一个字段进去是把 v1 唯一一次 bump 变成两次（铁律 8），所以照 schema 做两条。
  doc.pages.forEach((page, i) => {
    page.overlays.forEach((overlay, j) => {
      const from: RefTarget = { kind: 'overlay', id: overlay.id }
      const at = `pages[${i}].overlays[${j}].props`
      // 判别联合，用 `in` 收窄而不是 `as`
      if ('mediaId' in overlay.props && overlay.props.mediaId != null) {
        pushRef(refsTo, overlay.props.mediaId, { from, path: `${at}.mediaId`, targetKind: 'media' })
      }
      if ('flowId' in overlay.props && overlay.props.flowId != null) {
        pushRef(refsTo, overlay.props.flowId, { from, path: `${at}.flowId`, targetKind: 'flow' })
      }
    })
  })

  // T-227 · 数据源的映射出边。字段名是 `map` 不是 `mapping`（卡面写错了，以 schema 为准）。
  doc.dataSources.forEach((source, i) => {
    const from: RefTarget = { kind: 'dataSource', id: source.id }
    source.map.forEach((mapping, j) => {
      pushRef(refsTo, mapping.variableId, {
        from,
        path: `dataSources[${i}].map[${j}].variableId`,
        targetKind: 'variable',
      })
    })
  })

  doc.flows.forEach((flow, i) => {
    const from: RefTarget = { kind: 'flow', id: flow.id }
    pushRef(refsTo, flow.variableId, { from, path: `flows[${i}].variableId`, targetKind: 'variable' })

    // T-227 · 步骤的两条出边。
    //
    // `getFlowChain` 在这里**不是顺手用一下**：链的定义只写一次，是 `getStepPrev`
    // 与 v1.2 的「上一步」按钮能和索引给出同一个答案的唯一保证。
    if (flow.startStepId !== null) {
      pushRef(refsTo, flow.startStepId, { from, path: `flows[${i}].startStepId`, targetKind: 'step' })
    }
    const stepIndex = new Map(flow.steps.map((step, j) => [step.id, j]))
    for (const step of getFlowChain(flow)) {
      if (step.next === null) continue
      pushRef(refsTo, step.next, {
        from,
        path: `flows[${i}].steps[${stepIndex.get(step.id)}].next`,
        targetKind: 'step',
      })
    }
    if (options.actionRefs) {
      flow.steps.forEach((step, j) => {
        step.onEnter.forEach((action, k) => {
          for (const target of options.actionRefs!(action)) {
            pushRef(refsTo, target.id, { from, path: `flows[${i}].steps[${j}].onEnter[${k}]`, targetKind: target.kind })
          }
        })
      })
    }
  })

  return {
    nodeById,
    childrenOf,
    assetById,
    materialById,
    animationById,
    hotspotById,
    viewpointById,
    variableById,
    mediaById,
    rulesByEvent,
    refsTo,
    actionRefsResolved: options.actionRefs !== undefined,
  }
}

/** Inbound references to `id` — the answer to "what breaks if I delete this?". */
export function referencesTo(index: DocIndex, id: string): readonly Ref[] {
  return index.refsTo.get(id) ?? []
}

/**
 * "该节点被 2 条规则、1 个动画引用，确认删除？" — the sentence T-092 requires before a
 * delete. Returns an empty string when nothing points at `id`.
 */
export function describeReferences(index: DocIndex, id: string): string {
  const refs = referencesTo(index, id)
  if (refs.length === 0) return ''
  const labels: Record<string, string> = {
    rule: '条规则',
    animation: '个动画',
    hotspot: '个热点',
    node: '个对象',
    material: '个材质',
    media: '个多媒体',
    flow: '个流程',
    // T-227 · 两个新的引用方。**没有 `page`**：覆盖层的出边记在 overlay 名下
    // （验收要的是「1 个覆盖层」），所以 v1.0 没有任何 ref 的 `from.kind` 会是 page，
    // 加一条 page 标签就是加一条死表项。
    overlay: '个覆盖层',
    dataSource: '个数据源',
    document: '处场景设置',
  }
  const counts = new Map<string, Set<string>>()
  for (const ref of refs) {
    const set = counts.get(ref.from.kind) ?? new Set<string>()
    set.add(ref.from.id)
    counts.set(ref.from.kind, set)
  }
  return [...counts.entries()].map(([kind, set]) => `${set.size} ${labels[kind] ?? `个${kind}`}`).join('、')
}
