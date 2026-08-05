// @vitest-environment jsdom
import { createGoldenPathDocument, validate } from '@w3/schema'
import type { Node, SceneDocument } from '@w3/schema'
import { StrictMode, act } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { PropertiesPanel } from '../../src/panels/PropertiesPanel.jsx'
import { createDocumentStore } from '../../src/store/document-store.js'
import type { DocumentStore } from '../../src/store/document-store.js'
import { StoreProvider } from '../../src/store/StoreContext.jsx'

/**
 * T-247 · 爆炸分组的创建入口与参数面板。
 *
 * 范式见 [ADR-0038](../../../../docs/adr/0038-编辑器-ui-事件入口的测试范式.md)：逐文件
 * jsdom + `react-dom/client` + React 19 的 `act`，零新依赖。
 *
 * 卡面点名的那条纪律（新纪律 4）：**测被调用的那一半是不够的，要有一条问过「这个函数
 * 有人调吗」。** `explode-edit.ts` 的四个 mutator 各自都能被纯函数测试压住，而
 * 「设为爆炸分组」那个按钮有没有接上它们，只有渲染出来点一下才知道。
 */

let root: Root | null = null
let host: HTMLElement | null = null

function mount(store: DocumentStore) {
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
  return host
}

afterEach(() => {
  const current = root
  if (current) act(() => current.unmount())
  host?.remove()
  root = null
  host = null
})

const find = <T extends HTMLElement>(testId: string): T => {
  const element = host?.querySelector<T>(`[data-testid="${testId}"]`)
  if (!element) throw new Error(`面板里没有 [data-testid="${testId}"]`)
  return element
}

const click = (element: HTMLElement) =>
  act(() => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })

function change(element: HTMLInputElement | HTMLSelectElement, value: string) {
  act(() => {
    const proto = element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(element, value)
    element.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

/** 找一个 `NumberField` 的输入框，按它的标签。 */
function fieldOf(label: string): HTMLInputElement {
  const labels = [...(host?.querySelectorAll<HTMLElement>('.field__label') ?? [])]
  const found = labels.find((l) => l.textContent === label)
  if (!found) throw new Error(`面板里没有字段「${label}」`)
  const input = found.parentElement?.querySelector('input')
  if (!input) throw new Error(`字段「${label}」没有输入框`)
  return input
}

/**
 * 输入一个值并提交（`NumberField` 在 blur 时才 commit）。
 *
 * 派发的是 **`focusout`** 而不是 `blur`：React 17 起 `onBlur` 委托在 `focusout` 上，
 * 因为 `blur` 不冒泡。派发 `blur` 的话这里什么都不会发生，而测试会红在一个与被测
 * 行为无关的地方。
 */
function type(input: HTMLInputElement, value: string) {
  change(input, value)
  act(() => {
    input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
  })
}

const GROUP = 'nd_expl0001'

function storeWith(explode: Node['explode']) {
  const base = createGoldenPathDocument()
  const node: Node = {
    section: null,
    explodeOffset: null,
    prefabRef: null,
    assetRef: null,
    primitive: null,
    light: null,
    id: GROUP,
    name: '泵组',
    parent: null,
    order: 7000,
    transform: { p: [0, 0, 0], r: [0, 0, 0, 1], s: [1, 1, 1] },
    visible: true,
    locked: false,
    overrides: {},
    explode,
  }
  const store = createDocumentStore({ ...base, nodes: [...base.nodes, node] } as SceneDocument)
  store.getState().select([GROUP])
  return store
}

const explodeOf = (store: DocumentStore) => store.getState().doc.nodes.find((n) => n.id === GROUP)!.explode

describe('T-247 · 走到 UI 事件入口', () => {
  it('**点「设为爆炸分组」→ explode 非空，撤销栈恰好 +1**', () => {
    // 把 onClick 换成空操作，这条必红。这就是新纪律 4 要的那条断言。
    const store = storeWith(null)
    mount(store)
    const before = store.getState().historyDepth

    click(find('explode-make'))

    expect(explodeOf(store)).not.toBeNull()
    expect(store.getState().historyDepth, '恰好一条撤销').toBe(before + 1)
  })

  it('默认配置取自 schema 的默认值，不是面板另抄的一份', () => {
    const store = storeWith(null)
    mount(store)
    click(find('explode-make'))
    expect(explodeOf(store)).toEqual({ mode: 'radial', gain: 1.5, axis: [0, 1, 0], spacing: 0.5, easing: 'easeInOutCubic' })
  })

  it('还没设为分组时没有参数控件', () => {
    const store = storeWith(null)
    mount(store)
    expect(host?.querySelector('[data-testid="explode-mode"]')).toBeNull()
    expect(host?.querySelector('[data-testid="explode-clear"]')).toBeNull()
  })

  it('切模式 → 字段跟着换（radial 的倍率 ↔ axis 的轴与间距）', () => {
    const store = storeWith({ mode: 'radial', gain: 1.5, axis: [0, 1, 0], spacing: 0.5, easing: 'linear' })
    mount(store)
    expect(() => fieldOf('散开倍率')).not.toThrow()

    change(find<HTMLSelectElement>('explode-mode'), 'axis')

    expect(explodeOf(store)?.mode).toBe('axis')
    expect(() => fieldOf('间距')).not.toThrow()
    expect(() => fieldOf('排布轴 X')).not.toThrow()
  })

  it('改一个参数 = 恰好一条 commit', () => {
    const store = storeWith({ mode: 'radial', gain: 1.5, axis: [0, 1, 0], spacing: 0.5, easing: 'linear' })
    mount(store)
    const before = store.getState().historyDepth

    type(fieldOf('散开倍率'), '3')

    expect(explodeOf(store)?.gain).toBe(3)
    expect(store.getState().historyDepth).toBe(before + 1)
  })

  it('**超范围的输入被控件挡住，文档值始终通过 validate()**', () => {
    // v0.5 T-176 的教训：面板让用户写进一个 schema 拒绝的值，保存成功，下次打开
    // validate() 判红，而错误信息指向一个用户根本不知道自己动过的字段。
    const store = storeWith({ mode: 'radial', gain: 1.5, axis: [0, 1, 0], spacing: 0.5, easing: 'linear' })
    mount(store)

    type(fieldOf('散开倍率'), '999')

    expect(explodeOf(store)?.gain, 'gain 的上限是 20').toBe(20)
    expect(validate(store.getState().doc).ok, '面板写出了一份 schema 拒绝的文档').toBe(true)

    type(fieldOf('散开倍率'), '-5')
    expect(explodeOf(store)?.gain).toBe(0)
    expect(validate(store.getState().doc).ok).toBe(true)
  })

  it('**「取消爆炸分组」保留子件的 explodeOffset**', () => {
    // 顺手删别人的数据，而撤销栈里只有一条「取消爆炸分组」——用户按 Ctrl+Z 会以为
    // 全都回来了。
    const base = createGoldenPathDocument()
    const shared = {
      section: null,
      prefabRef: null,
      assetRef: null,
      primitive: null,
      light: null,
      visible: true,
      locked: false,
      overrides: {},
      transform: { p: [0, 0, 0] as [number, number, number], r: [0, 0, 0, 1] as [number, number, number, number], s: [1, 1, 1] as [number, number, number] },
    }
    const doc = {
      ...base,
      nodes: [
        ...base.nodes,
        { ...shared, id: GROUP, name: '泵组', parent: null, order: 7000, explodeOffset: null, explode: { mode: 'radial' as const, gain: 1.5, axis: [0, 1, 0] as [number, number, number], spacing: 0.5, easing: 'linear' as const } },
        { ...shared, id: 'nd_child0001', name: '零件', parent: GROUP, order: 1, explode: null, explodeOffset: [1, 2, 3] as [number, number, number] },
      ],
    } as SceneDocument
    const store = createDocumentStore(doc)
    store.getState().select([GROUP])
    mount(store)

    click(find('explode-clear'))

    expect(explodeOf(store)).toBeNull()
    expect(
      store.getState().doc.nodes.find((n) => n.id === 'nd_child0001')?.explodeOffset,
      '顺手删掉了别人的数据',
    ).toEqual([1, 2, 3])
  })

  it('面板说清了「取消不会删偏移」', () => {
    const store = storeWith({ mode: 'radial', gain: 1.5, axis: [0, 1, 0], spacing: 0.5, easing: 'linear' })
    mount(store)
    expect(host?.textContent).toContain('不会删除各零件已记录的爆炸偏移')
  })

  it('中文模式标签取自 `EXPLODE_MODE_LABELS`，不是手写', () => {
    const store = storeWith({ mode: 'radial', gain: 1.5, axis: [0, 1, 0], spacing: 0.5, easing: 'linear' })
    mount(store)
    const options = [...find<HTMLSelectElement>('explode-mode').options].map((o) => o.textContent)
    expect(options).toEqual(['径向（以质心为中心散开）', '轴向（沿一条轴依次排开）'])
  })

  it('多选时不显示爆炸分区 —— 参数是分组自己的', () => {
    const store = storeWith(null)
    store.getState().select([GROUP, createGoldenPathDocument().nodes[0]!.id])
    mount(store)
    expect(host?.querySelector('[data-testid="explode-section"]')).toBeNull()
  })
})
