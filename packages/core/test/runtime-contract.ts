import type { SceneDocument } from '@w3/schema'
import { createGoldenPathDocument } from '@w3/schema'
import { expect, it } from 'vitest'
import type { RuntimeContext, RuntimeEvent } from '../src/eca/types.js'
import { IDS } from './helpers.js'

/**
 * T-084 · the shared RuntimeContext contract.
 *
 * ECA_SPEC §6: HeadlessRuntime and SceneRuntime MUST both run this suite. The quiet
 * failure mode of this whole architecture is a headless runtime that slowly drifts away
 * from the real one — every test green, the product broken. This file is the thing that
 * makes that drift a test failure instead of an acceptance-day discovery.
 *
 * SceneRuntime does not exist yet (T-031); when it lands it calls this same function.
 */
export interface ContractHarness {
  readonly ctx: RuntimeContext
  /** Moves whatever clock this runtime uses forward by `ms`, settling side effects. */
  advance(ms: number): Promise<void>
  /**
   * v0.5 · the light's live parameters, however this runtime stores them.
   *
   * Supplied by the harness rather than added to `RuntimeContext` on purpose. The frozen
   * increment (进化规划 §4.3) is `setLight` and three media methods — no reader — and
   * widening a frozen list for the convenience of a test is how frozen lists stop meaning
   * anything. Each side exposes its own state, and the SAME assertions run against both,
   * which is what the contract is for.
   */
  lightOf(nodeId: string): { intensity: number; color: string } | null
  /**
   * T-216 · every event this runtime emitted, in order.
   *
   * Same reasoning as `lightOf`: `RuntimeContext` is frozen and this is a test seam, not a
   * capability. Both sides happen to expose `onEvent`, but going through the harness keeps
   * the assertions typed instead of casting through `unknown` the way the earlier probe in
   * this file had to.
   */
  events(): readonly RuntimeEvent[]
  /**
   * T-245 · 这个爆炸分组此刻的系数。
   *
   * 与 `lightOf` 同一条理由走 harness 而不是 `RuntimeContext`：**它其实在两侧都有**
   * （`explodeOf` 是规划 §4 冻结的读者），但让契约通过 harness 拿，测试就不必为了
   * 读一个数而 cast 穿 unknown。
   */
  explodeOf(groupNodeId: string): number
  /**
   * T-245 · 这个运行时报过的每一条日志。
   *
   * 「两侧 error 日志措辞相同」是这一批里唯一一条**比字符串**的契约断言，而两个运行时
   * 报日志的路子完全不同（headless 往数组里推，SceneRuntime 走 `onLog` 回调）。
   * 不给 harness 开这条缝的话，那条验收在今天的契约套件里根本观测不到。
   */
  logs(): readonly { level: string; message: string }[]
}

/** A spot light node, so the light half of the contract has something to point at. */
const LIGHT_ID = 'nd_light001'

/** A media record, so the media half has something to point at. */
const MEDIA_ID = 'med_00000001'

/** A looping tween, so 「停止循环动画」 has something to stop. T-216. */
const LOOP_ANIMATION_ID = 'anm_loop0001'

function loopDocument(): SceneDocument {
  const doc = createGoldenPathDocument()
  return {
    ...doc,
    animations: [
      ...doc.animations,
      {
        kind: 'tween',
        id: LOOP_ANIMATION_ID,
        name: '循环抬起',
        duration: 1.2,
        easing: 'linear',
        loop: true,
        yoyo: false,
        targets: [{ nodeId: IDS.cover, to: { p: [0, 0.35, 0] } }],
      },
    ],
  } as SceneDocument
}

/** The golden path plus one audio asset and its media record. */
function mediaDocument(): SceneDocument {
  const doc = createGoldenPathDocument()
  return {
    ...doc,
    assets: [
      ...doc.assets,
      { ...doc.assets[0]!, id: 'ast_med00001', type: 'audio', name: '讲解.mp3' },
    ],
    media: [{ id: MEDIA_ID, type: 'audio', assetId: 'ast_med00001', name: '讲解', durationS: 2 }],
  } as SceneDocument
}

function litDocument(): SceneDocument {
  const doc = createGoldenPathDocument()
  return {
    ...doc,
    nodes: [
      ...doc.nodes,
      {
        section: null,
        explode: null,
        explodeOffset: null,
        prefabRef: null,
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

/**
 * T-240 · 一个真的画得出来的节点，供高亮那几条用。
 *
 * 黄金路径文档里没有这样的节点：`nd_pump` 是分组节点，`nd_body` / `nd_cover` 挂着资产
 * 而契约的 harness 从不真的加载资产（那是 loader 的测试，不是契约的），于是它们在
 * SceneRuntime 一侧都是空 Group。**对着空 Group 断言「高亮成功」会必红，而且红的原因
 * 与被测语义无关。** 图元节点是这里唯一能同步materialise 出真网格 + `MeshStandardMaterial`
 * 的载体，与 `litDocument()` 给灯光加一个节点是同一个套路。
 */
const SHADED_ID = 'nd_shade001'

function shadedDocument(): SceneDocument {
  const doc = createGoldenPathDocument()
  return {
    ...doc,
    nodes: [
      ...doc.nodes,
      {
        section: null,
        explode: null,
        explodeOffset: null,
        prefabRef: null,
        id: SHADED_ID,
        name: '标记球',
        parent: null,
        order: 9100,
        assetRef: null,
        primitive: { kind: 'sphere', radius: 0.2 },
        light: null,
        transform: { p: [0, 1, 0], r: [0, 0, 0, 1], s: [1, 1, 1] },
        visible: true,
        locked: false,
        overrides: {},
      },
    ],
  }
}

/**
 * T-245 · 一个真的会散开的爆炸分组。
 *
 * ⚠ **锚点必须互不相同。** 黄金路径那三个节点的 `transform.p` 全是 `[0,0,0]`，而 radial
 * 位移是 `(锚点 − 质心) × gain`——锚点全重合时位移**恒为零**，于是「完成后两侧 positionY
 * 逐位相等」会退化成 `0 === 0`，而卡面变异 ① 在那种文档上是绿的。这份 fixture 存在的
 * 全部理由就是让那条断言有判别力。
 */
const EXPLODE_GROUP = 'nd_exgrp001'
const EXPLODE_MEMBER = 'nd_exmem002'

function explodeDocument(): SceneDocument {
  const doc = createGoldenPathDocument()
  const shared = {
    section: null,
    explodeOffset: null,
    prefabRef: null,
    assetRef: null,
    primitive: null,
    light: null,
    visible: true,
    locked: false,
    overrides: {},
    parent: null as string | null,
    transform: { p: [0, 0, 0] as [number, number, number], r: [0, 0, 0, 1] as [number, number, number, number], s: [1, 1, 1] as [number, number, number] },
  }
  const member = (id: string, order: number, p: [number, number, number]) => ({
    ...shared,
    id,
    name: `零件 ${order}`,
    parent: EXPLODE_GROUP,
    order,
    explode: null,
    primitive: { kind: 'box' as const, size: [0.2, 0.2, 0.2] as [number, number, number] },
    transform: { ...shared.transform, p },
  })
  return {
    ...doc,
    nodes: [
      ...doc.nodes,
      {
        ...shared,
        id: EXPLODE_GROUP,
        name: '爆炸组',
        order: 8000,
        explode: { mode: 'radial' as const, gain: 2, axis: [0, 1, 0] as [number, number, number], spacing: 0.5, easing: 'linear' as const },
      },
      member('nd_exmem001', 1, [0, 0, 0]),
      member(EXPLODE_MEMBER, 2, [0, 1, 0]),
      member('nd_exmem003', 3, [0, 2, 0]),
    ],
  } as SceneDocument
}

/** `animationEnd` events only, narrowed so `completed` is reachable without a cast. */
const animationEnds = (events: readonly RuntimeEvent[], animationId?: string) =>
  events.filter((e): e is Extract<RuntimeEvent, { event: 'animationEnd' }> =>
    e.event === 'animationEnd' && (animationId === undefined || e.animationId === animationId),
  )

export function describeRuntimeContract(label: string, makeCtx: (doc: SceneDocument) => ContractHarness) {
  const setup = () => makeCtx(createGoldenPathDocument())
  const setupLit = () => makeCtx(litDocument())
  const setupWithMedia = () => makeCtx(mediaDocument())
  const setupLooping = () => makeCtx(loopDocument())
  const setupShaded = () => makeCtx(shadedDocument())
  const setupExplode = () => makeCtx(explodeDocument())

  it(`${label}: variables start at their document defaults`, () => {
    expect(setup().ctx.getVar('step')).toBe(1)
  })

  it(`${label}: setVar emits variableChange only on an actual change`, () => {
    const { ctx } = setup()
    const seen: unknown[] = []
    const original = ctx.emit.bind(ctx)
    void original
    // Runtimes expose their event stream differently; observe through a rule-free probe.
    const probe = (ctx as unknown as { onEvent?: (fn: (e: unknown) => void) => void }).onEvent
    probe?.call(ctx, (e: unknown) => seen.push(e))

    ctx.setVar('step', 1)
    expect(seen, 'writing the same value must not fire an event').toHaveLength(0)
    ctx.setVar('step', 2)
    expect(seen).toHaveLength(1)
  })

  it(`${label}: visibility starts from the document and is settable per node`, () => {
    const { ctx } = setup()
    expect(ctx.isVisible(IDS.cover)).toBe(true)
    ctx.setVisible(IDS.cover, false)
    expect(ctx.isVisible(IDS.cover)).toBe(false)
    expect(ctx.isVisible(IDS.body), 'siblings must be untouched').toBe(true)
  })

  it(`${label}: setVisible with includeDescendants reaches the subtree`, () => {
    const { ctx } = setup()
    ctx.setVisible(IDS.pump, false, { includeDescendants: true })
    expect(ctx.isVisible(IDS.body)).toBe(false)
    expect(ctx.isVisible(IDS.cover)).toBe(false)
  })

  it(`${label}: panels open and close, individually and all at once`, () => {
    const { ctx } = setup()
    expect(ctx.isPanelOpen(IDS.hotspot)).toBe(false)
    ctx.openPanel(IDS.hotspot)
    expect(ctx.isPanelOpen(IDS.hotspot)).toBe(true)
    ctx.closePanel(IDS.hotspot)
    expect(ctx.isPanelOpen(IDS.hotspot)).toBe(false)
    ctx.openPanel(IDS.hotspot)
    ctx.closePanel('all')
    expect(ctx.isPanelOpen(IDS.hotspot)).toBe(false)
  })

  it(`${label}: a non-looping animation resolves only when it finishes`, async () => {
    const h = setup()
    let done = false
    void h.ctx.playAnimation(IDS.animation, {}).then(() => {
      done = true
    })
    await h.advance(1199)
    expect(done).toBe(false)
    await h.advance(1)
    expect(done).toBe(true)
  })

  it(`${label}: D6 · playAnimation is reported as playing while it runs`, async () => {
    const h = setup()
    void h.ctx.playAnimation(IDS.animation, {}).catch(() => undefined)
    await h.advance(100)
    expect(h.ctx.isAnimationPlaying(IDS.animation)).toBe(true)
    await h.advance(1200)
    expect(h.ctx.isAnimationPlaying(IDS.animation)).toBe(false)
  })

  /**
   * T-216 · overlapping playback, which is where the two runtimes had already diverged.
   *
   * Measured before the fix: headless emitted `[{completed:true},{completed:true}]` and
   * resolved the first promise; the real runtime emitted
   * `[{completed:false},{completed:true}]` and rejected it. Both were green, because
   * **neither the contract suite nor `pnpm test:parity` had an overlapping case** — the
   * exact shape ECA_SPEC §6 warns about, where the headless runtime drifts quietly and
   * everything stays green until a customer clicks the same button twice.
   */
  it(`${label}: T-216 · a second play of the same animation ends the first one`, async () => {
    const h = setup()
    const first = h.ctx.playAnimation(IDS.animation, {}).then(
      () => 'resolved',
      () => 'rejected',
    )
    await h.advance(100)

    void h.ctx.playAnimation(IDS.animation, {}).catch(() => undefined)
    await h.advance(0)

    // The interrupted run reports itself as UNfinished. Reporting `completed: true` would
    // fire every 「动画播完之后」 rule for an animation that was cut off a tenth of the way in.
    const ends = animationEnds(h.events())
    expect(ends.map((e) => e.completed)).toEqual([false])
    expect(await first, 'the interrupted promise is a cancellation, not a completion').toBe('rejected')

    await h.advance(1200)
    const after = animationEnds(h.events())
    expect(after.map((e) => e.completed)).toEqual([false, true])
  })

  it(`${label}: T-216 · stopping a LOOPING animation still reports it ended`, async () => {
    const h = setupLooping()
    void h.ctx.playAnimation(LOOP_ANIMATION_ID, {}).catch(() => undefined)
    await h.advance(100)
    expect(h.ctx.isAnimationPlaying(LOOP_ANIMATION_ID)).toBe(true)

    h.ctx.stopAnimation(LOOP_ANIMATION_ID)
    await h.advance(0)

    // A loop never ends by itself, so 「停止之后接着做别的」 has no other event to hang on.
    // The old headless guard `if (!entry.loop)` swallowed it and the real runtime did not.
    const ends = animationEnds(h.events(), LOOP_ANIMATION_ID)
    expect(ends.map((e) => e.completed)).toEqual([false])
  })

  it(`${label}: an aborted animation rejects rather than resolving`, async () => {
    const h = setup()
    const controller = new AbortController()
    const promise = h.ctx.playAnimation(IDS.animation, { signal: controller.signal })
    const settled = promise.then(
      () => 'resolved',
      () => 'rejected',
    )
    await h.advance(100)
    controller.abort()
    expect(await settled).toBe('rejected')
  })

  it(`${label}: wait resolves on the injected clock, never the wall clock`, async () => {
    const h = setup()
    const before = h.ctx.now()
    let done = false
    void h.ctx.wait(500).then(() => {
      done = true
    })
    await h.advance(499)
    expect(done).toBe(false)
    await h.advance(1)
    expect(done).toBe(true)
    expect(h.ctx.now() - before).toBeGreaterThanOrEqual(500)
  })

  it(`${label}: wait is cancellable`, async () => {
    const h = setup()
    const controller = new AbortController()
    const settled = h.ctx.wait(1000, controller.signal).then(
      () => 'resolved',
      () => 'rejected',
    )
    controller.abort()
    expect(await settled).toBe('rejected')
  })

  it(`${label}: moveCamera resolves on arrival`, async () => {
    const h = setup()
    let done = false
    void h.ctx.moveCamera(IDS.viewpoint, { duration: 1 }).then(() => {
      done = true
    })
    await h.advance(999)
    expect(done).toBe(false)
    await h.advance(1)
    expect(done).toBe(true)
  })

  it(`${label}: getNodeProp reads visibility and position`, () => {
    const { ctx } = setup()
    expect(ctx.getNodeProp(IDS.cover, 'visible')).toBe(true)
    expect(typeof ctx.getNodeProp(IDS.cover, 'positionY')).toBe('number')
  })

  it(`${label}: resetScene returns everything to the document`, () => {
    const { ctx } = setupShaded()
    ctx.setVar('step', 7)
    ctx.setVisible(IDS.cover, false)
    ctx.highlight(SHADED_ID, 'outline_red')
    ctx.openPanel(IDS.hotspot)

    // T-240 · 前提断言。少了这条，下面那句 `highlightOf === null` 对一个「从来没高亮上」
    // 的运行时同样为真——resetScene 什么都不做也能绿。
    expect(ctx.highlightOf(SHADED_ID), '高亮先得真的加上，reset 才谈得上把它撤掉').toBe('outline_red')

    ctx.resetScene()

    expect(ctx.getVar('step')).toBe(1)
    expect(ctx.isVisible(IDS.cover)).toBe(true)
    expect(ctx.isPanelOpen(IDS.hotspot)).toBe(false)
    expect(ctx.highlightOf(SHADED_ID), 'resetScene 要把高亮也撤掉').toBeNull()
  })

  /* --- T-245 · setExplode ------------------------------------------------- */

  it(`${label}: 起始系数是 0`, () => {
    expect(setupExplode().explodeOf(EXPLODE_GROUP)).toBe(0)
  })

  it(`${label}: setExplode(1, {durationS:0.5}) 在 499ms 未完成、500ms 完成`, async () => {
    const h = setupExplode()
    let done = false
    void h.ctx.setExplode(EXPLODE_GROUP, 1, { durationS: 0.5 }).then(() => {
      done = true
    })

    await h.advance(499)
    expect(done, '提前完成了').toBe(false)
    await h.advance(1)
    expect(done).toBe(true)
    expect(h.explodeOf(EXPLODE_GROUP)).toBe(1)
  })

  it(`${label}: **完成之后两侧 positionY 逐位相等**`, async () => {
    // 必须在爆炸**完成之后**读。factor=0 时两侧当然相等，那条断言什么都不测——
    // 卡面变异 ① 点名的正是这个形状。
    const h = setupExplode()
    // 成员 2 的锚点恰在质心上（y=1），位移为零——**故意不用它做主断言**。
    // 用一个位移非零的成员，否则这条契约在「headless 只读文档」的实现下也是绿的。
    expect(h.ctx.getNodeProp(EXPLODE_MEMBER, 'positionY')).toBeCloseTo(1, 6)

    await h.ctx.setExplode(EXPLODE_GROUP, 1)

    // 质心 y = (0+1+2)/3 = 1，gain = 2 → 成员 3 的位移 y = (2 − 1) × 2 = 2
    const third = h.ctx.getNodeProp('nd_exmem003', 'positionY')
    expect(third, '位移是零，这条断言什么都没测').not.toBe(2)
    expect(third).toBeCloseTo(2 + (2 - 1) * 2, 6)
  })

  it(`${label}: 目标不是爆炸分组 → 不抛、系数 0、error 日志措辞相同`, async () => {
    const h = setupExplode()
    await expect(h.ctx.setExplode(EXPLODE_MEMBER, 1)).resolves.toBeUndefined()

    expect(h.explodeOf(EXPLODE_MEMBER)).toBe(0)
    const errors = h.logs().filter((l) => l.level === 'error')
    expect(errors.map((l) => l.message)).toContain(`爆炸目标「${EXPLODE_MEMBER}」不是爆炸分组，已跳过`)
  })

  it(`${label}: resetScene 之后系数归 0 且 positionY 回文档值`, async () => {
    const h = setupExplode()
    const before = h.ctx.getNodeProp('nd_exmem003', 'positionY')
    await h.ctx.setExplode(EXPLODE_GROUP, 1)
    expect(h.ctx.getNodeProp('nd_exmem003', 'positionY')).not.toBe(before)

    h.ctx.resetScene()

    expect(h.explodeOf(EXPLODE_GROUP)).toBe(0)
    expect(h.ctx.getNodeProp('nd_exmem003', 'positionY')).toBeCloseTo(before as number, 6)
  })

  /* --- T-240 · highlightOf ------------------------------------------------ */

  it(`${label}: highlightOf 报出刚写进去的预设名，取消后回到 null`, () => {
    const { ctx } = setupShaded()
    expect(ctx.highlightOf(SHADED_ID)).toBeNull()

    ctx.highlight(SHADED_ID, 'outline_amber')
    expect(ctx.highlightOf(SHADED_ID)).toBe('outline_amber')

    // 换一种预设：报的是新的那种，不是第一次那种
    ctx.highlight(SHADED_ID, 'outline_red')
    expect(ctx.highlightOf(SHADED_ID)).toBe('outline_red')

    ctx.highlight(SHADED_ID, null)
    expect(ctx.highlightOf(SHADED_ID)).toBeNull()
  })

  it(`${label}: highlightOf 只认被点名的那个节点`, () => {
    // 「返回最后一次高亮过的预设名，不管问的是谁」这种实现在上一条下面是绿的。
    const { ctx } = setupShaded()
    ctx.highlight(SHADED_ID, 'outline_amber')
    expect(ctx.highlightOf(IDS.hotspot)).toBeNull()
  })

  it(`${label}: 未知预设不会被记成高亮`, () => {
    const { ctx } = setupShaded()
    ctx.highlight(SHADED_ID, 'outline_chartreuse')
    expect(ctx.highlightOf(SHADED_ID), '画不出来的预设不该报成已生效').toBeNull()
  })

  it(`${label}: now() is monotonic`, async () => {
    const h = setup()
    const t0 = h.ctx.now()
    await h.advance(100)
    expect(h.ctx.now()).toBeGreaterThanOrEqual(t0)
  })

  it(`${label}: currentEvent() is null outside a dispatch`, () => {
    expect(setup().ctx.currentEvent()).toBeNull()
  })

  it(`${label}: reading an undeclared variable warns instead of throwing`, () => {
    const { ctx } = setup()
    expect(() => ctx.getVar('nope')).not.toThrow()
  })

  /* --- v0.5 · setLight (进化规划 §4.3) ------------------------------------ */

  it(`${label}: a light starts at the parameters the document gave it`, () => {
    expect(setupLit().lightOf(LIGHT_ID)).toEqual({ intensity: 3, color: '#ffd9a0' })
  })

  it(`${label}: setLight moves intensity and colour`, () => {
    const h = setupLit()
    h.ctx.setLight(LIGHT_ID, { intensity: 6, color: '#ff0000' })
    expect(h.lightOf(LIGHT_ID)).toEqual({ intensity: 6, color: '#ff0000' })
  })

  it(`${label}: setLight leaves the parameter it was not given alone`, () => {
    const h = setupLit()
    h.ctx.setLight(LIGHT_ID, { intensity: 6 })
    expect(h.lightOf(LIGHT_ID)).toEqual({ intensity: 6, color: '#ffd9a0' })
  })

  it(`${label}: setLight on a node that is not a light is skipped, not thrown (B9)`, () => {
    // The divergence this catches is the expensive kind: one runtime throwing where the
    // other skips means the editor's preview and the player disagree about whether the
    // rest of the sequence ran at all.
    //
    // BOTH parameters are passed on purpose. With intensity alone this assertion does not
    // discriminate: writing a number onto the wrong Object3D silently succeeds in
    // JavaScript, so a runtime that had lost its "is this a light" guard entirely would
    // still pass. Colour is the one that needs a real `Color` on the other end.
    const h = setupLit()
    expect(() => h.ctx.setLight(IDS.cover, { intensity: 6, color: '#ff0000' })).not.toThrow()
    expect(h.lightOf(IDS.cover)).toBeNull()
  })

  it(`${label}: resetScene puts the light back (B13, extended to lights)`, () => {
    const h = setupLit()
    h.ctx.setLight(LIGHT_ID, { intensity: 6, color: '#ff0000' })
    h.ctx.resetScene()
    expect(h.lightOf(LIGHT_ID)).toEqual({ intensity: 3, color: '#ffd9a0' })
  })

  /* --- v0.5 · media (进化规划 §4.3 · T-163) -------------------------------- */

  it(`${label}: nothing is playing to begin with`, async () => {
    const h = setupWithMedia()
    expect(h.ctx.isMediaPlaying(MEDIA_ID)).toBe(false)
    await Promise.resolve()
  })

  it(`${label}: playMedia starts it and isMediaPlaying says so`, async () => {
    const h = setupWithMedia()
    await h.ctx.playMedia(MEDIA_ID, {})
    expect(h.ctx.isMediaPlaying(MEDIA_ID)).toBe(true)
  })

  it(`${label}: stopMedia stops it`, async () => {
    const h = setupWithMedia()
    await h.ctx.playMedia(MEDIA_ID, {})
    h.ctx.stopMedia(MEDIA_ID)
    expect(h.ctx.isMediaPlaying(MEDIA_ID)).toBe(false)
  })

  it(`${label}: stopMedia('all') stops everything`, async () => {
    const h = setupWithMedia()
    await h.ctx.playMedia(MEDIA_ID, {})
    h.ctx.stopMedia('all')
    expect(h.ctx.isMediaPlaying(MEDIA_ID)).toBe(false)
  })

  it(`${label}: stopping what is not playing is fine, not an error`, async () => {
    const h = setupWithMedia()
    expect(() => h.ctx.stopMedia(MEDIA_ID)).not.toThrow()
    expect(() => h.ctx.stopMedia('all')).not.toThrow()
    await Promise.resolve()
  })

  it(`${label}: playMedia on a media id that does not exist is skipped, not thrown`, async () => {
    // Same divergence risk as setLight on a non-light (B9): one runtime throwing where the
    // other skips means the editor's preview and the player disagree about whether the rest
    // of the sequence ran.
    const h = setupWithMedia()
    await expect(h.ctx.playMedia('med_00000000', {})).resolves.toBeUndefined()
    expect(h.ctx.isMediaPlaying('med_00000000')).toBe(false)
  })

  it(`${label}: resetScene silences the scene (B13 extended to media)`, async () => {
    // Leaving preview mode with a narration still playing is the single most jarring thing
    // this feature can do.
    const h = setupWithMedia()
    await h.ctx.playMedia(MEDIA_ID, {})
    h.ctx.resetScene()
    expect(h.ctx.isMediaPlaying(MEDIA_ID)).toBe(false)
  })
}
