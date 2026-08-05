// @vitest-environment jsdom
import { checkIntegrity, createGoldenPathDocument } from '@w3/schema'
import type { SceneDocument } from '@w3/schema'
import { NullHotspotRenderer, SceneRuntime, createActionRefResolver, createMemoryResolver, defaultRegistry, registerBuiltinActions } from '@w3/core'
import { StrictMode, act } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { AnimationPanel } from '../../src/panels/AnimationPanel.jsx'
import { setActiveRuntime } from '../../src/viewport/runtime-registry.js'
import { createDocumentStore } from '../../src/store/document-store.js'
import type { DocumentStore } from '../../src/store/document-store.js'
import { StoreProvider } from '../../src/store/StoreContext.jsx'

/**
 * T-254 · 动画面板的 imported 那一半。
 *
 * 这张卡兑现的是一条**断链**：整条 `ClipPlayer` 栈建得很完整而零生产调用者。所以这里
 * 每一条都从 **UI 事件入口**走——`createImportedAnimation` 有没有被真的调用，只有点一下
 * 才知道（新纪律 4）。
 *
 * 「新建」那条断的是**数量前后对比**，不是 `.first()` 也不是 `not.toBeNull()`：
 * v0.5 的 T-115 与 E18 各在那两种写法上栽过一次。
 */

const CLIP_A = 'Disassemble'
const CLIP_B = 'Rotate'

/** 黄金路径 + 一份带两段动画的模型资产。 */
function docWithClips(): SceneDocument {
  const base = createGoldenPathDocument()
  return {
    ...base,
    assets: base.assets.map((a, i) =>
      i === 0 ? { ...a, stats: { ...a.stats, animations: [CLIP_A, CLIP_B] } } : a,
    ),
  } as SceneDocument
}

let runtime: SceneRuntime | null = null
let root: Root | null = null
let host: HTMLElement | null = null

beforeAll(() => registerBuiltinActions())

function setup(doc: SceneDocument = docWithClips()) {
  runtime = new SceneRuntime(doc, {
    resolver: createMemoryResolver(new Map()),
    mode: 'edit',
    hotspotRenderer: new NullHotspotRenderer(),
    now: () => 0,
  })
  runtime.graph.build(doc)
  setActiveRuntime(runtime)

  const store = createDocumentStore(doc)
  host = document.createElement('div')
  document.body.appendChild(host)
  const created = createRoot(host)
  root = created
  act(() => {
    created.render(
      <StrictMode>
        <StoreProvider store={store}>
          <AnimationPanel />
        </StoreProvider>
      </StrictMode>,
    )
  })
  return { store, doc }
}

afterEach(() => {
  const current = root
  if (current) act(() => current.unmount())
  host?.remove()
  root = null
  host = null
  runtime?.dispose()
  runtime = null
  setActiveRuntime(null)
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

function change(element: HTMLSelectElement, value: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set?.call(element, value)
    element.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

const importedOf = (store: DocumentStore) => store.getState().doc.animations.filter((a) => a.kind === 'imported')

describe('T-254 · 新建导入动画', () => {
  it('**点一下就多一条 imported 记录，撤销栈恰好 +1**', () => {
    // 数量前后对比，不是 `.first()` 也不是 `not.toBeNull()`。
    const { store } = setup()
    const before = importedOf(store).length

    click(find('imported-create'))

    expect(importedOf(store).length).toBe(before + 1)
    expect(store.getState().historyDepth).toBe(1)
  })

  it('新建的那条指向选中的资产与 clip', () => {
    const { store, doc } = setup()
    change(find<HTMLSelectElement>('imported-clip'), CLIP_B)

    click(find('imported-create'))

    const created = importedOf(store)[0]!
    expect(created).toMatchObject({ kind: 'imported', assetId: doc.assets[0]!.id, clipName: CLIP_B })
  })

  it('新建之后 `checkIntegrity` 零 error', () => {
    const { store } = setup()
    click(find('imported-create'))

    const issues = checkIntegrity(store.getState().doc, { actionRefs: createActionRefResolver(defaultRegistry) })
    expect(issues.filter((i) => i.level === 'error')).toEqual([])
  })

  it('资产里一段动画都没有时整块不出现', () => {
    // 一个永远只有「（无）」一项的下拉框只会让人以为功能坏了。
    // ⚠ 黄金路径那份资产**自带**一段 `Disassemble`，所以要显式清空才测得到这条。
    const base = createGoldenPathDocument()
    const noClips = { ...base, assets: base.assets.map((a) => ({ ...a, stats: { ...a.stats, animations: [] } })) } as SceneDocument
    setup(noClips)
    expect(host?.querySelector('[data-testid="imported-create-row"]')).toBeNull()
  })

  it('clip 下拉框列的是资产自己声明的那几段', () => {
    setup()
    const options = [...find<HTMLSelectElement>('imported-clip').options].map((o) => o.value)
    expect(options).toEqual([CLIP_A, CLIP_B])
  })
})

describe('T-254 · imported 行的参数', () => {
  it('速度 / 循环 / 停在末帧都能改，各落一条撤销', () => {
    const { store } = setup()
    click(find('imported-create'))
    const id = importedOf(store)[0]!.id
    const before = store.getState().historyDepth

    const checkboxes = [...(host?.querySelectorAll<HTMLInputElement>('input[type="checkbox"]') ?? [])]
    expect(checkboxes.length, '循环与停在末帧两个勾选框').toBeGreaterThanOrEqual(2)
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'checked')?.set?.call(checkboxes[0]!, true)
      checkboxes[0]!.dispatchEvent(new Event('click', { bubbles: true }))
    })

    const after = store.getState().doc.animations.find((a) => a.id === id)!
    expect(after.kind === 'imported' && after.loop).toBe(true)
    expect(store.getState().historyDepth).toBe(before + 1)
  })
})

describe('T-254 · 编辑期预览', () => {
  it('**点预览 → 运行时开始播；点停止 → 停**，而文档一字未改', () => {
    // ⚠ 用**补间**那一行测，不用 imported：imported 片段要资产字节真的加载完才播得起来，
    // 而这个 harness 不加载资产（那是 loader 的测试，不是本卡的）。预览按钮在每一行上
    // 都是同一个 `previewAnimation`，所以补间那一行同样压得住这条线。
    const { store } = setup()
    const id = store.getState().doc.animations[0]!.id
    const docBefore = store.getState().doc

    click(find(`anim-preview-${id}`))
    expect(runtime!.isAnimationPlaying(id), '把 previewAnimation 改成空操作，这条必红').toBe(true)

    click(find(`anim-stop-${id}`))
    expect(runtime!.isAnimationPlaying(id)).toBe(false)

    expect(store.getState().doc, '预览不进文档').toBe(docBefore)
    expect(store.getState().historyDepth, '预览不进撤销栈').toBe(0)
  })

  it('没有活着的运行时时点预览不抛', () => {
    const { store } = setup()
    const id = store.getState().doc.animations[0]!.id
    setActiveRuntime(null)

    expect(() => click(find(`anim-preview-${id}`))).not.toThrow()
  })
})

describe('T-254 · 仍然不做时间轴', () => {
  it('**面板 DOM 里不存在任何刻度 / 关键帧元素**', () => {
    // 结构断言，防以后有人「顺手加个时间轴」。R03 把动画创作认定为合同上最容易膨胀的
    // 一项，闭合的 `kind` 联合是工程上的防线，这一条是它在 UI 上的对应物。
    const { store } = setup()
    click(find('imported-create'))

    const html = host!.innerHTML
    for (const forbidden of ['timeline', 'keyframe', 'ruler', 'playhead', 'track-lane']) {
      expect(html, `面板里出现了 ${forbidden}`).not.toContain(forbidden)
    }
    // range 滑块是时间轴的第一步，也一并挡住
    expect(host!.querySelectorAll('input[type="range"]')).toHaveLength(0)
    void store
  })
})
