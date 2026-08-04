import { createGoldenPathDocument } from '@w3/schema'
import type { Rule, SceneDocument } from '@w3/schema'
import { beforeEach, describe, expect, it } from 'vitest'
import { ActionRegistry, registerBuiltinActions } from '../../src/eca/actions/index.js'
import { execute } from '../../src/eca/executor.js'
import { HeadlessRuntime } from '../../src/eca/headless.js'
import { defineAction } from '../../src/eca/actions/define.js'
import { z } from '@w3/schema'
import { IDS, clickOn, makeRule } from '../helpers.js'

/**
 * T-211 · three places where ECA_SPEC's text and the implementation had drifted apart.
 *
 * 「两份 SPEC 是逐字实现的规范，不是参考建议」 — so each of the three was ruled on, and each
 * ruling is nailed down by an assertion here. They did NOT all go the same way: ① moved the
 * code to meet the spec, ② moved the spec to meet the code, ③ the spec was simply silent.
 *
 *   ① §5.1 said `Promise.allSettled`, `executor.ts` said `Promise.all`
 *   ② §6 said 「未在播放…立即 resolve」, both runtimes returned `neverEnds()` — **the SPEC was
 *      the one that was wrong here**, and the implementation stayed
 *   ③ §4.2 never stated `playAnimation`'s `await` default, and `media.ts` carried a comment
 *      claiming the two actions agreed on it — they never have
 */

const MEDIA_ID = 'med_00000001'

function mediaDocument(): SceneDocument {
  const doc = createGoldenPathDocument()
  return {
    ...doc,
    assets: [...doc.assets, { ...doc.assets[0]!, id: 'ast_med00001', type: 'audio', name: '讲解.mp3' }],
    media: [{ id: MEDIA_ID, type: 'audio', assetId: 'ast_med00001', name: '讲解', durationS: 2 }],
  } as SceneDocument
}

let registry: ActionRegistry
let ctx: HeadlessRuntime

beforeEach(() => {
  registry = registerBuiltinActions(new ActionRegistry())
  ctx = new HeadlessRuntime(mediaDocument())
})

/* -------------------------------------------------------------------------- */
/* ① §5.1 · parallel collects every outcome                                    */
/* -------------------------------------------------------------------------- */

/**
 * An action whose `refs()` throws.
 *
 * Not contrived: `refs` is called BEFORE `runStep`'s `try` (so is `registry.get`, and so is
 * `schema.safeParse`), which is precisely why `Promise.all` and `Promise.allSettled` are not
 * interchangeable here even though `runStep` looks like it catches everything.
 */
const brokenRefs = defineAction<{ nodeId: string }>({
  type: 'brokenRefs',
  schema: z.object({ nodeId: z.string() }),
  handler: () => {},
  ui: { label: '坏引用', group: 'scene', fields: [] },
  refs: () => {
    throw new Error('refs 自己炸了')
  },
  describe: () => '坏引用',
})

describe('T-211 ① · ECA_SPEC §5.1 · parallel 用 allSettled', () => {
  const parallelRule = (): Rule =>
    makeRule({
      when: clickOn(IDS.cover),
      mode: 'parallel',
      then: [
        { action: 'setVisible', params: { nodeId: IDS.cover, value: false } },
        { action: 'brokenRefs', params: { nodeId: IDS.cover } },
        { action: 'setVisible', params: { nodeId: IDS.body, value: false } },
      ],
    })

  it('one step throwing outside runStep does not discard its siblings', async () => {
    registry.register(brokenRefs)
    const doc = ctx.doc
    const result = await execute(parallelRule(), ctx, null, new AbortController().signal, {
      registry,
      index: { nodeById: new Map(doc.nodes.map((n) => [n.id, n])) } as never,
    })

    // The whole point. `Promise.all` would have rejected here and `execute` would have
    // thrown, so there would be no ExecResult at all — not a partial one, none.
    expect(result.steps).toHaveLength(3)
    expect(result.steps.map((s) => s.status)).toEqual(['ok', 'failed', 'ok'])
    expect(result.status).toBe('failed')
  })

  it('and the two steps that succeeded really did run', async () => {
    registry.register(brokenRefs)
    const doc = ctx.doc
    await execute(parallelRule(), ctx, null, new AbortController().signal, {
      registry,
      index: { nodeById: new Map(doc.nodes.map((n) => [n.id, n])) } as never,
    })
    expect(ctx.isVisible(IDS.cover)).toBe(false)
    expect(ctx.isVisible(IDS.body)).toBe(false)
  })

  it('counter-example: with nothing throwing, every step is collected as before', async () => {
    const rule = makeRule({
      when: clickOn(IDS.cover),
      mode: 'parallel',
      then: [
        { action: 'setVisible', params: { nodeId: IDS.cover, value: false } },
        { action: 'setVisible', params: { nodeId: IDS.body, value: false } },
      ],
    })
    const result = await execute(rule, ctx, null, new AbortController().signal, { registry })
    expect(result.steps.map((s) => s.status)).toEqual(['ok', 'ok'])
    expect(result.status).not.toBe('failed')
  })
})

/* -------------------------------------------------------------------------- */
/* ② §6 · waitForMediaEnd on a clip that is not playing                        */
/* -------------------------------------------------------------------------- */

describe('T-211 ② · ECA_SPEC §6 · 未在播放时永不 resolve（改的是规范）', () => {
  it('does NOT resolve when nothing is playing — autoplay refused is not "already ended"', async () => {
    let ended = false
    void ctx.waitForMediaEnd(MEDIA_ID).then(() => void (ended = true))
    await ctx.clock.advance(60_000)
    await Promise.resolve()
    // Resolving here would make `await: true` return at once and fire every following step
    // immediately: a scene whose audio the browser blocked would be silent AND broken.
    expect(ended, '没在响就没有「响完」可听，交给时钟').toBe(false)
  })

  it('counter-example: while it IS playing, headless still never resolves (ADR-0019)', async () => {
    await ctx.playMedia(MEDIA_ID, {})
    let ended = false
    void ctx.waitForMediaEnd(MEDIA_ID).then(() => void (ended = true))
    await ctx.clock.advance(60_000)
    await Promise.resolve()
    expect(ended, 'headless 观测不到「播完」，就不该假装观测到了').toBe(false)
  })

  it('and the SPEC now says so, so the next reader is not sent the other way', async () => {
    const { readFile } = await import('node:fs/promises')
    const { fileURLToPath } = await import('node:url')
    const spec = await readFile(fileURLToPath(new URL('../../../../docs/ECA_SPEC.md', import.meta.url)), 'utf8')
    expect(spec, '§6 的这句话是本卡改的那一句').toContain('未在播放（含 V3 自动播放被拒）永不 resolve，由时钟决定')
  })
})

/* -------------------------------------------------------------------------- */
/* ③ §4.2 · the two await defaults differ, on purpose                          */
/* -------------------------------------------------------------------------- */

describe('T-211 ③ · playAnimation 与 playMedia 的 await 默认值', () => {
  it('playAnimation defaults to true, playMedia to false', () => {
    const anim = registry.get('playAnimation')!.schema.safeParse({ animationId: IDS.animation })
    const media = registry.get('playMedia')!.schema.safeParse({ mediaId: MEDIA_ID })
    expect((anim as { data: { await: boolean } }).data.await).toBe(true)
    expect((media as { data: { await: boolean } }).data.await).toBe(false)
  })

  it('and no comment in the tree claims otherwise', async () => {
    const { readFile } = await import('node:fs/promises')
    const { fileURLToPath } = await import('node:url')
    const source = await readFile(fileURLToPath(new URL('../../src/eca/actions/media.ts', import.meta.url)), 'utf8')
    expect(source, 'D19 的「语义对齐」不包括这个默认值').not.toContain('same as `playAnimation`')
  })
})
