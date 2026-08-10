import type { Hotspot, HotspotMarker } from '@w3/schema'
import type { HotspotPlacement } from './hotspot-layer.js'

/**
 * T-264 · 热点长什么样，写成数据。
 *
 * ## 这张卡为什么必须先于 sprite 层
 *
 * **热点的视觉表现从来没有 CSS**——全仓一行都没有。DOM 版靠几行内联样式活着，而那几行
 * 里连标记的大小都没设：`w3-hotspot--number` 这个类名指向一份不存在的样式表，编号那一支
 * 更是一行死代码（`marker.textContent = kind === 'number' ? '' : ''`，两个分支都是空串）。
 *
 * 也就是说「把 DOM 热点转成 sprite」在此之前**没有可对齐的目标**：没人知道一个热点应该
 * 多大、什么字号、编号从哪来。这份文件就是那个目标，两个渲染器读同一份。
 *
 * 零 DOM、零 three、零 canvas：它是纯数据加纯算术，跑在 C8 的纯 Node 里。
 */

/** 一种标记的几何规格。单位是 CSS 像素。 */
export interface MarkerSpec {
  /** 外圆半径。 */
  readonly radius: number
  /** 描边宽度。0 = 不描边。 */
  readonly strokeWidth: number
  /** 编号字号；不显示文字的标记为 0。 */
  readonly fontSize: number
  /**
   * 锚点相对标记中心的偏移，CSS 像素。
   *
   * `pin` 是一根图钉：它的尖端才是锚点，圆头在上方。所以它的中心要往上抬一个半径多，
   * 否则图钉会插在被标注的位置的正中间而不是指着它。
   */
  readonly anchorOffsetY: number
}

/**
 * 三种标记的规格。**三者的半径与字号互不相同**——这不是审美，是可断言的区分度：
 * 一份让 `dot` 与 `number` 长得一样大的规格，等于没有区分标记类型。
 */
export const HOTSPOT_MARKER_SPEC: Record<HotspotMarker, MarkerSpec> = {
  // 小圆点：只标位置，不承载信息，所以最小。
  dot: { radius: 6, strokeWidth: 2, fontSize: 0, anchorOffsetY: 0 },
  // 图钉：尖端指向锚点，圆头在上。
  pin: { radius: 9, strokeWidth: 2, fontSize: 0, anchorOffsetY: -11 },
  // 编号：要装得下两个字符（`12` / `A1`），所以最大且是唯一有字号的一种。
  number: { radius: 12, strokeWidth: 2, fontSize: 13, anchorOffsetY: 0 },
}

/** 被遮挡的标记的不透明度。0 = 完全隐藏。 */
export const HOTSPOT_OCCLUDED_OPACITY = 0.25

/** 面板尺寸与边距，CSS 像素。 */
export const HOTSPOT_PANEL_SPEC = {
  width: 260,
  /** 面板与标记之间的水平间隙。 */
  gap: 12,
  padding: 12,
  titleFontSize: 14,
  bodyFontSize: 12,
  lineHeight: 18,
  /** 估算高度时的最小值——一个只有标题的面板也要有可点的面积。 */
  minHeight: 64,
} as const

/** 一次标记绘制需要的全部几何。 */
export interface MarkerGeometry {
  readonly kind: HotspotMarker
  readonly radius: number
  readonly strokeWidth: number
  readonly fontSize: number
  /** 标记中心的屏幕坐标，已经吃掉了 `anchorOffsetY`。 */
  readonly x: number
  readonly y: number
  readonly color: string
  /** 要画的文字；`dot` / `pin` 是空串。 */
  readonly label: string
  /** 已经按遮挡算好的不透明度。 */
  readonly alpha: number
}

/**
 * 一个热点在屏幕上的标记几何。
 *
 * @param ordinal 该热点在文档 `hotspots` 数组里的下标，用来生成缺省编号
 */
export function markerGeometry(hotspot: Hotspot, placement: HotspotPlacement, ordinal: number): MarkerGeometry {
  const spec = HOTSPOT_MARKER_SPEC[hotspot.style.marker]
  return {
    kind: hotspot.style.marker,
    radius: spec.radius,
    strokeWidth: spec.strokeWidth,
    fontSize: spec.fontSize,
    x: placement.x,
    y: placement.y + spec.anchorOffsetY,
    color: hotspot.style.color,
    label: markerLabel(hotspot, ordinal),
    alpha: placement.occluded ? HOTSPOT_OCCLUDED_OPACITY : 1,
  }
}

/**
 * 标记上要显示的文字。
 *
 * `number` 标记优先用作者写死的 `style.label`，缺省才退回 1-based 序号（X-07）。
 * **理由值钱**：编号取下标会让删掉一个热点使它后面全部改号——而热点编号是印在客户的
 * 作业指导书上的。给它一个可写死的字段，删一个不动其余。
 *
 * 非 `number` 标记恒为空串：一个画着文字的小圆点不是小圆点。
 */
export function markerLabel(hotspot: Hotspot, ordinal: number): string {
  if (hotspot.style.marker !== 'number') return ''
  return hotspot.style.label ?? String(ordinal + 1)
}

/**
 * 标记的绘制顺序：**远的先画，近的后画**。
 *
 * 返回的是排序后的 placement 数组。近的后画意味着它盖在远的上面——这与 DOM 版的
 * `zIndex` 取值方向必须一致，否则同一份场景在导出图上和在屏幕上叠得不一样，
 * 而那是 C3 分叉的一种，parity 看不见（两侧都「有热点」）。
 */
export function hotspotDrawOrder(placements: readonly HotspotPlacement[]): HotspotPlacement[] {
  return [...placements].sort((a, b) => b.distance - a.distance)
}

/** 一个面板的位置与尺寸，CSS 像素。 */
export interface PanelLayout {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
  /** 面板翻到了标记的左侧。给调用方画小尾巴用。 */
  readonly flipped: boolean
}

/**
 * 面板放在标记的哪一侧。
 *
 * 默认放右边；**右边放不下就翻到左边**。不翻的话，靠近右边界的热点的面板会有一半在画布
 * 外——用户看到半句话，而且没有任何办法把它拉回来（面板位置不是可编辑的东西）。
 *
 * 上下同理夹在画布内，但不翻转：竖直方向上「贴着上边」和「贴着下边」都能读，翻转只会
 * 让面板在拖动相机时上下跳。
 */
export function panelLayout(
  placement: HotspotPlacement,
  canvas: { readonly width: number; readonly height: number },
  height: number = HOTSPOT_PANEL_SPEC.minHeight,
): PanelLayout {
  const { width, gap } = HOTSPOT_PANEL_SPEC
  const right = placement.x + gap
  // 翻边判据就是「放右边会超出右边界」。等号算超出：贴着边界的一列像素读起来已经不适。
  const flipped = right + width > canvas.width
  const x = flipped ? Math.max(0, placement.x - gap - width) : right
  const y = Math.min(Math.max(0, placement.y - height / 2), Math.max(0, canvas.height - height))
  return { x, y, width, height, flipped }
}

/**
 * 面板高度的估算：标题一行 + 正文按字符数折行。
 *
 * 估算而不是实测，因为 sprite 层在纯 Node 的 parity 里也要跑，那里没有 `measureText`。
 * 估得不准的代价是面板略高或略矮，估不出来的代价是 parity 覆盖不到栅格化层。
 */
export function estimatePanelHeight(content: { readonly title?: string; readonly text?: string }): number {
  const { width, padding, lineHeight, minHeight, bodyFontSize } = HOTSPOT_PANEL_SPEC
  // 一个汉字约占一个字号宽，英文约半个。按汉字算是保守的那一侧——宁可高一点。
  const perLine = Math.max(1, Math.floor((width - padding * 2) / bodyFontSize))
  const bodyLines = content.text ? Math.ceil(content.text.length / perLine) : 0
  const titleLines = content.title ? 1 : 0
  return Math.max(minHeight, padding * 2 + (titleLines + bodyLines) * lineHeight)
}
