import type { Action, Condition, EventDescriptor, Rule, SceneDocument } from '@w3/schema'
import { createGoldenPathDocument } from '@w3/schema'
import { ActionRegistry, registerBuiltinActions } from '../src/eca/actions/index.js'
import { EcaEngine } from '../src/eca/engine.js'
import { HeadlessRuntime } from '../src/eca/headless.js'

/** Shared scaffolding for the ECA suite. Everything runs in plain Node (C8). */

export const IDS = {
  pump: 'nd_r5t8y1u3',
  body: 'nd_v7w9x2z4',
  cover: 'nd_b3n5m7k9',
  material: 'mat_c4d6f8h1',
  animation: 'anm_j2l4n6p8',
  hotspot: 'hs_q1s3u5w7',
  viewpoint: 'vp_e9g1i3k5',
  rule: 'rl_m8o2q4s6',
} as const

let ruleCounter = 0
export function makeRule(overrides: Partial<Rule> & { when: EventDescriptor; then: Action[] }): Rule {
  ruleCounter += 1
  return {
    id: `rl_${String(ruleCounter).padStart(8, '0')}`,
    name: `规则 ${ruleCounter}`,
    enabled: true,
    if: [],
    ifAny: [],
    mode: 'sequence',
    reentry: 'restart',
    onError: 'abort',
    ...overrides,
  }
}

export const clickOn = (nodeId: string): EventDescriptor => ({ event: 'click', target: { nodeId } })

export function docWithRules(rules: Rule[], mutate?: (doc: SceneDocument) => SceneDocument): SceneDocument {
  const base = createGoldenPathDocument()
  const doc: SceneDocument = { ...base, rules }
  return mutate ? mutate(doc) : doc
}

export interface Harness {
  readonly doc: SceneDocument
  readonly ctx: HeadlessRuntime
  readonly engine: EcaEngine
  readonly registry: ActionRegistry
  /** Advances the fake clock and lets every resulting microtask settle. */
  advance(ms: number): Promise<void>
  /** Drains everything currently scheduled. */
  settle(): Promise<void>
  /** Rule ids in the order their results were recorded. */
  statuses(): string[]
}

export interface HarnessOptions {
  readonly importedDurationMs?: number
  readonly registry?: ActionRegistry
  readonly enabled?: boolean
}

export function harness(doc: SceneDocument, options: HarnessOptions = {}): Harness {
  const registry = options.registry ?? registerBuiltinActions(new ActionRegistry())
  const ctx = new HeadlessRuntime(doc, {
    ...(options.importedDurationMs === undefined ? {} : { importedDurationMs: options.importedDurationMs }),
  })
  const engine = new EcaEngine(ctx, { registry })
  engine.attach(doc)
  // The runtime emits variableChange / animationEnd; the engine turns those into rules.
  ctx.onEvent((event) => engine.dispatch(event))
  engine.setEnabled(options.enabled ?? true)

  const flush = async () => {
    for (let i = 0; i < 8; i++) await Promise.resolve()
  }

  return {
    doc,
    ctx,
    engine,
    registry,
    async advance(ms) {
      await flush()
      await ctx.clock.advance(ms)
      await flush()
    },
    async settle() {
      // Alternate between draining microtasks and stepping the clock to its next
      // scheduled instant: a finishing rule often schedules the next one, so neither
      // "flush everything" nor "advance once" is enough on its own.
      for (let i = 0; i < 500; i++) {
        await flush()
        const next = ctx.clock.nextAt()
        if (next === null) break
        await ctx.clock.advance(Math.max(1, next - ctx.clock.now()))
      }
      await flush()
    },
    statuses() {
      return engine.history.map((r) => r.status)
    },
  }
}

/** An action that records the order in which steps actually ran. */
export function recorderAction(type: string, log: string[], options: { throws?: boolean; waitMs?: number } = {}) {
  return {
    type,
    schema: { safeParse: (v: unknown) => ({ success: true as const, data: v ?? {} }) } as never,
    async handler(ctx: HeadlessRuntime, _p: unknown, signal: AbortSignal) {
      if (options.waitMs) await ctx.wait(options.waitMs, signal)
      log.push(type)
      if (options.throws) throw new Error(`${type} failed on purpose`)
    },
    ui: { label: type, group: 'state' as const, fields: [] },
    refs: () => [],
    describe: () => type,
  }
}

export const conditionVarEquals = (variableId: string, value: number): Condition => ({
  op: 'eq',
  left: { var: variableId },
  right: { const: value },
})
