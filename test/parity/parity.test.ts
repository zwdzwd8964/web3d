import { createGoldenPathDocument } from '@w3/schema'
import type { SceneDocument } from '@w3/schema'
import { HotspotSpriteLayer, SAMPLE_CLIP, SceneRuntime, buildSamplePumpGlb, createMemoryResolver, registerBuiltinActions } from '@w3/core'
import type { ExecResult } from '@w3/core'
import { PreviewController, createPreviewStore } from '@w3/editor'
import { createPlayerSession } from '@w3/player'
import { packScene, unpackScene } from '@w3/storage'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import script from './event-script.json' with { type: 'json' }

/**
 * T-103 · G0-4 · the constitution C3 gate.
 *
 * "编辑器里是这样、发布出来不一样" (技术方案 §1.1) is the acceptance disaster this whole
 * architecture exists to prevent, and this file is its only automated defence. ECA_SPEC
 * §9.3 is blunt about the consequence of it failing: **停下来修架构，不要继续加功能.**
 *
 * ── Why this is not self-proving ──────────────────────────────────────────────
 *
 * Both sides do end up inside `createPlaybackSession` — that is the point of T-102. If
 * this test called that function twice it would prove nothing but its own determinism. So
 * each side is driven through its REAL entry point, and the two paths differ in every way
 * a real deployment differs:
 *
 *   editor side   PreviewController.enter()  · document object held in memory
 *                                            · assets from the session's resolver
 *   player side   createPlayerSession()      · document round-tripped through a .w3p
 *                                              (JSON serialise -> zip -> unzip -> parse)
 *                                            · assets from createPackageResolver
 *                                            · assertCompatible + its own registration
 *
 * What is being asserted is that none of those differences reaches behaviour. A divergence
 * anywhere in packing, unpacking, resolution, registration or wiring order shows up here
 * as a mismatched ExecResult and nowhere else until a customer finds it.
 *
 * ── What this does NOT cover ──────────────────────────────────────────────────
 *
 * The layer above: how each host turns a pointer event into a call on its side. The
 * editor's viewport used to translate a hotspot click into a SELECTION while the player
 * fired the rule — a genuine C3 divergence that this file could never have seen, because
 * both sides here are driven through the controller/session API directly.
 *
 * That layer belongs to the browser E2E, and the split is deliberate: parity is the
 * head-less gate that can run on every commit, and dragging a DOM into it would cost that.
 * Nobody should read a green parity run as "the two hosts behave identically" — it means
 * "given the same input at the session boundary, the two behave identically".
 */

type ScriptStep = {
  atMs: number
  note: string
  event:
    | { kind: 'click'; nodeId: string }
    | { kind: 'hotspotClick'; hotspotId: string }
    | { kind: 'pointerOver'; nodeId: string | null }
    | { kind: 'setVar'; variableId: string; value: number }
    | { kind: 'idle' }
}

const STEPS = (script as { steps: ScriptStep[] }).steps

/** Frame quantum for the fake clock. Small enough that a 1.2 s tween gets ~72 samples. */
const FRAME_MS = 16

let glb: ArrayBuffer

beforeAll(async () => {
  registerBuiltinActions()
  glb = await buildSamplePumpGlb()
})

// Both sides replay against the same fake timers, so `ctx.wait` resolves at the instant the
// script says rather than whenever the machine gets round to it.
beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

/**
 * Runs the script against one side and returns its execution trace.
 *
 * `advance` is shared so both sides are ticked identically: same frame quantum, same
 * instants, same number of ticks. Anything else would make timestamp comparison
 * meaningless and would hide a real divergence behind a scheduling one.
 */
/** 画布尺寸。**两侧必须一致**，否则热点投影落点不同，ops 序列天然不可比。 */
const VIEWPORT = { width: 1280, height: 720 } as const

/**
 * T-294 · 一个无 GPU、无 DOM 的 2D 画布。
 *
 * `HotspotSpriteLayer` 只要 13 个 2D 方法，一个都不碰 WebGL——所以热点栅格化这条链
 * **在纯 Node 里是可比的**，而它在此之前从未被 parity 覆盖过（全仓没有任何宿主构造过
 * 这个层，两侧用的都是 `NullHotspotRenderer`）。
 */
function fakeCanvas(width: number, height: number) {
  const ctx = {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 0,
    font: '',
    textAlign: '' as CanvasTextAlign,
    textBaseline: '' as CanvasTextBaseline,
    globalAlpha: 1,
    clearRect: () => {},
    beginPath: () => {},
    arc: () => {},
    fill: () => {},
    stroke: () => {},
    fillRect: () => {},
    fillText: () => {},
    drawImage: () => {},
  }
  return { width, height, getContext: () => ctx }
}

/**
 * 一次回放交出来的**全部可比量**。
 *
 * 在此之前只有 `results` 与 `variables`——也就是说 parity 比的一直只有「规则怎么跑的」。
 * v1.0 加的雾、描边、热点栅格化、爆炸、剖切，一样都没进过比较。
 */
interface Trace {
  results: ExecResult[]
  variables: Record<string, unknown>
  /** `scene.fog` 的快照。无 renderer 下雾也真的生效，见 parityDocument 的注释。 */
  fog: { type: string; color: number; near?: number; far?: number; density?: number } | null
  /** 热点栅格化的 op 序列。**顺序就是绘制顺序**。 */
  ops: unknown[]
  /** 每个节点的高亮预设。`highlight` 动作写的是这份账本，两侧都读得到。 */
  highlights: Record<string, string | null>
  /** 爆炸之后阀盖的世界位置。**只有它能证明爆炸真的动了东西**。 */
  explodedY: number | null
  /**
   * 运行时发出的警告。
   *
   * 加它的直接原因：**「imported 片段真的播了」这件事，用时长断言测不出来。**
   * 实测——把片段名改成一个不存在的值，那条规则的时长一动不动是 1328ms（`ClipPlayer.play`
   * 找不到片段时 warn 一句然后立刻 resolve，而 1328ms 全部来自爆炸过渡与时钟粒度）。
   * 于是「挂起 ≥ 片段时长」这条断言对它要抓的那件事完全不敏感。
   *
   * 警告文本是唯一直接的观测量：片段没被找到时它一定出现，找到了它一定不出现。
   */
  warnings: string[]
}

/** `scene.fog` 拍成一个可 `toEqual` 的普通对象。three 的 Fog 对象带方法，比不了。 */
function fogSnapshot(runtime: SceneRuntime): Trace['fog'] {
  const fog = runtime.scene.fog as unknown as { color: { getHex(): number }; near?: number; far?: number; density?: number } | null
  if (!fog) return null
  const shape = { type: fog.density === undefined ? 'linear' : 'exp2', color: fog.color.getHex() }
  return fog.density === undefined ? { ...shape, near: fog.near, far: fog.far } : { ...shape, density: fog.density }
}

async function replay(
  side: 'editor' | 'player',
  doc: SceneDocument,
): Promise<Trace> {
  const results: ExecResult[] = []
  const warnings: string[] = []
  const onLog = (level: 'debug' | 'warn' | 'error', message: string) => {
    if (level !== 'debug') warnings.push(message)
  }
  // 两侧各自一个，但**用同一个工厂**——共用一个实例的话，第二侧会读到第一侧留下的 ops。
  const spriteLayer = new HotspotSpriteLayer({ createCanvas: fakeCanvas })
  spriteLayer.resize(VIEWPORT.width, VIEWPORT.height)
  let clock = 0
  const now = () => clock

  let runtime: SceneRuntime
  let dispatchClick: (nodeId: string) => void
  let dispatchHotspot: (hotspotId: string) => void
  let dispatchHover: (nodeId: string | null) => void
  let tick: () => void
  let stop: () => void

  if (side === 'editor') {
    // The editor's real path: a runtime it owns, driven by PreviewController.
    runtime = new SceneRuntime(doc, {
      resolver: createMemoryResolver(new Map([[doc.assets[0]!.url, glb]])),
      mode: 'edit',
      now,
      // T-294 · 热点栅格化进入比较面。**尺寸也要给**——运行时默认 1×1，
      // 那样每个热点都在视锥外，ops 恒为空，而「两个空数组相等」会通过。
      hotspotRenderer: spriteLayer,
      onLog,
    })
    runtime.resize(VIEWPORT.width, VIEWPORT.height)
    const store = createPreviewStore()
    const controller = new PreviewController(runtime, store)
    store.subscribe(() => {
      // The controller pushes results into the store; read them from there rather than
      // from the engine, because that is the path the debug panel uses too.
    })
    // `append` is what the controller calls; wrap it to capture in order.
    const original = store.getState().append
    store.setState({
      append: (result: ExecResult) => {
        results.push(result)
        original(result)
      },
    })

    await controller.enter(doc)
    // Each side through its OWN entry point. Routing both through `runtime.emit` would
    // have hidden the real divergence the reviewer found: the editor's viewport used to
    // turn a hotspot click into a selection while the player fired the rule.
    dispatchClick = (nodeId) => controller.dispatchClick(nodeId)
    dispatchHotspot = (hotspotId) => controller.dispatchHotspotClick(hotspotId)
    dispatchHover = (nodeId) => controller.dispatchPointerOver(nodeId)
    tick = () => runtime.tick()
    stop = () => controller.exit()
  } else {
    // The player's real path: the document has been through a .w3p round trip.
    const packed = packScene({
      document: doc,
      snapshotId: 'snp_parity01',
      publishedAt: '2026-07-31T00:00:00.000Z',
      coreVersion: '0.0.0',
      // Every asset the document names, or `unpackScene` refuses the package — and the
      // v0.5 document names an audio file as well as the model.
      blobs: new Map(doc.assets.map((a) => [a.hash, a.type === 'model' ? new Uint8Array(glb) : new Uint8Array(64)])),
    })
    const pkg = unpackScene(packed)

    // `PlayerSessionOptions.hotspotRenderer` 是 T-265 就留好的缝，所以这一行
    // **没有动 packages/player/src 一个字**（C3）。
    const created = createPlayerSession({ pkg, now, onResult: (r) => results.push(r), hotspotRenderer: spriteLayer, onLog })
    runtime = created.runtime
    runtime.resize(VIEWPORT.width, VIEWPORT.height)
    await created.session.start()
    dispatchClick = (nodeId) => created.session.click(nodeId)
    dispatchHotspot = (hotspotId) => created.session.hotspotClick(hotspotId)
    dispatchHover = (nodeId) => created.session.pointerOver(nodeId)
    tick = () => created.session.tick()
    stop = () => created.session.dispose()
  }

  // Replay. The clock only ever moves forward in FRAME_MS steps, and every event fires at
  // the exact instant the script names.
  //
  // The TIMER clock is advanced in lockstep with the injected `now` (v0.5 · T-171). Tweens
  // are driven by `tick()` and never needed it, but `playMedia(await: true)` suspends on
  // `ctx.wait`, which is a real `setTimeout` inside `SceneRuntime` — left alone it is still
  // pending when the script ends, teardown aborts it, and BOTH sides report a rule that
  // never finished. Deterministic timers are what make the awaited step comparable rather
  // than a race between the script and the wall clock.
  for (const step of STEPS) {
    while (clock < step.atMs) {
      const delta = Math.min(step.atMs, clock + FRAME_MS) - clock
      clock += delta
      tick()
      await vi.advanceTimersByTimeAsync(delta)
      await settle()
    }
    switch (step.event.kind) {
      case 'click':
        dispatchClick(step.event.nodeId)
        break
      case 'hotspotClick':
        dispatchHotspot(step.event.hotspotId)
        break
      case 'pointerOver':
        dispatchHover(step.event.nodeId)
        break
      case 'setVar':
        runtime.setVar(step.event.variableId, step.event.value)
        break
      case 'idle':
        break
    }
    await settle()
  }

  const variables: Record<string, unknown> = {}
  for (const variable of doc.variables) variables[variable.id] = runtime.getVar(variable.id)

  // **在 stop() 之前抓**：退出预览会把这些全部还原，那时读到的是静息态，两侧当然相等。
  const fog = fogSnapshot(runtime)
  // ⚠ 投影坐标**按 0.001 像素取整**。两侧实测差在小数点后第 9 位
  // （351.71131510781373 vs 351.71131581744766）——那是浮点累加顺序的差，不是行为分叉；
  // 而 1e-7 像素的差异没有任何观测后果。**取整粒度是有代价的**：它同时也让 0.001 像素
  // 以内的真实分叉隐形，所以取的是一个远小于「一个像素」的数，而不是图省事的整数。
  const ops = spriteLayer.ops.map((op) => {
    const round = (v: unknown) => (typeof v === 'number' ? Number(v.toFixed(3)) : v)
    return Object.fromEntries(Object.entries(op).map(([k, v]) => [k, round(v)]))
  })
  const highlights: Record<string, string | null> = {}
  for (const node of doc.nodes) highlights[node.id] = runtime.highlightOf(node.id)
  const exploded = runtime.graph.objectFor(PARITY_EXPLODE_ROOT)
  // 直接读世界矩阵的平移分量，**不 import three**：parity 这个包没有 three 依赖，
  // 而为了一行取值把它加进来，等于让一份测试工程多背一个渲染引擎。
  let explodedY: number | null = null
  if (exploded) {
    exploded.updateWorldMatrix(true, false)
    explodedY = Number(exploded.matrixWorld.elements[13]!.toFixed(4))
  }

  stop()
  return { results, variables, fog, ops, highlights, explodedY, warnings }
}

/** Lets the executor's promise chain run to quiescence between ticks. */
async function settle(): Promise<void> {
  for (let i = 0; i < 8; i++) await Promise.resolve()
}

/**
 * v0.5 · T-171 · the parity input, extended with a light and a media clip.
 *
 * `createGoldenPathDocument()` is frozen (SCHEMA_SPEC §12) and has neither, so before this
 * card the trace contained no `setLight` and no `playMedia` — and 「播放器零改动自动获得灯光
 * 与媒体」 was an INFERENCE. M9 and M12 each registered that in IMPL_NOTES; this is the card
 * that turns it into an observation.
 *
 * Extended here rather than in the sample: the sample is a spec fixture that many tests
 * assert against literally, and widening it to serve one test is how frozen things stop
 * being frozen. Both sides still receive the SAME object, which is all parity requires.
 */
const PARITY_LIGHT = 'nd_light001'
const PARITY_MEDIA = 'med_00000001'
const PARITY_AUDIO_HASH = `sha256:${'a1b2c3d4'.repeat(8)}`

/** T-294 · 爆炸分组挂在阀盖上（黄金路径文档里那个节点）。 */
const PARITY_EXPLODE_ROOT = 'nd_v7w9x2z4'
/** T-294 · 一条**从 GLB 导入**的片段。黄金路径自带的那条是 tween，两者走的是完全不同的代码。 */
const PARITY_IMPORTED = 'anm_t294imp1'
/** T-294 · 一把水平剖切刀，默认关着——脚本里再打开它。 */
const PARITY_SECTION = 'nd_sec00001'

function parityDocument(): SceneDocument {
  const doc = createGoldenPathDocument()
  return {
    ...doc,
    // T-294 · 表现力两项。**雾在无 renderer 下也真的生效**（`environment.ts` 的
    // `applyFog` 排在 renderer 早退之前，那处注释写明「parity 恰好是唯一机器证明」），
    // 所以 `scene.fog` 是可以逐项比对的量。描边开关本身要 renderer，但
    // `highlight` 动作写的是 `highlightOf` 那份账本，两侧都能读。
    meta: {
      ...doc.meta,
      fog: { enabled: true, type: 'linear', color: '#8fa3b8', near: 4, far: 24, density: 0.02 },
      effects: { ...doc.meta.effects, outline: { ...doc.meta.effects.outline, enabled: true } },
    },
    assets: [
      ...doc.assets,
      {
        ...doc.assets[0]!,
        id: 'ast_med00001',
        type: 'audio',
        name: '讲解.mp3',
        hash: PARITY_AUDIO_HASH,
        url: 'assets/pa/ri/parity-audio.mp3',
      },
    ],
    animations: [
      ...doc.animations,
      {
        // T-294 · **带区间的 imported 段落。** 黄金路径自带的那条是 `kind: 'tween'`，
        // 走的是补间求值器；imported 走的是 ClipPlayer + three 的 AnimationMixer，
        // 两条代码路径完全不同，而在此之前 parity 只比过前一条。
        //
        // ⚠ `startS` / `endS` 在 v1.0 的 core 里**零消费**（ClipPlayer 只认 clip.duration，
        // 规划 §4 把区间标为「冻结，v1.2 通电」，owner T-318）。所以这两个字段今天是
        // 纯文档事实，比的是「两侧对同一份文档的解释一致」，**不是**「区间被裁了」。
        kind: 'imported' as const,
        id: PARITY_IMPORTED,
        name: '拆装（导入）',
        assetId: doc.assets[0]!.id,
        clipName: SAMPLE_CLIP.name,
        startS: 0,
        endS: null,
        loop: false,
        speed: 1,
      },
    ],
    media: [
      {
        id: PARITY_MEDIA,
        type: 'audio',
        assetId: 'ast_med00001',
        name: '讲解',
        // Short on purpose: the script has to idle past it, and every extra second is
        // wall-clock time both sides pay on every run.
        durationS: 0.4,
      },
    ],
    nodes: [
      ...doc.nodes,
      {
        id: PARITY_LIGHT,
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
        transform: { p: [0, 3, 2], r: [0, 0, 0, 1], s: [1, 1, 1] },
        visible: true,
        locked: false,
        overrides: {},
      },
      {
        // T-294 · 一把水平刀。**默认 visible: false**——ADR-0039 把「启用中」判成世界可见性，
        // 所以脚本里那条 `setVisible` 才是真的把它打开，而不是一句摆设。
        id: PARITY_SECTION,
        name: '水平剖切面',
        parent: null,
        order: 9500,
        assetRef: null,
        primitive: null,
        light: null,
        section: { scope: 'scene' as const, size: [2.4, 2.4] as [number, number] },
        transform: {
          p: [0, 0.5, 0] as [number, number, number],
          // 绕 X 轴 -90°，法向从 +Z 转到 +Y。**非单位旋转是刻意的**（照抄泵组样板的理由）：
          // 单位旋转下「有没有把节点的世界矩阵算进法向」这件事没有观测后果。
          r: [-Math.SQRT1_2, 0, 0, Math.SQRT1_2] as [number, number, number, number],
          s: [1, 1, 1] as [number, number, number],
        },
        visible: false,
        locked: false,
        explode: null,
        explodeOffset: null,
        prefabRef: null,
        overrides: {},
      },
    ].map((n) =>
      // 爆炸分组挂在阀盖上。**`node.explode` 为 null 时 `setExplode` 直接不执行**
      // （scene-runtime.ts:438-441），那样爆炸那条规则会静静地什么都不做，而
      // `ExecResult` 照样 completed —— 又一处「对称地空转」。
      n.id === PARITY_EXPLODE_ROOT
        ? {
            ...n,
            explode: {
              mode: 'radial' as const,
              gain: 1.5,
              axis: [0, 1, 0] as [number, number, number],
              spacing: 0.5,
              easing: 'easeInOutCubic' as const,
            },
          }
        : n,
    ),
    rules: [
      ...doc.rules,
      {
        id: 'rl_v5m1a2b3',
        name: 'v0.5 · 灯光与媒体',
        enabled: true,
        when: { event: 'click', target: { nodeId: 'nd_v7w9x2z4' } },
        if: [],
        ifAny: [],
        mode: 'sequence',
        reentry: 'restart',
        onError: 'abort',
        then: [
          { action: 'setLight', params: { nodeId: PARITY_LIGHT, intensity: 6, color: '#ff0000' } },
          // `await: true` is the whole point: it suspends on `ctx.wait(durationS)`, so the
          // two sides have to agree on WHEN the next step runs, not merely that it ran.
          { action: 'playMedia', params: { mediaId: PARITY_MEDIA, await: true, loop: false, volume: 1 } },
          { action: 'setVariable', params: { variableId: 'step', value: { const: 9 }, mode: 'set' } },
        ],
      },
      {
        // T-294 · v1.0 的两条新路径。**都写在同一条规则里**是有意的：脚本每多一步，
        // 两侧就多一次「同样地什么都没做」的机会，而步数是这份脚本最贵的资源。
        id: 'rl_t294expl',
        name: 'v1.0 · 爆炸与剖切',
        enabled: true,
        when: { event: 'click', target: { nodeId: PARITY_LIGHT } },
        if: [],
        ifAny: [],
        mode: 'sequence',
        reentry: 'restart',
        onError: 'abort',
        then: [
          // 先播那条 imported 片段。**这一步是本卡加 `SAMPLE_CLIP` 的全部理由**：
          // 在此之前样例 GLB 里一条动画通道都没有，`ClipPlayer.play` 找不到名字时
          // 只 warn 然后 resolve —— 两侧对称地什么都不做，而轨迹看起来一模一样。
          { action: 'playAnimation', params: { animationId: PARITY_IMPORTED, await: true } },
          // `await: true` —— 与 playMedia 同一个理由：两侧要在**同一时刻**走到下一步，
          // 而不是仅仅「都执行过」。过渡时长由 explode 动作的 durationS 决定。
          { action: 'explode', params: { nodeId: PARITY_EXPLODE_ROOT, factor: 1, durationS: 0.5, await: true } },
          // 剖切面默认 visible:false，这一步才真的把刀打开（ADR-0039：启用判定看世界可见性）。
          { action: 'setVisible', params: { nodeId: PARITY_SECTION, value: true } },
          { action: 'setVariable', params: { variableId: 'step', value: { const: 11 }, mode: 'set' } },
        ],
      },
    ],
  } as SceneDocument
}

describe('G0-4 · 编辑器预览与播放器的执行轨迹逐项相等', () => {
  it('runs the same script on both sides and gets identical ExecResult sequences', async () => {
    const doc = parityDocument()

    const editor = await replay('editor', doc)

    const player = await replay('player', doc)

    // Fail loudly and legibly. A bare toEqual on two arrays of nested objects produces a
    // diff nobody can read, and this is the one test whose failure has to be actionable.
    expect(summarise(player.results), formatMismatch(editor.results, player.results)).toEqual(
      summarise(editor.results),
    )

    // The full structure, once the summary matches — this catches step-level differences
    // the summary flattens away.
    expect(player.results).toEqual(editor.results)

    // Variable state is the other half of "逐项一致": two runs can produce the same rule
    // log and still end with different state if an action wrote different values.
    expect(player.variables).toEqual(editor.variables)

    /* ── T-294 · v1.0 加进比较面的四项 ──────────────────────────────────── */

    // 雾。**无 renderer 下它也真的生效**（applyFog 排在 renderer 早退之前），
    // 所以这是 v1.0 表现力里唯一一项在纯 Node 下可逐项比对的量。
    expect(player.fog, '两侧的雾不一致').toEqual(editor.fog)

    // 高亮账本。`highlight` 动作写的是运行时的这份账本，不是文档——
    // 拿 `doc.nodes[i]` 去断言是空转（那个值从来不动，T-176 抓到过同形的一次）。
    expect(player.highlights, '两侧的高亮账本不一致').toEqual(editor.highlights)

    // 热点栅格化的 op 序列。**顺序就是绘制顺序**，所以逐项比而不是比集合。
    expect(player.ops, '两侧的热点绘制序列不一致').toEqual(editor.ops)

    // 爆炸之后阀盖的世界位置。ops 与 highlights 都是「账本」，这一条是**几何**——
    // 它是唯一能证明爆炸真的把东西挪开了的量。
    expect(player.explodedY, '两侧爆炸之后的位置不一致').toEqual(editor.explodedY)
  })

  it('actually exercised the interesting cases, rather than trivially matching nothing', async () => {
    const doc = parityDocument()
    const { results, ops, highlights, warnings } = await replay('editor', doc)

    // A parity test that compares two empty arrays passes and proves nothing. These
    // assertions are about the SCRIPT, not the code: they fail if the fixture drifts into
    // being vacuous.
    expect(results.length, '事件脚本没有触发任何规则，这样的 parity 通过是假的').toBeGreaterThan(2)
    const statuses = new Set(results.map((r) => r.status))
    expect(statuses.has('completed'), '脚本从未让任何规则完整跑完').toBe(true)
    expect(
      statuses.has('skipped-condition') || statuses.has('skipped-reentry'),
      '脚本从未触发条件不满足或重入跳过，这两条正是最容易两侧不一致的路径',
    ).toBe(true)

    // v0.5 · the two new tracks have to BE in the trace. Without this the script could lose
    // its light/media steps and parity would stay green while the divergence it was added
    // to catch lived on — exactly what happened to hover and hotspotClick before them.
    const actionsRun = new Set(results.flatMap((r) => r.steps.map((step) => step.action)))
    expect(actionsRun.has('setLight'), '轨迹里必须有 setLight，否则灯光那条路径根本没被比过').toBe(true)
    expect(actionsRun.has('playMedia'), '轨迹里必须有 playMedia，否则媒体那条路径根本没被比过').toBe(true)
    const awaited = results.find((r) => r.steps.some((step) => step.action === 'playMedia'))!
    expect(awaited.endedAt - awaited.startedAt, 'playMedia(await:true) 必须真的挂起了 ~0.4s').toBeGreaterThanOrEqual(400)
    expect(awaited.status, '那条规则要完整跑完，否则比较的是两个失败').toBe('completed')

    const kinds = new Set(STEPS.map((s) => s.event.kind))
    // hover and hotspotClick are the two input paths that HAVE diverged between the two
    // sides in this repo. A script without them stays green while the divergence lives on,
    // so their presence is asserted rather than assumed.
    expect(kinds.has('pointerOver'), '事件脚本必须包含 hover，那是曾经全仓无发射点的一条路径').toBe(true)
    expect(kinds.has('hotspotClick'), '事件脚本必须包含热点点击，那是曾经两侧含义不同的一条路径').toBe(true)

    /* ── T-294 · v1.0 的五条防空转自检 ─────────────────────────────────
     *
     * **双向比较看不见对称的错误**（ADR-0019 逐字）。两侧同时关掉描边、两侧同时把
     * sprite 层的 update 改成空操作、两侧同时用一个不存在的片段名——每一种都让
     * `toEqual` 继续绿，而被比较的东西已经什么都不是了。下面这几条断的全是**绝对量**：
     * 非空、下界、具体名字出现过。它们是这份 parity 唯一能抵抗对称变异的部分。
     */

    // ① 动画真的播了，而且真的挂起了。**不是断 `actionsRun.has('playAnimation')`**——
    //   `ClipPlayer.play` 找不到片段名时只 warn 然后 resolve，那一步照样 completed，
    //   于是「动作出现过」这条断言在片段根本不存在时也成立（T-294 之前就是这个状态：
    //   样例 GLB 里一条动画通道都没有）。
    // ⚠ 找的是**跑完的那一条**，不是第一条。规则的 reentry 是 restart，脚本里那几次
    //   连点会把先前那一条截断，而被截断的那条 endedAt − startedAt 很小——第一版就是
    //   这么红的（实测 400ms），红得对：它量到的是一条被拆台的规则。
    // ⚠ **按规则 id 定位，不是「第一条含 playAnimation 的」。** 第一版就是后者，而它
    //   稳定地找到了黄金路径那条规则 —— 那里的动画是一条 1.2 秒的 **tween**，与本卡新加的
    //   imported 片段走的是完全不同的代码。实测：把片段名改成一个不存在的值，那条断言
    //   量到的仍然是 1200ms，一动不动。**一条看起来在测新路径、实际在测旧路径的断言。**
    const animated = results.find((r) => r.ruleId === 'rl_t294expl' && r.status === 'completed')
    expect(animated, '轨迹里必须有一条跑完的 rl_t294expl').toBeDefined()
    // 这条规则 = imported 片段(0.8s) + 爆炸过渡(0.5s)，所以下界取两者之和。
    expect(
      animated!.endedAt - animated!.startedAt,
      'playAnimation(await:true) 必须真的挂起了 ≥ 片段时长；挂起时间接近 0 说明片段没被找到，两侧只是对称地什么都没做',
    ).toBeGreaterThanOrEqual(SAMPLE_CLIP.seconds * 1000 + 500)

    // ①′ **片段真的被找到了。** 上面那条时长断言对这件事不敏感——实测把片段名改坏之后
    //    它一动不动（1328ms，全部来自爆炸过渡与时钟粒度），因为 `ClipPlayer.play` 找不到
    //    片段时只 warn 一句就 resolve。警告文本才是那件事的直接观测量。
    expect(
      warnings.filter((w) => w.includes('动画片段')),
      '运行时报了「资产中不存在名为…的动画片段」—— imported 那条链根本没跑，两侧只是对称地什么都没做',
    ).toEqual([])

    // ② 爆炸真的跑了，而且真的挂满了过渡时长。
    const exploded = results.find((r) => r.steps.some((step) => step.action === 'explode'))
    expect(exploded, '轨迹里必须有 explode').toBeDefined()
    expect(exploded!.endedAt - exploded!.startedAt, 'explode(await:true) 必须挂满过渡时长').toBeGreaterThanOrEqual(500)
    expect(exploded!.status, '爆炸那条规则要完整跑完，否则比较的是两个失败').toBe('completed')

    // ③ 热点真的被栅格化了。**ops 恒为空有三条独立成因**（没 resize、热点在视锥外、
    //   运行时尺寸停在 1×1），任一条命中都会让两侧的 `[]` 相等。
    expect(ops.length, '热点一个 op 都没画出来 —— 两侧的空数组相等，证明不了任何事').toBeGreaterThan(0)
    expect(ops.some((op) => (op as { kind: string }).kind === 'marker'), 'ops 里没有 marker').toBe(true)

    // ④ 面板打开之后要有 panel op。
    //   ⚠ 断的是 `spriteLayer.ops` 里的 `kind: 'panel'`，**不是 `CaptureResult.panelCount`**
    //   ——后者今天两个分支都返回 0（scene-runtime.ts:1592），是个恒定值，断它等于没断。
    expect(ops.some((op) => (op as { kind: string }).kind.startsWith('panel')), 'openPanel 之后没有任何 panel op').toBe(true)

    // ⑤ 高亮真的落进了账本。
    expect(Object.values(highlights).some((v) => v !== null), '没有任何节点被高亮 —— 描边那条路径没被比过').toBe(true)
  })

  it('the document survives the .w3p round trip byte-for-byte', async () => {
    const doc = createGoldenPathDocument()
    const packed = packScene({
      document: doc,
      snapshotId: 'snp_parity01',
      publishedAt: '2026-07-31T00:00:00.000Z',
      coreVersion: '0.0.0',
      blobs: new Map([[doc.assets[0]!.hash, new Uint8Array(glb)]]),
    })
    const pkg = unpackScene(packed)

    // If this drifts, every parity assertion above is comparing two different documents
    // and the whole suite becomes meaningless without failing.
    expect(pkg.document).toEqual(doc)
    expect(pkg.manifest.schemaVersion).toBe(doc.schemaVersion)
    expect(pkg.blobs.get(doc.assets[0]!.hash)?.byteLength).toBe(glb.byteLength)
  })
})

/** ruleId + status + step statuses — the shape a human can actually diff. */
const summarise = (results: readonly ExecResult[]) =>
  results.map((r) => `${r.ruleId} ${r.status} [${r.steps.map((s) => `${s.action}:${s.status}`).join(',')}]`)

function formatMismatch(editor: readonly ExecResult[], player: readonly ExecResult[]): string {
  const a = summarise(editor)
  const b = summarise(player)
  const lines = ['编辑器预览与播放器的执行轨迹不一致（宪法 C3 被违反）：', '']
  const max = Math.max(a.length, b.length)
  for (let i = 0; i < max; i++) {
    const same = a[i] === b[i]
    lines.push(`${same ? '  ' : '✗ '}[${i}] 编辑器: ${a[i] ?? '（无）'}`)
    lines.push(`${same ? '  ' : '✗ '}[${i}] 播放器: ${b[i] ?? '（无）'}`)
  }
  lines.push('', 'ECA_SPEC §9.3：这条不过说明架构分叉了，停下来修架构，不要继续加功能。')
  return lines.join('\n')
}
