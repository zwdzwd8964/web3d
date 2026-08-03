import { describe, expect, it } from 'vitest'
import { CHURN_LIMIT, CHURN_WINDOW_MS, ChurnGuard } from '../../src/eca/churn-guard.js'
import { ActionRegistry, registerBuiltinActions } from '../../src/eca/actions/index.js'
import { docWithRules, harness, makeRule } from '../helpers.js'

/**
 * T-204 · ECA_SPEC §9.2 B10, second half. See ADR-0029.
 *
 * The first two tests are the reproduction: two rules writing each other's variables loop
 * forever when there is an `await` between them, and `MAX_CHAIN_DEPTH` never notices —
 * because it counts synchronous nesting, and an awaited hop starts from a clean stack.
 */

/**
 * `setVariable` only emits `variableChange` when the value actually differs, so a loop that
 * writes a constant stops on its own. These rules write an ever-increasing number instead,
 * which is what a real "A changed, so set B to A + 1" rule does.
 */
function makeCounterRegistry(counts: { a: number; b: number }) {
  const registry = registerBuiltinActions(new ActionRegistry())
  registry.register({
    type: 'bump',
    schema: { safeParse: (v: unknown) => ({ success: true as const, data: v ?? {} }) },
    async handler(ctx: { setVar(id: string, value: unknown): void }, params: unknown) {
      const target = (params as { variableId: 'a' | 'b' }).variableId
      counts[target] += 1
      ctx.setVar(target, counts[target])
    },
    ui: { label: 'bump', group: 'state', fields: [] },
    refs: () => [],
    describe: () => 'bump',
  } as never)
  return registry
}

function loopDocument(withWait: boolean) {
  const bump = (variableId: string) => ({ action: 'bump', params: { variableId } })
  const wait = { action: 'wait', params: { ms: 1 } }
  const rules = [
    makeRule({ when: { event: 'variableChange', variableId: 'a' }, then: withWait ? [wait, bump('b')] : [bump('b')] }),
    makeRule({ when: { event: 'variableChange', variableId: 'b' }, then: withWait ? [wait, bump('a')] : [bump('a')] }),
  ]
  return docWithRules(rules, (doc) => ({
    ...doc,
    variables: [
      ...doc.variables,
      { id: 'a', name: 'A', type: 'number', default: 0, persist: false },
      { id: 'b', name: 'B', type: 'number', default: 0, persist: false },
    ],
  }))
}

/**
 * Advances the harness one small step at a time.
 *
 * `advance(3000)` in a single call yields only two microtasks between clock entries, which is
 * not enough for an awaited rule to finish and schedule its next hop. The loop then appears
 * to stop by itself — and a test written that way passes whether or not the guard exists.
 */
async function step(h: { advance(ms: number): Promise<void> }, totalMs: number, stepMs = 1): Promise<void> {
  for (let elapsed = 0; elapsed < totalMs; elapsed += stepMs) await h.advance(stepMs)
}

describe('跨 await 的变量环', () => {
  it('stops a loop that MAX_CHAIN_DEPTH cannot see, with exactly one error', async () => {
    const counts = { a: 0, b: 0 }
    const h = harness(loopDocument(true), { registry: makeCounterRegistry(counts) })

    counts.a = 1
    h.ctx.setVar('a', 1)
    // Millisecond by millisecond: one `advance(3000)` yields only two microtasks between
    // clock entries, which is not enough for an awaited rule to finish and schedule the next
    // hop — the loop would appear to stop on its own, and the test would pass for the wrong
    // reason.
    await step(h, 3000)

    // Measured: the loop ran 480 hops before the guard cut it, and MAX_CHAIN_DEPTH never
    // said a word. That number is the whole reason this card exists.
    expect(counts.a + counts.b).toBeGreaterThan(400)

    const churnErrors = h.ctx.errors().filter((entry) => entry.message.includes('1 秒内变化超过'))
    expect(churnErrors).toHaveLength(1)
    // Asserted to the wording, not to "an error was logged": two guards reporting the same
    // failure in different words is how one of them silently stops mattering (E18 教训 1),
    // and this file's whole point is that the two guards measure different things.
    expect(h.ctx.errors().filter((e) => e.message.includes('规则连锁深度超过'))).toHaveLength(0)

    // And it actually stopped. Asserting only "one error was logged" would pass on a guard
    // that logs and then lets the loop continue — which is the more likely bug of the two.
    const frozen = counts.a + counts.b
    await step(h, 3000)
    expect(counts.a + counts.b).toBe(frozen)
  })

  it('leaves the synchronous depth guard to handle a synchronous chain', async () => {
    const counts = { a: 0, b: 0 }
    const h = harness(loopDocument(false), { registry: makeCounterRegistry(counts) })

    counts.a = 1
    h.ctx.setVar('a', 1)
    await h.settle()

    // Depth, not churn: a synchronous chain of 16 never gets near 240 changes in a second.
    // The two guards measuring different things is the whole design (ADR-0029).
    expect(h.ctx.logs.filter((e) => e.message.includes('规则连锁深度超过')).length).toBeGreaterThanOrEqual(1)
    expect(h.ctx.logs.filter((e) => e.message.includes('1 秒内变化超过'))).toHaveLength(0)
  })

  it('does not fire for a 16 ms repeating timer writing the same variable', async () => {
    // The false-positive check. ~62 changes per second, comfortably inside the limit —
    // and this is an entirely ordinary thing for an author to configure.
    const counts = { a: 0, b: 0 }
    const doc = docWithRules(
      [makeRule({ when: { event: 'timer', delay: 16, repeat: true, startOn: 'sceneReady' }, then: [{ action: 'bump', params: { variableId: 'a' } }] })],
      (d) => ({ ...d, variables: [...d.variables, { id: 'a', name: 'A', type: 'number', default: 0, persist: false }] }),
    )
    const h = harness(doc, { registry: makeCounterRegistry(counts) })

    h.engine.dispatch({ event: 'sceneReady' })
    // Frame by frame rather than one 5000 ms jump: the engine re-arms a repeating timer
    // only after the rule it fired has settled, and `advance` yields two microtasks between
    // clock entries — not enough for an async handler to finish and re-arm.
    await step(h, 5000, 16)

    expect(h.ctx.logs.filter((e) => e.message.includes('1 秒内变化超过'))).toHaveLength(0)
    expect(counts.a).toBeGreaterThan(100)
  })
})

describe('ChurnGuard 本体', () => {
  it('trips on the crossing and only on the crossing', () => {
    const guard = new ChurnGuard()
    for (let i = 0; i <= CHURN_LIMIT; i++) {
      expect({ i, tripped: guard.tripped('a', i) }).toEqual({ i, tripped: i === CHURN_LIMIT })
    }
    // Still over the limit, but already reported: one runaway loop must not produce one error
    // per event. The caller aborted that dispatch, which is what actually severs the chain.
    expect(guard.tripped('a', CHURN_LIMIT + 1)).toBe(false)
  })

  it('forgets changes older than the window', () => {
    const guard = new ChurnGuard()
    for (let i = 0; i < CHURN_LIMIT; i++) expect(guard.tripped('a', i)).toBe(false)
    // Same total count, but the first batch is now out of window.
    for (let i = 0; i < CHURN_LIMIT; i++) expect(guard.tripped('a', CHURN_WINDOW_MS + 10 + i)).toBe(false)
  })

  it('counts each variable separately', () => {
    const guard = new ChurnGuard()
    for (let i = 0; i <= CHURN_LIMIT; i++) guard.tripped('a', i)
    // `b` is untouched: a guard keyed on a shared counter would report it too.
    expect(guard.tripped('b', CHURN_LIMIT)).toBe(false)
  })

  it('can report a second, genuinely new runaway after recovering', () => {
    const guard = new ChurnGuard()
    for (let i = 0; i <= CHURN_LIMIT; i++) guard.tripped('a', i)
    // Quiet for a full window, then a new storm.
    const later = CHURN_WINDOW_MS * 5
    for (let i = 0; i < CHURN_LIMIT; i++) expect(guard.tripped('a', later + i)).toBe(false)
    expect(guard.tripped('a', later + CHURN_LIMIT)).toBe(true)
  })

  it('forgets everything on reset', () => {
    const guard = new ChurnGuard()
    for (let i = 0; i <= CHURN_LIMIT; i++) guard.tripped('a', i)
    guard.reset()
    for (let i = 0; i < CHURN_LIMIT; i++) expect(guard.tripped('a', i)).toBe(false)
  })
})
