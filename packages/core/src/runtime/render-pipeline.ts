import type { SceneDocument } from '@w3/schema'
import { HalfFloatType, UnsignedByteType, WebGLRenderTarget } from 'three'
import type { Camera, Scene, WebGLRenderer } from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import type { RendererLike } from './renderer-like.js'

/**
 * T-235 · 后处理链的生命周期（ADR-0021）。
 *
 * ## 唯一的硬规矩：描边关着时，一行 target 都不建
 *
 * D31 与 ADR-0021 逐字要求「`enabled === false` 时 core 一个 RenderTarget 都不建、渲染
 * 路径与 v0.5 完全相同」。这不是省内存的优化，是**默认路径的可信度**：一份没开描边的
 * 文档在 v1.0 里走的必须是 v0.5 那条已经被 parity 与 E2E 跑过上千次的路，而不是一条
 * 「碰巧看起来一样」的新路。所以判据写在 `sync()` 的第一行，且验收断的是「composer
 * 工厂被调用 0 次」而不是「mode === 'direct'」——后者对一个建了 target 又不用的实现
 * 同样为真。
 */

/** `EffectComposer` 里本模块真正用到的那部分。 */
export interface ComposerLike {
  readonly passes: unknown[]
  addPass(pass: unknown): void
  /** T-240 · 描边层在某个预设的选中集清空时把那条 pass 摘掉，把名额还回去。 */
  removePass(pass: unknown): void
  render(deltaS?: number): void
  setSize(width: number, height: number): void
  dispose(): void
  readonly renderTarget1: { samples: number }
  readonly renderTarget2: { samples: number }
}

export interface ComposerContext {
  readonly renderer: RendererLike
  readonly scene: Scene
  readonly camera: Camera
  readonly width: number
  readonly height: number
  readonly pixelRatio: number
}

export interface RenderPipelineOptions {
  /**
   * 造 composer 的工厂。**单测必须注入**。
   *
   * 缺省实现会 `new EffectComposer(...)`，而那需要一个真 WebGL 上下文——在 Node 里跑
   * 会直接抛。注入口同时是本模块唯一的可观测点：验收里那条「默认文档下工厂被调用 0 次」
   * 靠的就是它。
   */
  readonly createComposer?: (ctx: ComposerContext) => ComposerLike
  readonly log?: (level: 'debug' | 'warn' | 'error', message: string, data?: unknown) => void
}

export type PipelineMode = 'direct' | 'composed'

export class RenderPipeline {
  private composer: ComposerLike | null = null
  /** `setPostFxEnabled` 的强制位。`null` = 跟文档走。 */
  private forced: boolean | null = null
  private lastContext: ComposerContext | null = null

  constructor(private readonly options: RenderPipelineOptions = {}) {}

  /** `'composed'` 当且仅当 composer 真的建起来了。 */
  get mode(): PipelineMode {
    return this.composer === null ? 'direct' : 'composed'
  }

  /**
   * 当前的 pass 链，直连时为空。
   *
   * 暴露它是为了让「`OutputPass` 固定在链尾」这件事可断言。**链尾不是风格问题**：
   * `OutputPass` 负责把线性空间的结果做色调映射并转回 sRGB，排在它后面的 pass 拿到的
   * 是已经转换过的颜色，再处理一次就是二次转换——画面整体偏灰，而所有单测全绿。
   */
  get passes(): readonly unknown[] {
    return this.composer?.passes ?? []
  }

  /**
   * 当前的 composer，直连时为 null。
   *
   * T-240 的 `OutlineLayer` 要往里 `addPass` / `removePass`。**只暴露这两个动作所需的
   * 那一小片**（`OutlineComposerLike`），而不是整个 composer——后者会让描边层拿到
   * `render()`，于是「谁负责画这一帧」这件事又有了第二个答案。
   */
  get composerHandle(): { addPass(pass: unknown): void; removePass(pass: unknown): void } | null {
    return this.composer
  }

  /**
   * 按文档建 / 拆 composer。可以反复调用，只在需要变时动作。
   *
   * @param doc 当前文档
   * @param ctx 渲染上下文。没有渲染器时传 `null`，此时一律拆掉
   */
  sync(doc: SceneDocument, ctx: ComposerContext | null): void {
    const wanted = ctx !== null && (this.forced ?? doc.meta.effects.outline.enabled)
    if (!wanted) {
      this.teardown()
      return
    }
    this.lastContext = ctx
    if (this.composer !== null) return

    const composer = this.options.createComposer?.(ctx)
    if (composer === undefined) {
      // 没有工厂就没有 composer。**不抛**：一个没注入工厂的宿主（今天的单测、将来的
      // 无头导出）应当安静地走直连路径，而不是因为文档里开了描边就崩掉。
      this.options.log?.('debug', '没有 composer 工厂，描边通道未建立，按直连渲染')
      return
    }
    this.composer = composer
  }

  /** 画一帧。**这里绝不出现 `renderer.render(`**——那一处收在 `SceneRuntime.drawScene()` 里。 */
  render(deltaS?: number): void {
    this.composer?.render(deltaS)
  }

  setSize(width: number, height: number): void {
    this.composer?.setSize(width, height)
    if (this.lastContext !== null) this.lastContext = { ...this.lastContext, width, height }
  }

  /**
   * benchmark 页用来对比「开 / 关描边」的帧率。
   *
   * @param enabled `true` / `false` 强制，`null` 交还给文档
   */
  setForced(enabled: boolean | null): void {
    this.forced = enabled
  }

  dispose(): void {
    this.teardown()
    this.lastContext = null
  }

  private teardown(): void {
    this.composer?.dispose()
    this.composer = null
  }
}

/**
 * 默认工厂：一条 `RenderPass → OutputPass` 的最小链。
 *
 * ## 两个 target 的 samples 必须分别设
 *
 * `rt1` 建成 `samples: 4`（MSAA），而 **`rt2` 必须显式设回 0**。
 * `EffectComposer` 用 `rt1.clone()` 造 `rt2`，而 `WebGLRenderTarget.copy()` 会把
 * `samples` 一起复制过去——于是两个多重采样目标之间的每一次 `swapBuffers` 都要做一次
 * resolve，白白多一遍带宽。只在 `rt1` 上开 MSAA、`rt2` 当普通中转，是 three 自己
 * 示例里的做法。
 *
 * ## 浮点缓冲不是必需品
 *
 * `HalfFloatType` 让色调映射前的中间结果保住高光细节。`EXT_color_buffer_float` 缺失时
 * 降级成 `UnsignedByteType` 并**说一声**——不降级会让 composer 在建 target 那一步就抛，
 * 用户看到的是黑屏；静默降级则会让「为什么这台机器上高光是灰的」永远查不出来。
 */
export function createDefaultComposer(ctx: ComposerContext, log?: RenderPipelineOptions['log']): ComposerLike {
  const renderer = ctx.renderer as unknown as WebGLRenderer
  const float = ctx.renderer.extensions.has('EXT_color_buffer_float')
  if (!float) {
    log?.('warn', '当前显卡不支持浮点帧缓冲（EXT_color_buffer_float），描边通道已降级为 8 位精度，高光细节会有损失')
  }

  const width = Math.max(1, Math.round(ctx.width * ctx.pixelRatio))
  const height = Math.max(1, Math.round(ctx.height * ctx.pixelRatio))
  const target = new WebGLRenderTarget(width, height, {
    type: float ? HalfFloatType : UnsignedByteType,
    samples: 4,
  })

  const composer = new EffectComposer(renderer, target)
  // **显式设回 0。** rt2 是 rt1 的 clone，而 copy() 把 samples 一起带过来了。
  composer.renderTarget2.samples = 0

  composer.addPass(new RenderPass(ctx.scene, ctx.camera))
  // 固定链尾。加新 pass 的人必须插在它之前 —— 见 `passes` 那段注释。
  composer.addPass(new OutputPass())

  return composer as unknown as ComposerLike
}
