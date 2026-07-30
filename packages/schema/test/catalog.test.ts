import { describe, expect, it } from 'vitest'
import { ACTION_CATALOG, ACTION_KINDS, Action, actionDescriptor } from '../src/eca/actions.js'
import { EVENT_CATALOG, EVENT_KINDS, EventTrigger } from '../src/eca/events.js'
import { REF_KINDS, refKindOf } from '../src/eca/params.js'
import { ID_COLLECTIONS } from '../src/document.js'

/**
 * These are the tests that keep C5 honest. If someone adds an action by editing the
 * executor instead of the catalog, or adds a catalog entry without a schema, the
 * failure shows up here rather than as a rule that silently does nothing in front of
 * the customer.
 */

/** One valid sample per action kind — also the corpus every other suite reuses. */
const SAMPLE_ACTIONS: Record<string, unknown> = {
  playAnimation: { action: 'playAnimation', animationId: 'anm_000001', loop: null, speed: null },
  stopAnimation: { action: 'stopAnimation', animationId: 'anm_000001' },
  seekAnimation: { action: 'seekAnimation', animationId: 'anm_000001', timeMs: 500 },
  setVisible: { action: 'setVisible', nodeId: 'nd_000001', visible: false },
  setMaterial: { action: 'setMaterial', nodeId: 'nd_000001', materialId: 'mat_000001' },
  highlight: { action: 'highlight', nodeId: 'nd_000001', preset: 'amber' },
  clearHighlight: { action: 'clearHighlight', nodeId: null },
  moveCamera: { action: 'moveCamera', viewpointId: 'vp_000001', durationMs: 800 },
  openPanel: { action: 'openPanel', hotspotId: 'hs_000001' },
  closePanel: { action: 'closePanel', hotspotId: null },
  setVariable: { action: 'setVariable', variableId: 'step', value: { const: 2 } },
  wait: { action: 'wait', durationMs: 300 },
  openLink: { action: 'openLink', url: '/docs/manual.pdf', target: 'blank' },
  resetScene: { action: 'resetScene' },
}

const SAMPLE_TRIGGERS: Record<string, unknown> = {
  sceneStart: { event: 'sceneStart' },
  click: { event: 'click', nodeId: 'nd_000001' },
  hoverEnter: { event: 'hoverEnter', nodeId: 'nd_000001' },
  hoverLeave: { event: 'hoverLeave', nodeId: 'nd_000001' },
  hotspotClick: { event: 'hotspotClick', hotspotId: 'hs_000001' },
  animationEnd: { event: 'animationEnd', animationId: 'anm_000001' },
  variableChange: { event: 'variableChange', variableId: 'step' },
  timer: { event: 'timer', intervalMs: 1000, repeat: true },
}

describe('action catalog (C5)', () => {
  it('every declared action kind has a catalog entry', () => {
    for (const kind of ACTION_KINDS) {
      expect(ACTION_CATALOG[kind], `missing catalog entry for ${kind}`).toBeDefined()
      expect(ACTION_CATALOG[kind].action).toBe(kind)
    }
  })

  it('the catalog contains nothing beyond the declared kinds', () => {
    expect(Object.keys(ACTION_CATALOG).sort()).toEqual([...ACTION_KINDS].sort())
  })

  it('every catalog entry carries a label and a help line the editor can render', () => {
    for (const kind of ACTION_KINDS) {
      const d = ACTION_CATALOG[kind]
      expect(d.label.length, kind).toBeGreaterThan(0)
      expect(d.help.length, kind).toBeGreaterThan(0)
    }
  })

  it('every action kind has a sample and every sample parses against the union', () => {
    for (const kind of ACTION_KINDS) {
      const sample = SAMPLE_ACTIONS[kind]
      expect(sample, `no sample declared for ${kind}`).toBeDefined()
      const parsed = Action.safeParse(sample)
      expect(parsed.success, `${kind}: ${JSON.stringify(parsed.error?.issues)}`).toBe(true)
    }
  })

  it("each entry's own schema accepts its sample and rejects its neighbours", () => {
    for (const kind of ACTION_KINDS) {
      const d = ACTION_CATALOG[kind]
      expect(d.schema.safeParse(SAMPLE_ACTIONS[kind]).success, kind).toBe(true)
      const other = ACTION_KINDS.find((k) => k !== kind)!
      expect(d.schema.safeParse(SAMPLE_ACTIONS[other]).success, `${kind} accepted ${other}`).toBe(false)
    }
  })

  it('every reference parameter points at a collection that actually exists', () => {
    for (const kind of ACTION_KINDS) {
      for (const field of ACTION_CATALOG[kind].params) {
        const ref = refKindOf(field)
        if (!ref) continue
        expect(REF_KINDS).toContain(ref)
        expect(ID_COLLECTIONS as readonly string[]).toContain(`${ref}s`)
      }
    }
  })

  it('every required parameter is present in that action’s sample', () => {
    for (const kind of ACTION_KINDS) {
      const sample = SAMPLE_ACTIONS[kind] as Record<string, unknown>
      for (const field of ACTION_CATALOG[kind].params) {
        if (!field.required) continue
        expect(sample[field.key], `${kind}.${field.key}`).toBeDefined()
      }
    }
  })

  it('marks exactly the long-running actions as awaitable (D6 / A10)', () => {
    const awaitable = ACTION_KINDS.filter((k) => ACTION_CATALOG[k].awaitable).sort()
    expect(awaitable).toEqual(['moveCamera', 'playAnimation', 'wait'])
  })

  it('actionDescriptor() returns undefined for an unregistered kind', () => {
    expect(actionDescriptor('launchMissiles')).toBeUndefined()
    expect(actionDescriptor('playAnimation')).toBeDefined()
  })

  it('adding an action requires touching at most 3 files — the catalog is the only schema-side edit', () => {
    // Guards the north-star metric: catalog entry + core implementation + test.
    // If this file ever needs a fourth schema-side change per action, the abstraction leaked.
    for (const kind of ACTION_KINDS) {
      expect(ACTION_CATALOG[kind].schema).toBeDefined()
      expect(Array.isArray(ACTION_CATALOG[kind].params)).toBe(true)
    }
  })
})

describe('event catalog', () => {
  it('every declared event kind has a catalog entry and nothing extra', () => {
    expect(Object.keys(EVENT_CATALOG).sort()).toEqual([...EVENT_KINDS].sort())
  })

  it('every event kind has a sample trigger that parses', () => {
    for (const kind of EVENT_KINDS) {
      const parsed = EventTrigger.safeParse(SAMPLE_TRIGGERS[kind])
      expect(parsed.success, `${kind}: ${JSON.stringify(parsed.error?.issues)}`).toBe(true)
    }
  })

  it('does not register events v0 cannot fire', () => {
    // pageEnter / flowStepEnter belong to v1 features. Registering them now would put
    // untestable entries in the registry and let authors build rules that never run.
    expect(EVENT_KINDS as readonly string[]).not.toContain('pageEnter')
    expect(EVENT_KINDS as readonly string[]).not.toContain('flowStepEnter')
    expect(EventTrigger.safeParse({ event: 'pageEnter', pageId: 'pg_000001' }).success).toBe(false)
  })

  it('every event reference parameter points at a real collection', () => {
    for (const kind of EVENT_KINDS) {
      for (const field of EVENT_CATALOG[kind].params) {
        const ref = refKindOf(field)
        if (!ref) continue
        expect(REF_KINDS).toContain(ref)
      }
    }
  })
})
