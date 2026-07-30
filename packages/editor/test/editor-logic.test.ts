import type { SceneDocument } from '@w3/schema'
import { checkIntegrity, createGoldenPathDocument, errorsOf } from '@w3/schema'
import { describe, expect, it } from 'vitest'
import { IDENTITY_QUAT, fromEulerDegrees, sameRotation, toEulerDegrees } from '@w3/core'
import {
  MIXED,
  commonValue,
  commonVector,
  commonVectorComponents,
  displayValue,
  formatNumber,
  isMixed,
  parseNumber,
} from '../src/lib/selection-values.js'
import { applyDropPlan, canDrop, dropPositionFor, flattenTree, rangeBetween } from '../src/panels/tree-dnd.js'
import { createDocumentStore } from '../src/store/document-store.js'

/** T-063 / T-064 · the parts of the panels that are logic rather than markup. */

const PUMP = 'nd_r5t8y1u3'
const BODY = 'nd_v7w9x2z4'
const COVER = 'nd_b3n5m7k9'

describe('T-064 · Euler <-> quaternion', () => {
  it('round-trips a rotation, even when the Euler triple differs', () => {
    for (const euler of [
      [0, 0, 0],
      [90, 0, 0],
      [0, 45, 0],
      [30, 60, 90],
      [-120, 15, 200],
    ] as [number, number, number][]) {
      const q = fromEulerDegrees(euler)
      // Many Euler triples map to one rotation, so compare rotations, not numbers.
      expect(sameRotation(q, fromEulerDegrees(toEulerDegrees(q))), euler.join(',')).toBe(true)
    }
  })

  it('produces a near-unit quaternion', () => {
    const q = fromEulerDegrees([37, -12, 88])
    const length = Math.hypot(q[0], q[1], q[2], q[3])
    // Components are rounded to 6 decimals so document diffs stay readable, which costs
    // ~1e-7 of unit length. The runtime normalises on read, so this never accumulates.
    expect(length).toBeCloseTo(1, 6)
  })

  it('maps identity both ways', () => {
    expect(toEulerDegrees(IDENTITY_QUAT)).toEqual([0, 0, 0])
    expect(fromEulerDegrees([0, 0, 0])).toEqual(IDENTITY_QUAT)
  })

  it('a quarter turn about Y is the expected quaternion', () => {
    const q = fromEulerDegrees([0, 90, 0])
    expect(q[1]).toBeCloseTo(Math.SQRT1_2, 6)
    expect(q[3]).toBeCloseTo(Math.SQRT1_2, 6)
  })

  it('treats q and -q as the same rotation', () => {
    const q = fromEulerDegrees([30, 60, 90])
    const negated: typeof q = [-q[0], -q[1], -q[2], -q[3]]
    expect(sameRotation(q, negated)).toBe(true)
  })

  it('never emits -0, which would show up in document diffs', () => {
    for (const n of fromEulerDegrees([0, -0, 0])) expect(Object.is(n, -0)).toBe(false)
  })
})

describe('T-064 · multi-select values', () => {
  const items = [{ v: 1 }, { v: 1 }, { v: 2 }]

  it('reports the shared value or MIXED', () => {
    expect(commonValue([{ v: 5 }, { v: 5 }], (i) => i.v)).toBe(5)
    expect(commonValue(items, (i) => i.v)).toBe(MIXED)
    expect(commonValue([], (i: { v: number }) => i.v)).toBeUndefined()
  })

  it('compares vectors per component, so only the differing axis reads as mixed', () => {
    const nodes = [{ p: [0, 5, 0] }, { p: [0, 9, 0] }]
    const components = commonVectorComponents(nodes, (n) => n.p)
    expect(components[0]).toBe(0)
    expect(isMixed(components[1])).toBe(true)
    expect(components[2]).toBe(0)
  })

  it('compares whole vectors when the field is edited as one', () => {
    expect(commonVector([{ p: [1, 2, 3] }, { p: [1, 2, 3] }], (n) => n.p)).toEqual([1, 2, 3])
    expect(commonVector([{ p: [1, 2, 3] }, { p: [1, 2, 4] }], (n) => n.p)).toBe(MIXED)
  })

  it('displays an em dash for mixed and trims trailing zeros', () => {
    expect(displayValue(MIXED)).toBe('—')
    expect(displayValue(undefined)).toBe('')
    expect(displayValue(0.35)).toBe('0.35')
    expect(formatNumber(1)).toBe('1')
    expect(formatNumber(0.123456)).toBe('0.123')
  })

  it('parseNumber refuses to put NaN into the document', () => {
    expect(parseNumber('0.35', 0)).toBe(0.35)
    expect(parseNumber('', 7)).toBe(7)
    expect(parseNumber('abc', 7)).toBe(7)
    expect(parseNumber('Infinity', 7)).toBe(7)
  })
})

describe('T-063 · hierarchy drag and drop', () => {
  const doc = createGoldenPathDocument()

  it('SCHEMA_SPEC §4.2 · refuses a drop into the node’s own subtree', () => {
    const result = canDrop(doc, PUMP, { nodeId: BODY, position: 'inside' })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toBe('cycle')
      expect(result.message).toContain('自己的子树')
    }
  })

  it('refuses a drop onto itself', () => {
    const result = canDrop(doc, BODY, { nodeId: BODY, position: 'inside' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('self')
  })

  it('refuses to move a locked node', () => {
    const locked: SceneDocument = {
      ...doc,
      nodes: doc.nodes.map((n) => (n.id === BODY ? { ...n, locked: true } : n)),
    }
    const result = canDrop(locked, BODY, { nodeId: COVER, position: 'after' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('locked')
  })

  it('reports a missing node rather than throwing', () => {
    const result = canDrop(doc, 'nd_99999999', { nodeId: BODY, position: 'inside' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('missing')
  })

  it('re-parents into a group and appends last', () => {
    const result = canDrop(doc, BODY, { nodeId: COVER, position: 'inside' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.plan).toMatchObject({ nodeId: BODY, parent: COVER })
    expect(result.plan.order).toBe(1000)
  })

  it('reorders between siblings by picking a midpoint order', () => {
    // 泵体 order 1000, 阀盖 order 2000. Dropping 阀盖 before 泵体 lands below 1000.
    const result = canDrop(doc, COVER, { nodeId: BODY, position: 'before' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.plan.parent).toBe(PUMP)
    expect(result.plan.order).toBeLessThan(1000)
  })

  it('renumbers the row when the integer gap is exhausted', () => {
    const tight: SceneDocument = {
      ...doc,
      nodes: doc.nodes.map((n) =>
        n.id === BODY ? { ...n, order: 1000 } : n.id === COVER ? { ...n, order: 1001 } : n,
      ),
    }
    const extra = { ...tight.nodes.find((n) => n.id === BODY)!, id: 'nd_11111111', name: '第三个', order: 1002 }
    const withThree: SceneDocument = { ...tight, nodes: [...tight.nodes, extra] }

    const result = canDrop(withThree, 'nd_11111111', { nodeId: COVER, position: 'before' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.plan.renumber, '间隔耗尽时应先批量重编号').toBeDefined()
    // The whole sibling row is renumbered, dragged node included — its order is then
    // overwritten by the plan, so including it costs nothing and keeps the row clean.
    expect([...result.plan.renumber!.values()]).toEqual([1000, 2000, 3000])
    expect(result.plan.order).toBeGreaterThan(1000)
    expect(result.plan.order).toBeLessThan(2000)
  })

  it('one drag produces one undo entry and a still-valid document', () => {
    const store = createDocumentStore(createGoldenPathDocument(), { now: () => 0 })
    const result = canDrop(store.getState().doc, BODY, { nodeId: COVER, position: 'inside' })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    store.getState().commit('移动 泵体', (draft) => applyDropPlan(draft, result.plan))

    expect(store.getState().historyDepth).toBe(1)
    expect(store.getState().doc.nodes.find((n) => n.id === BODY)!.parent).toBe(COVER)
    expect(errorsOf(checkIntegrity(store.getState().doc))).toHaveLength(0)

    store.getState().undo()
    expect(store.getState().doc.nodes.find((n) => n.id === BODY)!.parent).toBe(PUMP)
  })
})

describe('T-063 · tree flattening', () => {
  const doc = createGoldenPathDocument()

  it('produces a flat row list with depths, in order', () => {
    const rows = flattenTree(doc, new Set())
    expect(rows.map((r) => [r.node.name, r.depth])).toEqual([
      ['泵组', 0],
      ['泵体', 1],
      ['阀盖', 1],
    ])
    expect(rows[0]!.hasChildren).toBe(true)
    expect(rows[1]!.hasChildren).toBe(false)
  })

  it('hides the children of a collapsed branch', () => {
    const rows = flattenTree(doc, new Set([PUMP]))
    expect(rows.map((r) => r.node.name)).toEqual(['泵组'])
  })

  it('does not hang on a corrupted parent chain', () => {
    const looped: SceneDocument = {
      ...doc,
      nodes: doc.nodes.map((n) => (n.id === PUMP ? { ...n, parent: COVER } : n)),
    }
    expect(() => flattenTree(looped, new Set())).not.toThrow()
    expect(flattenTree(looped, new Set()).length).toBeLessThan(10)
  })

  it('resolves a shift-click range in either direction', () => {
    const rows = flattenTree(doc, new Set())
    expect(rangeBetween(rows, PUMP, COVER)).toEqual([PUMP, BODY, COVER])
    expect(rangeBetween(rows, COVER, PUMP)).toEqual([PUMP, BODY, COVER])
    expect(rangeBetween(rows, 'nd_99999999', COVER)).toEqual([COVER])
  })

  it('maps pointer offset to a drop position in thirds', () => {
    expect(dropPositionFor(2, 24, true)).toBe('before')
    expect(dropPositionFor(12, 24, true)).toBe('inside')
    expect(dropPositionFor(22, 24, true)).toBe('after')
    // A leaf cannot be dropped into, so it splits in half instead.
    expect(dropPositionFor(10, 24, false)).toBe('before')
    expect(dropPositionFor(14, 24, false)).toBe('after')
  })
})
