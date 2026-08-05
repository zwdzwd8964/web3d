import { createGoldenPathDocument } from '@w3/schema'
import type { Node, SceneDocument } from '@w3/schema'
import { Plane, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { MAX_SECTION_PLANES, SectionLayer, sectionFactory } from '../../src/runtime/section-layer.js'
import { SceneGraph } from '../../src/runtime/scene-graph.js'
import type { RendererLike } from '../../src/runtime/renderer-like.js'

/**
 * T-243 · 剖切平面。
 *
 * **每一条断言读的都是 `renderer.clippingPlanes`，不是 `layer.livePlanes`。**
 * 后者是本层自己的账本：删掉「写给渲染器」那一行，它照样是对的。这正是 v0.5 M11
 * 「断言渲染器而不是文档」那条教训的第四次同形，卡面把它写成了变异 ① 的判据。
 *
 * three 的矩阵与 `Plane` 不需要 GL，所以法线与常数的手算对拍全部跑在 Node 里。
 */

/** 一个只记下被写进来什么的渲染器替身。 */
function fakeRenderer() {
  return { clippingPlanes: [] as Plane[], localClippingEnabled: false } as unknown as RendererLike & {
    clippingPlanes: Plane[]
    localClippingEnabled: boolean
  }
}

const SECTION_BASE: Omit<Node, 'id' | 'name' | 'order' | 'transform' | 'parent'> = {
  section: { scope: 'scene', size: [4, 4] },
  explode: null,
  explodeOffset: null,
  prefabRef: null,
  assetRef: null,
  primitive: null,
  light: null,
  visible: true,
  locked: false,
  overrides: {},
}

const sectionNode = (
  id: string,
  overrides: Partial<Node> = {},
): Node => ({
  ...SECTION_BASE,
  id,
  name: `剖切面 ${id}`,
  parent: null,
  order: 100,
  transform: { p: [0, 0, 0], r: [0, 0, 0, 1], s: [1, 1, 1] },
  ...overrides,
})

const groupNode = (id: string, overrides: Partial<Node> = {}): Node => ({
  ...SECTION_BASE,
  section: null,
  id,
  name: `分组 ${id}`,
  parent: null,
  order: 90,
  transform: { p: [0, 0, 0], r: [0, 0, 0, 1], s: [1, 1, 1] },
  ...overrides,
})

function docWith(...nodes: Node[]): SceneDocument {
  const base = createGoldenPathDocument()
  return { ...base, nodes: [...base.nodes, ...nodes] }
}

function setup(doc: SceneDocument) {
  const graph = new SceneGraph({ sections: sectionFactory })
  graph.build(doc)
  const renderer = fakeRenderer()
  const layer = new SectionLayer(graph)
  layer.sync(doc, renderer)
  return { graph, renderer, layer, resync: () => layer.sync(doc, renderer) }
}

/** 绕 Y 轴 90°：局部 +Z 转到世界 +X。 */
const YAW_90: [number, number, number, number] = [0, Math.SQRT1_2, 0, Math.SQRT1_2]

describe('T-243 · 法线与常数', () => {
  it('带非单位旋转的剖切面：恰好 1 条，法线与常数等于手算值', () => {
    const node = sectionNode('nd_sec00001', { transform: { p: [1, 2, 3], r: YAW_90, s: [1, 1, 1] } })
    const { renderer } = setup(docWith(node))

    expect(renderer.clippingPlanes).toHaveLength(1)
    const plane = renderer.clippingPlanes[0]!
    // 绕 Y 转 90°，(0,0,1) → (1,0,0)
    expect(plane.normal.x).toBeCloseTo(1, 6)
    expect(plane.normal.y).toBeCloseTo(0, 6)
    expect(plane.normal.z).toBeCloseTo(0, 6)
    // three 的约定：constant = -point·normal
    expect(plane.constant).toBeCloseTo(-1, 6)
  })

  it('无旋转时法线是 +Z，常数是 -z', () => {
    const node = sectionNode('nd_sec00001', { transform: { p: [0, 0, 2.5], r: [0, 0, 0, 1], s: [1, 1, 1] } })
    const { renderer } = setup(docWith(node))
    const plane = renderer.clippingPlanes[0]!
    expect(plane.normal.toArray().map((v) => Math.round(v * 1e6) / 1e6)).toEqual([0, 0, 1])
    expect(plane.constant).toBeCloseTo(-2.5, 6)
  })

  it('**缩放不许把法线拧歪** —— 非等比缩放下法线仍是单位向量且方向不变', () => {
    // 用 matrixWorld 直接变换法线的实现在这条下红：法线不是随点一起变的那种向量。
    const node = sectionNode('nd_sec00001', { transform: { p: [0, 0, 0], r: YAW_90, s: [3, 1, 0.2] } })
    const { renderer } = setup(docWith(node))
    const plane = renderer.clippingPlanes[0]!
    expect(plane.normal.length()).toBeCloseTo(1, 6)
    expect(plane.normal.x).toBeCloseTo(1, 6)
  })
})

describe('T-243 · 启停就是 node.visible', () => {
  it('visible:false → 平面数 0', () => {
    const { renderer } = setup(docWith(sectionNode('nd_sec00001', { visible: false })))
    expect(renderer.clippingPlanes).toHaveLength(0)
  })

  it('**父节点隐藏 → 也变 0**（世界可见性，不是自己的 visible）', () => {
    // 只看 object.visible 的实现在这条下红。用户收起一个分组之后，组里那把刀如果还在切，
    // 画面被剖开而看得见的地方一个平面都没有——找不着，也关不掉。
    const parent = groupNode('nd_grp00001', { visible: false })
    const child = sectionNode('nd_sec00001', { parent: 'nd_grp00001' })
    const { renderer } = setup(docWith(parent, child))
    expect(renderer.clippingPlanes).toHaveLength(0)
  })

  it('前提：同一对节点在父节点可见时是 1 条', () => {
    // 少了这条，上一条对一个「永远返回 0 条」的实现同样成立。
    const parent = groupNode('nd_grp00001', { visible: true })
    const child = sectionNode('nd_sec00001', { parent: 'nd_grp00001' })
    const { renderer } = setup(docWith(parent, child))
    expect(renderer.clippingPlanes).toHaveLength(1)
  })

  it('挂到被移动过的父节点下 → 平面跟着走', () => {
    const parent = groupNode('nd_grp00001', { transform: { p: [0, 5, 0], r: [0, 0, 0, 1], s: [1, 1, 1] } })
    const child = sectionNode('nd_sec00001', {
      parent: 'nd_grp00001',
      transform: { p: [0, 0, 0], r: [0, 0, 0, 1], s: [1, 1, 1] },
    })
    const { graph, renderer, resync } = setup(docWith(parent, child))

    // 父节点又被拖了 3 米
    graph.objectFor('nd_grp00001')!.position.set(0, 8, 0)
    resync()

    const plane = renderer.clippingPlanes[0]!
    // 法线仍是 +Z，而平面上的点跟着父节点走了 → 常数不变（法线与位移正交）
    expect(plane.normal.z).toBeCloseTo(1, 6)
    // 换个方向再验一次：法线与位移同向时常数必须跟着变
    graph.objectFor('nd_grp00001')!.position.set(0, 8, 4)
    resync()
    expect(renderer.clippingPlanes[0]!.constant).toBeCloseTo(-4, 6)
  })
})

describe('T-243 · 上限', () => {
  it('4 条启用只取文档序前 3', () => {
    const doc = docWith(
      sectionNode('nd_sec00001', { transform: { p: [0, 0, 1], r: [0, 0, 0, 1], s: [1, 1, 1] } }),
      sectionNode('nd_sec00002', { transform: { p: [0, 0, 2], r: [0, 0, 0, 1], s: [1, 1, 1] } }),
      sectionNode('nd_sec00003', { transform: { p: [0, 0, 3], r: [0, 0, 0, 1], s: [1, 1, 1] } }),
      sectionNode('nd_sec00004', { transform: { p: [0, 0, 4], r: [0, 0, 0, 1], s: [1, 1, 1] } }),
    )
    const { renderer } = setup(doc)

    expect(renderer.clippingPlanes).toHaveLength(MAX_SECTION_PLANES)
    // 断的是**哪三条**，不只是数量：取后 3 条的实现在只数数量的断言下同样绿
    expect(renderer.clippingPlanes.map((p) => Math.round(p.constant))).toEqual([-1, -2, -3])
  })

  it('隐藏中的那条不占名额', () => {
    const doc = docWith(
      sectionNode('nd_sec00001', { visible: false, transform: { p: [0, 0, 1], r: [0, 0, 0, 1], s: [1, 1, 1] } }),
      sectionNode('nd_sec00002', { transform: { p: [0, 0, 2], r: [0, 0, 0, 1], s: [1, 1, 1] } }),
      sectionNode('nd_sec00003', { transform: { p: [0, 0, 3], r: [0, 0, 0, 1], s: [1, 1, 1] } }),
      sectionNode('nd_sec00004', { transform: { p: [0, 0, 4], r: [0, 0, 0, 1], s: [1, 1, 1] } }),
    )
    const { renderer } = setup(doc)
    expect(renderer.clippingPlanes.map((p) => Math.round(p.constant))).toEqual([-2, -3, -4])
  })
})

describe('T-243 · 生命周期', () => {
  it('dispose 之后 clippingPlanes 为空', () => {
    const { renderer, layer } = setup(docWith(sectionNode('nd_sec00001')))
    expect(renderer.clippingPlanes).toHaveLength(1)

    layer.dispose(renderer)

    expect(renderer.clippingPlanes).toHaveLength(0)
    expect(layer.livePlanes).toHaveLength(0)
  })

  it('没有渲染器时只算不写，不抛', () => {
    const graph = new SceneGraph({ sections: sectionFactory })
    const doc = docWith(sectionNode('nd_sec00001'))
    graph.build(doc)
    const layer = new SectionLayer(graph)

    expect(() => layer.sync(doc, null)).not.toThrow()
    expect(layer.livePlanes, '无头路径也要答得出「有几条」').toHaveLength(1)
  })

  it('图里没有这个节点时跳过它，不抛', () => {
    const graph = new SceneGraph({ sections: sectionFactory })
    const doc = docWith(sectionNode('nd_sec00001'))
    // 故意不 build
    const layer = new SectionLayer(graph)
    layer.sync(doc, null)
    expect(layer.livePlanes).toHaveLength(0)
  })
})

describe('T-243 · 指示矩形', () => {
  it('工厂造出来的东西有几何体，尺寸改了能原地更新', () => {
    const object = sectionFactory.create({ scope: 'scene', size: [4, 4] })
    expect(object.children.length).toBeGreaterThan(0)
    expect(sectionFactory.update(object, { scope: 'scene', size: [8, 2] })).toBe(true)
    expect(() => sectionFactory.dispose(object)).not.toThrow()
  })

  it('指示矩形本身不参与裁剪计算 —— 平面只由世界矩阵决定', () => {
    // 换个尺寸，平面一点都不该变（size 只影响你看得见刀在哪）
    const small = setup(docWith(sectionNode('nd_sec00001', { section: { scope: 'scene', size: [1, 1] } })))
    const large = setup(docWith(sectionNode('nd_sec00001', { section: { scope: 'scene', size: [40, 40] } })))
    expect(small.renderer.clippingPlanes[0]!.constant).toBe(large.renderer.clippingPlanes[0]!.constant)
    expect(small.renderer.clippingPlanes[0]!.normal.toArray()).toEqual(large.renderer.clippingPlanes[0]!.normal.toArray())
  })
})

describe('T-243 · 手算对拍的对拍', () => {
  it('这套 helper 造出来的确实是一条能算的平面', () => {
    // D36 的 M6：如果 `setup` 因为任何原因造不出节点，上面每一条「长度为 0」的断言
    // 都会变成一句什么都不说的话。这里正面证明它算得出非零结果。
    const { renderer } = setup(docWith(sectionNode('nd_sec00001', { transform: { p: [0, 0, 7], r: [0, 0, 0, 1], s: [1, 1, 1] } })))
    expect(renderer.clippingPlanes[0]).toBeInstanceOf(Plane)
    expect(renderer.clippingPlanes[0]!.normal.distanceTo(new Vector3(0, 0, 1))).toBeLessThan(1e-6)
  })
})

/* ========================================================================== */
/* T-243 · 接缝防线：真工厂确实在生产组装路径上                                */
/* ========================================================================== */

/** 一个够 SceneRuntime 组装起来的渲染器桩。真 WebGLRenderer 这些成员一个都不缺。 */
function stubRenderer() {
  return {
    clippingPlanes: [] as Plane[],
    localClippingEnabled: false,
    info: { memory: { geometries: 0, textures: 0 } },
    shadowMap: { enabled: false, type: -1 },
    extensions: { has: () => false },
    getPixelRatio: () => 1,
    getSize: (t: { set: (w: number, h: number) => unknown }) => t.set(800, 600),
    setRenderTarget: () => {},
    getRenderTarget: () => null,
    clear: () => {},
    render: () => {},
    setSize: () => {},
    setPixelRatio: () => {},
    dispose: () => {},
    domElement: {} as HTMLCanvasElement,
  }
}

describe('T-243 · 接缝防线', () => {
  /**
   * 卡面逐字要求的那一条：**断言真 section 工厂已经在 `new SceneRuntime(...)` 的
   * 生产组装路径上被装上，而不是工厂自己的测试。**
   *
   * 这条防线存在的理由，本批已经踩到过一次：T-241 查出 `createComposer` /
   * `createOutlinePass` 在两个宿主里都没人注入，于是整条描边通道从来没通过电——
   * 而 `render-pipeline` 自己的 12 条单测全绿。**「零件对」与「零件被装上了」是两件事。**
   */
  it('SceneRuntime 装的是真工厂，不是占位工厂', async () => {
    const { SceneRuntime } = await import('../../src/runtime/scene-runtime.js')
    const { createMemoryResolver } = await import('../../src/runtime/loader.js')
    const { NullHotspotRenderer } = await import('../../src/runtime/hotspot-layer.js')

    const doc = docWith(sectionNode('nd_sec00001'))
    const runtime = new SceneRuntime(doc, {
      resolver: createMemoryResolver(new Map()),
      mode: 'edit',
      hotspotRenderer: new NullHotspotRenderer(),
      now: () => 0,
    })
    runtime.graph.build(doc)

    const object = runtime.graph.objectFor('nd_sec00001')
    // 占位工厂造的是一个**空** Group；真工厂造的是填充面 + 边框两个子对象。
    // 断子对象数而不是断类型：`instanceof Group` 对两者都为真，那是假绿。
    expect(object?.children.length, '装的是占位工厂 —— 剖切面在编辑器里会是隐形的').toBeGreaterThan(0)
    runtime.dispose()
  })

  it('接上渲染器时打开 localClippingEnabled 并把平面写过去', async () => {
    // three 默认不做局部裁剪：少了那一行，clippingPlanes 写进去也不生效，
    // 而画面看起来「就是没剖」——一个没有任何报错的失效。
    const { SceneRuntime } = await import('../../src/runtime/scene-runtime.js')
    const { createMemoryResolver } = await import('../../src/runtime/loader.js')
    const { NullHotspotRenderer } = await import('../../src/runtime/hotspot-layer.js')

    const doc = docWith(sectionNode('nd_sec00001', { transform: { p: [0, 0, 6], r: [0, 0, 0, 1], s: [1, 1, 1] } }))
    const renderer = stubRenderer()
    const runtime = new SceneRuntime(doc, {
      canvas: { clientWidth: 800, clientHeight: 600 } as HTMLCanvasElement,
      resolver: createMemoryResolver(new Map()),
      mode: 'edit',
      createRenderer: () => renderer as never,
      hotspotRenderer: new NullHotspotRenderer(),
      now: () => 0,
    })
    await runtime.load(doc)

    expect(renderer.localClippingEnabled, 'three 默认不做局部裁剪').toBe(true)
    expect(renderer.clippingPlanes).toHaveLength(1)
    expect(renderer.clippingPlanes[0]!.constant).toBeCloseTo(-6, 6)

    runtime.dispose()
    expect(renderer.clippingPlanes, 'dispose 之后不该把刀留给下一份文档').toHaveLength(0)
  })

  it('**连续 100 次改平面 transform，fullRebuildCount 为 0**', async () => {
    const { SceneRuntime } = await import('../../src/runtime/scene-runtime.js')
    const { createMemoryResolver } = await import('../../src/runtime/loader.js')
    const { NullHotspotRenderer } = await import('../../src/runtime/hotspot-layer.js')

    const doc = docWith(sectionNode('nd_sec00001'))
    // **注入渲染器并读它**，不另开一个计数器：本卡自己定的纪律就是「断渲染器」，
    // 为了方便测试而加一个 `sectionPlaneCount` 等于给自己开一条读账本的后门。
    const renderer = stubRenderer()
    const runtime = new SceneRuntime(doc, {
      canvas: { clientWidth: 800, clientHeight: 600 } as HTMLCanvasElement,
      resolver: createMemoryResolver(new Map()),
      mode: 'edit',
      createRenderer: () => renderer as never,
      hotspotRenderer: new NullHotspotRenderer(),
      now: () => 0,
    })
    await runtime.load(doc)

    const index = doc.nodes.findIndex((n) => n.id === 'nd_sec00001')
    let current = doc
    for (let i = 1; i <= 100; i++) {
      const nodes = current.nodes.map((n, k) =>
        k === index ? { ...n, transform: { ...n.transform, p: [0, 0, i] as [number, number, number] } } : n,
      )
      const next = { ...current, nodes }
      runtime.applyPatch([{ op: 'replace', path: ['nodes', index, 'transform', 'p'], value: [0, 0, i] }], next, current)
      current = next
    }

    expect(runtime.fullRebuildCount, '拖一把剖切刀不该触发整图重建').toBe(0)
    expect(renderer.clippingPlanes, '而且它真的跟着走了').toHaveLength(1)
    expect(renderer.clippingPlanes[0]!.constant, '跟到了最后一次的位置').toBeCloseTo(-100, 6)
    runtime.dispose()
  })
})

describe('T-243 · 三个新字段都要被认领，否则一改就整图重建', () => {
  /**
   * 卡面变异 ② 的落点。三个字段各来一条：**合并成一条会让「删掉其中一个 case」
   * 这个变异只在其中一支上可观测**，而那正是 `sceneId` / `projectId` 分两行写的理由。
   */
  const cases: readonly [field: string, path: readonly (string | number)[], value: unknown][] = [
    ['section', ['section', 'size'], [8, 2]],
    ['explode', ['explode'], { mode: 'radial', axis: [0, 1, 0], center: [0, 0, 0], factor: 1 }],
    ['explodeOffset', ['explodeOffset'], [1, 0, 0]],
  ]

  it.each(cases)('改 /nodes/N/%s 不触发整图重建', async (_field, path, value) => {
    const { SceneRuntime } = await import('../../src/runtime/scene-runtime.js')
    const { createMemoryResolver } = await import('../../src/runtime/loader.js')
    const { NullHotspotRenderer } = await import('../../src/runtime/hotspot-layer.js')

    const doc = docWith(sectionNode('nd_sec00001'))
    const runtime = new SceneRuntime(doc, {
      resolver: createMemoryResolver(new Map()),
      mode: 'edit',
      hotspotRenderer: new NullHotspotRenderer(),
      now: () => 0,
    })
    await runtime.load(doc)

    const index = doc.nodes.findIndex((n) => n.id === 'nd_sec00001')
    const nodes = doc.nodes.map((n, k) => (k === index ? applyAt(n, path, value) : n))
    const next = { ...doc, nodes }
    runtime.applyPatch([{ op: 'replace', path: ['nodes', index, ...path], value }], next, doc)

    expect(runtime.fullRebuildCount, '这个字段没人认领，掉进了 default').toBe(0)
    runtime.dispose()
  })
})

/** 把 `value` 写到 `node` 的 `path` 上，返回一份新节点。测试自用，够浅。 */
function applyAt(node: Node, path: readonly (string | number)[], value: unknown): Node {
  if (path.length === 1) return { ...node, [path[0]!]: value } as Node
  const [head, ...rest] = path as [string, ...(string | number)[]]
  const current = (node as unknown as Record<string, unknown>)[head] as Record<string, unknown> | null
  return { ...node, [head]: { ...(current ?? {}), [rest[0]!]: value } } as unknown as Node
}
