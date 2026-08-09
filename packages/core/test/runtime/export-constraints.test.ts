import { describe, expect, it } from 'vitest'
import { estimateExportVram, resolveExportPipeline } from '../../src/runtime/render-pipeline.js'
import { MAX_SCALE_COMPOSED, MAX_SCALE_DIRECT } from '../../src/runtime/image-export.js'

/**
 * T-263 · 出图相容性：透明背景降级、倍率上限、显存预估。
 *
 * ## X-18 的裁决：降级，不是拒绝
 *
 * 用户拿到一张图 + 一句解释，好过拿到一个禁用的按钮。他真正要的是一张能贴进 PPT 的
 * 透明底图；描边可以没有，图不能没有。这一条推翻了 `design/render-out.md` ADR-C 的
 * 「拒绝导出」主张（[ADR-0021](../../../docs/adr/0021-撤销-D20-v1.0-引入后处理链.md)）。
 *
 * ## 三条纪律
 *
 * - 文案里**不许出现「雾」**（拍板项 P-11）。雾画在物体像素上，背景像素仍是 alpha 0，
 *   把它列进「透明背景导出会丢失」的清单里是在描述一个不存在的限制。
 * - 显存预估**用公式校验，不是硬编码一个数**（卡面点名）。硬编码的期望值在公式改了
 *   之后照样绿——它守的是那次抄写，不是那个公式。
 * - `reason` 断言**具体措辞**，不是 `not.toBeNull()`（E18 教训 3：那种断言对 `undefined`
 *   也成立，等于什么都没断）。
 */

describe('T-263 · 透明背景降级', () => {
  it('transparent:true → 恒 direct、droppedOutline、reason 非空且不含「雾」', () => {
    for (const docMode of ['direct', 'composed'] as const) {
      const decision = resolveExportPipeline({ transparent: true, scale: 1, docMode })
      expect(decision.mode, `${docMode} 下透明背景也必须走 direct`).toBe('direct')
    }

    // droppedOutline 只在**本来有描边**时为真：composed 才有 OutlinePass。
    const composed = resolveExportPipeline({ transparent: true, scale: 1, docMode: 'composed' })
    expect(composed.droppedOutline).toBe(true)
    expect(composed.reason).toBe('透明背景导出不包含描边效果。')
    // P-11：不许把雾一起列进去。
    expect(composed.reason).not.toContain('雾')
  })

  it('本来就是 direct 时不谎报「丢了描边」—— 本来就没有', () => {
    const decision = resolveExportPipeline({ transparent: true, scale: 1, docMode: 'direct' })
    expect(decision.droppedOutline).toBe(false)
    expect(decision.reason).toBe('')
  })

  it('不透明时管线跟着文档走', () => {
    expect(resolveExportPipeline({ transparent: false, scale: 1, docMode: 'composed' }).mode).toBe('composed')
    expect(resolveExportPipeline({ transparent: false, scale: 1, docMode: 'direct' }).mode).toBe('direct')
  })
})

describe('T-263 · 倍率上限随管线变', () => {
  it('scale:4 且 composed → 降到 2，reason 说清是 2×', () => {
    const decision = resolveExportPipeline({ transparent: false, scale: 4, docMode: 'composed' })
    expect(decision.scale).toBe(MAX_SCALE_COMPOSED)
    // 具体措辞，不是 `not.toBeNull()`。
    expect(decision.reason).toBe('叠加了描边等画面效果时导出倍率上限为 2×，已按 2× 导出。')
  })

  it('direct 下 4× 不动 —— 证明上一条不是「一律降到 2」', () => {
    const decision = resolveExportPipeline({ transparent: false, scale: 4, docMode: 'direct' })
    expect(decision.scale).toBe(MAX_SCALE_DIRECT)
    expect(decision.reason).toBe('')
  })

  it('降级之后吃的是 direct 的 4× —— 透明背景已经把管线拽回 direct 了', () => {
    // 这一条防的是先按 docMode 钳倍率、再按 transparent 改 mode 的写法：那样会白白
    // 损失一半分辨率，而用户看不出为什么。
    const decision = resolveExportPipeline({ transparent: true, scale: 4, docMode: 'composed' })
    expect(decision.mode).toBe('direct')
    expect(decision.scale).toBe(4)
    expect(decision.reason).not.toContain('倍率上限')
  })

  it('用的就是 T-262 落的那两个常量，不是抄了一份', () => {
    // X-19 的另一半。抄一份常量 = 把「composed 上限」写在两个地方，而它们会分叉。
    expect(MAX_SCALE_DIRECT).toBe(4)
    expect(MAX_SCALE_COMPOSED).toBe(2)
  })
})

describe('T-263 · 显存预估', () => {
  /** ADR-0021 腿 3 的两个系数。测试自己算一遍，而不是抄一个结果数字。 */
  const expected = (w: number, h: number, passes: number) => 48 * w * h + 19 * w * h * passes

  it('1920×1080 / composed / 2 passes 落在 170–190 MB', () => {
    const bytes = estimateExportVram({ width: 1920, height: 1080, mode: 'composed', outlinePasses: 2 })
    const mb = bytes / (1024 * 1024)
    expect(mb).toBeGreaterThan(170)
    expect(mb).toBeLessThan(190)
    // **用公式校验，不是硬编码一个数**（卡面点名）：硬编码的期望值在公式改了之后
    // 照样绿——它守的是那次抄写，不是那个公式。
    expect(bytes).toBe(expected(1920, 1080, 2))
  })

  it('direct 模式恒 0 额外 —— 它直接画进默认帧缓冲', () => {
    expect(estimateExportVram({ width: 7680, height: 4320, mode: 'direct', outlinePasses: 2 })).toBe(0)
  })

  it('4× 出图（7680×4320）确实到 2 GB 以上 —— 这就是上限 2× 的来源', () => {
    const bytes = estimateExportVram({ width: 7680, height: 4320, mode: 'composed', outlinePasses: 1 })
    expect(bytes / (1024 * 1024 * 1024)).toBeGreaterThan(2)
    expect(bytes).toBe(expected(7680, 4320, 1))
  })

  it('随 pass 数线性增长，随面积二次增长', () => {
    const one = estimateExportVram({ width: 1000, height: 1000, mode: 'composed', outlinePasses: 1 })
    const two = estimateExportVram({ width: 1000, height: 1000, mode: 'composed', outlinePasses: 2 })
    expect(two - one).toBe(19 * 1000 * 1000)

    const doubled = estimateExportVram({ width: 2000, height: 2000, mode: 'composed', outlinePasses: 1 })
    expect(doubled).toBe(one * 4)
  })

  it('零 pass 时只剩 composer 那一份', () => {
    expect(estimateExportVram({ width: 100, height: 100, mode: 'composed', outlinePasses: 0 })).toBe(48 * 100 * 100)
  })

  it('负数与 0 不会算出负显存', () => {
    expect(estimateExportVram({ width: -100, height: 100, mode: 'composed', outlinePasses: -1 })).toBe(0)
  })
})
