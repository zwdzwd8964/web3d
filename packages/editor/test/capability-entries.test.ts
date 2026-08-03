import { ActionRegistry, registerBuiltinActions } from '@w3/core'
import { EVENT_TYPES } from '@w3/schema'
import { describe, expect, it } from 'vitest'
import { CAPABILITY_ENTRIES } from './capability-entries.js'

/**
 * T-205 ⑥ · the completeness half of 能力入口体检.
 *
 * Driven by the registries in both directions, so a capability added without an entry fails
 * here on the day it is registered — rather than two milestones later, when someone writes an
 * E2E test and discovers the feature has no user interface (v0.5's T-137, verbatim).
 *
 * What this file deliberately does NOT prove: that the selectors resolve to anything. That
 * needs a browser and belongs to T-296's `golden-path-3.spec.ts`, which runs `toBeEnabled()`
 * on each row. **Until then a row here is a claim, not an observation** — writing that down is
 * the whole point of M10's lesson, which cost three `major` findings to learn.
 */

const registered = registerBuiltinActions(new ActionRegistry())
  .all()
  .map((definition) => `action:${definition.type}`)
const events = EVENT_TYPES.map((type) => `event:${type}`)
const listed = CAPABILITY_ENTRIES.map((entry) => entry.capability)

describe('能力入口体检表', () => {
  it('covers every registered action and every event type, and nothing else', () => {
    // Set equality in BOTH directions. `toContain` per capability would pass while the table
    // still listed something that no longer exists — and a table that lies about a capability
    // it does not have is worse than no table, because the E2E half will silently skip it.
    expect([...listed].sort()).toEqual([...registered, ...events].sort())
  })

  it('gives every entry either a selector or a written reason for not having one', () => {
    for (const entry of CAPABILITY_ENTRIES) {
      if (entry.selector !== null) {
        expect({ [entry.capability]: entry.selector }).toEqual({ [entry.capability]: expect.stringMatching(/\S/) })
        continue
      }
      // A bare `null` is an unanswered question wearing a decision's clothes.
      expect({ [entry.capability]: entry.note ?? '' }).toEqual({
        [entry.capability]: expect.stringMatching(/^.{10,}$/s),
      })
    }
  })

  it('has no duplicate rows', () => {
    expect(listed.length).toBe(new Set(listed).size)
  })

  /**
   * The registries have to be non-empty for the test above to mean anything: comparing two
   * empty sets passes, and that is precisely what a broken import would produce.
   */
  it('is comparing against registries that actually loaded', () => {
    expect(registered.length).toBeGreaterThanOrEqual(16)
    expect(events.length).toBeGreaterThanOrEqual(8)
  })
})
