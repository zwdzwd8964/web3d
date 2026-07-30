import type { Animation } from './animation.js'
import type { Asset } from './asset.js'
import type { SceneDocument } from './document.js'
import type { Hotspot } from './hotspot.js'
import type { Material } from './material.js'
import type { Node } from './node.js'
import type { Action, Condition, EventType, Rule, ValueExpr } from './rule.js'
import { getChildren } from './selectors.js'
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

  const childrenOf = new Map<string | null, Node[]>()
  childrenOf.set(null, getChildren(doc, null))
  for (const node of doc.nodes) childrenOf.set(node.id, getChildren(doc, node.id))

  const rulesByEvent = new Map<EventType, Rule[]>()
  for (const rule of doc.rules) {
    const list = rulesByEvent.get(rule.when.event)
    if (list) list.push(rule)
    else rulesByEvent.set(rule.when.event, [rule])
  }

  const refsTo = new Map<string, Ref[]>()

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

  doc.flows.forEach((flow, i) => {
    const from: RefTarget = { kind: 'flow', id: flow.id }
    pushRef(refsTo, flow.variableId, { from, path: `flows[${i}].variableId`, targetKind: 'variable' })
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
  }
  const counts = new Map<string, Set<string>>()
  for (const ref of refs) {
    const set = counts.get(ref.from.kind) ?? new Set<string>()
    set.add(ref.from.id)
    counts.set(ref.from.kind, set)
  }
  return [...counts.entries()].map(([kind, set]) => `${set.size} ${labels[kind] ?? `个${kind}`}`).join('、')
}
