import type { Action, DocIndex, Rule } from '@w3/schema'
import type { ActionRegistry } from './actions/registry.js'
import { defaultRegistry } from './actions/registry.js'
import { refExists, refTypeOk } from './ref-kinds.js'
import type { ExecResult, ExecStep, RuntimeContext, RuntimeEvent, StepStatus } from './types.js'
import { isAbortError } from './types.js'

/**
 * T-083 · ECA_SPEC §5.
 *
 * This file must never learn the name of a single concrete action. It looks a function
 * up in the registry, hands it parameters, and awaits it. The moment a branch on action
 * type appears here (anti-pattern A3), extension-by-configuration is dead and every new
 * customer requirement reopens the engine — which is the exact failure mode C5 exists
 * to prevent. `scripts/check-core-purity.mjs` fails the build if one appears.
 */

export interface ExecuteOptions {
  readonly registry?: ActionRegistry
  /** Used to check that an action's references still resolve (ECA_SPEC §9.2 B9). */
  readonly index?: DocIndex
}

interface StepOutcome {
  readonly status: StepStatus
  readonly error?: string
}

async function runStep(
  action: Action,
  order: number,
  rule: Rule,
  ctx: RuntimeContext,
  signal: AbortSignal,
  options: ExecuteOptions,
): Promise<StepOutcome> {
  const registry = options.registry ?? defaultRegistry

  if (signal.aborted) return { status: 'skipped' }

  const definition = registry.get(action.action)
  if (!definition) {
    const message = `未注册的动作类型「${action.action}」`
    ctx.log('error', `规则「${rule.name}」第 ${order + 1} 步：${message}`)
    return { status: 'failed', error: message }
  }

  const parsed = definition.schema.safeParse(action.params)
  if (!parsed.success) {
    const message = `动作参数不合法：${parsed.error.issues.map((issue: { message: string }) => issue.message).join('; ')}`
    ctx.log('error', `规则「${rule.name}」第 ${order + 1} 步：${message}`)
    return { status: 'failed', error: message }
  }

  // B9 · a rule pointing at something the user deleted must not crash the engine and
  // must not silently "succeed". Skip the step, say why, keep going.
  if (options.index) {
    for (const ref of definition.refs(parsed.data)) {
      if (!refExists(options.index, ref.kind, ref.id)) {
        ctx.log('error', `规则「${rule.name}」第 ${order + 1} 步引用了已不存在的${ref.kind}：${ref.id}，该步骤跳过`)
        return { status: 'skipped' }
      }
      if (!refTypeOk(options.index, ref)) {
        ctx.log(
          'error',
          `规则「${rule.name}」第 ${order + 1} 步要的是 ${ref.expectType} 类型的${ref.kind}，${ref.id} 不是，该步骤跳过`,
        )
        return { status: 'skipped' }
      }
    }
  }

  try {
    await definition.handler(ctx, parsed.data, signal)
    return { status: 'ok' }
  } catch (error) {
    // §5.3 · cancellation is not a failure. It never reaches onError and never surfaces
    // to the user as an error.
    if (isAbortError(error) || signal.aborted) return { status: 'skipped' }
    const message = error instanceof Error ? error.message : String(error)
    ctx.log('error', `规则「${rule.name}」第 ${order + 1} 步执行失败：${message}`)
    return { status: 'failed', error: message }
  }
}

export async function execute(
  rule: Rule,
  ctx: RuntimeContext,
  event: RuntimeEvent | null,
  signal: AbortSignal,
  options: ExecuteOptions = {},
): Promise<ExecResult> {
  void event // The event reaches handlers through ctx.currentEvent(); kept for the §5.1 signature.
  const startedAt = ctx.now()
  const steps: ExecStep[] = []
  let failed = false

  if (rule.mode === 'parallel') {
    // Give the group its own controller so `onError: 'abort'` can cancel the siblings
    // without touching the caller's signal.
    const group = new AbortController()
    const onOuterAbort = () => group.abort()
    if (signal.aborted) group.abort()
    else signal.addEventListener('abort', onOuterAbort, { once: true })

    // T-211 · `Promise.allSettled`, which is what ECA_SPEC §5.1 has always said. The code
    // said `Promise.all`, and the two agreed only because `runStep` catches everything —
    // an accident, not a design. Three things escape that catch (`registry.get`,
    // `schema.safeParse` and `definition.refs`, all called before the `try`), and when one
    // does, `Promise.all` rejects on the spot: `execute` throws instead of returning an
    // `ExecResult`, and **every sibling step's outcome is thrown away** — including the
    // ones that finished fine. A parallel group would report nothing at all because one
    // action's `refs()` had a bug.
    const settled = await Promise.allSettled(
      rule.then.map(async (action, index): Promise<ExecStep> => {
        const outcome = await runStep(action, index, rule, ctx, group.signal, options)
        if (outcome.status === 'failed' && rule.onError === 'abort') group.abort()
        return { index, action: action.action, status: outcome.status, ...(outcome.error ? { error: outcome.error } : {}) }
      }),
    )
    signal.removeEventListener('abort', onOuterAbort)
    const outcomes = settled.map((result, index): ExecStep => {
      if (result.status === 'fulfilled') return result.value
      // A step whose machinery threw is a failed step, not a failed engine.
      const message = result.reason instanceof Error ? result.reason.message : String(result.reason)
      ctx.log('error', `规则「${rule.name}」第 ${index + 1} 步执行失败：${message}`)
      return { index, action: rule.then[index]!.action, status: 'failed', error: message }
    })
    steps.push(...outcomes)
    failed = outcomes.some((s) => s.status === 'failed')
  } else {
    for (const [index, action] of rule.then.entries()) {
      if (signal.aborted) {
        steps.push({ index, action: action.action, status: 'skipped' })
        continue
      }
      if (failed && rule.onError === 'abort') {
        steps.push({ index, action: action.action, status: 'skipped' })
        continue
      }
      const outcome = await runStep(action, index, rule, ctx, signal, options)
      steps.push({ index, action: action.action, status: outcome.status, ...(outcome.error ? { error: outcome.error } : {}) })
      if (outcome.status === 'failed') failed = true
    }
  }

  const endedAt = ctx.now()
  const status: ExecResult['status'] = signal.aborted ? 'aborted' : failed ? 'failed' : 'completed'
  return { ruleId: rule.id, status, startedAt, endedAt, steps }
}
