import type { SceneDocument } from '@w3/schema'
import type { Camera, Scene } from 'three'
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
