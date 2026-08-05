// @vitest-environment jsdom
import { createGoldenPathDocument, explodeOffsets } from '@w3/schema'
import type { Node, SceneDocument } from '@w3/schema'
import { NullHotspotRenderer, SceneRuntime, createMemoryResolver } from '@w3/core'
import { StrictMode, act } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PropertiesPanel } from '../../src/panels/PropertiesPanel.jsx'
import { resetExplodeTool, setExplodeTool } from '../../src/viewport/explode-tool.js'
import { setActiveRuntime } from '../../src/viewport/runtime-registry.js'
import { createDocumentStore } from '../../src/store/document-store.js'
import type { DocumentStore } from '../../src/store/document-store.js'
import { StoreProvider } from '../../src/store/StoreContext.jsx'

/**
 * T-249 · 单零件 `explodeOffset` 的记录与清除。
 *
 * ## 卡面的验收与变异互相对不上，两条都写
 *
 * 验收说「记录后把 factor 归零再拉回 1，该件回到刚才那个位置」——**这句只有在 factor=1
 * 记录时才成立**。变异检验要求「必须用 factor ≠ 1 记录一次」，而那时 `explodeOffset`
 * 存的是 factor=1 的位移（= 观测位移 / factor），拉到 1 时该件落在观测位置的 `1/factor` 倍处。
 *
 * 两条都写，各自把几何关系写清楚：
 *  - factor=1 的那条对应验收的字面（回到刚才那个位置）；
 *  - factor=0.5 的那条对应变异（拉到 1 时是观测位移的两倍），**它才是能杀掉「删除以 factor」
 *    那条变异的样本**。
 */

const GROUP = 'nd_expl0001'
const PART = 'nd_child0002'

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
      member(PART, 2, [0, 2, 0]),
    ],
  } as SceneDocument
}

let runtime: SceneRuntime | null = null
let root: Root | null = null
let host: HTMLElement | null = null

function setup(doc: SceneDocument = explodeDoc()) {
  runtime = new SceneRuntime(doc, {
    resolver: createMemoryResolver(new Map()),
    mode: 'edit',
    hotspotRenderer: new NullHotspotRenderer(),
    now: () => 0,
  })
  runtime.graph.build(doc)
  setActiveRuntime(runtime)

  const store = createDocumentStore(doc)
  store.getState().select([PART])

  host = document.createElement('div')
  document.body.appendChild(host)
  const created = createRoot(host)
  root = created
  act(() => {
    created.render(
      <StrictMode>
        <StoreProvider store={store}>
          <PropertiesPanel />
        </StoreProvider>
      </StrictMode>,
    )
  })
  return { store, doc }
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

const click = (element: HTMLElement) =>
  act(() => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })

const livePos = () => runtime!.graph.objectFor(PART)!.position.clone()
const offsetOf = (store: DocumentStore) => store.getState().doc.nodes.find((n) => n.id === PART)!.explodeOffset

/** 把工具态开到 `factor`，并把零件再手动拖开 `drag`（模拟 gizmo 拖动）。 */
function explodeAndDrag(factor: number, drag: [number, number, number]) {
  act(() => void setExplodeTool({ groupNodeId: GROUP, factor }))
  act(() => {
    runtime!.graph.objectFor(PART)!.position.x += drag[0]
    runtime!.graph.objectFor(PART)!.position.y += drag[1]
    runtime!.graph.objectFor(PART)!.position.z += drag[2]
  })
}

describe('T-249 · 记录当前偏移', () => {
  it('**在 factor=1 记录：归零再拉回 1，该件回到刚才那个位置**（验收的字面）', () => {
    const { store } = setup()
    explodeAndDrag(1, [0.5, 0, 0])
    const observed = livePos().clone()

    click(find('explode-offset-record'))

    // 归零 → 拉回 1
    act(() => void setExplodeTool({ factor: 0 }))
    act(() => void setExplodeTool({ factor: 1 }))
    // 文档改了，运行时要按新文档重算
    act(() => void runtime!.applyPatch([], store.getState().doc, store.getState().doc))
    act(() => void setExplodeTool({ factor: 1 }))

    expect(livePos().distanceTo(observed)).toBeLessThan(1e-5)
    expect(store.getState().historyDepth, '一次记录 = 撤销栈 +1').toBe(1)
  })

  it('**在 factor=0.5 记录：存的是 factor=1 的位移**（能杀掉「删除以 factor」的那条样本）', () => {
    // 卡面变异：删掉「除以 factor」→ 这条必红。在 factor=1 记录的话两版实现给出同一个
    // 结果，那条变异是绿的——所以这条**必须**用 factor ≠ 1。
    const { store } = setup()
    explodeAndDrag(0.5, [0.5, 0, 0])
    const observed = livePos().clone()
    const docPos = store.getState().doc.nodes.find((n) => n.id === PART)!.transform.p

    click(find('explode-offset-record'))

    const recorded = offsetOf(store)!
    // 观测位移 = observed − 文档值；存进去的应当是它的 1/0.5 = 2 倍
    const observedShiftX = observed.x - docPos[0]!
    expect(recorded[0]).toBeCloseTo(observedShiftX / 0.5, 6)
    expect(recorded[0], '没除以 factor 的话它等于观测位移本身').not.toBeCloseTo(observedShiftX, 6)
  })

  it('记录下来的值就是 `explodeOffsets` 会用的那个 —— 两端对得上', () => {
    const { store } = setup()
    explodeAndDrag(0.5, [0.5, 0, 0])
    click(find('explode-offset-record'))

    const derived = explodeOffsets(store.getState().doc, GROUP).get(PART)!
    expect(derived).toEqual(offsetOf(store))
  })
})

describe('T-249 · 清除', () => {
  it('清除后回派生位移', () => {
    const { store, doc } = setup()
    const derivedBefore = explodeOffsets(doc, GROUP).get(PART)!
    explodeAndDrag(1, [0.5, 0, 0])
    click(find('explode-offset-record'))
    expect(offsetOf(store)).not.toBeNull()

    click(find('explode-offset-clear'))

    expect(offsetOf(store)).toBeNull()
    expect(explodeOffsets(store.getState().doc, GROUP).get(PART)).toEqual(derivedBefore)
  })

  it('没记录过时「清除」是禁用的', () => {
    setup()
    expect(find<HTMLButtonElement>('explode-offset-clear').disabled).toBe(true)
  })
})

describe('T-249 · 什么时候不许记录', () => {
  it('工具态关闭时按钮禁用，并说清怎么开', () => {
    setup()
    expect(find<HTMLButtonElement>('explode-offset-record').disabled).toBe(true)
    expect(find('explode-offset-hint').textContent).toContain('开启这一组的爆炸预览')
  })

  it('**factor === 0 时禁用** —— 换算是「除以 factor」，0 会写出 Infinity/NaN', () => {
    // NaN 沿 transform 传下去的表现是整个分组从画面消失，没有报错也没有日志。
    setup()
    act(() => void setExplodeTool({ groupNodeId: GROUP, factor: 0 }))
    expect(find<HTMLButtonElement>('explode-offset-record').disabled).toBe(true)
    expect(find('explode-offset-hint').textContent).toContain('系数为 0 时零件都在原位')
  })

  it('即使按钮被绕过，mutator 自己也拒绝 factor <= 0', async () => {
    // 面板禁用是第一道；这是第二道。一个 NaN 写进文档之后就传染开了。
    const { produce } = await import('immer')
    const { recordExplodeOffset } = await import('../../src/lib/explode-edit.js')
    const doc = explodeDoc()
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const next = produce(doc, (d) => void recordExplodeOffset(d, PART, [1, 2, 3], bad))
      expect(next.nodes.find((n) => n.id === PART)!.explodeOffset, `factor=${bad}`).toBeNull()
    }
  })

  it('**预览的是别的分组时按钮仍然禁用**', () => {
    // 在 A 组的预览下点开 B 组的零件，观测位移是 0（B 组没被炸开），记下去就是一条把
    // 该件钉死在原位的偏移，而用户以为自己什么都没做。
    const base = explodeDoc()
    const second = { ...base.nodes.find((n) => n.id === GROUP)!, id: 'nd_expl0002', name: '第二组', order: 7100 }
    setup({ ...base, nodes: [...base.nodes, second] } as SceneDocument)

    act(() => void setExplodeTool({ groupNodeId: 'nd_expl0002', factor: 1 }))

    expect(find<HTMLButtonElement>('explode-offset-record').disabled).toBe(true)
    expect(find('explode-offset-hint').textContent).toContain('开启这一组的爆炸预览')
  })

  it('不属于任何爆炸分组的节点没有偏移分区', () => {
    const doc = createGoldenPathDocument()
    runtime = new SceneRuntime(doc, {
      resolver: createMemoryResolver(new Map()),
      mode: 'edit',
      hotspotRenderer: new NullHotspotRenderer(),
      now: () => 0,
    })
    runtime.graph.build(doc)
    setActiveRuntime(runtime)
    const store = createDocumentStore(doc)
    store.getState().select([doc.nodes[0]!.id])
    host = document.createElement('div')
    document.body.appendChild(host)
    const created = createRoot(host)
    root = created
    act(() => {
      created.render(
        <StrictMode>
          <StoreProvider store={store}>
            <PropertiesPanel />
          </StoreProvider>
        </StrictMode>,
      )
    })

    expect(host.querySelector('[data-testid="explode-offset-section"]')).toBeNull()
  })
})
