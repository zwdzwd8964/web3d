import { buildIndex, createGoldenPathDocument } from '@w3/schema'
import { describe, expect, it } from 'vitest'
import { EventBus, candidateRules, eventPayload, isSelfOrDescendant, matchesNodeTarget, triggerMatches } from '../../src/eca/events.js'
import type { RuntimeEvent } from '../../src/eca/types.js'
import { IDS, clickOn, docWithRules, makeRule } from '../helpers.js'

/** T-080 · ECA_SPEC §2. */

const doc = createGoldenPathDocument()
const index = buildIndex(doc)

describe('EventBus', () => {
  it('delivers to type listeners and to wildcard listeners', () => {
    const bus = new EventBus()
    const seen: string[] = []
    bus.on('click', () => seen.push('click'))
    bus.on('*', () => seen.push('*'))
    bus.emit({ event: 'click', nodeId: IDS.cover })
    bus.emit({ event: 'sceneReady' })
    expect(seen).toEqual(['click', '*', '*'])
  })

  it('lets a listener unsubscribe itself while handling without skipping siblings', () => {
    const bus = new EventBus()
    const seen: string[] = []
    const off = bus.on('click', () => {
      seen.push('first')
      off()
    })
    bus.on('click', () => seen.push('second'))
    bus.emit({ event: 'click', nodeId: IDS.cover })
    bus.emit({ event: 'click', nodeId: IDS.cover })
    expect(seen).toEqual(['first', 'second', 'second'])
  })

  it('clear() removes everything', () => {
    const bus = new EventBus()
    let count = 0
    bus.on('*', () => count++)
    bus.clear()
    bus.emit({ event: 'sceneReady' })
    expect(count).toBe(0)
  })
})

describe('node target matching (ECA_SPEC §2.2)', () => {
  it('matches an exact node and nothing else', () => {
    expect(matchesNodeTarget({ nodeId: IDS.cover }, IDS.cover, index)).toBe(true)
    expect(matchesNodeTarget({ nodeId: IDS.cover }, IDS.body, index)).toBe(false)
  })

  it('includeDescendants covers the whole subtree — one rule instead of one per mesh', () => {
    const target = { nodeId: IDS.pump, includeDescendants: true } as const
    expect(matchesNodeTarget(target, IDS.pump, index)).toBe(true)
    expect(matchesNodeTarget(target, IDS.body, index)).toBe(true)
    expect(matchesNodeTarget(target, IDS.cover, index)).toBe(true)
    // Not the other way round: a parent is not inside its child.
    expect(matchesNodeTarget({ nodeId: IDS.cover, includeDescendants: true }, IDS.pump, index)).toBe(false)
  })

  it('{ any: true } matches every node', () => {
    expect(matchesNodeTarget({ any: true }, IDS.body, index)).toBe(true)
    expect(matchesNodeTarget({ any: true }, 'nd_99999999', index)).toBe(true)
  })

  it('isSelfOrDescendant terminates on a corrupted parent chain', () => {
    const looped = buildIndex({
      ...doc,
      nodes: doc.nodes.map((n) => (n.id === IDS.pump ? { ...n, parent: IDS.cover } : n)),
    })
    expect(() => isSelfOrDescendant(looped, IDS.body, 'nd_99999999')).not.toThrow()
    expect(isSelfOrDescendant(looped, IDS.body, 'nd_99999999')).toBe(false)
  })
})

describe('triggerMatches()', () => {
  const cases: [string, RuntimeEvent, boolean][] = [
    ['same node', { event: 'click', nodeId: IDS.cover }, true],
    ['different node', { event: 'click', nodeId: IDS.body }, false],
  ]
  for (const [label, event, expected] of cases) {
    it(`click · ${label}`, () => {
      expect(triggerMatches(clickOn(IDS.cover), event, index)).toBe(expected)
    })
  }

  it('ignores events of a different type', () => {
    expect(triggerMatches(clickOn(IDS.cover), { event: 'hoverEnter', nodeId: IDS.cover }, index)).toBe(false)
  })

  it('sceneReady always matches', () => {
    expect(triggerMatches({ event: 'sceneReady' }, { event: 'sceneReady' }, index)).toBe(true)
  })

  it('§5.3 · an INTERRUPTED animation must not fire animationEnd rules', () => {
    const when = { event: 'animationEnd', animationId: IDS.animation } as const
    expect(triggerMatches(when, { event: 'animationEnd', animationId: IDS.animation, completed: true }, index)).toBe(true)
    expect(triggerMatches(when, { event: 'animationEnd', animationId: IDS.animation, completed: false }, index)).toBe(false)
  })

  it('matches hotspot and variable triggers by id', () => {
    expect(
      triggerMatches({ event: 'hotspotClick', hotspotId: IDS.hotspot }, { event: 'hotspotClick', hotspotId: IDS.hotspot }, index),
    ).toBe(true)
    expect(
      triggerMatches({ event: 'variableChange', variableId: 'step' }, { event: 'variableChange', variableId: 'other', from: 1, to: 2 }, index),
    ).toBe(false)
  })
})

describe('candidateRules()', () => {
  it('returns matching, enabled rules in document order', () => {
    const a = makeRule({ name: 'A', when: clickOn(IDS.cover), then: [{ action: 'resetScene', params: {} }] })
    const b = makeRule({ name: 'B', when: clickOn(IDS.cover), then: [{ action: 'resetScene', params: {} }] })
    const c = makeRule({ name: 'C', when: clickOn(IDS.body), then: [{ action: 'resetScene', params: {} }] })
    const withRules = buildIndex(docWithRules([a, b, c]))
    // §2.3 · all matches run, each independently. Not "first wins".
    expect(candidateRules(withRules, { event: 'click', nodeId: IDS.cover }).map((r) => r.name)).toEqual(['A', 'B'])
  })

  it('skips disabled rules', () => {
    const off = makeRule({ enabled: false, when: clickOn(IDS.cover), then: [{ action: 'resetScene', params: {} }] })
    const withRules = buildIndex(docWithRules([off]))
    expect(candidateRules(withRules, { event: 'click', nodeId: IDS.cover })).toHaveLength(0)
  })

  it('returns nothing for an event type no rule listens to, without scanning them all', () => {
    expect(candidateRules(index, { event: 'hoverLeave', nodeId: IDS.cover })).toEqual([])
    expect(index.rulesByEvent.has('hoverLeave')).toBe(false)
  })
})

describe('eventPayload()', () => {
  it('reads the id carried by the current event', () => {
    expect(eventPayload({ event: 'click', nodeId: IDS.cover }, 'nodeId')).toBe(IDS.cover)
    expect(eventPayload({ event: 'hotspotClick', hotspotId: IDS.hotspot }, 'hotspotId')).toBe(IDS.hotspot)
  })

  it('returns undefined when this event carries no such id', () => {
    expect(eventPayload({ event: 'sceneReady' }, 'nodeId')).toBeUndefined()
    expect(eventPayload({ event: 'click', nodeId: IDS.cover }, 'hotspotId')).toBeUndefined()
  })
})
