import { createGoldenPathDocument } from '@w3/schema'
import { describe, expect, it } from 'vitest'
import { HeadlessRuntime } from '../../../src/eca/headless.js'
import { ActionRegistry, registerBuiltinActions } from '../../../src/eca/actions/index.js'
import type { ActionDefinition } from '../../../src/eca/types.js'
import { planCapture } from '../../../src/runtime/image-export.js'

/**
 * T-268 · `exportImage` 动作与 `RuntimeContext` 的双实现。
 *
 * ## 卡面自己点名的那条「变异会失灵」
 *
 * 变异 ②：把 headless 侧的 `planCapture` 换成自己抄一份的算法（**同一份数字**）→
 * 契约测试仍然绿。这就是 E18 教训 1 说的「冗余实现让变异失灵」——两边算出一样的结果，
 * 而钳位规则改了之后只有一边跟着改。
 *
 * 所以本文件额外断一条：**`HeadlessRuntime.planFn` 就是 `planCapture` 这个符号本身**。
 * 这是这批唯一一条断「是不是同一份实现」而不是「结果一不一样」的断言。
 *
 * ⚠ 覆盖率闸门（`actions.test.ts` 的 `covered` 集合）是**模块内**的，本文件够不着它，
 * 所以那边另有一条最小用例。两处都要有：那边证明「注册了就有测试」，这边证明「测的是
 * 对的东西」。
 */

const registry = registerBuiltinActions(new ActionRegistry())
const definition = registry.get('exportImage') as ActionDefinition<Record<string, unknown>>

const runtime = () => new HeadlessRuntime(createGoldenPathDocument())

async function invoke(ctx: HeadlessRuntime, params: Record<string, unknown> = {}): Promise<void> {
  const parsed = definition.schema.parse(params) as Record<string, unknown>
  await definition.handler(ctx, parsed as never, new AbortController().signal)
}

describe('T-268 · 参数表逐字照冻结清单', () => {
  it('六个字段与默认值', () => {
    expect(definition.schema.parse({})).toEqual({
      scale: 1,
      includeHotspots: true,
      background: 'auto',
      format: 'png',
      filename: '',
      await: false,
    })
  })

  it('scale 的范围是 1–4，越界即拒', () => {
    expect(definition.schema.safeParse({ scale: 0.9 }).success).toBe(false)
    expect(definition.schema.safeParse({ scale: 4.1 }).success).toBe(false)
    expect(definition.schema.safeParse({ scale: 4 }).success).toBe(true)
  })

  it('background 与 format 是封闭枚举', () => {
    expect(definition.schema.safeParse({ background: 'blurry' }).success).toBe(false)
    expect(definition.schema.safeParse({ format: 'webp' }).success).toBe(false)
  })

  it('**没有 longEdge**：长边是对话框的档位，不是规则里的参数', () => {
    // 一条写进文档的规则如果写死一个像素长边，换一台机器就会产出不同构图的图。
    const parsed = definition.schema.parse({ longEdge: 3840 }) as Record<string, unknown>
    expect('longEdge' in parsed).toBe(false)
  })

  it('引用为空 —— 出图不指向文档里的任何东西', () => {
    expect(definition.refs?.({} as never)).toEqual([])
  })

  it('describe 是中文且带上关键参数', () => {
    const text = definition.describe?.(
      { scale: 2, format: 'png', includeHotspots: true, await: false } as never,
      createGoldenPathDocument(),
    )
    expect(text).toContain('导出图片')
    expect(text).toContain('2×')
    expect(text).toContain('含热点')
  })
})

describe('T-268 · headless 侧的行为', () => {
  it('`await: true` 时等到结果，尺寸由 planCapture 算', async () => {
    const ctx = runtime()
    await invoke(ctx, { await: true, scale: 2 })
    expect(ctx.captures).toHaveLength(1)
    expect(ctx.captures[0]?.ok).toBe(true)
    // 1280×720 视口、2×、pixelRatio 1 → 2560×1440。
    expect(ctx.captures[0]?.width).toBe(2560)
    expect(ctx.captures[0]?.height).toBe(1440)
  })

  it('`await: false` 立即 resolve，且不抛', async () => {
    const ctx = runtime()
    await expect(invoke(ctx, { await: false })).resolves.toBeUndefined()
  })

  it('`await: true` 且失败时**不抛，只 warn**', async () => {
    const ctx = runtime()
    await invoke(ctx, { await: true, format: 'jpeg', background: 'transparent' })
    expect(ctx.captures[0]?.ok).toBe(false)
    expect(ctx.captures[0]?.reason).toBe('JPEG 格式不支持透明背景。请改用 PNG 格式，或把背景改为不透明。')
    expect(ctx.logs.some((l) => l.level === 'warn' && l.message.includes('导出图片失败'))).toBe(true)
  })

  it('blob 恒为 null —— 无头侧没有画布，不许给假字节', async () => {
    // 假字节会让「导出成功了吗」这个问题在两个运行时上有两个答案，而契约比的正是
    // 「除 blob 外逐字段相等」。
    const ctx = runtime()
    await invoke(ctx, { await: true })
    expect(ctx.captures[0]?.blob).toBeNull()
    expect(ctx.captures[0]?.ok).toBe(true)
  })

  it('钳位说明原样带出来', async () => {
    const ctx = runtime()
    await invoke(ctx, { await: true, scale: 4 })
    // 1280 × 4 = 5120，超过 3840 的合同上限。
    expect(ctx.captures[0]?.notice).toContain('导出长边上限为 3840 像素')
    expect(ctx.captures[0]?.width).toBe(3840)
  })

  it('打开着的面板数进结果', async () => {
    const ctx = runtime()
    const hotspot = ctx.doc.hotspots[0]
    if (hotspot) ctx.openPanel(hotspot.id)
    await invoke(ctx, { await: true })
    expect(ctx.captures[0]?.panelCount).toBe(hotspot ? 1 : 0)
  })
})

describe('T-268 · 两个运行时共用同一个 planCapture 符号', () => {
  it('**断的是符号本身，不是结果**', () => {
    // 卡面点名：抄一份同数字的算法 → 契约测试仍然绿，而钳位规则改了之后只有一边跟着改。
    // 「结果相等」对那种失效完全无感，只有身份断言抓得住。
    expect(HeadlessRuntime.planFn).toBe(planCapture)
  })

  it('headless 的结果与直接调 planCapture 逐字段相同', async () => {
    const ctx = runtime()
    const direct = planCapture(
      { viewport: ctx.captureViewport, scale: 4, background: 'auto', format: 'png' },
      ctx.captureLimits,
    )
    expect(direct.ok, '这条比对的前提').toBe(true)
    if (!direct.ok) return

    await invoke(ctx, { await: true, scale: 4 })
    const capture = ctx.captures[0]!
    expect(capture.width).toBe(direct.width)
    expect(capture.height).toBe(direct.height)
    expect(capture.notice).toBe(direct.notice)
    expect(capture.background).toBe(direct.background)
    expect(capture.format).toBe(direct.format)
  })
})
