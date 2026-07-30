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
}

/**
 * Delegating wrapper that pins `currentEvent()` for one dispatch.
 *
 * Written out by hand rather than via Object.create: prototype delegation would send
 * property WRITES to the wrapper instead of the real runtime, so state mutations would
 * silently land on a throwaway object.
 */
function withCurrentEvent(ctx: RuntimeContext, event: RuntimeEvent | null): RuntimeContext {
  return {
    doc: ctx.doc,
    getVar: (id) => ctx.getVar(id),
    setVar: (id, v) => ctx.setVar(id, v),
    isVisible: (id) => ctx.isVisible(id),
    setVisible: (id, v, o) => ctx.setVisible(id, v, o),
    setMaterial: (id, m) => ctx.setMaterial(id, m),
    highlight: (id, p, o) => ctx.highlight(id, p, o),
    getNodeProp: (id, k) => ctx.getNodeProp(id, k),
    resetScene: () => ctx.resetScene(),
    playAnimation: (id, o) => ctx.playAnimation(id, o),
    stopAnimation: (id, o) => ctx.stopAnimation(id, o),
    seekAnimation: (id, t) => ctx.seekAnimation(id, t),
    isAnimationPlaying: (id) => ctx.isAnimationPlaying(id),
    moveCamera: (id, o) => ctx.moveCamera(id, o),
    openPanel: (id) => ctx.openPanel(id),
    closePanel: (id) => ctx.closePanel(id),
    isPanelOpen: (id) => ctx.isPanelOpen(id),
    openLink: (u, t) => ctx.openLink(u, t),
    now: () => ctx.now(),
    wait: (ms, s) => ctx.wait(ms, s),
    emit: (e) => ctx.emit(e),
    log: (l, m, d) => ctx.log(l, m, d),
    currentEvent: () => event,
  }
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

  constructor(ctx: RuntimeContext, options: EcaEngineOptions = {}) {
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
