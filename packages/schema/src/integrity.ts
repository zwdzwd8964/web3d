import type { SceneDocument } from './document.js'
import type { ActionRefResolver, RefTarget } from './index-builder.js'
import type { Condition, Rule, ValueExpr } from './rule.js'
import { getUnreachableNodes } from './selectors.js'
import { isValueOfType } from './variable.js'

/**
 * SCHEMA_SPEC §9 · reference and logic integrity. Zod answers "is the shape right";
 * this answers "does any of it actually resolve".
 *
 * Three levels, and the distinction is load-bearing:
 *   error — publishing is blocked (MVP_V0 D8). The document describes something
 *           impossible.
 *   warn  — shown, never blocking. An orphaned assetRef after a re-import is the
 *           canonical case: the user's rules, materials and hotspots on that node are
 *           still valuable, and deleting their work is not an acceptable response to a
 *           model whose node names changed (§5.3).
 *   info  — an observation, e.g. an animation nothing ever triggers.
 */

export type IntegrityLevel = 'error' | 'warn' | 'info'

export interface IntegrityIssue {
  /** The SCHEMA_SPEC §9 check id: I1 … I10. */
  readonly code: string
  readonly level: IntegrityLevel
  /** Bracketed document path, e.g. `rules[0].when`. */
  readonly path: string
  readonly message: string
  readonly refKind?: string
  readonly refId?: string
}

export interface CheckIntegrityOptions {
  /**
   * Resolves the ids inside an action's `params`. Supplied by core, whose action
   * registry is the only place that knows what a given action's params mean.
   * Without it, I3/I8/I9 cannot see into action parameters — and this module says so
   * (`I3-actions-unchecked`) rather than reporting a clean bill of health it did not earn.
   */
  readonly actionRefs?: ActionRefResolver
}

const KIND_LABEL: Record<string, string> = {
  asset: '资产',
  node: '对象',
  material: '材质',
  animation: '动画',
  viewpoint: '视点',
  hotspot: '热点',
  variable: '变量',
  media: '多媒体',
  step: '流程步骤',
}

export function checkIntegrity(doc: SceneDocument, options: CheckIntegrityOptions = {}): IntegrityIssue[] {
  const issues: IntegrityIssue[] = []
  const add = (
    code: string,
    level: IntegrityLevel,
    path: string,
    message: string,
    ref?: { kind: string; id: string },
  ) => {
    issues.push({ code, level, path, message, ...(ref ? { refKind: ref.kind, refId: ref.id } : {}) })
  }

  const sets: Record<string, Set<string>> = {
    asset: new Set(doc.assets.map((a) => a.id)),
    node: new Set(doc.nodes.map((n) => n.id)),
    material: new Set(doc.materials.map((m) => m.id)),
    animation: new Set(doc.animations.map((a) => a.id)),
    hotspot: new Set(doc.hotspots.map((h) => h.id)),
    viewpoint: new Set(doc.viewpoints.map((v) => v.id)),
    variable: new Set(doc.variables.map((v) => v.id)),
    media: new Set(doc.media.map((m) => m.id)),
  }

  const requireRef = (code: string, kind: string, id: string | null | undefined, path: string) => {
    if (id == null) return
    if (!sets[kind]?.has(id)) {
      add(code, 'error', path, `引用了不存在的${KIND_LABEL[kind] ?? kind}：${id}`, { kind, id })
    }
  }

  /* --- I1 · ids unique within each collection ---------------------------- */
  const collections: [string, readonly { id: string }[]][] = [
    ['assets', doc.assets],
    ['nodes', doc.nodes],
    ['materials', doc.materials],
    ['animations', doc.animations],
    ['hotspots', doc.hotspots],
    ['viewpoints', doc.viewpoints],
    ['variables', doc.variables],
    ['rules', doc.rules],
    ['pages', doc.pages],
    ['flows', doc.flows],
    ['media', doc.media],
  ]
  for (const [name, items] of collections) {
    const first = new Map<string, number>()
    items.forEach((item, i) => {
      const at = first.get(item.id)
      if (at !== undefined) add('I1', 'error', `${name}[${i}].id`, `id 重复：${item.id}（首次出现在 ${name}[${at}]）`)
      else first.set(item.id, i)
    })
  }
  for (const [i, flow] of doc.flows.entries()) {
    const first = new Map<string, number>()
    flow.steps.forEach((step, j) => {
      const at = first.get(step.id)
      if (at !== undefined) add('I1', 'error', `flows[${i}].steps[${j}].id`, `流程步骤 id 重复：${step.id}`)
      else first.set(step.id, j)
    })
  }

  /* --- I2 · parent resolves, and the parent chain is acyclic -------------- */
  const parentOf = new Map<string, string | null>()
  doc.nodes.forEach((node, i) => {
    parentOf.set(node.id, node.parent)
    if (node.parent === node.id) {
      add('I2', 'error', `nodes[${i}].parent`, `对象不能是自己的父级：${node.id}`, { kind: 'node', id: node.id })
    } else {
      requireRef('I2', 'node', node.parent, `nodes[${i}].parent`)
    }
  })

  // Colour-marking DFS so an N-node loop is reported once, not N times.
  const state = new Map<string, 1 | 2>()
  const reportedCycle = new Set<string>()
  for (const node of doc.nodes) {
    if (state.get(node.id) === 2) continue
    const stack: string[] = []
    let cursor: string | null = node.id
    while (cursor != null && state.get(cursor) !== 2) {
      if (state.get(cursor) === 1) {
        if (!reportedCycle.has(cursor)) {
          const loop = stack.slice(stack.indexOf(cursor))
          for (const id of loop) reportedCycle.add(id)
          add('I2', 'error', 'nodes', `父子关系成环：${[...loop, cursor].join(' -> ')}`, { kind: 'node', id: cursor })
        }
        break
      }
      state.set(cursor, 1)
      stack.push(cursor)
      cursor = parentOf.has(cursor) ? (parentOf.get(cursor) ?? null) : null
    }
    for (const id of stack) state.set(id, 2)
  }

  /* --- I3 · every reference resolves -------------------------------------- */
  doc.assets.forEach((asset, i) => {
    if (asset.lineageId !== asset.id) requireRef('I3', 'asset', asset.lineageId, `assets[${i}].lineageId`)
    if (asset.version === 1 && asset.lineageId !== asset.id) {
      add('I3', 'warn', `assets[${i}].lineageId`, `version 为 1 的资产其 lineageId 应等于自身 id`)
    }
  })

  doc.nodes.forEach((node, i) => {
    if (node.assetRef) requireRef('I3', 'asset', node.assetRef.assetId, `nodes[${i}].assetRef.assetId`)
    requireRef('I3', 'material', node.overrides.materialId, `nodes[${i}].overrides.materialId`)
  })

  doc.materials.forEach((material, i) => {
    for (const [slot, assetId] of Object.entries(material.params.maps)) {
      if (assetId == null) continue
      requireRef('I3', 'asset', assetId, `materials[${i}].params.maps.${slot}`)
      const asset = doc.assets.find((a) => a.id === assetId)
      if (asset && asset.type !== 'texture' && asset.type !== 'image') {
        add('I3', 'error', `materials[${i}].params.maps.${slot}`, `贴图槽位引用了非贴图资产（type=${asset.type}）`, {
          kind: 'asset',
          id: assetId,
        })
      }
    }
  })

  doc.hotspots.forEach((hotspot, i) => {
    requireRef('I3', 'node', hotspot.anchor.nodeId, `hotspots[${i}].anchor.nodeId`)
    requireRef('I3', 'media', hotspot.content.mediaId, `hotspots[${i}].content.mediaId`)
  })

  doc.media.forEach((media, i) => requireRef('I3', 'asset', media.assetId, `media[${i}].assetId`))

  doc.flows.forEach((flow, i) => {
    requireRef('I3', 'variable', flow.variableId, `flows[${i}].variableId`)
    const stepIds = new Set(flow.steps.map((s) => s.id))
    flow.steps.forEach((step, j) => {
      if (step.next != null && !stepIds.has(step.next)) {
        add('I3', 'error', `flows[${i}].steps[${j}].next`, `指向了不存在的流程步骤：${step.next}`, {
          kind: 'step',
          id: step.next,
        })
      }
    })
  })

  /* --- I6 · animations ----------------------------------------------------- */
  doc.animations.forEach((animation, i) => {
    if (animation.kind === 'imported') {
      requireRef('I3', 'asset', animation.assetId, `animations[${i}].assetId`)
      const asset = doc.assets.find((a) => a.id === animation.assetId)
      if (asset && asset.type !== 'model') {
        add('I3', 'error', `animations[${i}].assetId`, `导入动画必须来自模型资产（当前 type=${asset.type}）`)
      }
      if (asset && asset.stats.animations.length > 0 && !asset.stats.animations.includes(animation.clipName)) {
        add('I6', 'error', `animations[${i}].clipName`, `资产「${asset.name}」中不存在名为「${animation.clipName}」的动画片段`)
      }
    } else {
      if (animation.targets.length === 0) {
        add('I6', 'error', `animations[${i}].targets`, '补间动画必须至少有一个目标对象')
      }
      animation.targets.forEach((t, j) => requireRef('I6', 'node', t.nodeId, `animations[${i}].targets[${j}].nodeId`))
    }
  })

  /* --- I5 · enum variables ------------------------------------------------- */
  doc.variables.forEach((variable, i) => {
    if (variable.type === 'enum') {
      if (!variable.options || variable.options.length === 0) {
        add('I5', 'error', `variables[${i}].options`, `枚举变量「${variable.id}」必须提供 options`)
      } else if (typeof variable.default !== 'string' || !variable.options.includes(variable.default)) {
        add('I5', 'error', `variables[${i}].default`, `枚举变量「${variable.id}」的默认值不在 options 中`)
      }
    } else if (!isValueOfType(variable.default, variable.type)) {
      add('I5', 'error', `variables[${i}].default`, `变量「${variable.id}」声明为 ${variable.type}，默认值类型不匹配`)
    }
  })

  /* --- I4 / I8 · rules ----------------------------------------------------- */
  const missingNodeIds = new Set(doc.nodes.filter((n) => n.assetRef?.missing === true).map((n) => n.id))
  const referencedAnimations = new Set<string>()

  doc.rules.forEach((rule, i) => {
    checkRuleRefs(rule, `rules[${i}]`, requireRef)
    checkRuleConditionTypes(rule, `rules[${i}]`, doc, add)

    if (rule.when.event === 'animationEnd') referencedAnimations.add(rule.when.animationId)
    for (const cond of [...rule.if, ...rule.ifAny]) {
      if (cond.op === 'isPlaying') referencedAnimations.add(cond.animationId)
    }

    if (options.actionRefs) {
      rule.then.forEach((action, j) => {
        for (const target of options.actionRefs!(action)) {
          requireRef('I3', target.kind, target.id, `rules[${i}].then[${j}].params`)
          if (target.kind === 'animation') referencedAnimations.add(target.id)
          if (rule.enabled && target.kind === 'node' && missingNodeIds.has(target.id)) {
            add(
              'I8',
              'warn',
              `rules[${i}].then[${j}]`,
              `规则「${rule.name}」引用了资产映射已失效的对象，运行时该步骤会被跳过`,
              { kind: 'node', id: target.id },
            )
          }
        }
      })
    }
  })

  if (!options.actionRefs && doc.rules.some((r) => r.then.length > 0)) {
    add(
      'I3-actions-unchecked',
      'info',
      'rules',
      '未提供动作参数解析器，规则动作内的引用未被检查（由 @w3/core 的动作注册表提供）',
    )
  }

  /* --- I7 · orphaned asset references ------------------------------------- */
  doc.nodes.forEach((node, i) => {
    if (node.assetRef?.missing === true) {
      add(
        'I7',
        'warn',
        `nodes[${i}].assetRef`,
        `对象「${node.name}」在资产中已找不到对应物体（${node.assetRef.objectPath}），需人工重新指定。配置已保留。`,
        { kind: 'asset', id: node.assetRef.assetId },
      )
    }
  })

  /* --- I9 · animations nothing ever triggers ------------------------------- */
  if (options.actionRefs) {
    doc.animations.forEach((animation, i) => {
      if (!referencedAnimations.has(animation.id)) {
        add('I9', 'info', `animations[${i}]`, `动画「${animation.name}」未被任何规则引用`)
      }
    })
  }

  /* --- I10 · unreachable nodes --------------------------------------------- */
  for (const node of getUnreachableNodes(doc)) {
    const i = doc.nodes.findIndex((n) => n.id === node.id)
    add('I10', 'error', `nodes[${i}]`, `对象「${node.name}」的父级链无法回到根节点，它不会出现在场景中`, {
      kind: 'node',
      id: node.id,
    })
  }

  return issues
}

/* -------------------------------------------------------------------------- */

type RequireRefFn = (code: string, kind: string, id: string | null | undefined, path: string) => void
type AddFn = (
  code: string,
  level: IntegrityLevel,
  path: string,
  message: string,
  ref?: { kind: string; id: string },
) => void

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

function checkRuleRefs(rule: Rule, base: string, requireRef: RequireRefFn): void {
  const w = rule.when
  switch (w.event) {
    case 'click':
    case 'hoverEnter':
    case 'hoverLeave':
      if ('nodeId' in w.target) requireRef('I3', 'node', w.target.nodeId, `${base}.when.target.nodeId`)
      break
    case 'hotspotClick':
      requireRef('I3', 'hotspot', w.hotspotId, `${base}.when.hotspotId`)
      break
    case 'animationEnd':
      requireRef('I3', 'animation', w.animationId, `${base}.when.animationId`)
      break
    case 'variableChange':
      requireRef('I4', 'variable', w.variableId, `${base}.when.variableId`)
      break
    default:
      break
  }

  const groups: ['if' | 'ifAny', readonly Condition[]][] = [
    ['if', rule.if],
    ['ifAny', rule.ifAny],
  ]
  for (const [key, list] of groups) {
    list.forEach((cond, j) => {
      for (const target of conditionRefs(cond)) {
        requireRef(target.kind === 'variable' ? 'I4' : 'I3', target.kind, target.id, `${base}.${key}[${j}]`)
      }
    })
  }
}

/** I4's second half: a comparison whose literal cannot match the variable's type. */
function checkRuleConditionTypes(rule: Rule, base: string, doc: SceneDocument, add: AddFn): void {
  const variableById = new Map(doc.variables.map((v) => [v.id, v]))

  const literalOf = (expr: ValueExpr): string | number | boolean | undefined =>
    'const' in expr ? expr.const : undefined
  const variableOf = (expr: ValueExpr) => ('var' in expr ? variableById.get(expr.var) : undefined)

  const groups: ['if' | 'ifAny', readonly Condition[]][] = [
    ['if', rule.if],
    ['ifAny', rule.ifAny],
  ]

  for (const [key, list] of groups) {
    list.forEach((cond, j) => {
      const path = `${base}.${key}[${j}]`
      if (cond.op === 'in') {
        const variable = variableOf(cond.left)
        if (!variable) return
        const bad = cond.right.filter((v) => !isValueOfType(v, variable.type))
        if (bad.length > 0) {
          add('I4', 'error', path, `变量「${variable.id}」声明为 ${variable.type}，候选值中有 ${bad.length} 项类型不符`, {
            kind: 'variable',
            id: variable.id,
          })
        }
        return
      }
      if (cond.op === 'isVisible' || cond.op === 'isPlaying' || cond.op === 'isPanelOpen') return

      for (const [a, b] of [
        [cond.left, cond.right],
        [cond.right, cond.left],
      ] as const) {
        const variable = variableOf(a)
        const literal = literalOf(b)
        if (!variable || literal === undefined) continue
        if (!isValueOfType(literal, variable.type)) {
          add(
            'I4',
            'error',
            path,
            `变量「${variable.id}」声明为 ${variable.type}，此处与 ${typeof literal} 比较；求值不做隐式转换，条件将永远为假`,
            { kind: 'variable', id: variable.id },
          )
        }
      }
    })
  }
}

/* -------------------------------------------------------------------------- */

export const hasErrors = (issues: readonly IntegrityIssue[]): boolean => issues.some((i) => i.level === 'error')

export const errorsOf = (issues: readonly IntegrityIssue[]) => issues.filter((i) => i.level === 'error')
export const warningsOf = (issues: readonly IntegrityIssue[]) => issues.filter((i) => i.level === 'warn')

/** Rendered verbatim by the publish dialog and the issue panel. */
export function formatIntegrityIssues(issues: readonly IntegrityIssue[]): string {
  if (issues.length === 0) return '完整性检查通过，无问题。'
  const label: Record<IntegrityLevel, string> = { error: '阻断', warn: '提示', info: '信息' }
  const order: IntegrityLevel[] = ['error', 'warn', 'info']
  const lines: string[] = []
  for (const level of order) {
    const group = issues.filter((i) => i.level === level)
    if (group.length === 0) continue
    lines.push(`${group.length} 项${label[level]}：`)
    for (const i of group) lines.push(`  [${i.code}] ${i.path} — ${i.message}`)
  }
  return lines.join('\n')
}
