import type { Light, SceneDocument } from '@w3/schema'
import { AbortError, neverEnds } from './types.js'
import type { LogLevel, RuntimeContext, RuntimeEvent, SubtreeOption, VarValue } from './types.js'

/**
 * T-084 · a RuntimeContext with no GPU and no real clock.
 *
 * ECA_SPEC constraint two: the engine only knows this interface, so the same rules that
 * drive WebGL in production drive a Map here. That is what makes the ECA suite run in
 * plain Node in well under two seconds and never go flaky — and, per the technical
 * assessment §1.3, it is also what lets the contract's acceptance test cases be
 * generated from the rule table instead of hand-written.
 *
 * `describeRuntimeContract` runs against this AND against SceneRuntime, because the
 * quiet failure mode of this architecture is a headless runtime that slowly drifts away
 * from real behaviour: every test green, the product broken.
 */

interface Pending {
  readonly at: number
  readonly resolve: () => void
  readonly reject: (error: unknown) => void
  readonly onCancel?: () => void
  cancelled: boolean
}

/** A clock the test advances by hand. Never reads the host clock. */
export class FakeClock {
  private t = 0
  private pending: Pending[] = []

  now(): number {
    return this.t
  }

  schedule(delayMs: number, onCancel?: () => void): { promise: Promise<void>; cancel: () => void } {
    let entry!: Pending
    const promise = new Promise<void>((resolve, reject) => {
      entry = { at: this.t + Math.max(0, delayMs), resolve, reject, cancelled: false, ...(onCancel ? { onCancel } : {}) }
      this.pending.push(entry)
    })
    const cancel = () => {
      if (entry.cancelled) return
      entry.cancelled = true
      this.pending = this.pending.filter((p) => p !== entry)
      entry.onCancel?.()
      entry.reject(new AbortError())
    }
    return { promise, cancel }
  }

  /**
   * Moves time forward, firing everything due in chronological order.
   *
   * Yields to the microtask queue after each entry so a resolved animation can start the
   * next step of a sequence before the clock moves again — otherwise a single advance
   * would fire steps that should have been separated in time.
   */
  async advance(ms: number): Promise<void> {
    const target = this.t + ms
    for (;;) {
      const due = this.pending
        .filter((p) => !p.cancelled && p.at <= target)
        .sort((a, b) => a.at - b.at)[0]
      if (!due) break
      this.pending = this.pending.filter((p) => p !== due)
      this.t = due.at
      due.resolve()
      await Promise.resolve()
      await Promise.resolve()
    }
    this.t = target
    await Promise.resolve()
  }

  /** The earliest scheduled instant, or null when nothing is pending. */
  nextAt(): number | null {
    let earliest: number | null = null
    for (const entry of this.pending) {
      if (entry.cancelled) continue
      if (earliest === null || entry.at < earliest) earliest = entry.at
    }
    return earliest
  }

  /**
   * Drains everything, one scheduled instant at a time.
   *
   * Stepping to the next instant rather than jumping to the furthest one matters: a
   * completing entry frequently schedules another (a queued rule starting its turn), and
   * a single long jump would run those later entries with the clock already past them.
   */
  async settle(limit = 1000): Promise<void> {
    for (let i = 0; i < limit; i++) {
      const next = this.nextAt()
      if (next === null) return
      await this.advance(Math.max(1, next - this.t))
    }
    throw new Error('FakeClock.settle: still busy after 1000 steps — a rule is probably looping')
  }

  get pendingCount(): number {
    return this.pending.length
  }

  cancelAll(): void {
    for (const entry of [...this.pending]) {
      entry.cancelled = true
      entry.onCancel?.()
      entry.reject(new AbortError())
    }
    this.pending = []
  }
}

export interface LogEntry {
  readonly level: LogLevel
  readonly message: string
  readonly data?: unknown
}

export interface HeadlessRuntimeOptions {
  readonly clock?: FakeClock
  /** Playback length in ms for `imported` clips, whose real duration lives in the GLB. */
  readonly importedDurationMs?: number
}

export class HeadlessRuntime implements RuntimeContext {
  readonly clock: FakeClock
  readonly doc: SceneDocument
  readonly logs: LogEntry[] = []
  readonly openedLinks: { url: string; target: string }[] = []

  private vars = new Map<string, VarValue>()
  private visibility = new Map<string, boolean>()
  private materials = new Map<string, string | null>()
  /** v0.5 · light params changed by `setLight`; absent means "still the document's". */
  private lights = new Map<string, LiveLight>()
  /** v0.5 · which clips are playing, and with what. No decoder, and none needed (D19). */
  private playingMedia = new Map<string, { loop: boolean; volume: number }>()
  private highlights = new Map<string, string>()
  private panels = new Set<string>()
  private playing = new Map<string, { cancel: () => void; loop: boolean }>()
  private animationTime = new Map<string, number>()
  private listeners: ((event: RuntimeEvent) => void)[] = []
  private event: RuntimeEvent | null = null
  private importedDurationMs: number
  private currentViewpoint: string | null = null

  constructor(doc: SceneDocument, options: HeadlessRuntimeOptions = {}) {
    this.doc = doc
    this.clock = options.clock ?? new FakeClock()
    this.importedDurationMs = options.importedDurationMs ?? 1000
    this.resetScene()
  }

  /* --- observation hooks used by the engine and by tests ------------------ */

  onEvent(listener: (event: RuntimeEvent) => void): () => void {
    this.listeners.push(listener)
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener)
    }
  }

  setCurrentEvent(event: RuntimeEvent | null): void {
    this.event = event
  }

  currentEvent(): RuntimeEvent | null {
    return this.event
  }

  get viewpoint(): string | null {
    return this.currentViewpoint
  }

  get openPanels(): string[] {
    return [...this.panels]
  }

  highlightOf(nodeId: string): string | null {
    return this.highlights.get(nodeId) ?? null
  }

  materialOf(nodeId: string): string | null {
    return this.materials.get(nodeId) ?? null
  }

  /* --- variables ---------------------------------------------------------- */

  getVar(id: string): VarValue {
    const value = this.vars.get(id)
    if (value === undefined) {
      this.log('warn', `读取了未声明的变量「${id}」`)
      return 0
    }
    return value
  }

  setVar(id: string, value: VarValue): void {
    const from = this.vars.get(id)
    if (from === undefined) {
      this.log('error', `写入了未声明的变量「${id}」，忽略`)
      return
    }
    // §2.1 · writing the same value is not a change and must not fire the event,
    // otherwise a variableChange rule that writes the variable loops forever.
    if (from === value) return
    this.vars.set(id, value)
    this.emit({ event: 'variableChange', variableId: id, from, to: value })
  }

  /* --- scene -------------------------------------------------------------- */

  private subtree(nodeId: string, includeDescendants: boolean | undefined): string[] {
    if (!includeDescendants) return [nodeId]
    const out = [nodeId]
    const walk = (parent: string) => {
      for (const node of this.doc.nodes) {
        if (node.parent === parent && !out.includes(node.id)) {
          out.push(node.id)
          walk(node.id)
        }
      }
    }
    walk(nodeId)
    return out
  }

  isVisible(nodeId: string): boolean {
    return this.visibility.get(nodeId) ?? false
  }

  setVisible(nodeId: string, value: boolean, options?: SubtreeOption): void {
    for (const id of this.subtree(nodeId, options?.includeDescendants)) this.visibility.set(id, value)
  }

  setMaterial(nodeId: string, materialId: string | null): void {
    this.materials.set(nodeId, materialId)
  }

  /**
   * v0.5 · light parameters, as bookkeeping.
   *
   * There is no three light here, so "applied" means "recorded against the node id" — and
   * that is exactly what the parity trace compares. The type check is the part that has to
   * agree with SceneRuntime bit for bit: a rule that points `setLight` at a mesh must be
   * skipped identically on both sides, or the two views disagree about whether the step
   * ran (C3).
   */
  setLight(nodeId: string, patch: { intensity?: number; color?: string }): void {
    const node = this.doc.nodes.find((n) => n.id === nodeId)
    if (!node) {
      this.log('error', `setLight 引用了不存在的对象：${nodeId}`)
      return
    }
    if (node.light === null) {
      this.log('error', `setLight 的目标「${node.name}」不是灯光对象，已跳过`)
      return
    }
    const current = this.lights.get(nodeId) ?? liveLightOf(node.light)
    this.lights.set(nodeId, {
      intensity: patch.intensity ?? current.intensity,
      color: patch.color ?? current.color,
    })
  }

  /* ---- media (v0.5 · T-163) ---------------------------------------------- */

  /**
   * Starts a clip, in the only sense a headless runtime can: it records that it is playing.
   *
   * There is no decoder here and there does not need to be. What the parity trace compares
   * is WHICH clip started, with what volume and loop flag, in what order relative to the
   * other steps — and every one of those is a decision the document made, not the audio
   * hardware. The waiting half lives in the action (D19), on `ctx.wait`, so a fake clock
   * drives it.
   */
  playMedia(id: string, opts: { loop?: boolean; volume?: number; signal?: AbortSignal } = {}): Promise<void> {
    const media = this.doc.media.find((m) => m.id === id)
    if (!media) {
      this.log('error', `playMedia 引用了不存在的媒体：${id}`)
      return Promise.resolve()
    }
    this.playingMedia.set(id, { loop: opts.loop ?? false, volume: opts.volume ?? 1 })
    return Promise.resolve()
  }

  stopMedia(id: string | 'all'): void {
    if (id === 'all') {
      this.playingMedia.clear()
      return
    }
    this.playingMedia.delete(id)
  }

  isMediaPlaying(id: string): boolean {
    return this.playingMedia.has(id)
  }
  /**
   * ADR-0019 · headless cannot observe a clip ending, so it says so by never resolving.
   *
   * Racing this against `wait(durationS)` therefore always ends on the clock, which is what
   * D19 specifies for headless. Rejecting on abort matters: without it a cancelled sequence
   * would leave this promise attached to the signal for the life of the run.
   *
   * T-211 · ECA_SPEC §6 used to add 「未在播放（含 V3 自动播放被拒）立即 resolve」. **That
   * sentence was wrong and the SPEC has been corrected**, not this code. Resolving for a clip
   * that is not playing means a scene whose audio the browser blocked fires every following
   * step at once — silent AND broken, instead of merely silent. T-186 tried it that way,
   * wrote the reasoning into `media-bus.test.ts`, and the parity self-check is what caught it.
   */
  waitForMediaEnd(_id: string, signal?: AbortSignal): Promise<void> {
    return neverEnds(signal)
  }


  /** What each playing clip was started with. Read by the parity trace and the tests. */
  mediaState(id: string): { loop: boolean; volume: number } | null {
    return this.playingMedia.get(id) ?? null
  }

  /** The live parameters of a light node — the document's own values until `setLight` moves them. */
  lightOf(nodeId: string): LiveLight | null {
    const node = this.doc.nodes.find((n) => n.id === nodeId)
    if (!node || node.light === null) return null
    return this.lights.get(nodeId) ?? liveLightOf(node.light)
  }

  highlight(nodeId: string, preset: string | null, options?: SubtreeOption): void {
    for (const id of this.subtree(nodeId, options?.includeDescendants)) {
      if (preset === null) this.highlights.delete(id)
      else this.highlights.set(id, preset)
    }
  }

  getNodeProp(nodeId: string, key: string): VarValue {
    const node = this.doc.nodes.find((n) => n.id === nodeId)
    if (!node) {
      this.log('error', `读取了不存在的对象属性：${nodeId}.${key}`)
      return 0
    }
    switch (key) {
      case 'visible':
        return this.isVisible(nodeId)
      case 'materialId':
        return this.materials.get(nodeId) ?? node.overrides.materialId ?? ''
      case 'positionY':
        return node.transform.p[1]
      default:
        this.log('warn', `未知的对象属性 ${key}`)
        return 0
    }
  }

  resetScene(): void {
    for (const [id, entry] of [...this.playing]) {
      this.playing.delete(id)
      entry.cancel()
    }
    this.vars.clear()
    for (const variable of this.doc.variables) this.vars.set(variable.id, variable.default)
    this.visibility.clear()
    for (const node of this.doc.nodes) this.visibility.set(node.id, node.visible)
    this.materials.clear()
    this.lights.clear()
    // B13 extended (T-163): leaving preview silences the scene. SceneRuntime does the same
    // through MediaBus, and the contract test is what caught them disagreeing.
    this.playingMedia.clear()
    this.highlights.clear()
    this.panels.clear()
    this.animationTime.clear()
    this.currentViewpoint = null
  }

  /* --- animation ---------------------------------------------------------- */

  private durationMsOf(animationId: string): { ms: number; loop: boolean } | null {
    const animation = this.doc.animations.find((a) => a.id === animationId)
    if (!animation) return null
    return animation.kind === 'tween'
      ? { ms: animation.duration * 1000, loop: animation.loop }
      : { ms: this.importedDurationMs, loop: animation.loop }
  }

  playAnimation(id: string, options: { signal?: AbortSignal }): Promise<void> {
    const spec = this.durationMsOf(id)
    if (!spec) {
      this.log('error', `播放了不存在的动画「${id}」`)
      return Promise.resolve()
    }
    if (options.signal?.aborted) return Promise.reject(new AbortError())

    // T-216 · restarting replaces the previous run of the same animation, exactly as
    // `TweenPlayer.play` (`tween.ts:73`) and `ClipPlayer.play` (`clip.ts:88`) do.
    //
    // Without this line the two runtimes diverged and it was **measurable**: overlapping
    // playback produced `[{completed:true},{completed:true}]` here and
    // `[{completed:false},{completed:true}]` on the real side, and the first promise
    // resolved here where it rejects there. Neither the contract suite nor parity could see
    // it — neither had an overlapping-playback case, which is the failure mode this whole
    // architecture is most exposed to (ECA_SPEC §6: a headless runtime that slowly drifts).
    this.stopAnimation(id)

    // MVP_V0 D6 / ECA_SPEC B2 · a looping animation resolves IMMEDIATELY even under
    // `await: true`. Anything else deadlocks every sequence that contains one, and it
    // is the single easiest边界 to miss.
    if (spec.loop) {
      this.playing.set(id, { cancel: () => undefined, loop: true })
      return Promise.resolve()
    }

    const { promise, cancel } = this.clock.schedule(spec.ms)
    this.playing.set(id, { cancel, loop: false })

    const onAbort = () => {
      if (this.playing.get(id)?.cancel === cancel) this.playing.delete(id)
      cancel()
      this.emit({ event: 'animationEnd', animationId: id, completed: false })
    }
    options.signal?.addEventListener('abort', onAbort, { once: true })

    return promise.then(
      () => {
        options.signal?.removeEventListener('abort', onAbort)
        this.playing.delete(id)
        this.animationTime.set(id, spec.ms / 1000)
        this.emit({ event: 'animationEnd', animationId: id, completed: true })
      },
      (error) => {
        options.signal?.removeEventListener('abort', onAbort)
        throw error
      },
    )
  }

  stopAnimation(id: string, options?: { reset?: boolean }): void {
    const entry = this.playing.get(id)
    if (entry) {
      this.playing.delete(id)
      entry.cancel()
      // T-216 · a stopped loop ends too. `TweenPlayer.stop` notifies unconditionally
      // (`tween.ts:154`) and only skips the promise REJECTION for a loop, because a loop's
      // promise already settled when it started (`settleOnStart`). The `if (!entry.loop)`
      // that used to guard this line conflated the two, so 「停止循环动画后接着做别的」 fired
      // on the real runtime and never fired headless.
      this.emit({ event: 'animationEnd', animationId: id, completed: false })
    }
    if (options?.reset) this.animationTime.set(id, 0)
  }

  seekAnimation(id: string, time: number): void {
    this.animationTime.set(id, time)
  }

  isAnimationPlaying(id: string): boolean {
    return this.playing.has(id)
  }

  timeOf(id: string): number {
    return this.animationTime.get(id) ?? 0
  }

  /* --- camera -------------------------------------------------------------- */

  moveCamera(viewpointId: string, options: { duration?: number; signal?: AbortSignal }): Promise<void> {
    if (!this.doc.viewpoints.some((v) => v.id === viewpointId)) {
      this.log('error', `飞向了不存在的视点「${viewpointId}」`)
      return Promise.resolve()
    }
    if (options.signal?.aborted) return Promise.reject(new AbortError())
    const ms = (options.duration ?? 0) * 1000
    if (ms <= 0) {
      this.currentViewpoint = viewpointId
      return Promise.resolve()
    }
    const { promise, cancel } = this.clock.schedule(ms)
    const onAbort = () => cancel()
    options.signal?.addEventListener('abort', onAbort, { once: true })
    return promise.then(
      () => {
        options.signal?.removeEventListener('abort', onAbort)
        this.currentViewpoint = viewpointId
      },
      (error) => {
        options.signal?.removeEventListener('abort', onAbort)
        throw error
      },
    )
  }

  /* --- UI ------------------------------------------------------------------ */

  openPanel(hotspotId: string): void {
    this.panels.add(hotspotId)
  }

  closePanel(hotspotId: string | 'all'): void {
    if (hotspotId === 'all') this.panels.clear()
    else this.panels.delete(hotspotId)
  }

  isPanelOpen(hotspotId: string): boolean {
    return this.panels.has(hotspotId)
  }

  openLink(url: string, target: '_blank' | '_self'): void {
    // Head-less: record the intent. Navigating would end the test run.
    this.openedLinks.push({ url, target })
  }

  /* --- time ---------------------------------------------------------------- */

  now(): number {
    return this.clock.now()
  }

  wait(ms: number, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) return Promise.reject(new AbortError())
    const { promise, cancel } = this.clock.schedule(ms)
    const onAbort = () => cancel()
    signal?.addEventListener('abort', onAbort, { once: true })
    return promise.finally(() => signal?.removeEventListener('abort', onAbort))
  }

  /* --- observation --------------------------------------------------------- */

  emit(event: RuntimeEvent): void {
    for (const listener of [...this.listeners]) listener(event)
  }

  log(level: LogLevel, message: string, data?: unknown): void {
    this.logs.push({ level, message, ...(data === undefined ? {} : { data }) })
  }

  warnings(): LogEntry[] {
    return this.logs.filter((l) => l.level === 'warn')
  }

  errors(): LogEntry[] {
    return this.logs.filter((l) => l.level === 'error')
  }
}


/* -------------------------------------------------------------------------- */

/**
 * The two light parameters `setLight` can move (进化规划 §4.3).
 *
 * Shared with SceneRuntime so both runtimes read the document's starting values through
 * one function: `hemisphere` calls its colour `skyColor`, and two independent readings of
 * that would be a divergence the contract test could not see — both sides would be
 * self-consistent and different from each other.
 */
export interface LiveLight {
  readonly intensity: number
  readonly color: string
}

/** A light carrier's starting parameters, before any `setLight` moved them. */
export function liveLightOf(light: Light): LiveLight {
  return {
    intensity: light.intensity,
    color: light.kind === 'hemisphere' ? light.skyColor : light.color,
  }
}
