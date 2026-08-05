// @vitest-environment jsdom
import { createGoldenPathDocument } from '@w3/schema'
import type { Node, SceneDocument } from '@w3/schema'
import { NullHotspotRenderer, SceneRuntime, createMemoryResolver } from '@w3/core'
import { StrictMode, act } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SectionPanel } from '../../src/panels/SectionPanel.jsx'
import { resetSectionView } from '../../src/viewport/section-view.js'
import { setActiveRuntime } from '../../src/viewport/runtime-registry.js'
import { createDocumentStore } from '../../src/store/document-store.js'
import type { DocumentStore } from '../../src/store/document-store.js'
import { StoreProvider } from '../../src/store/StoreContext.jsx'

/**
 * T-251 · 剖切平面的编辑器入口与参数面板。
 *
 * 「对齐 X」那条**断的是 `livePlanes`，不是 `transform.r`**——卡面逐字要求的。理由：
 * 同一个朝向有无数种四元数写法（q 与 −q 是同一个旋转），断 `transform.r` 既会假红也会
 * 在「写对了值但语义不对」时假绿。断法线是断结果。
 *
 * 「翻转两次回原状」用**点积绝对值**比，同样是因为 q 与 −q：直接 `toEqual` 会假红。
 */

const PLANE = 'nd_sec00001'

const base = {
  explode: null,
  explodeOffset: null,
  prefabRef: null,
  assetRef: null,
  primitive: null,
  light: null,
  visible: true,
  locked: false,
  overrides: {},
  parent: null as string | null,
}

const planeNode = (overrides: Partial<Node> = {}): Node =>
  ({
    ...base,
    section: { scope: 'scene', size: [4, 4] },
    id: PLANE,
    name: '剖切平面',
    order: 100,
    transform: { p: [0, 0, 0], r: [0, 0, 0, 1], s: [1, 1, 1] },
    ...overrides,
  }) as Node

const docWith = (...nodes: Node[]): SceneDocument => {
  const doc = createGoldenPathDocument()
  return { ...doc, nodes: [...doc.nodes, ...nodes] }
}

let runtime: SceneRuntime | null = null
let root: Root | null = null
let host: HTMLElement | null = null

/**
 * 一个够 SceneRuntime 组装起来的渲染器桩。
 *
 * **本文件每一条剖切断言读的都是 `renderer.clippingPlanes`**，不是层自己的账本——
 * 与 T-243 的纪律一致：只断本层账本的测试对一个「算对了但没写给渲染器」的实现同样为真。
 */
function stubRenderer() {
  return {
    clippingPlanes: [] as { normal: { x: number; y: number; z: number }; constant: number }[],
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

let renderer: ReturnType<typeof stubRenderer> | null = null

function setup(doc: SceneDocument = docWith(planeNode()), selected: string[] = [PLANE]) {
  renderer = stubRenderer()
  runtime = new SceneRuntime(doc, {
    canvas: { clientWidth: 800, clientHeight: 600 } as HTMLCanvasElement,
    resolver: createMemoryResolver(new Map()),
    mode: 'edit',
    createRenderer: () => renderer as never,
    hotspotRenderer: new NullHotspotRenderer(),
    now: () => 0,
  })
  runtime.graph.build(doc)
  // 触发一次 syncSections：构造函数只建图，平面要等一次同步。`setSectionsEnabled(null)`
  // 是「交还给文档」，语义上正是「按当前文档重算一次」。
  runtime.setSectionsEnabled(null)
  setActiveRuntime(runtime)

  const store = createDocumentStore(doc)
  if (selected.length > 0) store.getState().select(selected)

  host = document.createElement('div')
  document.body.appendChild(host)
  const created = createRoot(host)
  root = created
  act(() => {
    created.render(
      <StrictMode>
        <StoreProvider store={store}>
          <SectionPanel />
        </StoreProvider>
      </StrictMode>,
    )
  })
  return { store, doc }
}

beforeEach(() => resetSectionView())

afterEach(() => {
  const current = root
  if (current) act(() => current.unmount())
  host?.remove()
  root = null
  host = null
  runtime?.dispose()
  runtime = null
  renderer = null
  setActiveRuntime(null)
  resetSectionView()
})

const find = <T extends HTMLElement>(testId: string): T => {
  const element = host?.querySelector<T>(`[data-testid="${testId}"]`)
  if (!element) throw new Error(`没有 [data-testid="${testId}"]`)
  return element
}

const click = (element: HTMLElement) =>
  act(() => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })

const toggle = (element: HTMLInputElement, checked: boolean) =>
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'checked')?.set?.call(element, checked)
    element.dispatchEvent(new Event('click', { bubbles: true }))
  })

/** 把当前文档推给运行时，再从**渲染器**读回平面。断的是这里，不是 `transform.r`。 */
function livePlanes(store: DocumentStore) {
  const doc = store.getState().doc
  act(() => {
    runtime!.graph.build(doc)
    runtime!.setSectionsEnabled(null)
  })
  return renderer!.clippingPlanes
}

/** 两个单位向量之间的距离。不引 three —— 它不是编辑器的直接依赖。 */
const dist = (a: { x: number; y: number; z: number }, b: readonly [number, number, number]) =>
  Math.hypot(a.x - b[0], a.y - b[1], a.z - b[2])

describe('T-251 · 新建剖切平面', () => {
  it('**点一下就多一个 section 非空的节点，撤销栈 +1，Ctrl+Z 后消失**', () => {
    const { store } = setup(createGoldenPathDocument(), [])
    const before = store.getState().doc.nodes.length

    click(find('section-create'))

    const doc = store.getState().doc
    expect(doc.nodes.length).toBe(before + 1)
    expect(doc.nodes.filter((n) => n.section !== null)).toHaveLength(1)
    expect(store.getState().historyDepth).toBe(1)

    act(() => void store.getState().undo())
    expect(store.getState().doc.nodes.length).toBe(before)
  })

  it('新建的那把刀被选中，且不落在原点', () => {
    // 落在原点的话它多半正好在模型内部或脚下，用户看不见自己刚建的东西。
    const { store } = setup(createGoldenPathDocument(), [])
    click(find('section-create'))
    const created = store.getState().doc.nodes.find((n) => n.section !== null)!
    expect(store.getState().selection).toEqual([created.id])
    expect(created.transform.p).not.toEqual([0, 0, 0])
  })
})

describe('T-251 · 对齐与翻转（断 livePlanes，不断 transform.r）', () => {
  it.each([
    ['x', [1, 0, 0]],
    ['y', [0, 1, 0]],
    ['z', [0, 0, 1]],
  ] as const)('对齐 %s 之后法线是那条轴', (axis, expected) => {
    const { store } = setup()
    click(find(`section-align-${axis}`))

    const planes = livePlanes(store)
    expect(planes).toHaveLength(1)
    const n = planes[0]!.normal
    expect(dist(n, expected), `法线是 ${n.x},${n.y},${n.z}`).toBeLessThan(1e-6)
  })

  it('翻转之后法线反向', () => {
    const { store } = setup()
    const b = livePlanes(store)[0]!.normal
    const before: [number, number, number] = [b.x, b.y, b.z]

    click(find('section-flip'))

    expect(dist(livePlanes(store)[0]!.normal, [-before[0], -before[1], -before[2]])).toBeLessThan(1e-6)
  })

  it('**翻转两次回原状**（四元数用点积绝对值比，避免 q 与 −q 的假红）', () => {
    const { store } = setup()
    const before = store.getState().doc.nodes.find((n) => n.id === PLANE)!.transform.r

    click(find('section-flip'))
    click(find('section-flip'))

    const after = store.getState().doc.nodes.find((n) => n.id === PLANE)!.transform.r
    const dot = Math.abs(before[0] * after[0] + before[1] * after[1] + before[2] * after[2] + before[3] * after[3])
    expect(dot).toBeCloseTo(1, 6)
  })

  it('每次对齐 / 翻转各落一条撤销', () => {
    const { store } = setup()
    click(find('section-align-x'))
    click(find('section-flip'))
    expect(store.getState().historyDepth).toBe(2)
  })

  it('没选中剖切面时不显示参数区', () => {
    setup(docWith(planeNode()), [])
    expect(host?.querySelector('[data-testid="section-align-x"]')).toBeNull()
  })
})

describe('T-251 · 尺寸', () => {
  it('改尺寸写进文档，且**不影响平面本身**', () => {
    const { store } = setup()
    const before = livePlanes(store)[0]!.constant

    act(() => {
      const state = store.getState()
      state.commit('调整剖切面宽度', (d) => {
        const node = d.nodes.find((n) => n.id === PLANE)!
        node.section = { ...node.section!, size: [9, 4] }
      })
    })

    expect(store.getState().doc.nodes.find((n) => n.id === PLANE)!.section!.size).toEqual([9, 4])
    expect(livePlanes(store)[0]!.constant, '尺寸只影响你看得见刀在哪').toBeCloseTo(before, 9)
  })
})

describe('T-251 · 暂时关闭剖切', () => {
  it('**勾上之后 clippingPlanes 空，而文档一字未改**', () => {
    const { store } = setup()
    expect(renderer!.clippingPlanes).toHaveLength(1)
    const docBefore = store.getState().doc

    toggle(find<HTMLInputElement>('section-view-disabled'), true)

    expect(renderer!.clippingPlanes).toHaveLength(0)
    expect(store.getState().doc, '不进文档').toBe(docBefore)
    expect(store.getState().historyDepth, '不进撤销栈').toBe(0)
  })

  it('**picker 也跟着恢复** —— 关掉剖切时不该还有刀在挡拾取', () => {
    // T-250 把 `sections.livePlanes` 同一个数组推给 picker，所以这两件事必须一起变。
    const { store } = setup()
    toggle(find<HTMLInputElement>('section-view-disabled'), true)
    expect(renderer!.clippingPlanes).toHaveLength(0)

    toggle(find<HTMLInputElement>('section-view-disabled'), false)

    expect(renderer!.clippingPlanes, '取消勾选要还回去').toHaveLength(1)
    void store
  })

  it('不写 localStorage', () => {
    expect(globalThis.localStorage, 'jsdom 该提供 localStorage，否则这条是恒真的').toBeDefined()
    localStorage.clear()
    setup()
    toggle(find<HTMLInputElement>('section-view-disabled'), true)
    expect(Object.keys(localStorage)).toEqual([])
  })

  it('勾上时说清它只影响画面', () => {
    setup()
    toggle(find<HTMLInputElement>('section-view-disabled'), true)
    expect(find('section-view-hint').textContent).toContain('不进文档、不进撤销栈')
  })

  it('文档里一把刀都没有时不显示这个开关', () => {
    setup(createGoldenPathDocument(), [])
    expect(host?.querySelector('[data-testid="section-view-disabled"]')).toBeNull()
  })
})
