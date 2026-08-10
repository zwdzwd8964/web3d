// @vitest-environment jsdom
import { createGoldenPathDocument } from '@w3/schema'
import type { SceneDocument } from '@w3/schema'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { HotspotPanel } from '../../src/panels/HotspotPanel.jsx'
import { createDocumentStore } from '../../src/store/document-store.js'
import type { DocumentStore } from '../../src/store/document-store.js'
import { StoreProvider } from '../../src/store/StoreContext.jsx'

/**
 * T-264 · 热点面板的「编号」输入框。
 *
 * 卡面把这一环写死在本卡内、不许推给别的卡，理由很实在：`style.label` 是 v3 schema 里
 * **已经冻结的字段**，`markerLabel` 也已经读它——但如果没有一个地方能写它，这个字段就是
 * 又一条「铺好路没人走」。而它的替代品（按下标编号）会让删掉一个热点使它后面全部改号，
 * 而热点编号是印在客户的作业指导书上的。
 */

let host: HTMLDivElement
let root: Root
let store: DocumentStore

/** 一份带三个 number 热点的文档。 */
function docWithNumbers(): SceneDocument {
  const base = createGoldenPathDocument()
  const first = base.hotspots[0]
  if (!first) throw new Error('黄金路径文档应当至少有一个热点')
  return {
    ...base,
    hotspots: [1, 2, 3].map((n) => ({
      ...first,
      id: `hs_0000000${n}`,
      name: `热点 ${n}`,
      style: { ...first.style, marker: 'number' as const },
    })),
  }
}

beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  store = createDocumentStore(docWithNumbers(), { now: () => 0 })
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

function render(): void {
  act(() => {
    root.render(
      <StoreProvider store={store}>
        <HotspotPanel />
      </StoreProvider>,
    )
  })
}

/** React 在 input 上装了自己的 value setter，绕过它事件不会带上新值。 */
function typeInto(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  setter?.call(input, value)
  act(() => {
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

const labelInputs = () => [...host.querySelectorAll<HTMLInputElement>('[data-testid="hotspot-label"]')]

describe('T-264 · 编号输入框', () => {
  it('number 标记下出现，且 placeholder 是缺省序号', () => {
    render()
    const inputs = labelInputs()
    expect(inputs.length, '三个 number 热点应当各有一个编号框').toBe(3)
    // placeholder 说清「不填会显示什么」。没有它，用户不知道空着代表什么。
    expect(inputs[0]?.placeholder).toBe('默认 1')
    expect(inputs[2]?.placeholder).toBe('默认 3')
  })

  it('改值 → 文档 style.label 变，且一次撤销', () => {
    render()
    const before = store.getState().historyDepth
    typeInto(labelInputs()[1]!, 'A1')

    expect(store.getState().doc.hotspots[1]?.style.label).toBe('A1')
    expect(store.getState().historyDepth, '一次输入一条撤销').toBe(before + 1)
    // 别人不受影响：写死一个不动其余，这正是这个字段存在的理由。
    expect(store.getState().doc.hotspots[0]?.style.label).toBeUndefined()
    expect(store.getState().doc.hotspots[2]?.style.label).toBeUndefined()
  })

  it('清空 → 字段被删掉，而不是存一个空串', () => {
    render()
    typeInto(labelInputs()[0]!, 'B7')
    expect(store.getState().doc.hotspots[0]?.style.label).toBe('B7')

    typeInto(labelInputs()[0]!, '')
    // 存空串的话，`label ?? String(ordinal+1)` 会拿到 `''` 而不是走缺省分支，
    // 标记上从此一个字都没有——而用户以为自己只是「清掉了自定义编号」。
    expect(store.getState().doc.hotspots[0]?.style.label).toBeUndefined()
    expect('label' in (store.getState().doc.hotspots[0]?.style ?? {})).toBe(false)
  })

  it('非 number 标记下不出现 —— 填了也不显示的框不该存在', () => {
    const base = createGoldenPathDocument()
    const first = base.hotspots[0]!
    store = createDocumentStore(
      { ...base, hotspots: [{ ...first, style: { ...first.style, marker: 'dot' } }] },
      { now: () => 0 },
    )
    render()
    expect(labelInputs()).toHaveLength(0)
  })

  it('撤销把编号还回去', () => {
    render()
    typeInto(labelInputs()[0]!, 'C9')
    act(() => void store.getState().undo())
    expect(store.getState().doc.hotspots[0]?.style.label).toBeUndefined()
  })
})
