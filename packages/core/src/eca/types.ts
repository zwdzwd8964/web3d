import type { SceneDocument, VariableValue } from '@w3/schema'
import type { ZodType } from '@w3/schema'

/**
 * T-030 · ECA_SPEC §6. The single seam between the rule engine and the renderer.
 *
 * Nothing in this file may reference three.js. That is not a style rule — it is the
 * technical basis of C8. Production injects `SceneRuntime` (which owns WebGL); tests
 * and the acceptance-case generator inject `HeadlessRuntime` (pure JS, fake clock).
 * The engine cannot tell the difference, which is why the ECA suite runs in plain Node
 * in under two seconds and never goes flaky.
 */

export type VarValue = VariableValue

/* -------------------------------------------------------------------------- */
/* Events — ECA_SPEC §2.1 payloads                                            */
/* -------------------------------------------------------------------------- */

export type RuntimeEvent =
  | { readonly event: 'sceneReady' }
  | { readonly event: 'click'; readonly nodeId: string; readonly point?: readonly [number, number, number]; readonly distance?: number }
  | { readonly event: 'hoverEnter'; readonly nodeId: string }
  | { readonly event: 'hoverLeave'; readonly nodeId: string }
  | { readonly event: 'hotspotClick'; readonly hotspotId: string }
  /** `completed: false` when the animation was stopped or aborted rather than finishing. */
  | { readonly event: 'animationEnd'; readonly animationId: string; readonly completed: boolean }
  | { readonly event: 'variableChange'; readonly variableId: string; readonly from: VarValue; readonly to: VarValue }
  | { readonly event: 'timer'; readonly timerId: string; readonly tick: number }

export type RuntimeEventType = RuntimeEvent['event']

/* -------------------------------------------------------------------------- */
/* RuntimeContext — ECA_SPEC §6                                               */
/* -------------------------------------------------------------------------- */

export interface SubtreeOption {
  readonly includeDescendants?: boolean
}

export type LogLevel = 'debug' | 'warn' | 'error'

export interface RuntimeContext {
  // ---- variables ----
  getVar(id: string): VarValue
  /** Emits `variableChange` itself when the value actually changes. */
  setVar(id: string, value: VarValue): void

  // ---- scene ----
  isVisible(nodeId: string): boolean
  setVisible(nodeId: string, value: boolean, options?: SubtreeOption): void
  /** null restores the source material. */
  setMaterial(nodeId: string, materialId: string | null): void
  /** null clears the highlight. */
  highlight(nodeId: string, preset: string | null, options?: SubtreeOption): void
  getNodeProp(nodeId: string, key: string): VarValue
  resetScene(): void

  /**
   * v0.5 · live light parameters (进化规划 §4.3).
   *
   * A node that is not a light is SKIPPED with an error log, never a throw — the B9
   * semantics every other node action follows: a rule pointing at something that has been
   * deleted or retyped must not take the scene down with it.
   *
   * Only intensity and colour, and deliberately so: they are what a scene animates in
   * response to an event. Cone angle and shadow quality are authoring decisions and stay
   * in the document.
   *
   * `resetScene` restores whatever this changed, which is what makes "exit preview and the
   * light goes back to 3" true (B13, extended to lights in v0.5).
   */
  setLight(nodeId: string, patch: { intensity?: number; color?: string }): void

  // ---- media (v0.5 · T-163) ----
  /**
   * Starts a clip and resolves once it has STARTED.
   *
   * Not when it ends: awaiting the end is the ACTION's decision (D19), because only the rule
   * knows whether it asked to wait. A browser that refuses to autoplay resolves too, with a
   * warning — rejecting would abort the whole rule chain, turning 「响完铃再弹面板」 into
   * 「铃没响，面板也没弹」 (risk V3).
   */
  playMedia(id: string, opts: { loop?: boolean; volume?: number; signal?: AbortSignal }): Promise<void>
  /** Stops one clip, or every clip. `'all'` is what leaving preview mode calls (B13). */
  stopMedia(id: string | 'all'): void
  isMediaPlaying(id: string): boolean
  /**
   * v0.5 · resolves when the clip actually finishes (ADR-0019).
   *
   * The other half of D19's 「以先到者为准」. `durationS` is what the browser reported at
   * import and can be off by a noticeable margin, so an action that only waits on the clock
   * either cuts the last second off or leaves the user watching a still frame. Racing this
   * against `wait(durationS)` takes whichever is right.
   *
   * Resolves immediately when nothing is playing — autoplay refused (V3) means there is no
   * sound to wait for, and a sequence must not stall on silence.
   *
   * Headless never resolves it: with no DOM there is no honest way to observe the end, so
   * the clock always wins there — which is exactly what D19 asks of headless.
   */
  waitForMediaEnd(id: string, signal?: AbortSignal): Promise<void>

  // ---- animation ----
  /**
   * MVP_V0 D6 · resolves when playback finishes naturally. A looping animation resolves
   * IMMEDIATELY — otherwise any sequence containing one hangs forever. Interruption
   * rejects with an AbortError, which the executor swallows.
   */
  playAnimation(id: string, options: { signal?: AbortSignal }): Promise<void>
  stopAnimation(id: string, options?: { reset?: boolean }): void
  /** `time` in seconds. */
  seekAnimation(id: string, time: number): void
  isAnimationPlaying(id: string): boolean

  // ---- camera ----
  moveCamera(viewpointId: string, options: { duration?: number; signal?: AbortSignal }): Promise<void>

  // ---- UI ----
  openPanel(hotspotId: string): void
  closePanel(hotspotId: string | 'all'): void
  isPanelOpen(hotspotId: string): boolean
  openLink(url: string, target: '_blank' | '_self'): void

  // ---- time (injectable — ECA_SPEC constraint three) ----
  /** Milliseconds. Monotonic within a session; never `Date.now()`. */
  now(): number
  wait(ms: number, signal?: AbortSignal): Promise<void>

  // ---- observation ----
  readonly doc: SceneDocument
  emit(event: RuntimeEvent): void
  log(level: LogLevel, message: string, data?: unknown): void

  /**
   * The event currently being handled, or null outside a dispatch.
   *
   * Added to ECA_SPEC §6 under the escape hatch §10 step 2 grants ("if a new runtime
   * capability is needed, add a method and implement it in BOTH runtimes"). It exists
   * because `setVariable`'s `value` is a ValueExpr, which may be `{ event: 'nodeId' }`,
   * while §4.1 fixes the handler signature at (ctx, params, signal) — so the event has
   * to arrive through the context. The engine sets it around each dispatch. See ADR-0008.
   */
  currentEvent(): RuntimeEvent | null
}

/* -------------------------------------------------------------------------- */
/* Action registry — ECA_SPEC §4.1 / §4.4                                     */
/* -------------------------------------------------------------------------- */

export type RefKind = 'node' | 'material' | 'animation' | 'hotspot' | 'viewpoint' | 'variable' | 'media'

/** ECA_SPEC §4.4 · a closed set, because the rule editor renders exactly these. */
/**
 * ECA_SPEC §4.4 · the closed set of field kinds the rule editor can render.
 *
 * A runtime array, and `FieldDescriptor['type']` is derived FROM it — so the two cannot
 * drift, and a seventh kind added to the union without being added here is a type error
 * rather than a form that renders blank.
 *
 * It exists because two tests each hand-copied this set and each got it wrong in a
 * different direction: one listed a `vec3` that has never existed, the other omitted the
 * `valueExpr` that does. Both passed. A guard that says 「没有第七种字段」 while not
 * knowing what the six are is not a guard (T-176 审查所得).
 */
export const FIELD_KINDS = ['ref', 'number', 'boolean', 'string', 'enum', 'valueExpr'] as const

export type FieldKind = (typeof FIELD_KINDS)[number]

export type FieldDescriptor =
  | { readonly key: string; readonly type: Extract<FieldKind, 'ref'>; readonly refKind: RefKind; readonly label: string; readonly required?: boolean }
  | { readonly key: string; readonly type: Extract<FieldKind, 'number'>; readonly label: string; readonly min?: number; readonly max?: number; readonly step?: number; readonly default?: number }
  | { readonly key: string; readonly type: Extract<FieldKind, 'boolean'>; readonly label: string; readonly default?: boolean }
  | { readonly key: string; readonly type: Extract<FieldKind, 'string'>; readonly label: string; readonly multiline?: boolean; readonly default?: string }
  | { readonly key: string; readonly type: Extract<FieldKind, 'enum'>; readonly label: string; readonly options: readonly { readonly value: string; readonly label: string }[] }
  | { readonly key: string; readonly type: Extract<FieldKind, 'valueExpr'>; readonly label: string }

export type ActionHandler<P = unknown> = (
  ctx: RuntimeContext,
  params: P,
  signal: AbortSignal,
) => void | Promise<void>

export interface ActionUi {
  readonly label: string
  readonly icon?: string
  readonly group: 'animation' | 'scene' | 'camera' | 'ui' | 'state' | 'flow'
  readonly fields: readonly FieldDescriptor[]
}

/**
 * ECA_SPEC §4.1 · `schema`, `handler`, `ui`, `refs` and `describe` are ALL mandatory.
 *
 * They look like boilerplate; each one carries a capability:
 *   refs     -> checkIntegrity finds "this rule points at a deleted node", and the
 *               reverse index answers "what breaks if I delete this?";
 *   describe -> the acceptance-case document (R14) is generated, not written;
 *   ui       -> the rule editor needs no per-action form, which is what makes
 *               "3 files to add an action" true (NORTH_STAR §7).
 * Skip one and the marginal cost of an action goes from half a day to two days.
 */
export interface ActionDefinition<P = unknown> {
  readonly type: string
  readonly schema: ZodType<P>
  readonly handler: ActionHandler<P>
  readonly ui: ActionUi
  /**
   * What this action's parameters point at, for the reverse index and integrity checking.
   *
   * `expectType` narrows the reference beyond its kind — 「这必须是一条 audio 媒体」 rather
   * than merely 「这必须是一条媒体」. Integrity check I14's third clause is enforced through
   * it (`requireType` in `integrity.ts`), and until T-176's review the field had no way to
   * be produced: the return type did not admit it, so the only code that ever set one was a
   * hand-written resolver inside a schema test. The gray-zone ruling 「视频进 ECA 动作 ——
   * 不做，I14 挡住」 therefore rested on a gate that did not exist.
   */
  readonly refs: (params: P) => ReadonlyArray<{ kind: RefKind; id: string; expectType?: string }>
  readonly describe: (params: P, doc: SceneDocument) => string
}

/* -------------------------------------------------------------------------- */
/* Execution results — ECA_SPEC §5.4                                          */
/* -------------------------------------------------------------------------- */

export type ExecStatus = 'completed' | 'aborted' | 'failed' | 'skipped-condition' | 'skipped-reentry'
export type StepStatus = 'ok' | 'failed' | 'skipped'

export interface ExecStep {
  readonly index: number
  readonly action: string
  readonly status: StepStatus
  readonly error?: string
}

/**
 * Shared by three consumers: the rule debug panel (T-093), the parity comparison
 * (T-103) and the acceptance-case execution log (§8). It therefore must be complete and
 * deterministic — no field may vary between two runs of the same input.
 */
export interface ExecResult {
  readonly ruleId: string
  readonly status: ExecStatus
  readonly startedAt: number
  readonly endedAt: number
  readonly steps: readonly ExecStep[]
}

/** Raised by `ctx.wait` and animation/camera promises when their signal aborts. */
export class AbortError extends Error {
  constructor(message = 'aborted') {
    super(message)
    this.name = 'AbortError'
  }
}

export const isAbortError = (error: unknown): boolean =>
  error instanceof AbortError || (error instanceof Error && error.name === 'AbortError')
