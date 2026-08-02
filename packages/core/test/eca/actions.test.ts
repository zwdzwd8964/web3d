import type { Animation, SceneDocument } from '@w3/schema'
import { createGoldenPathDocument } from '@w3/schema'
import { beforeEach, describe, expect, it } from 'vitest'
import { ActionRegistry, BUILTIN_ACTIONS, registerBuiltinActions } from '../../src/eca/actions/index.js'
import { HeadlessRuntime } from '../../src/eca/headless.js'
import type { ActionDefinition, RuntimeEvent } from '../../src/eca/types.js'
import { AbortError, FIELD_KINDS } from '../../src/eca/types.js'
import { IDS } from '../helpers.js'

/**
 * T-085 · gate G0-5.
 *
 * `covered` below is the tested set. The final test compares it against the registry,
 * so registering an action without writing a test fails the suite immediately — rather
 * than shipping an action nobody ever ran.
 */
const covered = new Set<string>()

const LOOPING: Animation = {
  kind: 'tween',
  id: 'anm_11111111',
  name: '循环',
  duration: 2,
  easing: 'linear',
  loop: true,
  yoyo: false,
  targets: [{ nodeId: IDS.cover, to: { p: [0, 1, 0] } }],
}

function testDoc(): SceneDocument {
  const doc = createGoldenPathDocument()
  return { ...doc, animations: [...doc.animations, LOOPING] }
}

let registry: ActionRegistry
let ctx: HeadlessRuntime

beforeEach(() => {
  registry = registerBuiltinActions(new ActionRegistry())
  ctx = new HeadlessRuntime(testDoc())
})

/** Runs an action the way the executor does: parse params, then invoke. */
async function run(type: string, params: Record<string, unknown>, event: RuntimeEvent | null = null) {
  covered.add(type)
  const definition = registry.get(type) as ActionDefinition<unknown>
  expect(definition, `action "${type}" is not registered`).toBeDefined()
  const parsed = definition.schema.safeParse(params)
  expect(parsed.success, `params rejected: ${JSON.stringify(parsed.error?.issues)}`).toBe(true)
  ctx.setCurrentEvent(event)
  const controller = new AbortController()
  const done = definition.handler(ctx, parsed.data, controller.signal)
  return { done, controller, definition, params: parsed.data }
}

describe('animation actions', () => {
  it('playAnimation resolves only when playback ends naturally', async () => {
    const { done } = await run('playAnimation', { animationId: IDS.animation, await: true })
    let settled = false
    void Promise.resolve(done).then(() => {
      settled = true
    })
    await ctx.clock.advance(1199)
    expect(settled).toBe(false)
    await ctx.clock.advance(1)
    await Promise.resolve()
    expect(settled).toBe(true)
  })

  it('playAnimation with a looping clip resolves immediately (D6)', async () => {
    const { done } = await run('playAnimation', { animationId: LOOPING.id, await: true })
    await expect(Promise.resolve(done)).resolves.toBeUndefined()
    expect(ctx.isAnimationPlaying(LOOPING.id)).toBe(true)
  })

  it('playAnimation restarts by default, and can be told not to', async () => {
    await run('playAnimation', { animationId: IDS.animation, await: false, restart: true })
    expect(ctx.isAnimationPlaying(IDS.animation)).toBe(true)
    await ctx.clock.settle()
  })

  it('stopAnimation stops, and optionally rewinds', async () => {
    await run('playAnimation', { animationId: IDS.animation, await: false })
    await ctx.clock.advance(600)
    await run('stopAnimation', { animationId: IDS.animation, reset: true })
    expect(ctx.isAnimationPlaying(IDS.animation)).toBe(false)
    expect(ctx.timeOf(IDS.animation)).toBe(0)
  })

  it('seekAnimation moves the playhead without changing play state', async () => {
    await run('seekAnimation', { animationId: IDS.animation, time: 0.8 })
    expect(ctx.timeOf(IDS.animation)).toBe(0.8)
    expect(ctx.isAnimationPlaying(IDS.animation)).toBe(false)
  })
})

describe('scene actions', () => {
  it('setVisible toggles one node, and optionally its subtree', async () => {
    await run('setVisible', { nodeId: IDS.cover, value: false })
    expect(ctx.isVisible(IDS.cover)).toBe(false)
    expect(ctx.isVisible(IDS.body)).toBe(true)

    await run('setVisible', { nodeId: IDS.pump, value: false, includeDescendants: true })
    expect(ctx.isVisible(IDS.body)).toBe(false)
  })

  it('setMaterial assigns and, with null, restores', async () => {
    await run('setMaterial', { nodeId: IDS.body, materialId: IDS.material })
    expect(ctx.materialOf(IDS.body)).toBe(IDS.material)
    await run('setMaterial', { nodeId: IDS.body, materialId: null })
    expect(ctx.materialOf(IDS.body)).toBeNull()
  })

  it('highlight applies a preset and clears with null', async () => {
    await run('highlight', { nodeId: IDS.cover, preset: 'outline_amber' })
    expect(ctx.highlightOf(IDS.cover)).toBe('outline_amber')
    await run('highlight', { nodeId: IDS.cover, preset: null })
    expect(ctx.highlightOf(IDS.cover)).toBeNull()
  })

  it('resetScene returns variables, visibility, materials, highlights and panels to the document', async () => {
    ctx.setVar('step', 5)
    ctx.setVisible(IDS.cover, false)
    ctx.setMaterial(IDS.body, IDS.material)
    ctx.highlight(IDS.cover, 'outline_red')
    ctx.openPanel(IDS.hotspot)

    await run('resetScene', {})

    expect(ctx.getVar('step')).toBe(1)
    expect(ctx.isVisible(IDS.cover)).toBe(true)
    expect(ctx.materialOf(IDS.body)).toBeNull()
    expect(ctx.highlightOf(IDS.cover)).toBeNull()
    expect(ctx.openPanels).toEqual([])
  })
})

describe('camera actions', () => {
  it('moveCamera flies over the requested duration and resolves on arrival', async () => {
    const { done } = await run('moveCamera', { viewpointId: IDS.viewpoint, duration: 1, await: true })
    let settled = false
    void Promise.resolve(done).then(() => {
      settled = true
    })
    await ctx.clock.advance(999)
    expect(settled).toBe(false)
    expect(ctx.viewpoint).toBeNull()
    await ctx.clock.advance(1)
    await Promise.resolve()
    expect(settled).toBe(true)
    expect(ctx.viewpoint).toBe(IDS.viewpoint)
  })

  it('moveCamera with zero duration jumps instantly', async () => {
    const { done } = await run('moveCamera', { viewpointId: IDS.viewpoint, duration: 0 })
    await done
    expect(ctx.viewpoint).toBe(IDS.viewpoint)
  })
})

describe('ui actions', () => {
  it('openPanel and closePanel manage one panel', async () => {
    await run('openPanel', { hotspotId: IDS.hotspot })
    expect(ctx.isPanelOpen(IDS.hotspot)).toBe(true)
    await run('closePanel', { hotspotId: IDS.hotspot })
    expect(ctx.isPanelOpen(IDS.hotspot)).toBe(false)
  })

  it('closePanel "all" closes everything', async () => {
    ctx.openPanel(IDS.hotspot)
    ctx.openPanel('hs_00000002')
    await run('closePanel', { hotspotId: 'all' })
    expect(ctx.openPanels).toEqual([])
  })

  it('openLink records the intent — a head-less run must not navigate away', async () => {
    await run('openLink', { url: '/docs/manual.pdf', target: '_blank' })
    expect(ctx.openedLinks).toEqual([{ url: '/docs/manual.pdf', target: '_blank' }])
  })
})

describe('state actions', () => {
  it('setVariable assigns a constant', async () => {
    await run('setVariable', { variableId: 'step', value: { const: 2 } })
    expect(ctx.getVar('step')).toBe(2)
  })

  it('setVariable can copy another variable', async () => {
    ctx.setVar('step', 4)
    await run('setVariable', { variableId: 'step', value: { var: 'step' } })
    expect(ctx.getVar('step')).toBe(4)
  })

  it('setVariable in add mode accumulates, and refuses non-numeric operands', async () => {
    await run('setVariable', { variableId: 'step', value: { const: 3 }, mode: 'add' })
    expect(ctx.getVar('step')).toBe(4)

    await run('setVariable', { variableId: 'step', value: { const: 'x' }, mode: 'add' })
    expect(ctx.getVar('step'), 'a bad add must leave the variable alone').toBe(4)
    expect(ctx.warnings().some((w) => w.message.includes('add 模式'))).toBe(true)
  })

  it('setVariable can read the triggering event through ctx.currentEvent()', async () => {
    const doc = testDoc()
    ctx = new HeadlessRuntime({
      ...doc,
      variables: [...doc.variables, { id: 'clicked', name: '点中的对象', type: 'string', default: '', persist: false }],
    })
    await run('setVariable', { variableId: 'clicked', value: { event: 'nodeId' } }, { event: 'click', nodeId: IDS.cover })
    expect(ctx.getVar('clicked')).toBe(IDS.cover)
  })

  it('wait suspends for exactly the requested time on the fake clock', async () => {
    const { done } = await run('wait', { ms: 250 })
    let settled = false
    void Promise.resolve(done).then(() => {
      settled = true
    })
    await ctx.clock.advance(249)
    expect(settled).toBe(false)
    await ctx.clock.advance(1)
    await Promise.resolve()
    expect(settled).toBe(true)
    expect(ctx.now()).toBe(250)
  })

  it('wait is cancellable', async () => {
    const { done, controller } = await run('wait', { ms: 1000 })
    controller.abort()
    await expect(Promise.resolve(done)).rejects.toThrow()
  })
})

/**
 * v0.5 · light actions (进化规划 §4.3).
 *
 * The document these run against gets a real light node, because every interesting case
 * here is about the difference between a light and something that merely has an id.
 */
describe('light actions', () => {
  const LIGHT_ID = 'nd_light001'

  const litDoc = (): SceneDocument => {
    const doc = testDoc()
    return {
      ...doc,
      nodes: [
        ...doc.nodes,
        {
          id: LIGHT_ID,
          name: '聚光灯',
          parent: null,
          order: 9000,
          assetRef: null,
          primitive: null,
          light: {
            kind: 'spot',
            color: '#ffd9a0',
            intensity: 3,
            range: 0,
            decay: 2,
            angleDeg: 30,
            penumbra: 0.2,
            shadow: { enabled: false, quality: 'medium', bias: -0.0005 },
          },
          transform: { p: [0, 2, 0], r: [0, 0, 0, 1], s: [1, 1, 1] },
          visible: true,
          locked: false,
          overrides: {},
        },
      ],
    }
  }

  beforeEach(() => {
    ctx = new HeadlessRuntime(litDoc())
  })

  it('setLight moves intensity and colour', async () => {
    await run('setLight', { nodeId: LIGHT_ID, intensity: 6, color: '#ff0000' })
    expect(ctx.lightOf(LIGHT_ID)).toEqual({ intensity: 6, color: '#ff0000' })
  })

  it('leaves the parameter it was not given alone', async () => {
    // A rule that only turns the light up must not also reset the colour the author chose.
    await run('setLight', { nodeId: LIGHT_ID, intensity: 6 })
    expect(ctx.lightOf(LIGHT_ID)).toEqual({ intensity: 6, color: '#ffd9a0' })
    await run('setLight', { nodeId: LIGHT_ID, color: '#00ff00' })
    expect(ctx.lightOf(LIGHT_ID)).toEqual({ intensity: 6, color: '#00ff00' })
  })

  it('reads the document’s own values before anything has changed them', async () => {
    expect(ctx.lightOf(LIGHT_ID)).toEqual({ intensity: 3, color: '#ffd9a0' })
  })

  it('skips a target that is not a light, logging an error rather than throwing (B9)', async () => {
    await run('setLight', { nodeId: IDS.cover, intensity: 6 })
    expect(ctx.lightOf(IDS.cover), '阀盖 不是灯，不该有灯光状态').toBeNull()
    expect(ctx.logs.some((l) => l.level === 'error' && l.message.includes('不是灯光对象'))).toBe(true)
  })

  it('skips a target that does not exist at all', async () => {
    await run('setLight', { nodeId: 'nd_00000000', intensity: 6 })
    expect(ctx.logs.some((l) => l.level === 'error' && l.message.includes('不存在'))).toBe(true)
  })

  it('rejects a colour that is not #rrggbb before the handler ever runs', async () => {
    const definition = registry.get('setLight')!
    expect(definition.schema.safeParse({ nodeId: LIGHT_ID, color: 'red' }).success).toBe(false)
    expect(definition.schema.safeParse({ nodeId: LIGHT_ID, intensity: 999 }).success).toBe(false)
  })

  it('resetScene puts the light back where the document had it (B13)', async () => {
    // Golden path II step 11: leave preview and the spot returns to intensity 3. Without
    // this the editor keeps whatever the last preview run happened to leave behind.
    await run('setLight', { nodeId: LIGHT_ID, intensity: 6, color: '#ff0000' })
    ctx.resetScene()
    expect(ctx.lightOf(LIGHT_ID)).toEqual({ intensity: 3, color: '#ffd9a0' })
  })

  it('describes itself in Chinese, naming the light rather than its id (R14)', async () => {
    const { definition, params } = await run('setLight', { nodeId: LIGHT_ID, intensity: 6 })
    expect(definition.describe(params, litDoc())).toMatch(/灯光「聚光灯」/)
    expect(definition.describe(params, litDoc())).toMatch(/强度 6/)
  })

  it('declares the node it points at, so refsTo and the publish gate can see it', async () => {
    const { definition, params } = await run('setLight', { nodeId: LIGHT_ID, intensity: 6 })
    expect(definition.refs(params)).toEqual([{ kind: 'node', id: LIGHT_ID }])
  })

  it('is renderable by the rule editor with no new field kinds', () => {
    // v0.5's claim is that a new action needs zero rule-editor changes. That holds only
    // while every field it declares is one of the six kinds ECA_SPEC §4.4 closes over.
    const KNOWN = new Set<string>(FIELD_KINDS)
    for (const field of registry.get('setLight')!.ui.fields) {
      expect(KNOWN, `字段 ${field.key} 用了规则编辑器不认识的类型 ${field.type}`).toContain(field.type)
    }
  })
})

describe('describe() produces the acceptance-case wording (R14)', () => {
  it('names entities by their display name, not by id', () => {
    const doc = testDoc()
    const cases: [string, Record<string, unknown>, RegExp][] = [
      ['playAnimation', { animationId: IDS.animation, await: true }, /播放动画「阀盖抬起」（等待播完）/],
      ['setVisible', { nodeId: IDS.cover, value: false }, /隐藏对象「阀盖」/],
      ['setMaterial', { nodeId: IDS.body, materialId: IDS.material }, /「泵体」.*「拉丝不锈钢」/],
      ['highlight', { nodeId: IDS.cover, preset: 'outline_amber' }, /高亮对象「阀盖」/],
      ['moveCamera', { viewpointId: IDS.viewpoint, duration: 1 }, /视点「拆解视角」/],
      ['openPanel', { hotspotId: IDS.hotspot }, /热点「拆卸提示」/],
      ['setVariable', { variableId: 'step', value: { const: 2 } }, /变量「当前步骤」为 2/],
      ['wait', { ms: 500 }, /等待 500 毫秒/],
      // T-186 · the weak pattern /恢复到文档初始状态/ passed for the stale v0 text too —
      // the strengthened one pins the two v0.5 deltas (media stop, light restore).
      ['resetScene', {}, /停止全部媒体.*灯光.*恢复到文档初始状态/],
    ]
    for (const [type, params, pattern] of cases) {
      const definition = registry.get(type)!
      const parsed = definition.schema.safeParse(params)
      expect(parsed.success, type).toBe(true)
      expect(definition.describe(parsed.data, doc), type).toMatch(pattern)
    }
  })
})

describe('media actions (v0.5 · T-163)', () => {
  const MEDIA_ID = 'med_00000001'

  /**
   * The golden path plus one audio record, 2 s long by default.
   *
   * `null` rather than `undefined` for 「时长未知」: a default parameter fires for an
   * explicit `undefined` too, so `mediaDoc(undefined)` silently produced a 2-second clip
   * and the test hung waiting for a clock nobody advanced.
   */
  const mediaDoc = (durationS: number | null = 2): SceneDocument => {
    const doc = createGoldenPathDocument()
    return {
      ...doc,
      assets: [...doc.assets, { ...doc.assets[0]!, id: 'ast_med00001', type: 'audio', name: '讲解.mp3' }],
      media: [
        {
          id: MEDIA_ID,
          type: 'audio',
          assetId: 'ast_med00001',
          name: '讲解',
          ...(durationS === null ? {} : { durationS }),
        },
      ],
    } as SceneDocument
  }

  beforeEach(() => {
    ctx = new HeadlessRuntime(mediaDoc())
  })

  it('playMedia starts the clip', async () => {
    await run('playMedia', { mediaId: MEDIA_ID })
    expect(ctx.isMediaPlaying(MEDIA_ID)).toBe(true)
    expect(ctx.mediaState(MEDIA_ID)).toEqual({ loop: false, volume: 1 })
  })

  it('carries loop and volume through to the runtime', async () => {
    await run('playMedia', { mediaId: MEDIA_ID, loop: true, volume: 0.25 })
    expect(ctx.mediaState(MEDIA_ID)).toEqual({ loop: true, volume: 0.25 })
  })

  it('does NOT wait by default', async () => {
    // Same default as `playAnimation`: a rule that plays a sound and opens a panel should
    // do both at once unless it said otherwise.
    const { done } = await run('playMedia', { mediaId: MEDIA_ID })
    await expect(Promise.resolve(done)).resolves.toBeUndefined()
  })

  it('await: true suspends for durationS and then continues', async () => {
    // D19 · through `ctx.wait`, so a fake clock drives it and no audio hardware is needed.
    const { done } = await run('playMedia', { mediaId: MEDIA_ID, await: true })
    let settled = false
    void Promise.resolve(done).then(() => void (settled = true))

    await ctx.clock.advance(1999)
    expect(settled, '还没到 2 秒，不该结束').toBe(false)
    await ctx.clock.advance(1)
    await Promise.resolve()
    expect(settled, '2 秒到了就该继续').toBe(true)
  })

  it('resolves as soon as the clip actually ends — 先到者为准 (D19 · T-186)', async () => {
    // The real runtime exposes `waitMediaEnd`; the action races it against durationS.
    // Before T-186 the race did not exist: `waitForEnd` had zero production callers and
    // a clip that ended early kept the rule chain waiting out the full recording.
    let endClip: (() => void) | undefined
    const seen: { signal?: AbortSignal } = {}
    Object.assign(ctx, {
      waitMediaEnd: (_id: string, signal?: AbortSignal) =>
        new Promise<void>((resolve) => {
          seen.signal = signal
          endClip = resolve
        }),
    })
    const { done } = await run('playMedia', { mediaId: MEDIA_ID, await: true })
    let settled = false
    void Promise.resolve(done).then(() => void (settled = true))

    await ctx.clock.advance(500)
    expect(settled, '还没播完也没到时长，不该结束').toBe(false)
    endClip!()
    // On regression (no race wired) this await hangs on a clock nobody advances and the
    // test times out red; the clock assertion below is the "did not wait it out" proof.
    await Promise.resolve(done)
    expect(ctx.now(), '真实结束先到，就不等录制时长').toBeLessThan(2000)
    expect(seen.signal, '竞速的两半都要能被中止（铁律 10）').toBeDefined()
  })

  it('durationS still wins when the clip never reports an end (D19 · T-186)', async () => {
    Object.assign(ctx, {
      waitMediaEnd: () => new Promise<void>(() => undefined),
    })
    const { done } = await run('playMedia', { mediaId: MEDIA_ID, await: true })
    let settled = false
    void Promise.resolve(done).then(() => void (settled = true))

    await ctx.clock.advance(1999)
    expect(settled).toBe(false)
    await ctx.clock.advance(1)
    await Promise.resolve(done)
    expect(ctx.now(), '时长先到也算先到者').toBe(2000)
  })

  it('a clip that never actually started falls back to the plain durationS wait (T-186)', async () => {
    // Autoplay refusal / no element factory: `waitForEnd` would resolve immediately for
    // a non-playing clip, so racing it would skip the wait entirely. The isMediaPlaying
    // guard keeps today's behavior for exactly those clips.
    Object.assign(ctx, {
      waitMediaEnd: () => Promise.resolve(),
      isMediaPlaying: () => false,
    })
    const { done } = await run('playMedia', { mediaId: MEDIA_ID, await: true })
    let settled = false
    void Promise.resolve(done).then(() => void (settled = true))

    await ctx.clock.advance(1)
    await Promise.resolve()
    expect(settled, '没真开播的剪辑仍按录制时长等待').toBe(false)
    await ctx.clock.advance(1999)
    await Promise.resolve()
    expect(settled).toBe(true)
  })

  it('aborting the rule aborts both halves of the race (铁律 10 · T-186)', async () => {
    const seen: { aborted?: boolean } = {}
    Object.assign(ctx, {
      waitMediaEnd: (_id: string, signal?: AbortSignal) =>
        new Promise<void>((_resolve, reject) => {
          signal?.addEventListener('abort', () => {
            seen.aborted = true
            reject(new AbortError())
          })
        }),
    })
    const { done, controller } = await run('playMedia', { mediaId: MEDIA_ID, await: true })
    await ctx.clock.advance(100)
    controller.abort()
    await expect(Promise.resolve(done)).rejects.toMatchObject({ name: 'AbortError' })
    expect(seen.aborted, '外层中止必须传到真实结束的那一半').toBe(true)
  })

  it('a LOOPING clip resolves immediately even with await: true (D6 边界，必测)', async () => {
    // A looping clip has no end. Awaiting one would hang the sequence for ever — the same
    // boundary `playAnimation` draws, and the reason this test is called out on the card.
    const { done } = await run('playMedia', { mediaId: MEDIA_ID, await: true, loop: true })
    await expect(Promise.resolve(done)).resolves.toBeUndefined()
    expect(ctx.isMediaPlaying(MEDIA_ID), '立即 resolve 不等于没在播').toBe(true)
  })

  it('resolves immediately and WARNS when durationS is missing', async () => {
    // The browser would not report a length at import (T-160). Inventing one would hang a
    // sequence on a number nobody measured.
    ctx = new HeadlessRuntime(mediaDoc(null))
    const { done } = await run('playMedia', { mediaId: MEDIA_ID, await: true })

    await expect(Promise.resolve(done)).resolves.toBeUndefined()
    expect(ctx.logs.some((l) => l.level === 'warn' && l.message.includes('没有时长记录'))).toBe(true)
  })

  it('skips a media id that does not exist, logging rather than throwing', async () => {
    await run('playMedia', { mediaId: 'med_00000000' })
    expect(ctx.logs.some((l) => l.level === 'error' && l.message.includes('不存在'))).toBe(true)
  })

  it('stopMedia stops one clip', async () => {
    await run('playMedia', { mediaId: MEDIA_ID })
    await run('stopMedia', { mediaId: MEDIA_ID })
    expect(ctx.isMediaPlaying(MEDIA_ID)).toBe(false)
  })

  it("stopMedia 'all' stops everything", async () => {
    await run('playMedia', { mediaId: MEDIA_ID })
    await run('stopMedia', { mediaId: 'all' })
    expect(ctx.isMediaPlaying(MEDIA_ID)).toBe(false)
  })

  it("'all' contributes no reference, or every scene using it reports a dangling id", async () => {
    const stop = registry.get('stopMedia')!
    expect(stop.refs?.({ mediaId: 'all' })).toEqual([])
    expect(stop.refs?.({ mediaId: MEDIA_ID })).toEqual([{ kind: 'media', id: MEDIA_ID }])
  })

  it('rejects parameters the schema does not allow, before the handler runs', async () => {
    const play = registry.get('playMedia')!
    expect(play.schema.safeParse({ mediaId: MEDIA_ID, volume: 2 }).success, '音量上限 1').toBe(false)
    expect(play.schema.safeParse({ mediaId: 'not-an-id' }).success).toBe(false)
    // …and `'all'` is only legal for stopMedia.
    expect(play.schema.safeParse({ mediaId: 'all' }).success).toBe(false)
    expect(registry.get('stopMedia')!.schema.safeParse({ mediaId: 'all' }).success).toBe(true)
  })

  it('describes itself in Chinese, with the media NAME rather than its id', async () => {
    const play = registry.get('playMedia')!
    expect(play.describe?.({ mediaId: MEDIA_ID, await: false, loop: false, volume: 1 }, ctx.doc)).toBe(
      '播放媒体「讲解」',
    )
    expect(play.describe?.({ mediaId: MEDIA_ID, await: true, loop: true, volume: 0.5 }, ctx.doc)).toContain('循环')
    expect(registry.get('stopMedia')!.describe?.({ mediaId: 'all' }, ctx.doc)).toBe('停止全部媒体')
  })

  it('the rule editor needs no change: every field is one of the six kinds', async () => {
    // C5's acceptance evidence. `refKind: 'media'` has been in `FieldDescriptor` since v0,
    // so the form grows on its own — which is the whole claim v0.5 makes about actions.
    //
    // T-185 ③ · the set now comes from FIELD_KINDS. The hand-typed copy this replaces
    // contained 'vec3' — a kind that has never existed — so it could never have failed
    // on the drift it was written to catch.
    const kinds = new Set<string>(FIELD_KINDS)
    for (const type of ['playMedia', 'stopMedia']) {
      for (const field of registry.get(type)!.ui.fields) {
        expect(kinds.has(field.type), `${type}.${field.key} 用了第七种字段类型`).toBe(true)
      }
    }
  })
})

describe('ECA_SPEC §4.4 · field kinds are closed at six', () => {
  it('every registered action uses only the six kinds, and the list stays six', () => {
    // §4.4 freezes the set at exactly six. If the length assertion goes red you are
    // changing the spec's closed set — that is a stop-and-ask event, not a test edit.
    // The loop is registry-wide on purpose: the per-action guards above only ever
    // inspected setLight and the media pair, so setVariable's `valueExpr` field had no
    // guard at all until this one.
    expect(FIELD_KINDS).toHaveLength(6)
    const known = new Set<string>(FIELD_KINDS)
    for (const action of BUILTIN_ACTIONS) {
      for (const field of action.ui.fields) {
        expect(known.has(field.type), `${action.type}.${field.key} 用了第七种字段类型 ${field.type}`).toBe(true)
      }
    }
  })
})


describe('G0-5 · every registered action has a test', () => {
  it('the tested set covers the registry exactly', () => {
    const registered = BUILTIN_ACTIONS.map((a) => a.type).sort()
    const missing = registered.filter((type) => !covered.has(type))
    expect(
      missing,
      `these actions are registered but untested: ${missing.join(', ')}. ` +
        'Add a test in this file — the coverage gate is not a formality (C8).',
    ).toEqual([])
  })
})
