import type { Condition, SceneDocument } from '@w3/schema'
import { createGoldenPathDocument } from '@w3/schema'
import { beforeEach, describe, expect, it } from 'vitest'
import { evaluateCondition, evaluateRuleConditions, evaluateValueExpr } from '../../src/eca/conditions.js'
import { HeadlessRuntime } from '../../src/eca/headless.js'
import type { RuntimeEvent } from '../../src/eca/types.js'
import { IDS, clickOn, makeRule } from '../helpers.js'

/** T-081 · ECA_SPEC §3. */

const docWithVars = (): SceneDocument => {
  const doc = createGoldenPathDocument()
  return {
    ...doc,
    variables: [
      ...doc.variables,
      {
        scope: 'scene' as const, id: 'title', name: '标题', type: 'string', default: 'A', persist: false },
      {
        scope: 'scene' as const, id: 'done', name: '完成', type: 'boolean', default: false, persist: false },
    ],
  }
}

let ctx: HeadlessRuntime

beforeEach(() => {
  ctx = new HeadlessRuntime(docWithVars())
})

const evaluate = (cond: Condition, event: RuntimeEvent | null = null) => evaluateCondition(cond, ctx, event)

describe('evaluateValueExpr()', () => {
  it('reads constants, variables and node properties', () => {
    expect(evaluateValueExpr({ const: 7 }, ctx, null)).toBe(7)
    expect(evaluateValueExpr({ var: 'step' }, ctx, null)).toBe(1)
    expect(evaluateValueExpr({ prop: { nodeId: IDS.cover, key: 'visible' } }, ctx, null)).toBe(true)
    expect(evaluateValueExpr({ prop: { nodeId: IDS.cover, key: 'positionY' } }, ctx, null)).toBe(0)
  })

  it('reads the payload of the triggering event', () => {
    const event: RuntimeEvent = { event: 'click', nodeId: IDS.cover }
    expect(evaluateValueExpr({ event: 'nodeId' }, ctx, event)).toBe(IDS.cover)
  })

  it('returns undefined — not a fake value — when there is no event to read', () => {
    expect(evaluateValueExpr({ event: 'nodeId' }, ctx, null)).toBeUndefined()
    expect(evaluateValueExpr({ event: 'hotspotId' }, ctx, { event: 'click', nodeId: IDS.cover })).toBeUndefined()
  })
})

describe('comparison operators', () => {
  it('compares numbers with every ordering operator', () => {
    const cmp = (op: 'gt' | 'gte' | 'lt' | 'lte' | 'eq' | 'ne', right: number) =>
      evaluate({ op, left: { var: 'step' }, right: { const: right } } as Condition)
    expect(cmp('eq', 1)).toBe(true)
    expect(cmp('ne', 2)).toBe(true)
    expect(cmp('gt', 0)).toBe(true)
    expect(cmp('gte', 1)).toBe(true)
    expect(cmp('lt', 2)).toBe(true)
    expect(cmp('lte', 1)).toBe(true)
    expect(cmp('gt', 1)).toBe(false)
  })

  it('compares strings by ordering as well as equality', () => {
    expect(evaluate({ op: 'eq', left: { var: 'title' }, right: { const: 'A' } })).toBe(true)
    expect(evaluate({ op: 'lt', left: { var: 'title' }, right: { const: 'B' } })).toBe(true)
  })

  it('B6 · a type mismatch evaluates to false and logs one warning — no coercion, no throw', () => {
    expect(evaluate({ op: 'eq', left: { var: 'step' }, right: { const: '1' } })).toBe(false)
    expect(ctx.warnings()).toHaveLength(1)
    expect(ctx.warnings()[0]!.message).toMatch(/类型不匹配/)
    expect(ctx.errors()).toHaveLength(0)
  })

  it('refuses to order booleans instead of silently coercing them to 0/1', () => {
    expect(evaluate({ op: 'gt', left: { var: 'done' }, right: { const: false } })).toBe(false)
    expect(ctx.warnings()[0]!.message).toMatch(/布尔值不支持/)
  })

  it('compares booleans for equality', () => {
    expect(evaluate({ op: 'eq', left: { var: 'done' }, right: { const: false } })).toBe(true)
    expect(evaluate({ op: 'ne', left: { var: 'done' }, right: { const: true } })).toBe(true)
  })

  it('an unreadable operand evaluates to false with a warning, not an exception', () => {
    expect(evaluate({ op: 'eq', left: { event: 'nodeId' }, right: { const: 'x' } }, null)).toBe(false)
    expect(ctx.warnings()[0]!.message).toMatch(/无法读取/)
  })
})

describe('`in` operator', () => {
  it('tests membership with the same strict typing', () => {
    expect(evaluate({ op: 'in', left: { var: 'step' }, right: [1, 2, 3] })).toBe(true)
    expect(evaluate({ op: 'in', left: { var: 'step' }, right: [2, 3] })).toBe(false)
    expect(evaluate({ op: 'in', left: { var: 'step' }, right: ['1'] })).toBe(false)
  })

  it('reports an unreadable left operand rather than matching nothing silently', () => {
    expect(evaluate({ op: 'in', left: { event: 'nodeId' }, right: ['x'] }, null)).toBe(false)
    expect(ctx.warnings()).toHaveLength(1)
  })
})

describe('scene-state operators', () => {
  it('reads visibility, playback and panel state through the context', () => {
    expect(evaluate({ op: 'isVisible', nodeId: IDS.cover, value: true })).toBe(true)
    ctx.setVisible(IDS.cover, false)
    expect(evaluate({ op: 'isVisible', nodeId: IDS.cover, value: true })).toBe(false)
    expect(evaluate({ op: 'isVisible', nodeId: IDS.cover, value: false })).toBe(true)

    expect(evaluate({ op: 'isPlaying', animationId: IDS.animation, value: false })).toBe(true)

    expect(evaluate({ op: 'isPanelOpen', hotspotId: IDS.hotspot, value: false })).toBe(true)
    ctx.openPanel(IDS.hotspot)
    expect(evaluate({ op: 'isPanelOpen', hotspotId: IDS.hotspot, value: true })).toBe(true)
  })
})

describe('evaluation is pure', () => {
  it('leaves the runtime untouched', () => {
    const before = { visible: ctx.isVisible(IDS.cover), step: ctx.getVar('step'), panels: ctx.openPanels.length }
    evaluate({ op: 'eq', left: { var: 'step' }, right: { const: 1 } })
    evaluate({ op: 'isVisible', nodeId: IDS.cover, value: true })
    evaluate({ op: 'isPanelOpen', hotspotId: IDS.hotspot, value: false })
    expect({ visible: ctx.isVisible(IDS.cover), step: ctx.getVar('step'), panels: ctx.openPanels.length }).toEqual(before)
  })
})

describe('evaluateRuleConditions() — ECA_SPEC §3.3', () => {
  const rule = (over: Partial<Parameters<typeof makeRule>[0]>) =>
    makeRule({ when: clickOn(IDS.cover), then: [{ action: 'resetScene', params: {} }], ...over })

  const T: Condition = { op: 'eq', left: { var: 'step' }, right: { const: 1 } }
  const F: Condition = { op: 'eq', left: { var: 'step' }, right: { const: 9 } }

  it('a disabled rule never passes', () => {
    expect(evaluateRuleConditions(rule({ enabled: false }), ctx, null)).toBe(false)
  })

  it('empty if and empty ifAny passes', () => {
    expect(evaluateRuleConditions(rule({}), ctx, null)).toBe(true)
  })

  it('if is AND', () => {
    expect(evaluateRuleConditions(rule({ if: [T, T] }), ctx, null)).toBe(true)
    expect(evaluateRuleConditions(rule({ if: [T, F] }), ctx, null)).toBe(false)
  })

  it('ifAny is OR', () => {
    expect(evaluateRuleConditions(rule({ ifAny: [F, T] }), ctx, null)).toBe(true)
    expect(evaluateRuleConditions(rule({ ifAny: [F, F] }), ctx, null)).toBe(false)
  })

  it('both groups present means (AND group) && (OR group)', () => {
    expect(evaluateRuleConditions(rule({ if: [T], ifAny: [T, F] }), ctx, null)).toBe(true)
    expect(evaluateRuleConditions(rule({ if: [T], ifAny: [F, F] }), ctx, null)).toBe(false)
    expect(evaluateRuleConditions(rule({ if: [F], ifAny: [T] }), ctx, null)).toBe(false)
  })
})
