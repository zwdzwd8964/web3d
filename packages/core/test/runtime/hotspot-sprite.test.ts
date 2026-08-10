import type { Hotspot, SceneDocument } from '@w3/schema'
import { createGoldenPathDocument } from '@w3/schema'
import { describe, expect, it, vi } from 'vitest'
import type { HotspotPlacement } from '../../src/runtime/hotspot-layer.js'
import { HOTSPOT_SPRITE_MATERIAL, HotspotSpriteLayer } from '../../src/runtime/hotspot-sprite.js'
import type { Canvas2DLike, DrawOp, HotspotSpriteLayerOptions, SpriteCanvas } from '../../src/runtime/hotspot-sprite.js'
import { HOTSPOT_MARKER_SPEC, HOTSPOT_OCCLUDED_OPACITY, hotspotDrawOrder } from '../../src/runtime/hotspot-visual.js'
import { SYSTEM_FONT_STACK, systemFontProvider, withSystemFallback } from '../../src/runtime/font-provider.js'

/**
 * T-265 · 热点 sprite 层。
 *
 * ## 全纯 Node，靠一个只记录调用的假 2D context
 *
 * 栅格化的结果同时写进两个地方：真的调 context，**以及**记进 `ops`。所以「画了几个标记、
 * 每个画在哪、文字是什么」在没有 GPU、没有 DOM 的情况下全部可断言。
 *
 * ## 断参数，不只断「调用了」
 *
 * 卡面点名了这条：**「断言调用了 fillText 但不断言参数」是这类测试最常见的假绿**。
 * 一个把面板正文写成 `hotspot.id` 的实现在那种断言下完全绿，而导出的图上每个面板都
 * 印着一串 `hs_00000001`。所以下面的文字断言全部是 `toBe(hotspot.content.text)` 逐字比。
 */

/* -------------------------------------------------------------------------- */
/* 假 context                                                                   */
/* -------------------------------------------------------------------------- */

interface Recorded {
  readonly calls: string[]
  readonly ctx: Canvas2DLike
}

function fakeContext(): Recorded {
  const calls: string[] = []
  const ctx: Canvas2DLike = {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 0,
    font: '',
    textAlign: '',
    textBaseline: '',
    globalAlpha: 1,
    clearRect: (...a) => void calls.push(`clearRect(${a.join(',')})`),
    beginPath: () => void calls.push('beginPath()'),
    arc: (...a) => void calls.push(`arc(${a.join(',')})`),
    fill: () => void calls.push('fill()'),
    stroke: () => void calls.push('stroke()'),
    fillRect: (...a) => void calls.push(`fillRect(${a.join(',')})`),
    fillText: (text, x, y) => void calls.push(`fillText(${text},${x},${y})`),
    drawImage: (_i, ...a) => void calls.push(`drawImage(${a.join(',')})`),
  }
  return { calls, ctx }
}

function wire(options: Partial<Omit<HotspotSpriteLayerOptions, 'createCanvas'>> = {}) {
  const recorded = fakeContext()
  const canvases: SpriteCanvas[] = []
  const layer = new HotspotSpriteLayer({
    createCanvas: (width, height) => {
      const canvas: SpriteCanvas = { width, height, getContext: () => recorded.ctx }
      canvases.push(canvas)
      return canvas
    },
    ...options,
  })
  layer.resize(1280, 720)
  return { layer, recorded, canvases }
}

/* -------------------------------------------------------------------------- */
/* 场景                                                                         */
/* -------------------------------------------------------------------------- */

const placement = (patch: Partial<HotspotPlacement>): HotspotPlacement => ({
  hotspotId: 'hs_00000001',
  onScreen: true,
  occluded: false,
  x: 100,
  y: 200,
  distance: 5,
  ...patch,
})

function hotspot(id: string, patch: Partial<Hotspot> = {}): Hotspot {
  return {
    id,
    name: `热点 ${id}`,
    anchor: { nodeId: 'nd_00000001', offset: [0, 0, 0] },
    occlude: true,
    visible: true,
    fadeWithDistance: false,
    content: { type: 'panel', title: '第一步', text: '松开六颗固定螺栓后抬起阀盖。' },
    style: { marker: 'dot', color: '#ffb020' },
    ...patch,
  } as Hotspot
}

/** 三个热点：一个正常、一个屏幕外、一个被遮挡。 */
function threeHotspots(): { doc: SceneDocument; placements: HotspotPlacement[] } {
  const doc = {
    ...createGoldenPathDocument(),
    hotspots: [hotspot('hs_00000001'), hotspot('hs_00000002'), hotspot('hs_00000003')],
  } as SceneDocument
  return {
    doc,
    placements: [
      placement({ hotspotId: 'hs_00000001', x: 100, y: 200, distance: 5 }),
      placement({ hotspotId: 'hs_00000002', onScreen: false, x: -50, y: 200, distance: 3 }),
      placement({ hotspotId: 'hs_00000003', occluded: true, x: 400, y: 300, distance: 9 }),
    ],
  }
}

const markers = (ops: readonly DrawOp[]) => ops.filter((o) => o.kind === 'marker')

/* -------------------------------------------------------------------------- */

describe('T-265 · 画了什么', () => {
  it('三个热点（正常 / 屏幕外 / 被遮挡）→ 恰好两条 marker，被遮挡那条 alpha 是 0.25', () => {
    const { layer } = wire()
    const { doc, placements } = threeHotspots()
    layer.update(placements, doc)

    const drawn = markers(layer.ops)
    // 「恰好两条」：屏幕外的热点**一个 op 都不产生**。画一个 alpha 0 的标记同样看不见，
    // 但它会让这条断言失去意义，也白白花一次栅格化。
    expect(drawn).toHaveLength(2)
    expect(drawn.map((m) => m.hotspotId)).not.toContain('hs_00000002')
    expect(drawn.find((m) => m.hotspotId === 'hs_00000003')?.alpha).toBe(HOTSPOT_OCCLUDED_OPACITY)
    expect(drawn.find((m) => m.hotspotId === 'hs_00000001')?.alpha).toBe(1)
  })

  it('marker 的 x/y 与 placement 的 x/y **逐字相等** —— 防「画了但位置错」', () => {
    const { layer } = wire()
    const { doc, placements } = threeHotspots()
    layer.update(placements, doc)

    // 用 dot 标记：它的 anchorOffsetY 是 0，所以 marker 坐标应当与 placement 一模一样。
    expect(HOTSPOT_MARKER_SPEC.dot.anchorOffsetY, '这条断言的前提').toBe(0)
    const first = markers(layer.ops).find((m) => m.hotspotId === 'hs_00000001')
    expect(first?.x).toBe(100)
    expect(first?.y).toBe(200)
  })

  it('pin 的 y 按规范偏移 —— 证明上一条不是「坐标原样抄过去」', () => {
    const { layer } = wire()
    const doc = { ...createGoldenPathDocument(), hotspots: [hotspot('hs_00000001', { style: { marker: 'pin', color: '#fff' } as Hotspot['style'] })] } as SceneDocument
    layer.update([placement({ hotspotId: 'hs_00000001' })], doc)
    expect(markers(layer.ops)[0]?.y).toBe(200 + HOTSPOT_MARKER_SPEC.pin.anchorOffsetY)
  })

  it('ops 顺序与 hotspotDrawOrder 一致：远的先画', () => {
    const { layer } = wire()
    const { doc, placements } = threeHotspots()
    layer.update(placements, doc)

    const expected = hotspotDrawOrder(placements.filter((p) => p.onScreen)).map((p) => p.hotspotId)
    expect(markers(layer.ops).map((m) => m.hotspotId)).toEqual(expected)
    // 距离 9 的那个排在距离 5 的前面。
    expect(markers(layer.ops)[0]?.hotspotId).toBe('hs_00000003')
  })

  it('真的调了 context，不是只记了账', () => {
    const { layer, recorded } = wire()
    const { doc, placements } = threeHotspots()
    layer.update(placements, doc)
    expect(recorded.calls.filter((c) => c.startsWith('arc('))).toHaveLength(2)
    expect(recorded.calls[0]).toContain('clearRect')
  })

  it('没 resize 过就什么都不画 —— 不猜一个尺寸', () => {
    // 猜错的话热点会画在图的错误位置上，而那看起来像「热点锚点配错了」。
    const layer = new HotspotSpriteLayer({ createCanvas: () => ({ width: 0, height: 0, getContext: () => null }) })
    const { doc, placements } = threeHotspots()
    layer.update(placements, doc)
    expect(layer.ops).toHaveLength(0)
  })
})

describe('T-265 · 面板', () => {
  function withOpenPanel() {
    const { layer, recorded } = wire()
    const { doc, placements } = threeHotspots()
    const target = doc.hotspots[0]!
    layer.setPanelOpen(target, true)
    layer.update(placements, doc)
    return { layer, recorded, target }
  }

  it('打开过的热点 → ops 含 panel + 两条 panel-text，且文字**逐字**等于 content', () => {
    const { layer, target } = withOpenPanel()
    const ops = layer.ops.filter((o) => o.hotspotId === target.id)

    expect(ops.some((o) => o.kind === 'panel')).toBe(true)
    const title = ops.find((o) => o.kind === 'panel-text' && o.role === 'title')
    const body = ops.find((o) => o.kind === 'panel-text' && o.role === 'body')
    // 卡面点名的假绿：一个把正文写成 `hotspot.id` 的实现，在「调用了 fillText」那种
    // 断言下完全绿，而导出的图上每个面板都印着一串 hs_00000001。
    expect(title && title.kind === 'panel-text' ? title.text : null).toBe(target.content.title)
    expect(body && body.kind === 'panel-text' ? body.text : null).toBe(target.content.text)
  })

  it('没打开的热点不产生面板 op', () => {
    const { layer } = wire()
    const { doc, placements } = threeHotspots()
    layer.update(placements, doc)
    expect(layer.ops.filter((o) => o.kind === 'panel')).toHaveLength(0)
  })

  it('关掉之后面板 op 消失', () => {
    const { layer, target } = withOpenPanel()
    const { doc, placements } = threeHotspots()
    layer.setPanelOpen(target, false)
    layer.update(placements, doc)
    expect(layer.ops.filter((o) => o.kind === 'panel')).toHaveLength(0)
  })
})

describe('T-265 · 降级：媒体与字体', () => {
  const mediaHotspot = () => {
    const doc = {
      ...createGoldenPathDocument(),
      hotspots: [hotspot('hs_00000001', { content: { type: 'panel', title: '第一步', text: '正文', mediaId: 'med_00000001' } as Hotspot['content'] })],
    } as SceneDocument
    return { doc, placements: [placement({ hotspotId: 'hs_00000001' })] }
  }

  it('媒体解码失败 → placeholder:true + warn 一次，**其余 ops 不变**', async () => {
    const onWarn = vi.fn()
    const { layer } = wire({ decodeImage: () => Promise.reject(new Error('坏图')), onWarn })
    const { doc, placements } = mediaHotspot()
    layer.setPanelOpen(doc.hotspots[0]!, true)

    await layer.prepare([{ hotspotId: 'hs_00000001', bytes: new ArrayBuffer(4) }])
    layer.update(placements, doc)

    const media = layer.ops.find((o) => o.kind === 'media')
    expect(media && media.kind === 'media' ? media.placeholder : null).toBe(true)
    expect(onWarn).toHaveBeenCalledTimes(1)
    // 「其余 ops 不变」：标记与两行文字一条都不能少。一张缺图的面板仍然是一份可读的说明。
    expect(layer.ops.filter((o) => o.kind === 'marker')).toHaveLength(1)
    expect(layer.ops.filter((o) => o.kind === 'panel-text')).toHaveLength(2)
  })

  it('媒体解码成功 → placeholder:false 且真的 drawImage', async () => {
    const { layer, recorded } = wire({ decodeImage: () => Promise.resolve({ tag: 'image' }) })
    const { doc, placements } = mediaHotspot()
    layer.setPanelOpen(doc.hotspots[0]!, true)

    await layer.prepare([{ hotspotId: 'hs_00000001', bytes: new ArrayBuffer(4) }])
    layer.update(placements, doc)

    const media = layer.ops.find((o) => o.kind === 'media')
    expect(media && media.kind === 'media' ? media.placeholder : null).toBe(false)
    expect(recorded.calls.some((c) => c.startsWith('drawImage('))).toBe(true)
  })

  it('font.ready() reject → 退回系统栈、ops 照常、warn 一次', async () => {
    const onWarn = vi.fn()
    const failing = { ready: () => Promise.reject(new Error('字体没下来')), family: '"某字体"', source: '自托管字体' }
    const font = withSystemFallback(failing, onWarn)
    const { layer } = wire({ font })
    const { doc, placements } = threeHotspots()

    await layer.prepare()
    layer.update(placements, doc)

    expect(onWarn).toHaveBeenCalledTimes(1)
    expect(font.family).toBe(SYSTEM_FONT_STACK)
    // ops 照常：一张字形不完美的图，好过一个「导出失败」。
    expect(markers(layer.ops)).toHaveLength(2)
  })

  it('字体正常时不 warn，且用的是它自己的族名', async () => {
    const onWarn = vi.fn()
    const font = withSystemFallback({ ready: () => Promise.resolve(), family: '"某字体"', source: '自托管字体' }, onWarn)
    await font.ready()
    expect(onWarn).not.toHaveBeenCalled()
    expect(font.family).toBe('"某字体"')
    expect(font.source).toBe('自托管字体')
  })

  it('默认就是系统字体栈，且 fontSource 说得出来', () => {
    const { layer } = wire()
    expect(layer.fontSource).toBe(systemFontProvider().source)
  })
})

describe('T-265 · dispose', () => {
  it('dispose() 之后 ops 为空，且再 update 也不画', () => {
    const { layer } = wire()
    const { doc, placements } = threeHotspots()
    layer.update(placements, doc)
    expect(layer.ops.length).toBeGreaterThan(0)

    layer.dispose()
    expect(layer.ops).toHaveLength(0)
    layer.update(placements, doc)
    expect(layer.ops, 'dispose 之后不许复活').toHaveLength(0)
    expect(layer.surface).toBeNull()
  })

  it('dispose() 之后 resize 也不重建画布', () => {
    const { layer } = wire()
    layer.dispose()
    layer.resize(800, 600)
    expect(layer.surface).toBeNull()
  })
})

describe('T-265 · 材质参数（只能断属性，断不了像素 —— 如实登记）', () => {
  it('toneMapped / depthTest / transparent 三条都在', () => {
    // 这三条只能靠属性断言守住。卡面如实写了这一点。
    expect(HOTSPOT_SPRITE_MATERIAL.toneMapped, 'overlay 画在色调映射之后，再映射一次颜色就对不上了').toBe(false)
    expect(HOTSPOT_SPRITE_MATERIAL.depthTest, '热点是标注，遮挡由 raycast 决定不由深度缓冲决定').toBe(false)
    expect(HOTSPOT_SPRITE_MATERIAL.transparent, '标记之外全是 alpha 0').toBe(true)
  })
})
