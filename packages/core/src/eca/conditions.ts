import type { Condition, Rule, ValueExpr } from '@w3/schema'
import { eventPayload } from './events.js'
import type { RuntimeContext, RuntimeEvent, VarValue } from './types.js'

/**
 * T-081 · ECA_SPEC §3.
 *
 * Evaluation is pure, synchronous and side-effect free. A condition that could change
 * state would make rule order observable and the whole rule table untestable.
 *
 * Comparison is STRICTLY typed: `"2" == 2` is false. A mismatch evaluates to false and
 * logs one warning. Silently coercing produces behaviour nobody can reproduce or
 * explain, and `checkIntegrity` I4 already catches most of these at save time — the
 * runtime warning is for the rest.
 */

/** `undefined` means "could not be read" — never conflated with a legitimate value. */
export function evaluateValueExpr(
  expr: ValueExpr,
  ctx: RuntimeContext,
  event: RuntimeEvent | null,
): VarValue | undefined {
  if ('const' in expr) return expr.const
  if ('var' in expr) return ctx.getVar(expr.var)
  if ('prop' in expr) return ctx.getNodeProp(expr.prop.nodeId, expr.prop.key)
  if (event === null) return undefined
  return eventPayload(event, expr.event)
}

const ORDERING_OPS = new Set(['gt', 'gte', 'lt', 'lte'])

function compare(op: string, left: VarValue, right: VarValue, ctx: RuntimeContext): boolean {
  if (typeof left !== typeof right) {
    ctx.log(
      'warn',
      `条件求值：类型不匹配，${typeof left} 与 ${typeof right} 比较，结果按 false 处理（不做隐式转换）`,
      { op, left, right },
    )
    return false
  }
  switch (op) {
    case 'eq':
      return left === right
    case 'ne':
      return left !== right
    default:
      break
  }
  if (typeof left === 'boolean') {
    ctx.log('warn', `条件求值：布尔值不支持 ${op} 比较`, { op, left, right })
    return false
  }
  const a = left as number | string
  const b = right as number | string
  switch (op) {
    case 'gt':
      return a > b
    case 'gte':
      return a >= b
    case 'lt':
      return a < b
    case 'lte':
      return a <= b
    default:
      ctx.log('error', `条件求值：未知比较运算符 ${op}`, { op })
      return false
  }
}

export function evaluateCondition(cond: Condition, ctx: RuntimeContext, event: RuntimeEvent | null): boolean {
  switch (cond.op) {
    case 'isVisible':
      return ctx.isVisible(cond.nodeId) === cond.value
    case 'isPlaying':
      return ctx.isAnimationPlaying(cond.animationId) === cond.value
    case 'isPanelOpen':
      return ctx.isPanelOpen(cond.hotspotId) === cond.value
    case 'isPageVisible':
      // v1.0 冻结形状、v1.2 才通电（T-225 · X-09/X-10）。**页面在 v1.0 从不渲染**，所以
      // 「页面 X 可见吗」在这一级的答案恒为否 —— 于是 `value: false` 的规则为真，
      // `value: true` 的为假。
      //
      // 不写成恒 `false`：那会让两种写法都得到 false，把一条「当页面没显示时」的规则
      // 静默变成永不触发。也不抛异常：一份配了 v1.2 规则的文档必须仍然能在 v1.0 播放器里
      // 打开并运行（C4），只是那条规则不生效。
      ctx.log('warn', '条件求值：isPageVisible 在 v1.0 尚未接线，按「页面不可见」处理', {
        op: cond.op,
        pageId: cond.pageId,
      })
      return cond.value === false
    case 'in': {
      const left = evaluateValueExpr(cond.left, ctx, event)
      if (left === undefined) {
        ctx.log('warn', '条件求值：左值无法读取，结果按 false 处理', { op: 'in' })
        return false
      }
      // Membership is exact-type, matching the comparison discipline above.
      return cond.right.some((candidate) => typeof candidate === typeof left && candidate === left)
    }
    default: {
      const left = evaluateValueExpr(cond.left, ctx, event)
      const right = evaluateValueExpr(cond.right, ctx, event)
      if (left === undefined || right === undefined) {
        ctx.log('warn', '条件求值：操作数无法读取，结果按 false 处理', {
          op: cond.op,
          leftMissing: left === undefined,
          rightMissing: right === undefined,
        })
        return false
      }
      if (ORDERING_OPS.has(cond.op) || cond.op === 'eq' || cond.op === 'ne') {
        return compare(cond.op, left, right, ctx)
      }
      return false
    }
  }
}

/**
 * ECA_SPEC §3.3 · the whole gate for one rule.
 *
 *   disabled                       -> false
 *   if empty and ifAny empty       -> true
 *   if non-empty                   -> every entry must hold
 *   ifAny non-empty                -> at least one entry must hold
 *   both non-empty                 -> (AND group) && (OR group)
 */
export function evaluateRuleConditions(rule: Rule, ctx: RuntimeContext, event: RuntimeEvent | null): boolean {
  if (!rule.enabled) return false
  const andOk = rule.if.length === 0 || rule.if.every((c) => evaluateCondition(c, ctx, event))
  if (!andOk) return false
  return rule.ifAny.length === 0 || rule.ifAny.some((c) => evaluateCondition(c, ctx, event))
}
