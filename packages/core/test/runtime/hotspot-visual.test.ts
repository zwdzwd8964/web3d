import type { Hotspot, SceneDocument } from '@w3/schema'
import { createGoldenPathDocument } from '@w3/schema'
import { describe, expect, it } from 'vitest'
import { CameraController } from '../../src/runtime/camera-controller.js'
import { DomHotspotRenderer, HotspotProjector } from '../../src/runtime/hotspot-layer.js'
import { SceneGraph } from '../../src/runtime/scene-graph.js'
import { createPumpAsset } from './fixtures.js'
import type { HotspotPlacement } from '../../src/runtime/hotspot-layer.js'
import {
  HOTSPOT_MARKER_SPEC,
  HOTSPOT_OCCLUDED_OPACITY,
  HOTSPOT_PANEL_SPEC,
  estimatePanelHeight,
  hotspotDrawOrder,
  markerGeometry,
  markerLabel,
  panelLayout,
} from '../../src/runtime/hotspot-visual.js'

/**
 * T-264 · 热点视觉规范。
 *
 * ## 这份规范之前根本不存在
 *
 * 热点的视觉表现**全仓一行 CSS 都没有**。DOM 版靠几行内联样式活着，而那几行里连标记
 * 大小都没设；`w3-hotspot--number` 指向一份不存在的样式表；编号那一支是一行死代码
 * （`marker.textContent = kind === 'number' ? '' : ''`，两个分支都是空串）。
 *
 * 所以「把 DOM 热点转成 sprite」在此之前没有可对齐的目标。下面的断言都是**逐值**的，
 * 不是 `not.toBeNull()`：一份让三种标记长得一样大的规格，等于没有区分标记类型，而
 * 「返回了一个对象」对此完全无感。
 */

const placement = (patch: Partial<HotspotPlacement> = {}): HotspotPlacement => ({
  hotspotId: 'hs_00000001',
  onScreen: true,
  occluded: false,
  x: 100,
  y: 200,
  distance: 5,
  ...patch,
})

const hotspot = (patch: Partial<Hotspot['style']> = {}, id = 'hs_00000001'): Hotspot =>
  ({
    id,
    name: '热点',
    anchor: { nodeId: 'nd_00000001', offset: [0, 0, 0] },
    occlude: true,
    visible: true,
    fadeWithDistance: false,
    content: { type: 'panel', title: '第一步', text: '松开六颗固定螺栓后抬起阀盖。' },
    style: { marker: 'dot', color: '#ffb020', ...patch },
  }) as Hotspot

describe('T-264 · 三种标记的规格互不相同', () => {
  it('半径与字号逐值不同 —— 不是「返回了一个对象」', () => {
    const { dot, pin, number } = HOTSPOT_MARKER_SPEC
    // 逐值断言：一份让 dot 与 number 一样大的规格等于没有区分标记类型。
    expect(dot.radius).toBe(6)
    expect(pin.radius).toBe(9)
    expect(number.radius).toBe(12)
    expect(new Set([dot.radius, pin.radius, number.radius]).size, '三个半径必须互不相同').toBe(3)

    // 只有 number 有字号：一个画着文字的小圆点不是小圆点。
    expect(dot.fontSize).toBe(0)
    expect(pin.fontSize).toBe(0)
    expect(number.fontSize).toBe(13)
  })

  it('只有 pin 把锚点偏到尖端 —— 它是一根图钉，尖端才是被标注的位置', () => {
    expect(HOTSPOT_MARKER_SPEC.dot.anchorOffsetY).toBe(0)
    expect(HOTSPOT_MARKER_SPEC.number.anchorOffsetY).toBe(0)
    expect(HOTSPOT_MARKER_SPEC.pin.anchorOffsetY).toBeLessThan(0)
  })

  it('markerGeometry 把偏移吃进 y，x 原样', () => {
    const geometry = markerGeometry(hotspot({ marker: 'pin' }), placement(), 0)
    expect(geometry.x).toBe(100)
    expect(geometry.y).toBe(200 + HOTSPOT_MARKER_SPEC.pin.anchorOffsetY)
  })

  it('遮挡时 alpha 落到常量，不遮挡时是 1', () => {
    expect(markerGeometry(hotspot(), placement({ occluded: true }), 0).alpha).toBe(HOTSPOT_OCCLUDED_OPACITY)
    expect(markerGeometry(hotspot(), placement({ occluded: false }), 0).alpha).toBe(1)
  })
})

describe('T-264 · markerLabel', () => {
  it('第三个热点没写 label → 显示 3（1-based 序号）', () => {
    expect(markerLabel(hotspot({ marker: 'number' }), 2)).toBe('3')
  })

  it('写死了 label → 显示它，序号不参与', () => {
    // 理由值钱：编号取下标会让删掉一个热点使它后面**全部**改号，而热点编号是印在
    // 客户的作业指导书上的。
    expect(markerLabel(hotspot({ marker: 'number', label: 'A1' }), 2)).toBe('A1')
  })

  it('非 number 标记恒为空串，哪怕写了 label', () => {
    expect(markerLabel(hotspot({ marker: 'dot', label: 'A1' }), 0)).toBe('')
    expect(markerLabel(hotspot({ marker: 'pin', label: 'A1' }), 0)).toBe('')
  })
})

describe('T-264 · hotspotDrawOrder', () => {
  it('距离 [5,1,9] → [9,5,1]：远的先画，近的盖在上面', () => {
    const order = hotspotDrawOrder([placement({ distance: 5 }), placement({ distance: 1 }), placement({ distance: 9 })])
    expect(order.map((p) => p.distance)).toEqual([9, 5, 1])
  })

  it('不改原数组 —— 调用方传进来的是 readonly', () => {
    const input = [placement({ distance: 1 }), placement({ distance: 9 })]
    hotspotDrawOrder(input)
    expect(input.map((p) => p.distance)).toEqual([1, 9])
  })
})

describe('T-264 · panelLayout 的翻边', () => {
  const canvas = { width: 1280, height: 720 }

  it('放得下时在标记右侧', () => {
    const layout = panelLayout(placement({ x: 100 }), canvas)
    expect(layout.flipped).toBe(false)
    expect(layout.x).toBe(100 + HOTSPOT_PANEL_SPEC.gap)
  })

  it('靠近右边界时翻到左侧，且整块面板在画布内', () => {
    const layout = panelLayout(placement({ x: 1200 }), canvas)
    expect(layout.flipped).toBe(true)
    // 卡面点名的判据。不翻的话面板有一半在画布外，用户看到半句话。
    expect(layout.x + layout.width).toBeLessThanOrEqual(canvas.width)
    expect(layout.x).toBeGreaterThanOrEqual(0)
  })

  it('竖直方向夹在画布内，但不翻转', () => {
    expect(panelLayout(placement({ y: -500 }), canvas).y).toBe(0)
    const low = panelLayout(placement({ y: 5000 }), canvas, 100)
    expect(low.y).toBe(canvas.height - 100)
  })

  it('画布比面板还窄时不给出负坐标', () => {
    const layout = panelLayout(placement({ x: 10 }), { width: 100, height: 100 })
    expect(layout.x).toBeGreaterThanOrEqual(0)
    expect(layout.y).toBeGreaterThanOrEqual(0)
  })
})

describe('T-264 · estimatePanelHeight', () => {
  it('正文越长越高，且不低于下限', () => {
    const short = estimatePanelHeight({ title: '第一步', text: '短' })
    const long = estimatePanelHeight({ title: '第一步', text: '很长'.repeat(200) })
    expect(short).toBe(HOTSPOT_PANEL_SPEC.minHeight)
    expect(long).toBeGreaterThan(short)
  })

  it('空内容也有可点的面积', () => {
    expect(estimatePanelHeight({})).toBe(HOTSPOT_PANEL_SPEC.minHeight)
  })
})

/* -------------------------------------------------------------------------- */
/* DOM 渲染器：接上规范之后的行为                                                */
/* -------------------------------------------------------------------------- */

/**
 * ⚠ **用 Node 里的 DOM 桩，不用 jsdom。**
 *
 * 卡面写的是「jsdom 断 number 标记 `textContent === '3'`」，而 core 的 vitest 环境是
 * `environment: 'node'`（C8：引擎无显卡可测），`DomHotspotRenderer` 现有的那份测试
 * （`hotspot-media.test.ts`）用的就是下面这种桩。给 core 引入一个 jsdom 文件会开一个
 * 新先例，而它买到的东西这里一样都不缺——要断的是 `textContent` 与几个 `style` 字段，
 * 桩全都记得下来。差异登记在 MUTATIONS。
 */

interface StubElement {
  className: string
  textContent: string
  readonly dataset: Record<string, string>
  readonly style: Record<string, string> & { setProperty(name: string, value: string): void }
  readonly children: StubElement[]
  readonly tag: string
  clientWidth: number
  clientHeight: number
  appendChild(child: StubElement): void
  append(...children: StubElement[]): void
  remove(): void
  addEventListener(): void
  querySelector(selector: string): StubElement | null
  ownerDocument: { createElement(tag: string): StubElement }
}

function stubElement(tag: string): StubElement {
  const element: StubElement = {
    tag,
    className: '',
    textContent: '',
    dataset: {},
    // `--w3-hotspot-color` 是自定义属性，渲染器走 setProperty 写它。
    style: Object.assign(Object.create(null) as Record<string, string>, {
      setProperty(name: string, value: string) {
        ;(this as unknown as Record<string, string>)[name] = value
      },
    }),
    children: [],
    clientWidth: 1280,
    clientHeight: 720,
    appendChild(child) {
      element.children.push(child)
    },
    append(...children) {
      element.children.push(...children)
    },
    remove() {
      /* detached from a parent this stub does not model */
    },
    addEventListener() {
      /* the renderer wires a click handler it never fires here */
    },
    querySelector(selector) {
      return element.children.find((c) => c.tag === selector) ?? null
    },
    ownerDocument: { createElement: stubElement },
  }
  return element
}

/** 一份带 N 个 number 热点的文档。 */
function docWithHotspots(count: number, styles: Partial<Hotspot['style']>[] = []): SceneDocument {
  const base = createGoldenPathDocument()
  const hotspots = Array.from({ length: count }, (_, i) =>
    hotspot({ marker: 'number', ...(styles[i] ?? {}) }, `hs_0000000${i + 1}`),
  )
  return { ...base, hotspots } as SceneDocument
}

describe('T-264 · DOM 渲染器读同一份规范', () => {
  it('第三个热点（无显式 label）的标记文字是 「3」', () => {
    // 在此之前这里是 `marker.textContent = kind === 'number' ? '' : ''` —— 两个分支都是
    // 空串，number 标记从来没有显示过编号。
    const container = stubElement('div')
    const renderer = new DomHotspotRenderer({ container: container as unknown as HTMLElement })
    const doc = docWithHotspots(3)

    renderer.update(
      doc.hotspots.map((h, i) => placement({ hotspotId: h.id, distance: i + 1 })),
      doc,
    )

    const third = container.children.find((c) => c.dataset['hotspotId'] === 'hs_00000003')
    expect(third?.textContent).toBe('3')
  })

  it('写死了编号的那个显示 「A1」，且不影响别人的序号', () => {
    const container = stubElement('div')
    const renderer = new DomHotspotRenderer({ container: container as unknown as HTMLElement })
    const doc = docWithHotspots(3, [{}, { label: 'A1' }, {}])

    renderer.update(
      doc.hotspots.map((h, i) => placement({ hotspotId: h.id, distance: i + 1 })),
      doc,
    )

    const byId = (id: string) => container.children.find((c) => c.dataset['hotspotId'] === id)?.textContent
    expect(byId('hs_00000002')).toBe('A1')
    // 删一个不动其余：第三个仍然是 3，不因为第二个写死了而变成别的。
    expect(byId('hs_00000003')).toBe('3')
  })

  it('三种标记写出三种不同的尺寸', () => {
    const container = stubElement('div')
    const renderer = new DomHotspotRenderer({ container: container as unknown as HTMLElement })
    const base = createGoldenPathDocument()
    const doc = {
      ...base,
      hotspots: [
        hotspot({ marker: 'dot' }, 'hs_00000001'),
        hotspot({ marker: 'pin' }, 'hs_00000002'),
        hotspot({ marker: 'number' }, 'hs_00000003'),
      ],
    } as SceneDocument

    renderer.update(
      doc.hotspots.map((h, i) => placement({ hotspotId: h.id, distance: i + 1 })),
      doc,
    )

    const widthOf = (id: string) => container.children.find((c) => c.dataset['hotspotId'] === id)?.style['width']
    expect(widthOf('hs_00000001')).toBe(`${HOTSPOT_MARKER_SPEC.dot.radius * 2}px`)
    expect(widthOf('hs_00000002')).toBe(`${HOTSPOT_MARKER_SPEC.pin.radius * 2}px`)
    expect(widthOf('hs_00000003')).toBe(`${HOTSPOT_MARKER_SPEC.number.radius * 2}px`)
  })

  it('遮挡的标记按常量变淡', () => {
    const container = stubElement('div')
    const renderer = new DomHotspotRenderer({ container: container as unknown as HTMLElement })
    const doc = docWithHotspots(1)
    renderer.update([placement({ hotspotId: 'hs_00000001', occluded: true })], doc)
    expect(container.children[0]?.style['opacity']).toBe(String(HOTSPOT_OCCLUDED_OPACITY))
  })
})

/* -------------------------------------------------------------------------- */
/* forceOcclusion：出图那一帧不许沿用旧判定                                      */
/* -------------------------------------------------------------------------- */

describe('T-264 · HotspotProjector.forceOcclusion', () => {
  function wire() {
    const graph = new SceneGraph({ assets: createPumpAsset().source })
    graph.build(createGoldenPathDocument())
    const camera = new CameraController(graph, { aspect: 1 })
    camera.orbit.target.set(0, 0, 0)
    camera.orbit.theta = Math.PI / 2
    camera.orbit.phi = Math.PI / 2
    camera.orbit.distance = 5
    camera.apply()
    return { graph, camera, doc: createGoldenPathDocument() }
  }

  it('第 2 帧本该沿用旧判定，forceOcclusion 让它照样 raycast', () => {
    // 出图发生在某一个任意的帧上，而遮挡状态最多可能是 N-1 帧之前的——那意味着导出图上
    // 某个热点的明暗与用户按下按钮时看到的不一样，且不可复现。
    const { graph, camera, doc } = wire()
    const projector = new HotspotProjector(graph, { occlusionInterval: 3 })

    projector.update(doc, camera.camera, 800, 600)
    expect(projector.lastRaycastCount, '前提：第 1 帧本来就会 raycast').toBe(1)

    projector.update(doc, camera.camera, 800, 600)
    expect(projector.lastRaycastCount, '前提：第 2 帧沿用旧判定').toBe(0)

    // 同样是第 3 帧（frame % 3 === 0，本该沿用），加上 forceOcclusion 就必须真射。
    projector.update(doc, camera.camera, 800, 600, { forceOcclusion: true })
    expect(projector.lastRaycastCount).toBeGreaterThan(0)
  })

  it('不传 forceOcclusion 时行为逐字不变 —— 老调用点零影响', () => {
    const { graph, camera, doc } = wire()
    const projector = new HotspotProjector(graph, { occlusionInterval: 3 })
    projector.update(doc, camera.camera, 800, 600)
    projector.update(doc, camera.camera, 800, 600, {})
    expect(projector.lastRaycastCount, '空 options 不该等于 forceOcclusion').toBe(0)
  })
})
