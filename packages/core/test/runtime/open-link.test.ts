import { createGoldenPathDocument } from '@w3/schema'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ActionRegistry, registerBuiltinActions } from '../../src/eca/actions/index.js'
import type { ActionDefinition } from '../../src/eca/types.js'
import { HeadlessRuntime } from '../../src/eca/headless.js'
import { NullHotspotRenderer, SceneRuntime, defaultOpenLink } from '../../src/runtime/index.js'

/**
 * T-270 · `openLink` 的注入口。
 *
 * ## 这张卡真正的价值是那条「⚠ 登记」
 *
 * `openLink` **早已让文档携带任意外部 URL 且零校验**——`OpenLinkParams.url` 是
 * `z.string().min(1)`，一个 `javascript:` 开头的地址照样 `safeParse` 通过、照样进文档、
 * 照样发布。所以「我们从不让文档决定外部地址」是错的，**v0 就让了**。
 *
 * 这不是本卡要修的东西（ADR-0024 决定 6 明确不修，并要求把这条不对称登记下来）。本卡做的
 * 是把「打开」这个动作变成一处可注入的口子，好让嵌入场景下宿主能拒绝导航——一个嵌进别人
 * 页面的播放器不该有权把宿主的整个标签页导走。
 *
 * ## 卡面那条变异检验，实测**咬不动**
 *
 * 卡面说：把 `OpenLinkParams.url` 改成 `z.string().url()` → 「含 `javascript:` 的历史文档
 * 仍能 validate」那条必须红。实测不成立——`OpenLinkParams` 在 `@w3/core`，而
 * `validate()` 在 `@w3/schema` 且只校验 `SceneDocument`，**它根本不跑 core 的逐动作 schema**。
 * 所以那条变异在今天的仓库里是不可观测的。下面因此补了一条 ECA 侧的断言，让它可观测。
 */

const registry = registerBuiltinActions(new ActionRegistry())
const openLinkAction = registry.get('openLink') as ActionDefinition<Record<string, unknown>>

afterEach(() => vi.unstubAllGlobals())

/** 一个装了 renderer 替身的运行时。`openLink` 不碰渲染器，所以替身可以很薄。 */
function runtime(options: Partial<ConstructorParameters<typeof SceneRuntime>[1]> = {}): SceneRuntime {
  return new SceneRuntime(createGoldenPathDocument(), {
    canvas: { clientWidth: 800, clientHeight: 600 } as HTMLCanvasElement,
    resolver: { resolve: async () => new ArrayBuffer(8) },
    mode: 'play',
    createRenderer: () =>
      ({
        info: { memory: { geometries: 0, textures: 0 } },
        shadowMap: { enabled: false, type: -1 },
        render: () => {},
        setSize: () => {},
        setPixelRatio: () => {},
        getPixelRatio: () => 1,
        getSize: (t: { set: (w: number, h: number) => unknown }) => t.set(800, 600),
        setRenderTarget: () => {},
        getRenderTarget: () => null,
        clear: () => {},
        dispose: () => {},
        domElement: {} as HTMLCanvasElement,
        extensions: { has: () => false },
      }) as never,
    hotspotRenderer: new NullHotspotRenderer(),
    ...options,
  } as never)
}

describe('T-270 · 老行为回归', () => {
  it('不注入时逐字调 `globalThis.open(url, target, "noopener,noreferrer")`', () => {
    // 三个实参逐字比。`noopener` 是安全边界：没有它，新开的页面拿得到 `window.opener`
    // 并且可以把原页面导走（反向标签劫持）。
    const open = vi.fn()
    vi.stubGlobal('open', open)

    runtime().openLink('https://example.com/manual', '_blank')

    expect(open).toHaveBeenCalledTimes(1)
    expect(open).toHaveBeenCalledWith('https://example.com/manual', '_blank', 'noopener,noreferrer')
  })

  it('`_self` 也走同一条路，target 原样透传', () => {
    const open = vi.fn()
    vi.stubGlobal('open', open)
    runtime().openLink('https://example.com/a', '_self')
    expect(open).toHaveBeenCalledWith('https://example.com/a', '_self', 'noopener,noreferrer')
  })

  it('无头环境（没有 `globalThis.open`）只 warn，不抛', () => {
    // 这条警告在重构前**零测试覆盖**，一个「顺手改成自由函数」的重构会把它悄悄丢掉。
    const logs: { level: string; message: string }[] = []
    vi.stubGlobal('open', undefined)
    runtime({ onLog: (level: string, message: string) => logs.push({ level, message }) } as never).openLink('https://x/y', '_blank')
    expect(logs.some((l) => l.level === 'warn' && l.message.includes('无头环境下不打开链接'))).toBe(true)
  })

  it('`defaultOpenLink` 就是那份老行为，单独可测', () => {
    const open = vi.fn()
    vi.stubGlobal('open', open)
    defaultOpenLink('https://example.com/z', '_blank', () => {})
    expect(open).toHaveBeenCalledWith('https://example.com/z', '_blank', 'noopener,noreferrer')
  })
})

describe('T-270 · 注入之后', () => {
  it('注入的实现**完全取代**默认行为 —— 不是「先发事件再打开」', () => {
    // 嵌入场景下宿主要能拒绝导航，而一个「已经导航了，顺便通知你」的接口给不了它这个能力。
    const open = vi.fn()
    vi.stubGlobal('open', open)
    const seen: { url: string; target: string }[] = []

    runtime({ openLink: (url: string, target: string) => void seen.push({ url, target }) } as never).openLink('https://x/y', '_self')

    expect(seen).toEqual([{ url: 'https://x/y', target: '_self' }])
    expect(open, '注入之后一次都不许导航').not.toHaveBeenCalled()
  })

  it('注入的实现拿得到 warn 通道', () => {
    const logs: string[] = []
    runtime({
      onLog: (_level: string, message: string) => logs.push(message),
      openLink: (url: string, _target: string, warn: (m: string) => void) => warn(`宿主拒绝了 ${url}`),
    } as never).openLink('javascript:alert(1)', '_blank')
    expect(logs.some((m) => m.includes('宿主拒绝了'))).toBe(true)
  })

  it('无头运行时那侧只记意图，两个运行时都不导航', () => {
    // C3：两个视图一份引擎。无头侧记账，真运行时走注入口——两边都不会在测试里把页面导走。
    const ctx = new HeadlessRuntime(createGoldenPathDocument())
    ctx.openLink('https://example.com/manual', '_blank')
    expect(ctx.openedLinks).toEqual([{ url: 'https://example.com/manual', target: '_blank' }])
  })
})

describe('T-270 · C4 的边界：零校验是既成事实，本卡不修', () => {
  it('`javascript:` 的地址照样通过动作 schema —— **v0 起就是这样**', () => {
    // ⚠ 卡面的变异检验（把 url 改成 `z.string().url()` → 「历史文档仍能 validate」转红）
    // **在今天的仓库里不可观测**：`OpenLinkParams` 在 @w3/core，而 `validate()` 在
    // @w3/schema 且只校验 SceneDocument，它不跑 core 的逐动作 schema。
    //
    // 这条断言是那条变异的可观测落点：它直接对着 core 的 schema 断，改成 `.url()` 立刻红。
    expect(openLinkAction.schema.safeParse({ url: 'javascript:alert(1)' }).success).toBe(true)
  })

  it('相对路径、锚点、mailto 一样通过 —— 说明这不是「漏了一种」而是没有校验', () => {
    for (const url of ['/manual.pdf', '#step-3', 'mailto:a@b.c', 'data:text/html,<b>x</b>']) {
      expect(openLinkAction.schema.safeParse({ url }).success, url).toBe(true)
    }
  })

  it('**`z.string().url()` 挡不住 `javascript:`** —— 卡面建议的那个收紧是安全剧场', () => {
    // 实测 zod：`javascript:alert(1)` 与 `data:text/html,<b>x</b>` 两个都**通过** `.url()`，
    // 被挡住的反而是 `/manual.pdf` 与 `#step-3` 这两个完全正当的相对地址。
    //
    // 也就是说卡面提议的那次收紧，代价是拦掉正当用法，收益是零——真正管用的是
    // `integrity.ts` 里那对 `SAFE_SCHEME` / `ANY_SCHEME` 正则（I44 走的就是它们）。
    // 这条断言把这件事钉住，免得下一个人「顺手加个 .url() 更安全」。
    expect(openLinkAction.schema.safeParse({ url: 'javascript:alert(1)' }).success).toBe(true)
    expect(openLinkAction.schema.safeParse({ url: '/manual.pdf' }).success, '相对地址必须仍然可用').toBe(true)
  })

  it('空串仍然被拒 —— 唯一的那条校验还在', () => {
    expect(openLinkAction.schema.safeParse({ url: '' }).success).toBe(false)
  })
})
