import type { Hotspot, SceneDocument } from '@w3/schema'
import type { HotspotPlacement, HotspotRenderer } from './hotspot-layer.js'
import {
  HOTSPOT_PANEL_SPEC,
  estimatePanelHeight,
  hotspotDrawOrder,
  markerGeometry,
  panelLayout,
} from './hotspot-visual.js'
import type { FontProvider } from './font-provider.js'
import { systemFontProvider } from './font-provider.js'

/**
 * T-265 · 把热点画进画布，而不是画在画布旁边。
 *
 * ## 为什么必须有这一层
 *
 * HTML 热点不在 canvas 里。`renderer.domElement.toDataURL()` 读不到它们一个像素，而
 * 出图要产出的东西是「设备说明书插图」——一张图上标着「①阀盖 ②叶轮 ③机封」，这正是
 * 渲染出图这个功能的头号用途（R06）。`hotspot-layer.ts` 从 v0 起就留了 `HotspotRenderer`
 * 这条缝，这个文件是缝的另一头。
 *
 * ## `ops` 是可观测输出，这是本文件最重要的设计
 *
 * 栅格化的结果同时写进两个地方：真的画进 2D context，**以及**记进一个 `DrawOp[]`。
 * 后者让整层可以在**纯 Node** 里被穷举——注入一个只记录调用的假 context，就能断言
 * 「画了几个标记、每个画在哪、文字是什么」，一个 GPU 都不需要。
 *
 * 这也是 parity 第一次够得到渲染层：`tick()` 先更新热点层再 `renderer?.render(...)`，
 * 热点层的更新与 renderer 在不在**无关**，所以 sprite 的栅格化可以在纯 Node 的 parity
 * 里真跑一遍。
 *
 * ## 与 DOM 版共用同一份规范
 *
 * 位置、尺寸、编号、绘制顺序、面板翻边全部来自 `hotspot-visual.ts`。**两边各写一份就是
 * C3 分叉的一种，而 parity 看不见它**——两侧都「有热点」，只是长得不一样。
 *
 * ## 连带后果（ADR-0025 写明）
 *
 * 这一层画在 `drawScene()` **之后**、以 `autoClear = false` 叠上去，所以：
 * **雾对热点无效、描边对热点无效**。合理（热点是标注，不是场景里的物体），但要写进
 * 面板文案，否则用户会以为是配置错了。
 */

/** 一次绘制操作。**顺序有意义**：数组顺序就是绘制顺序。 */
export type DrawOp =
  | {
      readonly kind: 'marker'
      readonly hotspotId: string
      readonly x: number
      readonly y: number
      readonly radius: number
      readonly alpha: number
      readonly color: string
      readonly label: string
    }
  | {
      readonly kind: 'panel'
      readonly hotspotId: string
      readonly x: number
      readonly y: number
      readonly width: number
      readonly height: number
    }
  | {
      readonly kind: 'panel-text'
      readonly hotspotId: string
      readonly role: 'title' | 'body'
      readonly x: number
      readonly y: number
      readonly text: string
    }
  | {
      readonly kind: 'media'
      readonly hotspotId: string
      readonly x: number
      readonly y: number
      readonly width: number
      readonly height: number
      /** 图解不出来时画一个占位块。**不是不画**——不画的话面板上会有一片莫名的空白。 */
      readonly placeholder: boolean
    }

/** 栅格化只需要 2D context 的这几个成员。**故意窄**，好让假 context 是十几行而不是一百行。 */
export interface Canvas2DLike {
  fillStyle: string
  strokeStyle: string
  lineWidth: number
  font: string
  textAlign: string
  textBaseline: string
  globalAlpha: number
  clearRect(x: number, y: number, w: number, h: number): void
  beginPath(): void
  arc(x: number, y: number, r: number, start: number, end: number): void
  fill(): void
  stroke(): void
  fillRect(x: number, y: number, w: number, h: number): void
  fillText(text: string, x: number, y: number): void
  drawImage(image: unknown, x: number, y: number, w: number, h: number): void
}

/** 一块能拿到 2D context、也能被 three 当贴图用的画布。 */
export interface SpriteCanvas {
  width: number
  height: number
  getContext(kind: '2d'): Canvas2DLike | null
}

export interface HotspotSpriteLayerOptions {
  /** 注入，照 `thumbnail.ts` 的模式：生产传 `document.createElement('canvas')`。 */
  readonly createCanvas: (width: number, height: number) => SpriteCanvas
  /** 解码一张媒体图片。拿不到就画占位块并 warn。 */
  readonly decodeImage?: (bytes: ArrayBuffer) => Promise<unknown>
  readonly font?: FontProvider
  readonly onWarn?: (message: string) => void
}

/**
 * 热点的 sprite 渲染器。
 *
 * 它实现 `HotspotRenderer`，所以运行时可以在两种渲染器之间换而不改任何调用点。
 */
export class HotspotSpriteLayer implements HotspotRenderer {
  private canvas: SpriteCanvas | null = null
  private drawn: DrawOp[] = []
  private readonly open = new Set<string>()
  private readonly media = new Map<string, { image: unknown | null }>()
  private readonly font: FontProvider
  private disposed = false

  constructor(private readonly options: HotspotSpriteLayerOptions) {
    this.font = options.font ?? systemFontProvider()
  }

  /**
   * 上一次 `update()` 画了些什么。
   *
   * **返回的是快照**：调用方拿到它之后再 `update()` 一次，手里那份不会跟着变。测试对着
   * 一个会变的数组做断言，是那种「单独跑绿、连着跑红」的形状。
   */
  get ops(): readonly DrawOp[] {
    return this.drawn
  }

  /** 当前贴图画布，供 `compose()` 之外的调用方读尺寸。 */
  get surface(): SpriteCanvas | null {
    return this.canvas
  }

  /** 字体来源，出图对话框显示它（T-267）。 */
  get fontSource(): string {
    return this.font.source
  }

  /** 面板开合由 ECA 动作驱动，与 DOM 版同一条链路。 */
  setPanelOpen(hotspot: Hotspot, open: boolean): void {
    if (open) this.open.add(hotspot.id)
    else this.open.delete(hotspot.id)
  }

  /**
   * 把一帧的热点画进画布，并记下画了什么。
   *
   * 画布尺寸由调用方通过 `resize()` 决定；没 resize 过就什么都不画——**不是猜一个尺寸**：
   * 猜错的话热点会画在图的错误位置上，而那看起来像「热点锚点配错了」。
   */
  update(placements: readonly HotspotPlacement[], doc: SceneDocument): void {
    if (this.disposed) return
    const ctx = this.canvas?.getContext('2d')
    if (!this.canvas || !ctx) {
      this.drawn = []
      return
    }

    const ops: DrawOp[] = []
    const byId = new Map(doc.hotspots.map((h) => [h.id, h]))
    const ordinalOf = new Map(doc.hotspots.map((h, i) => [h.id, i]))
    const canvasSize = { width: this.canvas.width, height: this.canvas.height }

    ctx.clearRect(0, 0, canvasSize.width, canvasSize.height)
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'

    // 与 DOM 版共用同一个比较器。远的先画，近的盖在上面。
    for (const placement of hotspotDrawOrder(placements)) {
      const hotspot = byId.get(placement.hotspotId)
      // 屏幕外的热点**一个 op 都不产生**。画一个 alpha 0 的标记同样看不见，但它会让
      // 「ops 恰好两条」这种断言失去意义，也白白花一次栅格化。
      if (!hotspot || !placement.onScreen) continue

      const geometry = markerGeometry(hotspot, placement, ordinalOf.get(hotspot.id) ?? 0)
      ctx.globalAlpha = geometry.alpha
      ctx.fillStyle = geometry.color
      ctx.strokeStyle = geometry.color
      ctx.lineWidth = geometry.strokeWidth
      ctx.beginPath()
      ctx.arc(geometry.x, geometry.y, geometry.radius, 0, Math.PI * 2)
      ctx.fill()
      // 描边真的画出来。`strokeWidth` 在规范里有值却从不 stroke 的话，那个字段就是装饰。
      if (geometry.strokeWidth > 0) {
        ctx.strokeStyle = '#12171a'
        ctx.stroke()
      }
      if (geometry.label !== '') {
        ctx.fillStyle = '#12171a'
        ctx.font = `${geometry.fontSize}px ${this.font.family}`
        ctx.fillText(geometry.label, geometry.x, geometry.y)
      }
      ops.push({
        kind: 'marker',
        hotspotId: hotspot.id,
        x: geometry.x,
        y: geometry.y,
        radius: geometry.radius,
        alpha: geometry.alpha,
        color: geometry.color,
        label: geometry.label,
      })

      if (this.open.has(hotspot.id)) ops.push(...this.drawPanel(ctx, hotspot, placement, canvasSize))
    }

    ctx.globalAlpha = 1
    this.drawn = ops
  }

  /** 面板与它的两行文字。媒体解不出来时画占位块。 */
  private drawPanel(
    ctx: Canvas2DLike,
    hotspot: Hotspot,
    placement: HotspotPlacement,
    canvasSize: { width: number; height: number },
  ): DrawOp[] {
    const height = estimatePanelHeight(hotspot.content)
    const layout = panelLayout(placement, canvasSize, height)
    const { padding, titleFontSize, bodyFontSize, lineHeight } = HOTSPOT_PANEL_SPEC

    ctx.globalAlpha = 1
    ctx.fillStyle = 'rgba(18, 23, 26, 0.92)'
    ctx.fillRect(layout.x, layout.y, layout.width, layout.height)

    const ops: DrawOp[] = [
      { kind: 'panel', hotspotId: hotspot.id, x: layout.x, y: layout.y, width: layout.width, height: layout.height },
    ]

    // 面板里的文字左对齐，与标记上的居中编号不同——所以每次都显式设一遍，
    // 而不是依赖上一次循环留下的状态。
    ctx.textAlign = 'left'
    ctx.textBaseline = 'top'
    ctx.fillStyle = '#e6eaed'

    const titleY = layout.y + padding
    ctx.font = `${titleFontSize}px ${this.font.family}`
    ctx.fillText(hotspot.content.title, layout.x + padding, titleY)
    ops.push({ kind: 'panel-text', hotspotId: hotspot.id, role: 'title', x: layout.x + padding, y: titleY, text: hotspot.content.title })

    const bodyY = titleY + lineHeight
    ctx.font = `${bodyFontSize}px ${this.font.family}`
    ctx.fillText(hotspot.content.text, layout.x + padding, bodyY)
    ops.push({ kind: 'panel-text', hotspotId: hotspot.id, role: 'body', x: layout.x + padding, y: bodyY, text: hotspot.content.text })

    if (hotspot.content.mediaId !== undefined) {
      const entry = this.media.get(hotspot.id)
      const mediaY = bodyY + lineHeight
      const mediaHeight = Math.max(0, layout.y + layout.height - padding - mediaY)
      const placeholder = !entry || entry.image === null
      if (placeholder) {
        // 占位块而不是不画：不画的话面板上是一片莫名的空白，而用户不知道那里本该有图。
        ctx.fillStyle = 'rgba(139, 150, 158, 0.35)'
        ctx.fillRect(layout.x + padding, mediaY, layout.width - padding * 2, mediaHeight)
      } else {
        ctx.drawImage(entry.image, layout.x + padding, mediaY, layout.width - padding * 2, mediaHeight)
      }
      ops.push({
        kind: 'media',
        hotspotId: hotspot.id,
        x: layout.x + padding,
        y: mediaY,
        width: layout.width - padding * 2,
        height: mediaHeight,
        placeholder,
      })
    }

    // 还原给下一个标记用的对齐方式。
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    return ops
  }

  /** 换画布尺寸。出图时调用方会先把它设成目标分辨率。 */
  resize(width: number, height: number): void {
    if (this.disposed) return
    const w = Math.max(1, Math.round(width))
    const h = Math.max(1, Math.round(height))
    if (this.canvas && this.canvas.width === w && this.canvas.height === h) return
    this.canvas = this.options.createCanvas(w, h)
    this.canvas.width = w
    this.canvas.height = h
  }

  /**
   * 等字体就绪，并把一张媒体图解码进缓存。
   *
   * **永不 reject**：字体加载失败退回系统栈，图解不出来画占位块。两种降级各 warn 一次。
   * 一张不完美的图好过一个「导出失败」。
   */
  async prepare(entries: readonly { hotspotId: string; bytes: ArrayBuffer }[] = []): Promise<void> {
    try {
      await this.font.ready()
    } catch (cause) {
      this.options.onWarn?.(`字体未能就绪，已改用系统字体导出：${cause instanceof Error ? cause.message : String(cause)}`)
    }

    for (const entry of entries) {
      try {
        const decode = this.options.decodeImage
        if (!decode) throw new Error('未注入 decodeImage')
        this.media.set(entry.hotspotId, { image: await decode(entry.bytes) })
      } catch (cause) {
        this.media.set(entry.hotspotId, { image: null })
        this.options.onWarn?.(
          `热点媒体解码失败，导出图中该处显示为占位块：${cause instanceof Error ? cause.message : String(cause)}`,
        )
      }
    }
  }

  dispose(): void {
    this.disposed = true
    this.drawn = []
    this.open.clear()
    this.media.clear()
    this.canvas = null
  }
}

/**
 * `compose()` 要用的材质参数，写成数据。
 *
 * ⚠ **三条都不是可选的，且只能靠属性断言守住**（卡面如实登记了这一点：这条测不了像素）：
 *
 * - `toneMapped: false` —— overlay 画在色调映射**之后**。让它再被映射一次，热点颜色
 *   与面板上选的那个色号对不上，而两次都「有颜色」。
 * - `depthTest: false` —— 热点是标注，不是场景里的物体。开深度测试的话它会被前面的
 *   几何挡住，而遮挡该由 `HotspotProjector` 的 raycast 决定（那是可以按每帧节流的），
 *   不是由深度缓冲决定。
 * - `transparent: true` —— 标记之外全是 alpha 0，不透明的话整块画布会盖住画面。
 */
export const HOTSPOT_SPRITE_MATERIAL = {
  toneMapped: false,
  depthTest: false,
  depthWrite: false,
  transparent: true,
} as const
