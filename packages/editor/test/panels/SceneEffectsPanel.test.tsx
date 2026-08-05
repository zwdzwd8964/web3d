// @vitest-environment jsdom
import { createGoldenPathDocument } from '@w3/schema'
import { StrictMode, act } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { SceneEffectsPanel } from '../../src/panels/SceneEffectsPanel.jsx'
import { createDocumentStore } from '../../src/store/document-store.js'
import type { DocumentStore } from '../../src/store/document-store.js'
import { StoreProvider } from '../../src/store/StoreContext.jsx'

/**
 * T-241 · **本仓第一条渲染 React 组件的测试**（范式见 ADR-0038）。
 *
 * ## 为什么非要渲染
 *
 * 台账的新纪律与 IMPL_NOTES 的 v0.5 M10 教训是同一句：**凡是卡面出现「点选」「拖动」
 * 这类手势的，验收必须有一条走到 UI 事件入口的测试或 E2E 步骤。** 这个仓库里编辑器
 * 一侧的测试全部停在 lib 层（`effects-edit.test.ts` 直接 `produce()` 调纯 mutator），
 * 于是**把某个 `onChange` 换成空箭头函数，一条测试都不会红**——面板与它的 mutator
 * 之间那根线从来没有被任何断言压住过。
 *
 * ## 为什么可以渲染
 *
 * `jsdom@30.0.1` 早就在 `@w3/editor` 的 devDependencies 里，从未被 import 过。逐文件
 * 用 `@vitest-environment jsdom` 打开它，配 React 19 自带的 `act` 与 `react-dom/client`，
 * **零新依赖**（不触发 CLAUDE.md 停下来问人第 3 条）。不引 `@testing-library/react`：
 * 那是一个新依赖，而它在这里省下的不过是几行 `dispatchEvent`。
 *
 * `StrictMode` 是刻意的：编辑器自己跑在 StrictMode 下，而 v0.5 有一个 P0 缺陷正是
 * StrictMode 的双次挂载把自动保存永久打死。测试里不开，就测不到那个形状。
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
          <SceneEffectsPanel />
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

/** 一次真实的用户输入：改值 + 派发 React 收得到的 change 事件。 */
function change(element: HTMLInputElement | HTMLSelectElement, value: string) {
  act(() => {
    // React 在 input/select 上装了 value setter，直接赋值会被它的脏值检查吞掉。
    const proto = element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set
    setter?.call(element, value)
    element.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

function toggle(element: HTMLInputElement, checked: boolean) {
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'checked')?.set
    setter?.call(element, checked)
    element.dispatchEvent(new Event('click', { bubbles: true }))
  })
}

/** `NumberField` 的拖拽把手就是它的标签。按文案找，因为它没有 testid。 */
function labelOf(text: string): HTMLElement {
  const spans = [...(host?.querySelectorAll<HTMLElement>('.field__label') ?? [])]
  const found = spans.find((s) => s.textContent === text)
  if (!found) throw new Error(`面板里没有标签「${text}」`)
  // jsdom 没实现指针捕获，而 NumberField 在按下与松手时各调一次
  found.setPointerCapture = () => {}
  found.releasePointerCapture = () => {}
  return found
}

/** 派发一个 React 收得到的指针事件。jsdom 无 PointerEvent，用 MouseEvent 同名代替。 */
function pointer(element: HTMLElement, type: string, clientX: number) {
  act(() => {
    element.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX }))
  })
}

/** 一次完整的拖拽：按下 → 若干帧 → 松手。 */
function scrub(element: HTMLElement, xs: readonly number[]) {
  pointer(element, 'pointerdown', xs[0] ?? 0)
  for (const x of xs.slice(1)) pointer(element, 'pointermove', x)
  pointer(element, 'pointerup', xs[xs.length - 1] ?? 0)
}

const storeWithOutline = (enabled: boolean) => {
  const base = createGoldenPathDocument()
  return createDocumentStore({
    ...base,
    meta: { ...base.meta, effects: { outline: { ...base.meta.effects.outline, enabled } } },
  })
}

describe('T-241 · 描边段走到 UI 事件入口', () => {
  it('关着的时候只有开关，参数控件一个都不渲染', () => {
    const store = storeWithOutline(false)
    mount(store)

    expect(find<HTMLInputElement>('outline-enabled').checked).toBe(false)
    expect(host?.querySelector('[data-testid="outline-color"]'), '关着就不该有参数').toBeNull()
    expect(host?.querySelector('[data-testid="outline-hidden-edge"]')).toBeNull()
  })

  it('**点开关这一下真的写进了文档**', () => {
    // 这条就是那根从来没被压住的线。把 onChange 换成 `() => {}` 它必红。
    const store = storeWithOutline(false)
    mount(store)

    toggle(find<HTMLInputElement>('outline-enabled'), true)

    expect(store.getState().doc.meta.effects.outline.enabled).toBe(true)
    expect(store.getState().canUndo, '一次点击 = 一条撤销').toBe(true)
  })

  it('打开之后参数控件出现，且初值取自文档', () => {
    const store = storeWithOutline(true)
    mount(store)

    expect(find<HTMLInputElement>('outline-color').value).toBe(store.getState().doc.meta.effects.outline.color)
    expect(find<HTMLSelectElement>('outline-hidden-edge').value).toBe('dim')
  })

  it('改颜色 → `meta.effects.outline.color` 变，且落一条撤销', () => {
    const store = storeWithOutline(true)
    mount(store)
    const before = store.getState().historyDepth

    change(find<HTMLInputElement>('outline-color'), '#33ccff')

    expect(store.getState().doc.meta.effects.outline.color).toBe('#33ccff')
    expect(store.getState().historyDepth).toBe(before + 1)
  })

  it('改遮挡轮廓三档 → 字段跟着变', () => {
    const store = storeWithOutline(true)
    mount(store)

    change(find<HTMLSelectElement>('outline-hidden-edge'), 'show')
    expect(store.getState().doc.meta.effects.outline.hiddenEdge).toBe('show')

    change(find<HTMLSelectElement>('outline-hidden-edge'), 'hide')
    expect(store.getState().doc.meta.effects.outline.hiddenEdge).toBe('hide')
  })

  it('**一次拖拽 = 一条撤销**，中间态不进撤销栈', () => {
    // 滑块每一帧一条撤销，会把「撤销上一步」变成撤销一像素。
    // `NumberField` 的拖拽入口是标签本身（`field__label` 上的 pointer 三件套），
    // 不是一个 range 控件——按 range 写这条测试会静默什么都不测。
    const store = storeWithOutline(true)
    mount(store)
    const before = store.getState().historyDepth
    const label = labelOf('宽度（近似像素）')

    scrub(label, [10, 40, 80])

    expect(store.getState().doc.meta.effects.outline.widthPx, '拖拽中画面要跟着走').toBeGreaterThan(3)
    expect(store.getState().historyDepth, '松手落一条，恰好一条').toBe(before + 1)
  })

  it('拖拽过程中一条撤销都不落 —— 松手前的中间态是 preview', () => {
    const store = storeWithOutline(true)
    mount(store)
    const before = store.getState().historyDepth
    const label = labelOf('强度')

    // 只按下并移动，不松手
    pointer(label, 'pointerdown', 0)
    pointer(label, 'pointermove', 30)
    pointer(label, 'pointermove', 60)

    expect(store.getState().doc.meta.effects.outline.strength, '中间态要写进文档（preview）').not.toBe(3)
    expect(store.getState().historyDepth, '但一条撤销都不许落').toBe(before)
  })

  it('面板上有那句「透明背景导出与 4× 导出不含描边」', () => {
    // 卡面逐字要求的一行说明。它是合同措辞的一部分：出图不含描边是已知限制，
    // 不写在用户看得见的地方，验收时它就是一个缺陷。
    const store = storeWithOutline(true)
    mount(store)
    expect(host?.textContent).toContain('透明背景导出与 4× 导出不含描边')
  })

  it('那句「选中色管不到规则高亮」也在', () => {
    const store = storeWithOutline(true)
    mount(store)
    expect(host?.textContent).toContain('规则里的高亮用各自预设的颜色')
  })
})

describe('T-241 · 雾段没有被描边段挤掉', () => {
  it('两段共存，雾开关仍然写得进文档', () => {
    const store = storeWithOutline(true)
    mount(store)

    toggle(find<HTMLInputElement>('fog-enabled'), true)

    expect(store.getState().doc.meta.fog.enabled).toBe(true)
  })
})
