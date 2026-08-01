import type { DocIndex, Rule, SceneDocument } from '@w3/schema'
import { buildIndex } from '@w3/schema'
import type { ActionRegistry } from './actions/registry.js'
import { createActionRefResolver, defaultRegistry } from './actions/registry.js'
import { evaluateRuleConditions } from './conditions.js'
import { candidateRules } from './events.js'
import { execute } from './executor.js'
import type { ExecResult, RuntimeContext, RuntimeEvent } from './types.js'
import { isAbortError } from './types.js'

/**
 * T-086 · ECA_SPEC §7.
 *
 * Owns three things the executor deliberately does not: which rules an event reaches,
 * what happens when a rule is re-triggered while still running, and the timers.
 */

const HISTORY_LIMIT = 500
const QUEUE_LIMIT = 8

/**
 * B10 · a variableChange rule that writes the same variable is the easiest infinite
 * loop to author, and in the editor it presents as the whole page freezing. A hard
 * depth cap is the only reliable guard.
 */
const MAX_CHAIN_DEPTH = 16

interface Slot {
  controller: AbortController
  promise: Promise<void>
  queue: RuntimeEvent[]
}

export interface EcaEngineOptions {
  readonly registry?: ActionRegistry
  /**
   * Called once per finished rule execution.
   *
   * `history` is a ring buffer and therefore forgets; the debug panel (T-093) and the
   * parity comparison (T-103) both need every result as it happens, not a sample of the
   * last N. Push rather than poll so a rule that completes between two frames is not
   * silently dropped from the log.
   */
  readonly onResult?: (result: ExecResult) => void
}

/**
 * Delegating wrapper that pins `currentEvent()` for one dispatch.
 *
 * Written out by hand rather than via Object.create: prototype delegation would send
 * property WRITES to the wrapper instead of the real runtime, so state mutations would
 * silently land on a throwaway object.
 *
 * **This list is why a new RuntimeContext capability cannot leave `engine.ts` untouched.**
 * v0.5's per-card rule ("涉及 ECA 动作的卡，engine.ts 的 diff 必须为空") is about C5 — no
 * `if (action.type === …)` in the engine — and that still holds: the line added below
 * carries no knowledge of any action. But the rule as written is unsatisfiable for the
 * four RuntimeContext methods 进化规划 §4.3 mandates, and it will be unsatisfiable again
 * for T-163's three. Registered in IMPL_NOTES §4 with a proposed fix (delegate through a
 * Proxy, which needs no per-method list) rather than refactored here unasked.
 */
/**
 * The context an action sees while a rule is executing: the real runtime, plus the event
 * that triggered it.
 *
 * A Proxy rather than a hand-written delegation, decided in T-163 after the hand-written
 * one had cost twice. Every method added to `RuntimeContext` needed a line here, and
 * forgetting one produced a failure that NO action test could see: the action tests pass a
 * `HeadlessRuntime` straight in, so `ctx.playMedia` exists there and is `undefined` only
 * once a real rule fires through the engine. A silent hole that opens at runtime, on the
 * exact path least covered.
 *
 * It also restores C5's substance. 「加交互能力靠注册表，不改 engine.ts」 was literally
 * impossible while every new `RuntimeContext` method demanded an engine edit — v0.5's own
 * discipline (「涉及 ECA 动作的卡，engine.ts 的 diff 必须为空」) and 进化规划 §4.3 (which
 * mandates four new context methods) contradicted each other outright. This is the one
 * engine change that stops there being any more of them; it was registered in M9's review
 * and approved by a human before being made.
 *
 * `bind(target)` matters: `SceneRuntime`'s methods use `this`, and handing back an unbound
 * function would break every one of them the moment it was called through the proxy.
 */
export function withCurrentEvent(ctx: RuntimeContext, event: RuntimeEvent | null): RuntimeContext {
  return new Proxy(ctx, {
    get(target, property, receiver) {
      if (property === 'currentEvent') return () => event
      const value = Reflect.get(target, property, receiver) as unknown
      return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value
    },
  })
}

export class EcaEngine {
  private readonly ctx: RuntimeContext
  private readonly registry: ActionRegistry
  private doc: SceneDocument | null = null
  private index: DocIndex | null = null
  private enabled = false
  private slots = new Map<string, Slot>()
  private timers = new Set<() => void>()
  private chainDepth = 0
  private historyBuffer: ExecResult[] = []

  constructor(
    ctx: RuntimeContext,
    private readonly options: EcaEngineOptions = {},
  ) {
    this.ctx = ctx
    this.registry = options.registry ?? defaultRegistry
  }

  /** Ring buffer, newest last. Read by the debug panel and by the parity comparison. */
  get history(): readonly ExecResult[] {
    return this.historyBuffer
  }

  get isEnabled(): boolean {
    return this.enabled
  }

  attach(doc: SceneDocument): void {
    this.doc = doc
    this.index = buildIndex(doc, { actionRefs: createActionRefResolver(this.registry) })
  }

  detach(): void {
    // B11 · nothing may outlive a detach: no dangling promises, no live timers.
    for (const [, slot] of this.slots) slot.controller.abort()
    this.slots.clear()
    for (const cancel of this.timers) cancel()
    this.timers.clear()
    this.doc = null
    this.index = null
    this.enabled = false
  }

  /** Rebuilds the dispatch index after the editor edits rules or variables. */
  onDocumentPatch(doc: SceneDocument): void {
    if (this.doc === null) return
    this.attach(doc)
  }

  /**
   * ECA_SPEC §7 · the engine is DISABLED while editing.
   *
   * Otherwise clicking an object that has a click rule would fire the rule instead of
   * selecting it, and the object would become uneditable — by its own configuration.
   */
  setEnabled(value: boolean): void {
    if (this.enabled === value) return
    this.enabled = value
    if (!value) {
      for (const [, slot] of this.slots) slot.controller.abort()
      this.slots.clear()
      for (const cancel of this.timers) cancel()
      this.timers.clear()
    }
  }

  clearHistory(): void {
    this.historyBuffer = []
  }

  dispatch(event: RuntimeEvent): void {
    if (!this.enabled || this.doc === null || this.index === null) return

    this.chainDepth++
    try {
      if (this.chainDepth > MAX_CHAIN_DEPTH) {
        this.ctx.log(
          'error',
          `规则连锁深度超过 ${MAX_CHAIN_DEPTH}，已中止本次分发（很可能是变量变化规则相互触发形成环）`,
          { event },
        )
        return
      }

      let matched = candidateRules(this.index, event)
      // A timer belongs to exactly one rule; `triggerMatches` cannot know which.
      if (event.event === 'timer') matched = matched.filter((rule) => rule.id === event.timerId)

      for (const rule of matched) this.runRule(rule, event)

      if (event.event === 'sceneReady') this.startTimers()
    } finally {
      this.chainDepth--
    }
  }

  private record(result: ExecResult): void {
    this.historyBuffer.push(result)
    if (this.historyBuffer.length > HISTORY_LIMIT) this.historyBuffer.shift()
    // A listener that throws must not take the rule down with it: the log panel is an
    // observer, and an observer's bug is not the engine's problem to propagate.
    try {
      this.options.onResult?.(result)
    } catch (error) {
      this.ctx.log('warn', 'ECA onResult 监听器抛出异常，已忽略', error)
    }
  }

  private runRule(rule: Rule, event: RuntimeEvent): void {
    const scopedCtx = withCurrentEvent(this.ctx, event)

    if (!evaluateRuleConditions(rule, scopedCtx, event)) {
      this.record({
        ruleId: rule.id,
        status: 'skipped-condition',
        startedAt: this.ctx.now(),
        endedAt: this.ctx.now(),
        steps: [],
      })
      return
    }

    const running = this.slots.get(rule.id)
    if (running) {
      // MVP_V0 D9.
      if (rule.reentry === 'ignore') {
        this.ctx.log('debug', `规则「${rule.name}」上一次尚未结束，按 ignore 策略丢弃本次触发`)
        this.record({
          ruleId: rule.id,
          status: 'skipped-reentry',
          startedAt: this.ctx.now(),
          endedAt: this.ctx.now(),
          steps: [],
        })
        return
      }
      if (rule.reentry === 'queue') {
        if (running.queue.length >= QUEUE_LIMIT) {
          running.queue.shift()
          this.ctx.log('warn', `规则「${rule.name}」的排队上限为 ${QUEUE_LIMIT}，已丢弃最早的一次触发`)
        }
        running.queue.push(event)
        return
      }
      // restart — the default.
      running.controller.abort()
      this.slots.delete(rule.id)
    }

    this.start(rule, event)
  }

  private start(rule: Rule, event: RuntimeEvent): void {
    const controller = new AbortController()
    const queue: RuntimeEvent[] = []
    const scopedCtx = withCurrentEvent(this.ctx, event)

    const promise = execute(rule, scopedCtx, event, controller.signal, {
      registry: this.registry,
      ...(this.index ? { index: this.index } : {}),
    })
      .then((result) => {
        this.record(result)
      })
      .catch((error) => {
        if (isAbortError(error)) return
        this.ctx.log('error', `规则「${rule.name}」执行时抛出未捕获错误`, error)
      })
      .finally(() => {
        const slot = this.slots.get(rule.id)
        if (slot?.controller !== controller) return
        this.slots.delete(rule.id)
        const next = slot.queue.shift()
        if (next !== undefined) {
          // Re-enter through runRule so conditions are re-evaluated against the state
          // the previous run left behind.
          this.runRule(rule, next)
          const created = this.slots.get(rule.id)
          if (created) created.queue.push(...slot.queue)
        }
      })

    // An aborted run still resolves — `execute` reports status 'aborted' with the steps
    // it managed and the ones it skipped — so there is exactly one history entry per
    // run. Recording on the abort event as well would double-count every restart.
    this.slots.set(rule.id, { controller, promise, queue })
  }

  private startTimers(): void {
    if (this.doc === null) return
    for (const rule of this.doc.rules) {
      if (!rule.enabled || rule.when.event !== 'timer' || rule.when.startOn !== 'sceneReady') continue
      this.startTimer(rule)
    }
  }

  /** Starts a `startOn: 'manual'` timer, or restarts one. */
  startTimer(rule: Rule): void {
    if (rule.when.event !== 'timer') return
    const { delay, repeat } = rule.when
    let cancelled = false
    let tick = 0
    const controller = new AbortController()
    const cancel = () => {
      cancelled = true
      controller.abort()
    }
    this.timers.add(cancel)

    const loop = async () => {
      while (!cancelled) {
        try {
          await this.ctx.wait(delay, controller.signal)
        } catch {
          return
        }
        if (cancelled) return
        tick += 1
        this.dispatch({ event: 'timer', timerId: rule.id, tick })
        if (!repeat) return
      }
    }
    void loop().finally(() => this.timers.delete(cancel))
  }

  /** Resolves once every in-flight rule has settled. Used by tests and by publish. */
  async idle(): Promise<void> {
    while (this.slots.size > 0) {
      await Promise.all([...this.slots.values()].map((s) => s.promise))
    }
  }
}
