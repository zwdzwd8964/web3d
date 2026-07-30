import type { Condition, EventDescriptor, Rule, SceneDocument, ValueExpr } from '@w3/schema'
import type { ActionRegistry } from './actions/registry.js'
import { defaultRegistry } from './actions/registry.js'
import { animationName, hotspotName, nodeName, variableName } from './actions/define.js'

/**
 * T-087 · ECA_SPEC §8 · technical assessment R14.
 *
 * The contract requires an acceptance test-case document (Appendix C) and the schedule
 * reserves four person-days for acceptance material. Generating the interaction cases
 * from the rule table eats a large part of that, and — more valuable — it removes the
 * most embarrassing thing that can happen during acceptance: the document describing
 * behaviour the software does not have. Both come from the same source.
 */

export interface TestCase {
  /** `TC-RL-001` */
  readonly id: string
  readonly title: string
  readonly precondition: string
  readonly steps: readonly string[]
  readonly expected: readonly string[]
  readonly ruleId: string
}

function describeValueExpr(expr: ValueExpr, doc: SceneDocument): string {
  if ('const' in expr) return typeof expr.const === 'string' ? `「${expr.const}」` : String(expr.const)
  if ('var' in expr) return `变量「${variableName(doc, expr.var)}」`
  if ('prop' in expr) return `对象「${nodeName(doc, expr.prop.nodeId)}」的 ${expr.prop.key}`
  return `本次事件的 ${expr.event}`
}

const COMPARE_TEXT: Record<string, string> = {
  eq: '等于',
  ne: '不等于',
  gt: '大于',
  gte: '不小于',
  lt: '小于',
  lte: '不大于',
}

export function describeCondition(cond: Condition, doc: SceneDocument): string {
  switch (cond.op) {
    case 'isVisible':
      return `对象「${nodeName(doc, cond.nodeId)}」${cond.value ? '可见' : '不可见'}`
    case 'isPlaying':
      return `动画「${animationName(doc, cond.animationId)}」${cond.value ? '正在播放' : '未在播放'}`
    case 'isPanelOpen':
      return `热点「${hotspotName(doc, cond.hotspotId)}」的面板${cond.value ? '已打开' : '未打开'}`
    case 'in':
      return `${describeValueExpr(cond.left, doc)} 属于 [${cond.right.join(', ')}]`
    default:
      return `${describeValueExpr(cond.left, doc)} ${COMPARE_TEXT[cond.op] ?? cond.op} ${describeValueExpr(cond.right, doc)}`
  }
}

export function describeTrigger(when: EventDescriptor, doc: SceneDocument): string {
  switch (when.event) {
    case 'sceneReady':
      return '打开场景，等待首帧渲染完成'
    case 'click':
    case 'hoverEnter':
    case 'hoverLeave': {
      const verb = when.event === 'click' ? '点击' : when.event === 'hoverEnter' ? '将鼠标移入' : '将鼠标移出'
      if ('any' in when.target) return `在场景中${verb}任意对象`
      const subtree = 'includeDescendants' in when.target ? '（或其任意子对象）' : ''
      return `在场景中${verb}「${nodeName(doc, when.target.nodeId)}」${subtree}`
    }
    case 'hotspotClick':
      return `点击热点「${hotspotName(doc, when.hotspotId)}」`
    case 'animationEnd':
      return `等待动画「${animationName(doc, when.animationId)}」自然播放结束`
    case 'variableChange':
      return `使变量「${variableName(doc, when.variableId)}」的值发生变化`
    case 'timer':
      return `等待 ${when.delay} 毫秒${when.repeat ? '（此后每隔相同时间重复）' : ''}`
    default:
      return '触发规则'
  }
}

function preconditionOf(rule: Rule, doc: SceneDocument): string {
  const parts: string[] = []
  if (rule.if.length > 0) parts.push(rule.if.map((c) => describeCondition(c, doc)).join('，且 '))
  if (rule.ifAny.length > 0) parts.push(`满足其一：${rule.ifAny.map((c) => describeCondition(c, doc)).join('；或 ')}`)
  return parts.length === 0 ? '无（任何情况下都应触发）' : parts.join('；同时 ')
}

export interface GenerateOptions {
  readonly registry?: ActionRegistry
  /** Include rules whose `enabled` is false. Off by default: they cannot be demonstrated. */
  readonly includeDisabled?: boolean
}

export function generateTestCases(doc: SceneDocument, options: GenerateOptions = {}): TestCase[] {
  const registry = options.registry ?? defaultRegistry
  const rules = options.includeDisabled ? doc.rules : doc.rules.filter((r) => r.enabled)

  return rules.map((rule, i) => {
    const expected = rule.then.map((action, index) => {
      const definition = registry.get(action.action)
      if (!definition) return `（第 ${index + 1} 步：未注册的动作「${action.action}」，无法生成预期结果）`
      const parsed = definition.schema.safeParse(action.params)
      if (!parsed.success) return `（第 ${index + 1} 步：动作参数不合法，无法生成预期结果）`
      return definition.describe(parsed.data, doc)
    })

    return {
      id: `TC-RL-${String(i + 1).padStart(3, '0')}`,
      title: rule.name,
      precondition: preconditionOf(rule, doc),
      steps: [describeTrigger(rule.when, doc)],
      expected:
        rule.mode === 'parallel'
          ? [`以下效果同时发生：`, ...expected]
          : expected.map((text, index) => `${index + 1}. ${text}`),
      ruleId: rule.id,
    }
  })
}

const escapeCell = (text: string) => text.replace(/\|/g, '\\|').replace(/\n/g, '<br>')

/** Renders the cases as the Markdown table that seeds Appendix C. */
export function renderTestCasesMarkdown(cases: readonly TestCase[]): string {
  const lines = [
    '# 附件C 验收测试用例（交互部分 · 自动生成）',
    '',
    '> 本表由 `generateTestCases(doc)` 从规则表生成，措辞与实际执行行为同源。',
    '> 非交互类功能（导入、发布、出图）的用例需人工补充。',
    '',
    '| 用例编号 | 名称 | 前置条件 | 操作步骤 | 预期结果 |',
    '|---|---|---|---|---|',
  ]
  for (const c of cases) {
    lines.push(
      `| ${c.id} | ${escapeCell(c.title)} | ${escapeCell(c.precondition)} | ${escapeCell(
        c.steps.join('<br>'),
      )} | ${escapeCell(c.expected.join('<br>'))} |`,
    )
  }
  if (cases.length === 0) lines.push('| — | （文档中没有启用的规则） | — | — | — |')
  return `${lines.join('\n')}\n`
}
