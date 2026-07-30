import type { Action, ValueExpr } from './eca/actions.js'
import { ACTION_CATALOG } from './eca/actions.js'
import type { Condition } from './eca/conditions.js'
import { EVENT_CATALOG } from './eca/events.js'
import type { ParamField, RefKind } from './eca/params.js'
import { refKindOf } from './eca/params.js'
import type { SceneDocument } from './document.js'
import type { Rule } from './eca/rules.js'

/**
 * Constitution C9's enforcement arm: a dangling reference is found here, before a
 * save and before a publish (D8), not by a customer clicking a button that does
 * nothing during acceptance.
 *
 * Two severities, and the distinction matters:
 *   error   — publishing is blocked. The document describes something impossible.
 *   warning — publishing proceeds. Most importantly, an orphaned assetRef after a
 *             re-import is a warning, never an error and never a deletion (D5):
 *             throwing away a customer's configuration is not an acceptable
 *             response to a model whose node names changed.
 */

export type IntegritySeverity = 'error' | 'warning'

export interface IntegrityIssue {
  readonly code: string
  readonly severity: IntegritySeverity
  /** Dotted/bracketed path into the document. */
  readonly path: string
  readonly message: string
  readonly refKind?: RefKind | 'asset' | 'flowStep' | 'media'
  readonly refId?: string
}

export interface IntegrityReport {
  readonly ok: boolean
  readonly issues: readonly IntegrityIssue[]
  readonly errors: readonly IntegrityIssue[]
  readonly warnings: readonly IntegrityIssue[]
}

interface Index {
  asset: Set<string>
  node: Set<string>
  material: Set<string>
  animation: Set<string>
  viewpoint: Set<string>
  hotspot: Set<string>
  variable: Set<string>
  media: Set<string>
}

function buildIndex(doc: SceneDocument): Index {
  return {
    asset: new Set(doc.assets.map((a) => a.id)),
    node: new Set(doc.nodes.map((n) => n.id)),
    material: new Set(doc.materials.map((m) => m.id)),
    animation: new Set(doc.animations.map((a) => a.id)),
    viewpoint: new Set(doc.viewpoints.map((v) => v.id)),
    hotspot: new Set(doc.hotspots.map((h) => h.id)),
    variable: new Set(doc.variables.map((v) => v.id)),
    media: new Set(doc.media.map((m) => m.id)),
  }
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
  flowStep: '流程步骤',
}

export function checkIntegrity(doc: SceneDocument): IntegrityReport {
  const issues: IntegrityIssue[] = []
  const index = buildIndex(doc)

  const add = (
    code: string,
    severity: IntegritySeverity,
    path: string,
    message: string,
    refKind?: IntegrityIssue['refKind'],
    refId?: string,
  ) => {
    issues.push({ code, severity, path, message, ...(refKind ? { refKind } : {}), ...(refId ? { refId } : {}) })
  }

  const requireRef = (kind: keyof Index, id: string | null | undefined, path: string, code = 'dangling-ref') => {
    if (id == null) return
    if (!index[kind].has(id)) {
      add(code, 'error', path, `引用了不存在的${KIND_LABEL[kind] ?? kind}：${id}`, kind as RefKind, id)
    }
  }

  /* --- 1. duplicate ids --------------------------------------------------- */
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
    ['media', doc.media],
    ['flows', doc.flows],
  ]
  for (const [name, items] of collections) {
    const seen = new Map<string, number>()
    items.forEach((item, i) => {
      const first = seen.get(item.id)
      if (first !== undefined) {
        add('duplicate-id', 'error', `${name}[${i}].id`, `id 重复：${item.id}（首次出现在 ${name}[${first}]）`)
      } else {
        seen.set(item.id, i)
      }
    })
  }

  /* --- 2. assets ----------------------------------------------------------- */
  doc.assets.forEach((asset, i) => {
    if (asset.supersedes != null && !index.asset.has(asset.supersedes)) {
      add('dangling-ref', 'warning', `assets[${i}].supersedes`, `被替代的资产已不在文档中：${asset.supersedes}`, 'asset', asset.supersedes)
    }
  })

  /* --- 3. node hierarchy --------------------------------------------------- */
  const parentOf = new Map<string, string | null>()
  doc.nodes.forEach((node, i) => {
    parentOf.set(node.id, node.parent)
    if (node.parent === node.id) {
      add('self-parent', 'error', `nodes[${i}].parent`, `对象不能是自己的父级：${node.id}`, 'node', node.id)
    } else {
      requireRef('node', node.parent, `nodes[${i}].parent`)
    }
    if (node.assetRef) {
      requireRef('asset', node.assetRef.assetId, `nodes[${i}].assetRef.assetId`)
      if (node.assetRef.missing === true) {
        add(
          'orphaned-asset-ref',
          'warning',
          `nodes[${i}].assetRef`,
          `对象「${node.name}」在资产中已找不到对应物体（${node.assetRef.objectPath}），需人工重新指定。配置已保留。`,
          'asset',
          node.assetRef.assetId,
        )
      }
    }
    requireRef('material', node.overrides.materialId, `nodes[${i}].overrides.materialId`)
  })

  // Cycle detection: colour-marking DFS, so a 3-node loop is reported once, not three times.
  const state = new Map<string, 0 | 1 | 2>()
  const reported = new Set<string>()
  for (const node of doc.nodes) {
    if (state.get(node.id) === 2) continue
    const stack: string[] = []
    let cur: string | null = node.id
    while (cur != null && state.get(cur) !== 2) {
      if (state.get(cur) === 1) {
        const loop = stack.slice(stack.indexOf(cur)).join(' -> ')
        if (!reported.has(cur)) {
          reported.add(cur)
          add('parent-cycle', 'error', `nodes`, `父子关系成环：${loop} -> ${cur}`, 'node', cur)
        }
        break
      }
      state.set(cur, 1)
      stack.push(cur)
      const next: string | null = parentOf.has(cur) ? (parentOf.get(cur) ?? null) : null
      cur = next
    }
    for (const id of stack) state.set(id, 2)
  }

  /* --- 4. materials -------------------------------------------------------- */
  doc.materials.forEach((mat, i) => {
    for (const [slot, assetId] of Object.entries(mat.maps)) {
      if (assetId == null) continue
      requireRef('asset', assetId, `materials[${i}].maps.${slot}`)
      const asset = doc.assets.find((a) => a.id === assetId)
      if (asset && asset.type !== 'texture' && asset.type !== 'image') {
        add('wrong-asset-type', 'error', `materials[${i}].maps.${slot}`, `贴图槽位引用了非贴图资产（type=${asset.type}）`, 'asset', assetId)
      }
    }
  })

  /* --- 5. animations ------------------------------------------------------- */
  doc.animations.forEach((anim, i) => {
    if (anim.kind === 'imported') {
      requireRef('asset', anim.assetId, `animations[${i}].assetId`)
      const asset = doc.assets.find((a) => a.id === anim.assetId)
      if (asset && asset.type !== 'model') {
        add('wrong-asset-type', 'error', `animations[${i}].assetId`, `导入动画必须来自模型资产（当前 type=${asset.type}）`, 'asset', anim.assetId)
      }
      if (asset?.stats && asset.stats.animations === 0) {
        add('no-clips', 'warning', `animations[${i}].clipName`, `资产「${asset.filename}」的体检结果显示不含任何动画片段`, 'asset', anim.assetId)
      }
    } else {
      anim.targets.forEach((t, j) => requireRef('node', t.nodeId, `animations[${i}].targets[${j}].nodeId`))
      const dupes = new Set<string>()
      const seen = new Set<string>()
      for (const t of anim.targets) {
        if (seen.has(t.nodeId)) dupes.add(t.nodeId)
        seen.add(t.nodeId)
      }
      for (const id of dupes) {
        add('duplicate-tween-target', 'warning', `animations[${i}].targets`, `同一对象在补间中出现多次，后者会覆盖前者：${id}`, 'node', id)
      }
    }
  })

  /* --- 6. hotspots --------------------------------------------------------- */
  doc.hotspots.forEach((h, i) => requireRef('node', h.anchor.nodeId, `hotspots[${i}].anchor.nodeId`))

  /* --- 7. rules ------------------------------------------------------------ */
  doc.rules.forEach((rule, i) => checkRule(rule, `rules[${i}]`, index, add, doc))

  /* --- 8. reserved collections (defined but not executed in v0) ------------ */
  doc.media.forEach((m, i) => requireRef('asset', m.assetId, `media[${i}].assetId`))
  doc.pages.forEach((p, i) =>
    p.overlays.forEach((o, j) => {
      if (o.mediaId != null && !index.media.has(o.mediaId)) {
        add('dangling-ref', 'error', `pages[${i}].overlays[${j}].mediaId`, `引用了不存在的多媒体：${o.mediaId}`, 'media', o.mediaId)
      }
    }),
  )
  doc.flows.forEach((f, i) => {
    const stepIds = new Set(f.steps.map((s) => s.id))
    f.steps.forEach((s, j) => {
      if (s.next != null && !stepIds.has(s.next)) {
        add('dangling-ref', 'error', `flows[${i}].steps[${j}].next`, `指向了不存在的流程步骤：${s.next}`, 'flowStep', s.next)
      }
    })
    requireRef('variable', f.stateVariableId, `flows[${i}].stateVariableId`)
  })

  const errors = issues.filter((i) => i.severity === 'error')
  const warnings = issues.filter((i) => i.severity === 'warning')
  return { ok: errors.length === 0, issues, errors, warnings }
}

/* -------------------------------------------------------------------------- */

type AddFn = (
  code: string,
  severity: IntegritySeverity,
  path: string,
  message: string,
  refKind?: IntegrityIssue['refKind'],
  refId?: string,
) => void

function checkRule(rule: Rule, base: string, index: Index, add: AddFn, doc: SceneDocument): void {
  const requireRef = (kind: keyof Index, id: string | null | undefined, path: string) => {
    if (id == null) return
    if (!index[kind].has(id)) {
      add('dangling-ref', 'error', path, `引用了不存在的${KIND_LABEL[kind] ?? kind}：${id}`, kind as RefKind, id)
    }
  }

  /* when — driven entirely by EVENT_CATALOG, so a new event type needs no code here */
  const trigger = rule.when as unknown as Record<string, unknown>
  const eventDesc = EVENT_CATALOG[rule.when.event]
  if (!eventDesc) {
    add('unknown-event', 'error', `${base}.when.event`, `未注册的事件类型：${rule.when.event}`)
  } else {
    checkParamRefs(eventDesc.params, trigger, `${base}.when`, index, add, requireRef)
  }

  /* if */
  rule.if.forEach((cond, i) => checkCondition(cond, `${base}.if[${i}]`, index, add, requireRef))

  /* then — driven entirely by ACTION_CATALOG (C5) */
  rule.then.forEach((action, i) => {
    const path = `${base}.then[${i}]`
    const desc = ACTION_CATALOG[action.action]
    if (!desc) {
      add('unknown-action', 'error', `${path}.action`, `未注册的动作类型：${action.action}`)
      return
    }
    checkParamRefs(desc.params, action as unknown as Record<string, unknown>, path, index, add, requireRef)

    if (action.action === 'setVariable') {
      checkValueExpr(action.value, `${path}.value`, index, add)
      const variable = doc.variables.find((v) => v.id === action.variableId)
      const literal = literalTypeOf(action.value)
      if (variable && literal && literal !== variable.type) {
        add(
          'type-mismatch',
          'warning',
          `${path}.value`,
          `变量「${variable.id}」声明为 ${variable.type}，此处写入 ${literal}`,
          'variable',
          variable.id,
        )
      }
    }
  })

  if (rule.mode === 'parallel') {
    const awaitables = rule.then.filter((a) => ACTION_CATALOG[a.action]?.awaitable)
    if (awaitables.length === 0 && rule.then.length > 1) {
      add(
        'pointless-parallel',
        'warning',
        `${base}.mode`,
        '并行模式下没有任何耗时动作，与顺序执行等价',
      )
    }
  }
}

/** Walks a catalog param list and validates every reference-typed field. */
function checkParamRefs(
  params: readonly ParamField[],
  value: Record<string, unknown>,
  base: string,
  _index: Index,
  add: AddFn,
  requireRef: (kind: keyof Index, id: string | null | undefined, path: string) => void,
): void {
  for (const field of params) {
    const refKind = refKindOf(field)
    const raw = value[field.key]
    if (raw == null) {
      if (field.required) {
        add('missing-param', 'error', `${base}.${field.key}`, `必填参数「${field.label}」为空`)
      }
      continue
    }
    if (refKind && typeof raw === 'string') {
      requireRef(refKind as keyof Index, raw, `${base}.${field.key}`)
    }
  }
}

function checkCondition(
  cond: Condition,
  path: string,
  index: Index,
  add: AddFn,
  requireRef: (kind: keyof Index, id: string | null | undefined, path: string) => void,
): void {
  switch (cond.op) {
    case 'and':
    case 'or':
      cond.conditions.forEach((c, i) => checkCondition(c, `${path}.conditions[${i}]`, index, add, requireRef))
      return
    case 'not':
      checkCondition(cond.condition, `${path}.condition`, index, add, requireRef)
      return
    case 'nodeVisible':
      requireRef('node', cond.nodeId, `${path}.nodeId`)
      return
    case 'animationPlaying':
      requireRef('animation', cond.animationId, `${path}.animationId`)
      return
    default: {
      for (const side of ['left', 'right'] as const) {
        const operand = cond[side]
        if ('var' in operand) requireRef('variable', operand.var, `${path}.${side}.var`)
      }
    }
  }
}

function checkValueExpr(expr: ValueExpr, path: string, index: Index, add: AddFn): void {
  if ('var' in expr) {
    if (!index.variable.has(expr.var)) {
      add('dangling-ref', 'error', `${path}.var`, `引用了不存在的变量：${expr.var}`, 'variable', expr.var)
    }
    return
  }
  if ('op' in expr) {
    checkValueExpr(expr.left, `${path}.left`, index, add)
    checkValueExpr(expr.right, `${path}.right`, index, add)
  }
}

function literalTypeOf(expr: ValueExpr): 'number' | 'string' | 'boolean' | null {
  if ('const' in expr) return typeof expr.const as 'number' | 'string' | 'boolean'
  if ('op' in expr) return 'number'
  return null
}

/** Formats a report for a publish dialog or a CLI. */
export function formatIntegrityReport(report: IntegrityReport): string {
  if (report.issues.length === 0) return '完整性检查通过，无问题。'
  const line = (i: IntegrityIssue) => `  [${i.severity === 'error' ? '阻断' : '提示'}] ${i.path} — ${i.message}`
  const parts: string[] = []
  if (report.errors.length > 0) parts.push(`${report.errors.length} 项阻断：`, ...report.errors.map(line))
  if (report.warnings.length > 0) parts.push(`${report.warnings.length} 项提示：`, ...report.warnings.map(line))
  return parts.join('\n')
}
