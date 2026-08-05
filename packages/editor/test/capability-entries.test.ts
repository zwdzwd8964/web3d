import { ActionRegistry, registerBuiltinActions } from '@w3/core'
import { EVENT_TYPES, createGoldenPathDocument } from '@w3/schema'
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
const listedBehaviour = listed.filter((c) => !c.startsWith('field:'))

/**
 * T-242 · 覆盖面的第二半：`meta.**` 的每一个叶子。
 *
 * **由一份真文档遍历出来，不是手写清单。** 手写清单会与自己一致——T-215 的高亮预设
 * 就是这么漂的（表里五个、手写的四个，`outline_white` 谁也选不到）。遍历实例还有一个
 * 好处：它不需要 zod 内省，因此不必把 `walkShape` 从 schema 的 test 目录拖过来。
 */
function metaLeaves(): string[] {
  const out: string[] = []
  const walk = (value: unknown, path: string) => {
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      for (const [key, child] of Object.entries(value as Record<string, unknown>)) walk(child, `${path}.${key}`)
      return
    }
    out.push(path)
  }
  walk(createGoldenPathDocument().meta, 'meta')
  return out.map((path) => `field:${path}`)
}

const fields = metaLeaves()
const listedFields = listed.filter((c) => c.startsWith('field:'))

describe('能力入口体检表', () => {
  it('covers every registered action and every event type, and nothing else', () => {
    // Set equality in BOTH directions. `toContain` per capability would pass while the table
    // still listed something that no longer exists — and a table that lies about a capability
    // it does not have is worse than no table, because the E2E half will silently skip it.
    expect([...listedBehaviour].sort()).toEqual([...registered, ...events].sort())
  })

  it('T-242 · covers every leaf under `meta`, and nothing else', () => {
    // 同样是双向。少一条 = 一个用户改不到的字段（`background.color` 就是这么躺了 13 份
    // 设计的）；多一条 = 表在替一个已经不存在的字段说话。
    expect([...listedFields].sort()).toEqual([...fields].sort())
  })

  it('T-242 · 那份 meta 真的被遍历到了，不是空集合', () => {
    // D36 的 M6：遍历一坏，两个空集合逐项相等，上一条会变成一句什么都不说的话。
    expect(fields.length).toBeGreaterThanOrEqual(15)
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
