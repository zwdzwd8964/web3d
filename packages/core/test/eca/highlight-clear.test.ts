import { createGoldenPathDocument } from '@w3/schema'
import type { Rule } from '@w3/schema'
import { beforeEach, describe, expect, it } from 'vitest'
import { ActionRegistry, registerBuiltinActions } from '../../src/eca/actions/index.js'
import { execute } from '../../src/eca/executor.js'
import { HeadlessRuntime } from '../../src/eca/headless.js'
import { HIGHLIGHT_PRESETS, highlightPresetOptions } from '../../src/highlight-presets.js'
import { IDS, clickOn, makeRule } from '../helpers.js'

/** One action, through the real executor — `status` is the thing under test. */
const runOne = (params: Record<string, unknown>) => {
  const rule: Rule = makeRule({ when: clickOn(IDS.cover), then: [{ action: 'highlight', params }] })
  return execute(rule, ctx, null, new AbortController().signal, { registry })
}

/**
 * T-215 · 「留空取消」 and the preset table that the dropdown drifted away from.
 *
 * Two bugs that had been shipping since v0, both invisible to every existing test.
 *
 * **① 「留空取消高亮」 never worked once.** The label says 「预设（留空取消）」, and the failure
 * needed all three packages to line up: the editor DELETES the key when a field is cleared;
 * `preset` was `z.string().nullable()` with no default, so the params arrive as `{nodeId}`
 * and zod refuses them for a missing required field; the executor turns a parse failure into
 * `status: 'failed'`. Each layer is individually defensible, which is why nobody found it.
 *
 * **② `outline_white` was unselectable.** The table had five presets; the dropdown's options
 * were typed out by hand next to it with four. A hand-written list agrees with itself, so
 * there was nothing for a test to disagree with.
 */

let registry: ActionRegistry
let ctx: HeadlessRuntime

beforeEach(() => {
  registry = registerBuiltinActions(new ActionRegistry())
  ctx = new HeadlessRuntime(createGoldenPathDocument())
})

describe('T-215 · 留空取消', () => {
  it('parses params with no preset key at all, defaulting it to null', () => {
    const parsed = registry.get('highlight')!.schema.safeParse({ nodeId: IDS.cover })
    expect(parsed.success).toBe(true)
    expect((parsed as { data: { preset: unknown } }).data.preset).toBe(null)
  })

  it('does the same for setMaterial — 「留空还原」 has the identical shape', () => {
    const parsed = registry.get('setMaterial')!.schema.safeParse({ nodeId: IDS.cover })
    expect(parsed.success).toBe(true)
    expect((parsed as { data: { materialId: unknown } }).data.materialId).toBe(null)
  })

  it('clearing the preset does not report failure, and actually clears the highlight', async () => {
    const applied = await runOne({ nodeId: IDS.cover, preset: 'outline_amber' })
    expect(applied.status).not.toBe('failed')
    expect(ctx.highlightOf(IDS.cover)).toBe('outline_amber')

    // The params the editor really sends after 「（未指定）」: the key is gone, not empty.
    const cleared = await runOne({ nodeId: IDS.cover })
    expect(cleared.status, JSON.stringify(cleared.steps)).not.toBe('failed')
    expect(ctx.highlightOf(IDS.cover)).toBe(null)
  })

  it('an unknown preset is still refused — the default must not become a catch-all', () => {
    const parsed = registry.get('highlight')!.schema.safeParse({ nodeId: IDS.cover, preset: 42 })
    expect(parsed.success).toBe(false)
  })
})

describe('T-215 · 预设表与下拉框机械对齐', () => {
  it('the dropdown offers exactly the table, key for key', () => {
    const field = registry
      .get('highlight')!
      .ui.fields.find((f) => f.key === 'preset')
    const options = field && field.type === 'enum' ? field.options : []
    expect(options.map((o) => o.value).sort()).toEqual(Object.keys(HIGHLIGHT_PRESETS).sort())
  })

  it('includes outline_white, which no user could select for the whole of v0 and v0.5', () => {
    expect(highlightPresetOptions().map((o) => o.value)).toContain('outline_white')
  })

  it('every option carries a Chinese label — an empty one renders as a blank row', () => {
    for (const option of highlightPresetOptions()) {
      expect(option.label, `${option.value} 没有中文标签`).toMatch(/[一-鿿]/)
    }
  })
})
