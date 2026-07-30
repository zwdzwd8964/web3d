import type { Animation, SceneDocument } from '@w3/schema'
import { beforeEach, describe, expect, it } from 'vitest'
import { ActionRegistry, registerBuiltinActions } from '../../src/eca/actions/index.js'
import { IDS, clickOn, docWithRules, harness, makeRule, recorderAction } from '../helpers.js'

/**
 * T-083 · ECA_SPEC §5, with §9.2's boundary table B1–B5, B7, B8 and B12 covered
 * explicitly. Everything runs on the fake clock, in plain Node.
 */

const LOOPING: Animation = {
  kind: 'tween',
  id: 'anm_11111111',
  name: '循环动画',
  duration: 2,
  easing: 'linear',
  loop: true,
  yoyo: false,
  targets: [{ nodeId: IDS.cover, to: { p: [0, 1, 0] } }],
}

const withLooping = (doc: SceneDocument): SceneDocument => ({ ...doc, animations: [...doc.animations, LOOPING] })

let log: string[]
let registry: ActionRegistry

beforeEach(() => {
  log = []
  registry = registerBuiltinActions(new ActionRegistry())
  registry.register(recorderAction('mark', log) as never)
  registry.register(recorderAction('boom', log, { throws: true }) as never)
  registry.register(recorderAction('slowMark', log, { waitMs: 500 }) as never)
})

describe('sequence execution', () => {
  it('B1 · an awaited animation blocks the following step until it finishes', async () => {
    const rule = makeRule({
      when: clickOn(IDS.cover),
      then: [
        { action: 'playAnimation', params: { animationId: IDS.animation, await: true } },
        { action: 'mark', params: {} },
      ],
    })
    const h = harness(docWithRules([rule]), { registry })

    h.engine.dispatch({ event: 'click', nodeId: IDS.cover })
    await h.advance(0)
    expect(log, 'the second step must not run before the animation ends').toEqual([])

    await h.advance(1199)
    expect(log).toEqual([])

    await h.advance(1)
    expect(log).toEqual(['mark'])
    expect(h.engine.history.at(-1)?.status).toBe('completed')
  })

  it('B1b · `await: false` lets the next step run immediately', async () => {
    const rule = makeRule({
      when: clickOn(IDS.cover),
      then: [
        { action: 'playAnimation', params: { animationId: IDS.animation, await: false } },
        { action: 'mark', params: {} },
      ],
    })
    const h = harness(docWithRules([rule]), { registry })
    h.engine.dispatch({ event: 'click', nodeId: IDS.cover })
    await h.advance(0)
    expect(log).toEqual(['mark'])
    await h.settle()
  })

  it('B2 · a LOOPING animation resolves immediately even under await, or the sequence deadlocks', async () => {
    const rule = makeRule({
      when: clickOn(IDS.cover),
      then: [
        { action: 'playAnimation', params: { animationId: LOOPING.id, await: true } },
        { action: 'mark', params: {} },
      ],
    })
    const h = harness(docWithRules([rule], withLooping), { registry })

    h.engine.dispatch({ event: 'click', nodeId: IDS.cover })
    await h.advance(0)

    expect(log, 'a looping animation never "ends"; awaiting it must not hang').toEqual(['mark'])
    expect(h.ctx.isAnimationPlaying(LOOPING.id)).toBe(true)
  })

  it('runs steps strictly in order', async () => {
    const rule = makeRule({
      when: clickOn(IDS.cover),
      then: [
        { action: 'slowMark', params: {} },
        { action: 'mark', params: {} },
      ],
    })
    const h = harness(docWithRules([rule]), { registry })
    h.engine.dispatch({ event: 'click', nodeId: IDS.cover })
    await h.settle()
    expect(log).toEqual(['slowMark', 'mark'])
  })
})

describe('error handling', () => {
  it('B7 · onError "abort" skips the remaining steps and reports failed', async () => {
    const rule = makeRule({
      onError: 'abort',
      when: clickOn(IDS.cover),
      then: [
        { action: 'boom', params: {} },
        { action: 'mark', params: {} },
      ],
    })
    const h = harness(docWithRules([rule]), { registry })
    h.engine.dispatch({ event: 'click', nodeId: IDS.cover })
    await h.settle()

    expect(log).toEqual(['boom'])
    const result = h.engine.history.at(-1)!
    expect(result.status).toBe('failed')
    expect(result.steps.map((s) => s.status)).toEqual(['failed', 'skipped'])
    expect(result.steps[0]!.error).toMatch(/failed on purpose/)
  })

  it('B8 · onError "continue" runs the remaining steps anyway', async () => {
    const rule = makeRule({
      onError: 'continue',
      when: clickOn(IDS.cover),
      then: [
        { action: 'boom', params: {} },
        { action: 'mark', params: {} },
      ],
    })
    const h = harness(docWithRules([rule]), { registry })
    h.engine.dispatch({ event: 'click', nodeId: IDS.cover })
    await h.settle()

    expect(log).toEqual(['boom', 'mark'])
    const result = h.engine.history.at(-1)!
    expect(result.status).toBe('failed')
    expect(result.steps.map((s) => s.status)).toEqual(['failed', 'ok'])
  })

  it('reports an unregistered action as a failed step instead of crashing', async () => {
    const rule = makeRule({ when: clickOn(IDS.cover), then: [{ action: 'notRegistered', params: {} }] })
    const h = harness(docWithRules([rule]), { registry })
    h.engine.dispatch({ event: 'click', nodeId: IDS.cover })
    await h.settle()
    expect(h.engine.history.at(-1)?.steps[0]?.error).toMatch(/未注册的动作类型/)
  })

  it('reports invalid action params as a failed step', async () => {
    const rule = makeRule({
      when: clickOn(IDS.cover),
      then: [{ action: 'playAnimation', params: { animationId: 'nonsense' } }],
    })
    const h = harness(docWithRules([rule]), { registry })
    h.engine.dispatch({ event: 'click', nodeId: IDS.cover })
    await h.settle()
    expect(h.engine.history.at(-1)?.steps[0]?.error).toMatch(/动作参数不合法/)
  })
})

describe('parallel execution', () => {
  it('starts every step without waiting for the previous one', async () => {
    const rule = makeRule({
      mode: 'parallel',
      when: clickOn(IDS.cover),
      then: [
        { action: 'slowMark', params: {} },
        { action: 'mark', params: {} },
      ],
    })
    const h = harness(docWithRules([rule]), { registry })
    h.engine.dispatch({ event: 'click', nodeId: IDS.cover })
    await h.advance(0)
    // `mark` is synchronous, so in parallel it finishes while slowMark is still waiting.
    expect(log).toEqual(['mark'])
    await h.settle()
    expect(log).toEqual(['mark', 'slowMark'])
  })

  it('B12 · parallel + first failure + abort cancels the siblings', async () => {
    const rule = makeRule({
      mode: 'parallel',
      onError: 'abort',
      when: clickOn(IDS.cover),
      then: [
        { action: 'boom', params: {} },
        { action: 'slowMark', params: {} },
      ],
    })
    const h = harness(docWithRules([rule]), { registry })
    h.engine.dispatch({ event: 'click', nodeId: IDS.cover })
    await h.settle()

    expect(log, 'the sibling must have been cancelled mid-wait').toEqual(['boom'])
    const result = h.engine.history.at(-1)!
    expect(result.steps.map((s) => s.status)).toEqual(['failed', 'skipped'])
  })

  it('parallel + continue lets the siblings finish', async () => {
    const rule = makeRule({
      mode: 'parallel',
      onError: 'continue',
      when: clickOn(IDS.cover),
      then: [
        { action: 'boom', params: {} },
        { action: 'slowMark', params: {} },
      ],
    })
    const h = harness(docWithRules([rule]), { registry })
    h.engine.dispatch({ event: 'click', nodeId: IDS.cover })
    await h.settle()
    expect(log).toEqual(['boom', 'slowMark'])
  })
})

describe('re-entry policies (MVP_V0 D9)', () => {
  const slowRule = (reentry: 'restart' | 'ignore' | 'queue') =>
    makeRule({ reentry, when: clickOn(IDS.cover), then: [{ action: 'slowMark', params: {} }] })

  it('B3 · restart: three rapid triggers leave only the last one completed', async () => {
    const h = harness(docWithRules([slowRule('restart')]), { registry })
    h.engine.dispatch({ event: 'click', nodeId: IDS.cover })
    await h.advance(100)
    h.engine.dispatch({ event: 'click', nodeId: IDS.cover })
    await h.advance(100)
    h.engine.dispatch({ event: 'click', nodeId: IDS.cover })
    await h.settle()

    expect(log, 'only the surviving run reaches its body').toEqual(['slowMark'])
    expect(h.statuses()).toEqual(['aborted', 'aborted', 'completed'])
  })

  it('B4 · ignore: later triggers are dropped while a run is in flight', async () => {
    const h = harness(docWithRules([slowRule('ignore')]), { registry })
    h.engine.dispatch({ event: 'click', nodeId: IDS.cover })
    await h.advance(100)
    h.engine.dispatch({ event: 'click', nodeId: IDS.cover })
    h.engine.dispatch({ event: 'click', nodeId: IDS.cover })
    await h.settle()

    expect(log).toEqual(['slowMark'])
    expect(h.statuses()).toEqual(['skipped-reentry', 'skipped-reentry', 'completed'])
  })

  it('B5 · queue: runs strictly serially, in trigger order', async () => {
    const h = harness(docWithRules([slowRule('queue')]), { registry })
    h.engine.dispatch({ event: 'click', nodeId: IDS.cover })
    await h.advance(100)
    h.engine.dispatch({ event: 'click', nodeId: IDS.cover })
    h.engine.dispatch({ event: 'click', nodeId: IDS.cover })
    await h.settle()

    expect(log).toEqual(['slowMark', 'slowMark', 'slowMark'])
    expect(h.statuses()).toEqual(['completed', 'completed', 'completed'])
  })

  it('queue drops the oldest beyond its limit rather than growing without bound', async () => {
    const h = harness(docWithRules([slowRule('queue')]), { registry })
    for (let i = 0; i < 12; i++) h.engine.dispatch({ event: 'click', nodeId: IDS.cover })
    await h.settle()
    // 1 running + at most 8 queued.
    expect(log.length).toBeLessThanOrEqual(9)
    expect(h.ctx.warnings().some((w) => w.message.includes('排队上限'))).toBe(true)
  })
})

describe('cancellation semantics (ECA_SPEC §5.3)', () => {
  it('an aborted run is not an error and produces no user-visible failure', async () => {
    const h = harness(docWithRules([makeRule({ reentry: 'restart', when: clickOn(IDS.cover), then: [{ action: 'slowMark', params: {} }] })]), {
      registry,
    })
    h.engine.dispatch({ event: 'click', nodeId: IDS.cover })
    await h.advance(100)
    h.engine.dispatch({ event: 'click', nodeId: IDS.cover })
    await h.settle()

    expect(h.engine.history[0]!.status).toBe('aborted')
    expect(h.engine.history[0]!.steps.every((s) => s.status !== 'failed')).toBe(true)
    expect(h.ctx.errors()).toHaveLength(0)
  })

  it('an interrupted animation reports animationEnd with completed: false', async () => {
    const seen: boolean[] = []
    const h = harness(docWithRules([makeRule({ when: clickOn(IDS.cover), then: [{ action: 'playAnimation', params: { animationId: IDS.animation } }] })]), {
      registry,
    })
    h.ctx.onEvent((e) => {
      if (e.event === 'animationEnd') seen.push(e.completed)
    })
    h.engine.dispatch({ event: 'click', nodeId: IDS.cover })
    await h.advance(200)
    h.ctx.stopAnimation(IDS.animation)
    await h.settle()
    expect(seen).toEqual([false])
  })
})

describe('ExecResult', () => {
  it('is deterministic: identical input produces an identical trace', async () => {
    // One rule object, two independent runs — otherwise the ids differ and the test
    // would be comparing its own scaffolding rather than the engine.
    const rule = makeRule({ when: clickOn(IDS.cover), then: [{ action: 'mark', params: {} }] })
    const runOnce = async () => {
      const h = harness(docWithRules([rule]), { registry })
      h.engine.dispatch({ event: 'click', nodeId: IDS.cover })
      await h.settle()
      return JSON.stringify(h.engine.history)
    }
    expect(await runOnce()).toBe(await runOnce())
  })

  it('carries timestamps from ctx.now(), never the wall clock', async () => {
    const h = harness(docWithRules([makeRule({ when: clickOn(IDS.cover), then: [{ action: 'slowMark', params: {} }] })]), { registry })
    h.engine.dispatch({ event: 'click', nodeId: IDS.cover })
    await h.settle()
    const result = h.engine.history.at(-1)!
    expect(result.startedAt).toBe(0)
    expect(result.endedAt).toBe(500)
  })
})
