import { createGoldenPathDocument } from '@w3/schema'
import type { SceneDocument } from '@w3/schema'
import { Object3D, PerspectiveCamera, Scene } from 'three'
import { describe, expect, it, vi } from 'vitest'
import { ChromeRegistry } from '../../src/runtime/chrome-registry.js'
import { RenderPipeline } from '../../src/runtime/render-pipeline.js'
import type { ComposerContext, ComposerLike } from '../../src/runtime/render-pipeline.js'

/**
 * T-235 · 后处理链的生命周期与编辑期辅助物的注册表。
 *
 * ## 这个文件里没有一个真 `EffectComposer`
 *
 * 真 composer 要 WebGL 上下文，在 Node 里 new 一下就抛。所以工厂是注入的，而**注入口
 * 同时是本卡最重要那条验收的观测点**：「默认文档下 composer 工厂被调用 0 次」——
 * 断的是工厂调用数，不是 `mode === 'direct'`，后者对一个「建了 target 又不用」的实现
 * 同样为真。
 */

function fakeComposer(): ComposerLike & { calls: Record<string, number> } {
  const calls = { render: 0, setSize: 0, dispose: 0 }
  const passes: unknown[] = []
  return {
    calls,
    passes,
    addPass: (p) => void passes.push(p),
    render: () => void calls.render++,
    setSize: () => void calls.setSize++,
    dispose: () => void calls.dispose++,
    renderTarget1: { samples: 4 },
    renderTarget2: { samples: 0 },
  }
}

const ctx = (): ComposerContext => ({
  renderer: {} as never,
  scene: new Scene(),
  camera: new PerspectiveCamera(),
  width: 800,
  height: 600,
  pixelRatio: 1,
})

const withOutline = (enabled: boolean): SceneDocument => {
  const base = createGoldenPathDocument()
  return { ...base, meta: { ...base.meta, effects: { outline: { ...base.meta.effects.outline, enabled } } } }
}

describe('T-235 · 描边关着时一行 target 都不建', () => {
  it('默认文档下 composer 工厂被调用 0 次', () => {
    // **断工厂调用数，不断 mode。** D31 / ADR-0021 要的是「渲染路径与 v0.5 完全相同」，
    // 而一个「建了 composer 又不用它」的实现 mode 也是 'direct'。
    const createComposer = vi.fn(fakeComposer)
    const pipeline = new RenderPipeline({ createComposer })
    pipeline.sync(createGoldenPathDocument(), ctx())

    expect(createComposer).not.toHaveBeenCalled()
    expect(pipeline.mode).toBe('direct')
  })

  it('前提：默认文档的描边确实是关着的', () => {
    // 上一条的判别力全靠这个前提。默认值哪天变了，那条会变成一条什么都不测的断言。
    expect(createGoldenPathDocument().meta.effects.outline.enabled).toBe(false)
  })

  it('enabled 为 true 时才建，且只建一次', () => {
    const createComposer = vi.fn(fakeComposer)
    const pipeline = new RenderPipeline({ createComposer })
    const doc = withOutline(true)

    pipeline.sync(doc, ctx())
    pipeline.sync(doc, ctx())
    pipeline.sync(doc, ctx())

    expect(createComposer).toHaveBeenCalledTimes(1)
    expect(pipeline.mode).toBe('composed')
  })

  it('来回切两次：构造 2 次、dispose 2 次，且 mode 跟着走', () => {
    const composers: ReturnType<typeof fakeComposer>[] = []
    const pipeline = new RenderPipeline({
      createComposer: () => {
        const c = fakeComposer()
        composers.push(c)
        return c
      },
    })

    for (let i = 0; i < 2; i++) {
      pipeline.sync(withOutline(true), ctx())
      expect(pipeline.mode).toBe('composed')
      pipeline.sync(withOutline(false), ctx())
      expect(pipeline.mode).toBe('direct')
    }

    expect(composers).toHaveLength(2)
    for (const c of composers) expect(c.calls.dispose, '拆掉时没有 dispose，target 就漏了').toBe(1)
  })

  it('没有渲染器（ctx 为 null）时一律拆掉，哪怕文档开着描边', () => {
    const composer = fakeComposer()
    const pipeline = new RenderPipeline({ createComposer: () => composer })
    pipeline.sync(withOutline(true), ctx())
    expect(pipeline.mode).toBe('composed')

    pipeline.sync(withOutline(true), null)
    expect(pipeline.mode).toBe('direct')
    expect(composer.calls.dispose).toBe(1)
  })

  it('没有注入工厂时安静走直连，不抛', () => {
    // 一个没注入工厂的宿主（今天的单测、将来的无头导出）不该因为文档里开了描边就崩掉。
    const pipeline = new RenderPipeline({})
    expect(() => pipeline.sync(withOutline(true), ctx())).not.toThrow()
    expect(pipeline.mode).toBe('direct')
  })
})

describe('T-235 · setForced（benchmark 的开关）', () => {
  it('强制 false 时，文档说 true 也不建', () => {
    const createComposer = vi.fn(fakeComposer)
    const pipeline = new RenderPipeline({ createComposer })
    pipeline.setForced(false)
    pipeline.sync(withOutline(true), ctx())
    expect(createComposer).not.toHaveBeenCalled()
  })

  it('强制 true 时，文档说 false 也建', () => {
    const createComposer = vi.fn(fakeComposer)
    const pipeline = new RenderPipeline({ createComposer })
    pipeline.setForced(true)
    pipeline.sync(withOutline(false), ctx())
    expect(createComposer).toHaveBeenCalledTimes(1)
  })

  it('交还 null 之后重新跟文档走', () => {
    const createComposer = vi.fn(fakeComposer)
    const pipeline = new RenderPipeline({ createComposer })
    pipeline.setForced(true)
    pipeline.sync(withOutline(false), ctx())
    pipeline.setForced(null)
    pipeline.sync(withOutline(false), ctx())
    expect(pipeline.mode).toBe('direct')
  })
})

describe('T-235 · ChromeRegistry', () => {
  const named = (name: string) => {
    const o = new Object3D()
    o.name = name
    return o
  }

  it('注册进 root，反注册摘掉', () => {
    const chrome = new ChromeRegistry()
    const grid = named('grid')
    const off = chrome.register(grid)

    expect(chrome.root.children).toContain(grid)
    expect(chrome.objects).toEqual([grid])

    off()
    expect(chrome.root.children).not.toContain(grid)
    expect(chrome.objects).toEqual([])
    // 幂等：重复反注册不抛
    expect(() => off()).not.toThrow()
  })

  it('隐藏后，注册过的**每一个**对象都不可见', () => {
    const chrome = new ChromeRegistry()
    const objects = ['grid', 'helpers', 'gizmo'].map(named)
    for (const o of objects) chrome.register(o)

    chrome.setVisible(false)
    // 遍历断言：只翻 root.visible 的实现在这条下红——子对象自己的 flag 仍是 true
    for (const o of chrome.objects) expect(o.visible, o.name).toBe(false)
  })

  it('**显示时还原各自隐藏那一刻的值，不是一律 true**', () => {
    // gizmo 的手柄可见性由选择集驱动：无选中时它自己是 false。一律恢复成 true 会在
    // 「退出预览且无选中」时把 TransformControls 的手柄画出来。
    const chrome = new ChromeRegistry()
    const grid = named('grid')
    const gizmo = named('gizmo')
    gizmo.visible = false // 无选中
    chrome.register(grid)
    chrome.register(gizmo)

    chrome.setVisible(false)
    chrome.setVisible(true)

    expect(grid.visible, '网格本来是可见的，要还回来').toBe(true)
    expect(gizmo.visible, '手柄本来就不可见，不许被「还原」成可见').toBe(false)
  })

  it('重复隐藏是幂等的 —— 第二次不会把记录覆盖成 false', () => {
    const chrome = new ChromeRegistry()
    const grid = named('grid')
    chrome.register(grid)

    chrome.setVisible(false)
    chrome.setVisible(false)
    chrome.setVisible(true)

    expect(grid.visible).toBe(true)
  })

  it('隐藏状态下新注册的对象立刻跟着隐藏', () => {
    // 退出预览前新建一盏灯，它的辅助线框不该立刻出现在预览画面里。
    const chrome = new ChromeRegistry()
    chrome.setVisible(false)
    const late = named('late')
    chrome.register(late)

    expect(late.visible).toBe(false)
    chrome.setVisible(true)
    expect(late.visible, '还原时它也要回到注册时的值').toBe(true)
  })

  it('dispose 清空并把 root 摘出场景', () => {
    const chrome = new ChromeRegistry()
    const scene = new Scene()
    scene.add(chrome.root)
    chrome.register(named('grid'))

    chrome.dispose()
    expect(chrome.objects).toEqual([])
    expect(scene.children).not.toContain(chrome.root)
  })
})
