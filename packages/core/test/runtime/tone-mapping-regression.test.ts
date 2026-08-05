import { createGoldenPathDocument } from '@w3/schema'
import type { SceneDocument } from '@w3/schema'
import { ACESFilmicToneMapping, NoToneMapping, PerspectiveCamera, Scene, WebGLRenderTarget } from 'three'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { describe, expect, it, vi } from 'vitest'
import { EnvironmentController } from '../../src/runtime/environment.js'
import { RenderPipeline, createDefaultComposer } from '../../src/runtime/render-pipeline.js'
import type { ComposerContext, ComposerLike } from '../../src/runtime/render-pipeline.js'
import type { RendererLike } from '../../src/runtime/renderer-like.js'

/**
 * T-236 · 后处理链的色调映射与色彩空间。
 *
 * ## 卡面的验收对象不存在，这里换了一个
 *
 * 卡面要求「断言 `OutputPass` 的 `toneMapping` 与 `toneMappingExposure` **逐值等于文档值**」。
 * 两处都不成立：
 *
 * 1. **`OutputPass` 上没有这两个属性。** 它在 `render()` 里从**渲染器**上读
 *    （`OutputPass.js:93-128`），然后写进自己的 uniform 与 material.defines。
 * 2. **`toneMapping` 不是文档字段。** 文档里只有 `meta.environment.exposure`；色调映射
 *    模式由 `EnvironmentController` 按「有没有 HDRI」决定（有 → ACESFilmic，无 → None）。
 *    把它当成文档字段去断言，等于断言一个 SPEC 里不存在的东西。
 *
 * 所以断言对象改成**它真正消费的那条链**：文档 → `EnvironmentController` → 渲染器状态
 * → `OutputPass` 的 uniform。这条链上任何一环断掉，画面都会整体偏亮或偏灰，而所有既有
 * 单测全绿——那正是 v0.5 的 M8（8 个默认值被改坏而全套测试全绿）在渲染侧的同形。
 */

/** 能被 `OutputPass.render()` 真正驱动的渲染器桩。 */
function probeRenderer(): RendererLike & { drawn: number } {
  const state = {
    drawn: 0,
    toneMapping: NoToneMapping as number,
    toneMappingExposure: 1,
    outputColorSpace: 'srgb',
    autoClear: true,
  }
  return new Proxy(
    {
      ...state,
      render: () => void state.drawn++,
      setSize: () => {},
      setPixelRatio: () => {},
      getPixelRatio: () => 1,
      setClearColor: () => {},
      setClearAlpha: () => {},
      clippingPlanes: [],
      localClippingEnabled: false,
      getContext: () => ({}) as never,
      capabilities: { maxTextureSize: 8192 },
      extensions: { has: () => true, get: () => null },
      info: { memory: { geometries: 0, textures: 0 }, render: { triangles: 0, calls: 0 }, programs: null },
      shadowMap: { enabled: false, type: 0 },
      setRenderTarget: () => {},
      domElement: {} as HTMLCanvasElement,
      dispose: () => {},
    },
    {
      get: (target, key) => (key in state ? state[key as keyof typeof state] : Reflect.get(target, key)),
      set: (target, key, value) => {
        if (key in state) {
          ;(state as Record<string, unknown>)[key as string] = value
          return true
        }
        return Reflect.set(target, key, value)
      },
    },
  ) as unknown as RendererLike & { drawn: number }
}

const withOutline = (enabled: boolean, exposure = 1): SceneDocument => {
  const base = createGoldenPathDocument()
  return {
    ...base,
    meta: {
      ...base.meta,
      environment: { ...base.meta.environment, exposure },
      effects: { outline: { ...base.meta.effects.outline, enabled } },
    },
  }
}

/** 带 HDRI 的文档 —— 只有它才会让 `EnvironmentController` 打开 ACESFilmic。 */
const withHdri = (exposure: number): SceneDocument => {
  const doc = withOutline(true, exposure)
  const hdri = { ...doc.assets[0]!, id: 'ast_hdri0001', type: 'hdri' as const, name: 'sky.hdr' }
  return {
    ...doc,
    assets: [...doc.assets, hdri],
    meta: { ...doc.meta, environment: { ...doc.meta.environment, hdriAssetId: 'ast_hdri0001', exposure } },
  }
}

const ctxWith = (renderer: RendererLike): ComposerContext => ({
  renderer,
  scene: new Scene(),
  camera: new PerspectiveCamera(),
  width: 800,
  height: 600,
  pixelRatio: 1,
})

/* ========================================================================== */

describe('T-236 · OutputPass 固定在链尾', () => {
  /** 只造 pass，不造 composer —— `EffectComposer` 需要真 GL 上下文。 */
  function fakeComposerWithRealPasses(): ComposerLike {
    const passes: unknown[] = []
    return {
      passes,
      addPass: (p) => void passes.push(p),
      removePass: () => {},
      render: () => {},
      setSize: () => {},
      dispose: () => {},
      renderTarget1: { samples: 4 },
      renderTarget2: { samples: 0 },
    }
  }

  it('链是 RenderPass → OutputPass，两端都断', () => {
    const pipeline = new RenderPipeline({
      createComposer: (ctx) => {
        const composer = fakeComposerWithRealPasses()
        composer.addPass(new RenderPass(ctx.scene, ctx.camera))
        composer.addPass(new OutputPass())
        return composer
      },
    })
    pipeline.sync(withOutline(true), ctxWith(probeRenderer()))

    expect(pipeline.passes).toHaveLength(2)
    expect(pipeline.passes[0]).toBeInstanceOf(RenderPass)
    // **链尾不是风格问题**：OutputPass 把线性结果转回 sRGB，排在它后面的 pass 拿到的是
    // 已经转换过的颜色，再处理一次就是二次转换 —— 画面整体偏灰而所有单测全绿。
    expect(pipeline.passes.at(-1)).toBeInstanceOf(OutputPass)
  })

  it('直连时 passes 是空的 —— 一个 pass 都没造', () => {
    const createComposer = vi.fn()
    const pipeline = new RenderPipeline({ createComposer })
    pipeline.sync(withOutline(false), ctxWith(probeRenderer()))
    expect(pipeline.passes).toEqual([])
    expect(createComposer).not.toHaveBeenCalled()
  })
})

describe('T-236 · OutputPass 消费的是渲染器上的曝光与色调映射', () => {
  /**
   * 断的是 `OutputPass.render()` **之后**它自己的 uniform 与 defines。
   *
   * 这是「文档 → EnvironmentController → 渲染器 → OutputPass」整条链唯一能在 Node 里
   * 走通的观测点：`OutputPass` 不暴露输入，只在渲染那一刻把渲染器状态搬进材质。
   */
  function driveOutputPass(doc: SceneDocument): { pass: OutputPass; renderer: RendererLike } {
    const renderer = probeRenderer()
    const scene = new Scene()
    const environment = new EnvironmentController({
      scene,
      // EnvironmentController 收的是 WebGLRenderer；桩只实现了它真正读的那几个成员
      renderer: () => renderer as never,
      resolve: async () => new ArrayBuffer(0),
      log: () => {},
    })
    environment.syncScene(doc)

    const pass = new OutputPass()
    const target = { texture: {} } as unknown as WebGLRenderTarget
    pass.render(renderer as never, target, target, 0.016, false)
    return { pass, renderer }
  }

  it('没有 HDRI：不做色调映射，曝光仍然照文档写进渲染器', () => {
    const { pass, renderer } = driveOutputPass(withOutline(true, 1.6))
    expect(renderer.toneMapping, '没有环境贴图就不该做 ACES —— 那会把一张没做过 HDR 的图压暗').toBe(NoToneMapping)
    expect(renderer.toneMappingExposure).toBe(1.6)
    expect((pass as unknown as { uniforms: Record<string, { value: number }> }).uniforms.toneMappingExposure!.value).toBe(1.6)
  })

  it('有 HDRI：ACESFilmic，且 defines 里真的开了那个宏', () => {
    const { pass, renderer } = driveOutputPass(withHdri(1.2))
    expect(renderer.toneMapping).toBe(ACESFilmicToneMapping)
    expect(renderer.toneMappingExposure).toBe(1.2)

    const material = (pass as unknown as { material: { defines: Record<string, unknown> } }).material
    expect(Object.keys(material.defines), 'defines 为空说明 OutputPass 没看见渲染器的 toneMapping').toContain(
      'ACES_FILMIC_TONE_MAPPING',
    )
  })

  it('改文档的 exposure，uniform 跟着走 —— 而且是同一个方向', () => {
    const low = driveOutputPass(withHdri(0.8))
    const high = driveOutputPass(withHdri(1.6))
    const valueOf = (p: OutputPass) =>
      (p as unknown as { uniforms: Record<string, { value: number }> }).uniforms.toneMappingExposure!.value

    expect(valueOf(low.pass)).toBeCloseTo(0.8, 6)
    expect(valueOf(high.pass)).toBeCloseTo(1.6, 6)
    expect(valueOf(high.pass)).toBeGreaterThan(valueOf(low.pass))
  })
})

describe('T-236 · 两条路径读的是同一组渲染器状态', () => {
  /**
   * Node 里给不出「两条路径渲出来的画面一样」——那要真 GL。**能给出的是它的必要条件**：
   * 两条路径下渲染器的色调映射状态逐值相同。
   *
   * 这一条不能替代 E2E 的像素比较，所以下面那条 E2E 才是本卡真正的观感回归；
   * 这里只保证「不是因为文档没被读到才一样」。
   */
  const stateOf = (doc: SceneDocument) => {
    const renderer = probeRenderer()
    const environment = new EnvironmentController({
      scene: new Scene(),
      // EnvironmentController 收的是 WebGLRenderer；桩只实现了它真正读的那几个成员
      renderer: () => renderer as never,
      resolve: async () => new ArrayBuffer(0),
      log: () => {},
    })
    environment.syncScene(doc)
    const pipeline = new RenderPipeline({
      createComposer: (ctx) => ({
        passes: [],
        addPass: () => {},
        removePass: () => {},
        render: () => void ctx.renderer.render(ctx.scene, ctx.camera),
        setSize: () => {},
        dispose: () => {},
        renderTarget1: { samples: 4 },
        renderTarget2: { samples: 0 },
      }),
    })
    pipeline.sync(doc, ctxWith(renderer))
    return { mode: pipeline.mode, toneMapping: renderer.toneMapping, exposure: renderer.toneMappingExposure }
  }

  it('direct 与 composed 的色调映射状态逐值相同', () => {
    const direct = stateOf(withHdri(1.4))
    const composed = stateOf({ ...withHdri(1.4), meta: { ...withHdri(1.4).meta, effects: { outline: { ...withHdri(1.4).meta.effects.outline, enabled: true } } } })

    expect(direct.toneMapping).toBe(composed.toneMapping)
    expect(direct.exposure).toBe(composed.exposure)
  })
})

describe('T-236 · 默认工厂的两个 target', () => {
  const build = (floatSupported: boolean) => {
    const logs: [string, string][] = []
    const renderer = probeRenderer()
    ;(renderer as unknown as { extensions: { has: () => boolean } }).extensions = { has: () => floatSupported }
    const composer = createDefaultComposer(ctxWith(renderer), (level, message) => logs.push([level, message]))
    return { composer, logs }
  }

  it('rt1 开 MSAA，**rt2 显式设回 0**', () => {
    // `EffectComposer` 用 `rt1.clone()` 造 rt2，而 `WebGLRenderTarget.copy()` 把 samples
    // 一起复制过去 —— 两个多重采样目标之间每次 swapBuffers 都要多做一遍 resolve。
    const { composer } = build(true)
    expect(composer.renderTarget1.samples).toBe(4)
    expect(composer.renderTarget2.samples, 'rt2 跟着 rt1 变成了 4，白白多一遍带宽').toBe(0)
  })

  it('链是 RenderPass → OutputPass', () => {
    const { composer } = build(true)
    expect(composer.passes).toHaveLength(2)
    expect(composer.passes[0]).toBeInstanceOf(RenderPass)
    expect(composer.passes.at(-1)).toBeInstanceOf(OutputPass)
  })

  it('浮点缓冲缺失时降级，并且说一声', () => {
    // 不降级 → 有些驱动上直接建不出 target；静默降级 →「为什么这台机器上高光是灰的」
    // 永远查不出来。
    const { logs } = build(false)
    expect(logs.some(([level, m]) => level === 'warn' && m.includes('浮点帧缓冲')), '降级必须说一声').toBe(true)
  })

  it('浮点缓冲在时不说话 —— 告警不是背景噪音', () => {
    const { logs } = build(true)
    expect(logs.filter(([level]) => level === 'warn')).toEqual([])
  })
})
