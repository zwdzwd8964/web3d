// @vitest-environment jsdom
import { createGoldenPathDocument } from '@w3/schema'
import type { Node, SceneDocument } from '@w3/schema'
import { NullHotspotRenderer, SceneRuntime, createMemoryResolver } from '@w3/core'
import { StrictMode, act } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ExplodeToolbar } from '../../src/viewport/ExplodeToolbar.jsx'
import { PropertiesPanel } from '../../src/panels/PropertiesPanel.jsx'
import { closeExplodeTool, getExplodeTool, resetExplodeTool, setExplodeTool } from '../../src/viewport/explode-tool.js'
import { setActiveRuntime } from '../../src/viewport/runtime-registry.js'
import { createDocumentStore } from '../../src/store/document-store.js'
import type { DocumentStore } from '../../src/store/document-store.js'
import { StoreProvider } from '../../src/store/StoreContext.jsx'

/**
 * T-248 · 爆炸预览工具态。
 *
 * ## 每一条都断渲染器上的位置，不断 store 的布尔量
 *
 * 卡面把这一点写成了变异 ② 的判据，理由是：「工具态关掉了」与「零件真的回原位了」
 * 是两件事。只清 store 的实现会让零件停在炸开的位置而工具条已经不见了——用户既看不出
 * 为什么，也没有入口把它收回去。
 *
 * ## 关于本卡验收里被拍板改掉的那一半
 *
 * 原验收要求「gizmo 未附着」与「拖放禁用」，2026-08-05 产品负责人裁决 T-248 让步：
 * 工具态下**允许拖动零件**（拖动写的是 `explodeOffset`，T-249 的核心动作），
 * 只保留「transform 面板只读」。所以本文件里没有 gizmo 断言，改为断只读与提示文案。
 *
 * 顺带：原验收里「断言该件的 `transform.p` 一字未变」是一条**对称性假绿断言**——爆炸
 * 偏移按 D29 本来就只写渲染器、从不写文档，所以那句话在爆炸功能整个没实现时同样成立。
 * 这里保留它，但**必须与「渲染器位置确实变了」配对**才有信息量，两条写在一起。
 */

const GROUP = 'nd_expl0001'
const MEMBER = 'nd_child0002'

function explodeDoc(): SceneDocument {
  const base = createGoldenPathDocument()
  const shared = {
    section: null,
    prefabRef: null,
    assetRef: null,
    light: null,
    visible: true,
    locked: false,
    overrides: {},
    explodeOffset: null,
    primitive: { kind: 'box' as const, size: [0.2, 0.2, 0.2] as [number, number, number] },
    transform: { p: [0, 0, 0] as [number, number, number], r: [0, 0, 0, 1] as [number, number, number, number], s: [1, 1, 1] as [number, number, number] },
  }
  const member = (id: string, order: number, p: [number, number, number]): Node =>
    ({ ...shared, id, name: `零件 ${order}`, parent: GROUP, order, explode: null, transform: { ...shared.transform, p } }) as Node
  return {
    ...base,
    nodes: [
      ...base.nodes,
      { ...shared, id: GROUP, name: '泵组', parent: null, order: 7000, primitive: null, explode: { mode: 'radial' as const, gain: 2, axis: [0, 1, 0] as [number, number, number], spacing: 0.5, easing: 'linear' as const } } as Node,
      member('nd_child0001', 1, [0, 0, 0]),
      member(MEMBER, 2, [0, 2, 0]),
    ],
  } as SceneDocument
}

let runtime: SceneRuntime | null = null
let root: Root | null = null
let host: HTMLElement | null = null

function makeRuntime(doc: SceneDocument) {
  const created = new SceneRuntime(doc, {
    resolver: createMemoryResolver(new Map()),
    mode: 'edit',
    hotspotRenderer: new NullHotspotRenderer(),
    now: () => 0,
  })
  created.graph.build(doc)
  runtime = created
  setActiveRuntime(created)
  return created
}

function mount(store: DocumentStore, node: React.ReactNode) {
  host = document.createElement('div')
  document.body.appendChild(host)
  const created = createRoot(host)
  root = created
  act(() => {
    created.render(
      <StrictMode>
        <StoreProvider store={store}>{node}</StoreProvider>
      </StrictMode>,
    )
  })
  return host
}

beforeEach(() => resetExplodeTool())

afterEach(() => {
  const current = root
  if (current) act(() => current.unmount())
  host?.remove()
  root = null
  host = null
  runtime?.dispose()
  runtime = null
  setActiveRuntime(null)
  resetExplodeTool()
})

const find = <T extends HTMLElement>(testId: string): T => {
  const element = host?.querySelector<T>(`[data-testid="${testId}"]`)
  if (!element) throw new Error(`没有 [data-testid="${testId}"]`)
  return element
}

function change(element: HTMLInputElement | HTMLSelectElement, value: string) {
  act(() => {
    const proto = element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(element, value)
    element.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

/** 渲染器上那个零件此刻在哪。**每一条断言都读它。** */
const livePos = () => runtime!.graph.objectFor(MEMBER)!.position.clone()

describe('T-248 · 滑块驱动渲染器', () => {
  it('走 UI 事件入口：选分组 → 渲染器上的位置真的变了', () => {
    const doc = explodeDoc()
    makeRuntime(doc)
    mount(createDocumentStore(doc), <ExplodeToolbar />)
    const before = livePos()

    change(find<HTMLSelectElement>('explode-tool-group'), GROUP)

    // 选中即开到 1：选完什么都不动会让人以为功能坏了
    expect(livePos().distanceTo(before)).toBeGreaterThan(0.1)
  })

  it('**滑块自己那一下也要算数**', () => {
    // ⚠ 上一条**盖不住滑块**：选分组时 factor 已经被设成 1，位置在那一刻就变了。
    // 把滑块的 onChange 改成空操作，上一条照样绿。所以这一条从「已经在 1」出发，
    // 只拉滑块，断位置**再次**变化——这才是滑块自己的那条线。
    const doc = explodeDoc()
    makeRuntime(doc)
    mount(createDocumentStore(doc), <ExplodeToolbar />)

    change(find<HTMLSelectElement>('explode-tool-group'), GROUP)
    const atOne = livePos()

    change(find<HTMLInputElement>('explode-tool-factor'), '3')

    expect(livePos().distanceTo(atOne), '把滑块的 onChange 改成空操作，这条必红').toBeGreaterThan(0.1)
    expect(getExplodeTool().factor).toBe(3)
  })

  it('**位置只写渲染器，文档一字未改** —— 与上一条配对才有信息量', () => {
    // 单独看这一条是对称性假绿：爆炸偏移按 D29 本来就只写渲染器，
    // 所以它在爆炸功能整个没实现时同样成立。
    const doc = explodeDoc()
    makeRuntime(doc)
    const store = createDocumentStore(doc)
    mount(store, <ExplodeToolbar />)
    const before = livePos()

    change(find<HTMLSelectElement>('explode-tool-group'), GROUP)
    change(find<HTMLInputElement>('explode-tool-factor'), '1')

    expect(livePos().distanceTo(before), '前提：渲染器上真的动了').toBeGreaterThan(0.1)
    expect(store.getState().doc.nodes.find((n) => n.id === MEMBER)!.transform.p).toEqual([0, 2, 0])
    expect(store.getState().historyDepth, '一个瞬态不该进撤销栈').toBe(0)
  })

  it('关掉工具态 → 渲染器上的位置回文档值', () => {
    const doc = explodeDoc()
    makeRuntime(doc)
    mount(createDocumentStore(doc), <ExplodeToolbar />)
    const before = livePos().toArray()

    change(find<HTMLSelectElement>('explode-tool-group'), GROUP)
    change(find<HTMLInputElement>('explode-tool-factor'), '1')
    change(find<HTMLSelectElement>('explode-tool-group'), '')

    expect(livePos().toArray()).toEqual(before)
  })

  it('换分组时把上一个归零', () => {
    const base = explodeDoc()
    const second = { ...base.nodes.find((n) => n.id === GROUP)!, id: 'nd_expl0002', name: '第二组', order: 7100 }
    const doc = { ...base, nodes: [...base.nodes, second] } as SceneDocument
    makeRuntime(doc)
    mount(createDocumentStore(doc), <ExplodeToolbar />)
    const before = livePos().toArray()

    change(find<HTMLSelectElement>('explode-tool-group'), GROUP)
    change(find<HTMLInputElement>('explode-tool-factor'), '1')
    expect(livePos().toArray()).not.toEqual(before)

    change(find<HTMLSelectElement>('explode-tool-group'), 'nd_expl0002')

    expect(livePos().toArray(), '上一个分组停在半炸开的姿态上没人管').toEqual(before)
  })

  it('文档里没有爆炸分组时整条工具条不渲染', () => {
    const doc = createGoldenPathDocument()
    makeRuntime(doc)
    mount(createDocumentStore(doc), <ExplodeToolbar />)
    expect(host?.querySelector('[data-testid="explode-toolbar"]')).toBeNull()
  })
})

describe('T-248 · 进预览时自动关闭', () => {
  it('**closeExplodeTool 把渲染器上的位置也收回去**', () => {
    // 卡面变异 ②。断的是渲染器位置——读 store 布尔量的话，一个「只清 store」的实现照样绿，
    // 而零件停在炸开的位置、工具条已经不见了。
    const doc = explodeDoc()
    makeRuntime(doc)
    const before = livePos().toArray()
    setExplodeTool({ groupNodeId: GROUP, factor: 1 })
    expect(livePos().toArray()).not.toEqual(before)

    closeExplodeTool()

    expect(livePos().toArray()).toEqual(before)
    expect(getExplodeTool()).toEqual({ groupNodeId: null, factor: 0 })
  })
})

describe('T-248 · 不进 localStorage', () => {
  it('**改工具态不写 localStorage**（这条在 jsdom 里才有意义）', () => {
    // ⚠ 仓库里同形的先例（`snap.test.ts`）跑在 node 环境，那里 `globalThis.localStorage`
    // 恒为 undefined，`?? {}` 让断言恒真——一条什么都不测的话。jsdom 有真的
    // localStorage，所以这条在这里是**真的**在测。
    expect(globalThis.localStorage, 'jsdom 该提供 localStorage，否则这条又是恒真的').toBeDefined()
    localStorage.clear()

    const doc = explodeDoc()
    makeRuntime(doc)
    setExplodeTool({ groupNodeId: GROUP, factor: 1 })

    expect(Object.keys(localStorage)).toEqual([])
  })

  it('源码里没有 localStorage 这个词', async () => {
    // jsdom 环境下 `import.meta.url` 不是 file: 协议，所以按仓库根拼路径
    const { readFile } = await import('node:fs/promises')
    const { resolve } = await import('node:path')
    const source = await readFile(resolve(process.cwd(), 'src/viewport/explode-tool.ts'), 'utf8')
    // 注释里可以解释「为什么不进 localStorage」，所以只查代码：剥掉注释再看
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    expect(code).not.toContain('localStorage')
  })
})

describe('T-248 · 属性面板 transform 只读', () => {
  const mountPanel = (doc: SceneDocument) => {
    const store = createDocumentStore(doc)
    store.getState().select([MEMBER])
    mount(store, <PropertiesPanel />)
    return store
  }

  it('工具态关闭时可编辑', () => {
    const doc = explodeDoc()
    makeRuntime(doc)
    mountPanel(doc)
    expect(host?.querySelectorAll('input:disabled').length, '前提：默认不该是只读').toBe(0)
    expect(host?.querySelector('[data-testid="transform-locked-hint"]')).toBeNull()
  })

  it('**工具态开启时 transform 只读，并说清为什么**', () => {
    const doc = explodeDoc()
    makeRuntime(doc)
    mountPanel(doc)
    act(() => void setExplodeTool({ groupNodeId: GROUP, factor: 1 }))

    // 位置 / 旋转 / 缩放各三个 = 9 个数值框
    expect(host?.querySelectorAll('input:disabled').length).toBeGreaterThanOrEqual(9)
    expect(find('transform-locked-hint').textContent).toContain('爆炸预览开启中，变换只读')
  })

  it('关掉之后又可编辑', () => {
    const doc = explodeDoc()
    makeRuntime(doc)
    mountPanel(doc)
    act(() => void setExplodeTool({ groupNodeId: GROUP, factor: 1 }))
    act(() => void closeExplodeTool())

    expect(host?.querySelectorAll('input:disabled').length).toBe(0)
  })
})
