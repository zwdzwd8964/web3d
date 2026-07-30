import type { SceneDocument } from '@w3/schema'
import { createGoldenPathDocument } from '@w3/schema'
import { beforeEach, describe, expect, it } from 'vitest'
import { ActionRegistry, registerBuiltinActions } from '../../src/eca/actions/index.js'
import { EcaEngine } from '../../src/eca/engine.js'
import { HeadlessRuntime } from '../../src/eca/headless.js'
import { IDS, clickOn, docWithRules, harness, makeRule, recorderAction } from '../helpers.js'

/** T-086 · ECA_SPEC §7, covering §9.2's B9, B10, B11, B13 and B14. */

let log: string[]
let registry: ActionRegistry

beforeEach(() => {
  log = []
  registry = registerBuiltinActions(new ActionRegistry())
  registry.register(recorderAction('mark', log) as never)
  registry.register(recorderAction('slowMark', log, { waitMs: 300 }) as never)
})

describe('the golden path, end to end and head-less', () => {
  it('MVP_V0 §2 step 11 · click plays, highlights, opens the panel and advances the step', async () => {
    const h = harness(createGoldenPathDocument(), { registry })

    h.engine.dispatch({ event: 'click', nodeId: IDS.cover })
    await h.settle()

    expect(h.ctx.highlightOf(IDS.cover)).toBe('outline_amber')
    expect(h.ctx.isPanelOpen(IDS.hotspot)).toBe(true)
    expect(h.ctx.getVar('step')).toBe(2)
    expect(h.engine.history.at(-1)?.status).toBe('completed')
  })

  it('MVP_V0 §2 step 11 · a second click does nothing, because the condition no longer holds', async () => {
    const h = harness(createGoldenPathDocument(), { registry })
    h.engine.dispatch({ event: 'click', nodeId: IDS.cover })
    await h.settle()

    h.ctx.closePanel('all')
    h.engine.dispatch({ event: 'click', nodeId: IDS.cover })
    await h.settle()

    expect(h.ctx.isPanelOpen(IDS.hotspot), 'the rule must not have run a second time').toBe(false)
    expect(h.ctx.getVar('step')).toBe(2)
    expect(h.engine.history.at(-1)?.status).toBe('skipped-condition')
  })

  it('the animation really is awaited before the panel opens', async () => {
    const h = harness(createGoldenPathDocument(), { registry })
    h.engine.dispatch({ event: 'click', nodeId: IDS.cover })
    await h.advance(0)
    expect(h.ctx.isPanelOpen(IDS.hotspot), 'the panel must wait for the 1.2 s tween').toBe(false)
    await h.advance(1200)
    expect(h.ctx.isPanelOpen(IDS.hotspot)).toBe(true)
  })
})

describe('edit mode vs preview mode (ECA_SPEC §7)', () => {
  it('a disabled engine ignores events, so a configured object stays selectable', async () => {
    const h = harness(createGoldenPathDocument(), { registry, enabled: false })
    h.engine.dispatch({ event: 'click', nodeId: IDS.cover })
    await h.settle()
    expect(h.engine.history).toHaveLength(0)
    expect(h.ctx.getVar('step')).toBe(1)
  })

  it('B13 · leaving preview restores the state the editor was in', async () => {
    const h = harness(createGoldenPathDocument(), { registry })

    // Enter preview from a clean document, run the golden path.
    h.engine.dispatch({ event: 'click', nodeId: IDS.cover })
    await h.settle()
    expect(h.ctx.getVar('step')).toBe(2)
    expect(h.ctx.isPanelOpen(IDS.hotspot)).toBe(true)

    // Leaving preview: disable, then reset.
    h.engine.setEnabled(false)
    h.ctx.resetScene()

    expect(h.ctx.getVar('step')).toBe(1)
    expect(h.ctx.isPanelOpen(IDS.hotspot)).toBe(false)
    expect(h.ctx.highlightOf(IDS.cover)).toBeNull()
    expect(h.ctx.isVisible(IDS.cover)).toBe(true)
    expect(h.ctx.isAnimationPlaying(IDS.animation)).toBe(false)
  })

  it('disabling aborts whatever was in flight', async () => {
    const rule = makeRule({ when: clickOn(IDS.cover), then: [{ action: 'slowMark', params: {} }] })
    const h = harness(docWithRules([rule]), { registry })
    h.engine.dispatch({ event: 'click', nodeId: IDS.cover })
    await h.advance(100)
    h.engine.setEnabled(false)
    await h.settle()
    expect(log).toEqual([])
  })
})

describe('B9 · a rule pointing at something the user deleted', () => {
  it('skips the step, logs an error, and does not crash the engine', async () => {
    const doc = createGoldenPathDocument()
    // Delete 阀盖 but leave the rule that highlights it in place.
    const pruned: SceneDocument = {
      ...doc,
      nodes: doc.nodes.filter((n) => n.id !== IDS.cover),
      hotspots: [],
      animations: [],
      rules: [
        makeRule({
          when: { event: 'sceneReady' },
          then: [
            { action: 'highlight', params: { nodeId: IDS.cover, preset: 'outline_amber' } },
            { action: 'mark', params: {} },
          ],
        }),
      ],
    }
    const h = harness(pruned, { registry })
    h.engine.dispatch({ event: 'sceneReady' })
    await h.settle()

    const result = h.engine.history.at(-1)!
    expect(result.steps[0]!.status).toBe('skipped')
    expect(result.steps[1]!.status, 'a skipped step is not a failure — later steps still run').toBe('ok')
    expect(result.status).toBe('completed')
    expect(h.ctx.errors().some((e) => e.message.includes('已不存在'))).toBe(true)
  })
})

describe('B10 · variable chain depth', () => {
  it('caps a self-triggering variableChange rule instead of freezing', async () => {
    const doc = createGoldenPathDocument()
    const looping: SceneDocument = {
      ...doc,
      rules: [
        makeRule({
          name: '自触发',
          when: { event: 'variableChange', variableId: 'step' },
          then: [{ action: 'setVariable', params: { variableId: 'step', value: { const: 1 }, mode: 'add' } }],
        }),
      ],
    }
    const h = harness(looping, { registry })

    h.ctx.setVar('step', 2)
    await h.settle()

    expect(h.ctx.errors().some((e) => e.message.includes('规则连锁深度超过 16'))).toBe(true)
    // Bounded, not runaway: the cap stopped it well before anything hung.
    expect(h.ctx.getVar('step')).toBeLessThan(40)
  })

  it('writing the same value is not a change, so it never starts a chain', async () => {
    const h = harness(createGoldenPathDocument(), { registry })
    h.ctx.setVar('step', 1)
    await h.settle()
    expect(h.engine.history).toHaveLength(0)
  })
})

describe('B11 · detach', () => {
  it('aborts running rules, clears timers and leaves nothing pending', async () => {
    const rule = makeRule({ when: clickOn(IDS.cover), then: [{ action: 'slowMark', params: {} }] })
    const h = harness(docWithRules([rule]), { registry })
    h.engine.dispatch({ event: 'click', nodeId: IDS.cover })
    await h.advance(50)

    h.engine.detach()
    await h.settle()

    expect(log).toEqual([])
    expect(h.ctx.clock.pendingCount).toBe(0)
    // Dispatching after detach is a no-op rather than an exception.
    expect(() => h.engine.dispatch({ event: 'click', nodeId: IDS.cover })).not.toThrow()
  })
})

describe('B14 · the { event: … } value expression', () => {
  it('reads the clicked node inside a wildcard rule', async () => {
    const doc = createGoldenPathDocument()
    const wildcard: SceneDocument = {
      ...doc,
      variables: [...doc.variables, { id: 'clicked', name: '点中的对象', type: 'string', default: '', persist: false }],
      rules: [
        makeRule({
          name: '记录点中的对象',
          when: { event: 'click', target: { any: true } },
          then: [{ action: 'setVariable', params: { variableId: 'clicked', value: { event: 'nodeId' } } }],
        }),
      ],
    }
    const h = harness(wildcard, { registry })

    h.engine.dispatch({ event: 'click', nodeId: IDS.body })
    await h.settle()
    expect(h.ctx.getVar('clicked')).toBe(IDS.body)

    h.engine.dispatch({ event: 'click', nodeId: IDS.cover })
    await h.settle()
    expect(h.ctx.getVar('clicked')).toBe(IDS.cover)
  })

  it('a condition can compare the event payload too', async () => {
    const doc = createGoldenPathDocument()
    const guarded: SceneDocument = {
      ...doc,
      rules: [
        makeRule({
          when: { event: 'click', target: { any: true } },
          if: [{ op: 'eq', left: { event: 'nodeId' }, right: { const: IDS.body } }],
          then: [{ action: 'mark', params: {} }],
        }),
      ],
    }
    const h = harness(guarded, { registry })

    h.engine.dispatch({ event: 'click', nodeId: IDS.cover })
    await h.settle()
    expect(log).toEqual([])

    h.engine.dispatch({ event: 'click', nodeId: IDS.body })
    await h.settle()
    expect(log).toEqual(['mark'])
  })
})

describe('timers', () => {
  it('a sceneReady timer fires after its delay and can repeat', async () => {
    const doc = createGoldenPathDocument()
    const timed: SceneDocument = {
      ...doc,
      rules: [
        makeRule({
          when: { event: 'timer', delay: 500, repeat: true, startOn: 'sceneReady' },
          then: [{ action: 'mark', params: {} }],
        }),
      ],
    }
    const h = harness(timed, { registry })
    h.engine.dispatch({ event: 'sceneReady' })

    await h.advance(499)
    expect(log).toEqual([])
    await h.advance(1)
    expect(log).toEqual(['mark'])
    await h.advance(500)
    expect(log).toEqual(['mark', 'mark'])

    h.engine.detach()
  })

  it('a non-repeating timer fires exactly once', async () => {
    const doc = createGoldenPathDocument()
    const timed: SceneDocument = {
      ...doc,
      rules: [
        makeRule({
          when: { event: 'timer', delay: 200, repeat: false, startOn: 'sceneReady' },
          then: [{ action: 'mark', params: {} }],
        }),
      ],
    }
    const h = harness(timed, { registry })
    h.engine.dispatch({ event: 'sceneReady' })
    await h.advance(1000)
    expect(log).toEqual(['mark'])
    h.engine.detach()
  })
})

describe('history', () => {
  it('is a ring buffer that does not grow without bound', async () => {
    const rule = makeRule({ when: clickOn(IDS.cover), then: [{ action: 'mark', params: {} }] })
    const h = harness(docWithRules([rule]), { registry })
    for (let i = 0; i < 520; i++) {
      h.engine.dispatch({ event: 'click', nodeId: IDS.cover })
      await h.settle()
    }
    expect(h.engine.history.length).toBe(500)
  })

  it('clearHistory empties it', async () => {
    const h = harness(createGoldenPathDocument(), { registry })
    h.engine.dispatch({ event: 'click', nodeId: IDS.cover })
    await h.settle()
    expect(h.engine.history.length).toBeGreaterThan(0)
    h.engine.clearHistory()
    expect(h.engine.history).toHaveLength(0)
  })
})

describe('onDocumentPatch', () => {
  it('picks up rules the editor just added', async () => {
    const h = harness(createGoldenPathDocument(), { registry })
    const added = makeRule({ when: clickOn(IDS.body), then: [{ action: 'mark', params: {} }] })

    h.engine.dispatch({ event: 'click', nodeId: IDS.body })
    await h.settle()
    expect(log).toEqual([])

    h.engine.onDocumentPatch({ ...h.doc, rules: [...h.doc.rules, added] })
    h.engine.dispatch({ event: 'click', nodeId: IDS.body })
    await h.settle()
    expect(log).toEqual(['mark'])
  })

  it('is a no-op before attach', () => {
    const ctx = new HeadlessRuntime(createGoldenPathDocument())
    const engine = new EcaEngine(ctx, { registry })
    expect(() => engine.onDocumentPatch(createGoldenPathDocument())).not.toThrow()
  })
})
