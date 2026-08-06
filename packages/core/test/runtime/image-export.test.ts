import { describe, expect, it } from 'vitest'
import type { CaptureLimits } from '../../src/runtime/capability.js'
import type { CapturePlan, CaptureRejection, CaptureRequest } from '../../src/runtime/image-export.js'
import {
  CONSERVATIVE_EDGE_LIMIT,
  MAX_EXPORT_EDGE,
  MAX_EXPORT_SCALE,
  MAX_SCALE_COMPOSED,
  MAX_SCALE_DIRECT,
  MIN_EXPORT_EDGE,
  effectiveEdgeLimit,
  maxScaleFor,
  planCapture,
} from '../../src/runtime/image-export.js'

/**
 * T-262 · `planCapture` 的拒绝矩阵与钳位矩阵。
 *
 * 全纯 Node：这个函数不碰 GPU、不碰 DOM、不碰文档，所以它的全部边界都能在这里跑一遍——
 * 而这正是它被写成纯函数的理由（R05：出图需求膨胀时，钳位是唯一挡得住的东西）。
 *
 * 三条纪律贯穿全篇：
 *  - 拒绝的 `reason` **逐字断言**。「返回了非空字符串」不算测过——`toBeTruthy()` 对
 *    「显卡错误」和「JPEG 不支持透明背景」一视同仁，而这两句给用户的下一步完全不同。
 *  - **每一条钳位都断言 `notice` 里带着改成了多少**。静默钳位是这里最容易犯的错。
 *  - 两条 `pixelRatio: 2` 的用例单独立着：桩 limits 让缺了像素比的公式全绿，只有真实
 *    的 2× 屏才会撞上（X-17）。
 */

const LIMITS: CaptureLimits = {
  pixelRatio: 1,
  maxTextureSize: 16384,
  maxRenderbufferSize: 16384,
  maxViewportDim: 16384,
  postFxActive: false,
}

const limits = (patch: Partial<CaptureLimits> = {}): CaptureLimits => ({ ...LIMITS, ...patch })

const request = (patch: Partial<CaptureRequest> = {}): CaptureRequest => ({
  viewport: { width: 1920, height: 1080 },
  background: 'auto',
  format: 'png',
  ...patch,
})

/** 断成计划，顺带把「拒绝」的分支从类型上摘掉。 */
function planned(result: CapturePlan | CaptureRejection): CapturePlan {
  expect(result.ok, `本该出计划，却被拒了：${(result as CaptureRejection).reason}`).toBe(true)
  return result as CapturePlan
}

function rejected(result: CapturePlan | CaptureRejection): CaptureRejection {
  expect(result.ok, '本该被拒，却出了计划').toBe(false)
  return result as CaptureRejection
}

describe('T-262 · 拒绝矩阵（四条，reason 逐字）', () => {
  it('① JPEG × 透明背景 —— 语义冲突，没有哪一边可以悄悄改掉', () => {
    const r = rejected(planCapture(request({ format: 'jpeg', background: 'transparent' }), limits()))
    expect(r.reason).toBe('JPEG 格式不支持透明背景。请改用 PNG 格式，或把背景改为不透明。')
  })

  it('② 视口尺寸不可用 —— 连纵横比都算不出来', () => {
    for (const viewport of [
      { width: 0, height: 1080 },
      { width: 1920, height: 0 },
      { width: Number.NaN, height: 1080 },
      { width: 1920, height: Number.POSITIVE_INFINITY },
      { width: -1920, height: 1080 },
    ]) {
      const r = rejected(planCapture(request({ viewport }), limits()))
      expect(r.reason, `${viewport.width}×${viewport.height} 应当被拒`).toBe(
        '画布尺寸还不可用，无法导出。请等画面显示出来后再试。',
      )
    }
  })

  it('③ 倍率 / 长边不合法 —— 包括长边小于下限', () => {
    const expected = `导出参数不合法：倍率与长边都必须是正数，且长边不小于 ${MIN_EXPORT_EDGE} 像素。`
    expect(rejected(planCapture(request({ scale: 0 }), limits())).reason).toBe(expected)
    expect(rejected(planCapture(request({ scale: Number.NaN }), limits())).reason).toBe(expected)
    expect(rejected(planCapture(request({ longEdge: -100 }), limits())).reason).toBe(expected)
    // 255 与 256 之间那一格：下限是闭区间的下界，不是「差不多 256」。
    expect(rejected(planCapture(request({ longEdge: MIN_EXPORT_EDGE - 1 }), limits())).reason).toBe(expected)
    expect(planCapture(request({ longEdge: MIN_EXPORT_EDGE }), limits()).ok).toBe(true)
  })

  it('④ 显卡上限低到产不出一张能用的图', () => {
    const r = rejected(planCapture(request(), limits({ maxRenderbufferSize: 64, maxTextureSize: 4096 })))
    // 取的是三条探针里最紧的那一条，不是纹理上限。
    expect(r.reason).toBe('当前显卡最大只支持 64 像素的画面，无法导出可用的图片。')
  })

  it('拒绝就是拒绝：不返回一份「尺寸为 0」的计划让调用方自己发现', () => {
    // 这条防的是把拒绝退化成 `{ ok: true, width: 0 }`——那样每一个下游都要再判一次。
    const r = planCapture(request({ format: 'jpeg', background: 'transparent' }), limits())
    expect('width' in r).toBe(false)
  })
})

describe('T-262 · 钳位矩阵（五条，每条都带着改成了多少）', () => {
  /**
   * 倍率类的用例一律用 960×540 的视口。
   *
   * 不是为了好算：**在 1920 的视口上 4× 根本到不了**——3840 的长边硬上限先咬住了，
   * 钳位 ① 与钳位 ④ 会同时触发，谁也证明不了谁。960 × 4 = 3840 恰好卡在合同上限上，
   * 倍率那一条才单独可观测。这个互相遮蔽的关系本身值得记一笔：对话框上的 3× / 4×
   * 在常见分辨率的视口上是够不着的档位。
   */
  const small = { width: 960, height: 540 }

  it('① 倍率超过对话框上限 → 钳到 4×，且说清是 4×', () => {
    const plan = planned(planCapture(request({ viewport: small, scale: 8 }), limits()))
    expect(plan.scale).toBe(MAX_EXPORT_SCALE)
    expect(plan.notice).toContain(`导出倍率上限为 ${MAX_EXPORT_SCALE}×`)
    expect(plan.width).toBe(3840)
  })

  it('② composed 管线 → 钳到 2×，措辞与 ① 不同（两把尺子答的不是同一个问题）', () => {
    const plan = planned(planCapture(request({ viewport: small, scale: 4 }), limits({ postFxActive: true })))
    expect(plan.scale).toBe(MAX_SCALE_COMPOSED)
    expect(plan.pipelineMode).toBe('composed')
    expect(plan.notice).toContain(`叠加了描边等画面效果时导出倍率上限为 ${MAX_SCALE_COMPOSED}×`)
    // ① 那句不该出现：4 没有超过 MAX_EXPORT_SCALE。
    expect(plan.notice).not.toContain(`导出倍率上限为 ${MAX_EXPORT_SCALE}×`)
  })

  it('③ 显卡上限收紧倍率 → 降档，且报出显卡到底能到多少', () => {
    // 1920 CSS px、上限 4096：只放得下 2×。
    const plan = planned(planCapture(request({ scale: 4 }), limits({ maxTextureSize: 4096, maxRenderbufferSize: 4096, maxViewportDim: 4096 })))
    expect(plan.scale).toBe(2)
    expect(plan.width).toBe(3840)
    expect(plan.notice).toContain('当前显卡最大支持 4096 像素')
    expect(plan.notice).toMatch(/降到 2×/)
  })

  it('④ 长边超过 3840 → 等比缩到 3840，notice 里带着最终的两个数', () => {
    const plan = planned(planCapture(request({ viewport: { width: 5000, height: 2500 }, scale: 1 }), limits()))
    expect(plan.width).toBe(MAX_EXPORT_EDGE)
    expect(plan.height).toBe(1920)
    expect(plan.notice).toContain(`导出长边上限为 ${MAX_EXPORT_EDGE} 像素`)
    expect(plan.notice).toContain('3840 × 1920')
  })

  it('⑤ 长边与倍率同给 → 长边胜出，且 notice 说明倍率被忽略了', () => {
    const plan = planned(planCapture(request({ scale: 4, longEdge: 2560 }), limits()))
    expect(plan.width).toBe(2560)
    expect(plan.height).toBe(1440)
    expect(plan.notice).toContain('以长边 2560 像素为准')
    expect(plan.notice).toContain('倍率设置已忽略')
  })

  it('钳位与否是一条线：请求被原样满足时 notice 是空串', () => {
    // 「notice 非空 ⇔ 计划与请求不一致」这条等价关系，是调用方唯一需要判的东西。
    const plan = planned(planCapture(request({ scale: 2 }), limits()))
    expect(plan.notice).toBe('')
    expect(plan.width).toBe(3840)
    expect(plan.height).toBe(2160)
  })

  it('每一条钳位的 notice 里都有数字 —— 没有一条是「尺寸已调整」这种废话', () => {
    const clamped = [
      planCapture(request({ viewport: small, scale: 8 }), limits()),
      planCapture(request({ viewport: small, scale: 4 }), limits({ postFxActive: true })),
      planCapture(request({ scale: 4 }), limits({ maxTextureSize: 4096, maxRenderbufferSize: 4096, maxViewportDim: 4096 })),
      planCapture(request({ viewport: { width: 5000, height: 2500 }, scale: 1 }), limits()),
      planCapture(request({ scale: 4, longEdge: 2560 }), limits()),
    ].map(planned)

    for (const plan of clamped) {
      expect(plan.notice.length, '钳位了却一声不吭').toBeGreaterThan(0)
      expect(plan.notice, `没带数字：${plan.notice}`).toMatch(/\d/)
    }
    // 五条各说各的：措辞撞车就意味着用户分不出被钳的是哪一项。
    expect(new Set(clamped.map((p) => p.notice)).size).toBe(5)
  })
})

describe('T-262 · pixelRatio 进公式（X-17 的机器落点）', () => {
  it('2× 屏上同一个请求分配的是两倍边长的图', () => {
    // 桩 limits 全是 1×，所以一个漏掉 pixelRatio 的实现在上面每一条用例下都是绿的。
    const one = planned(planCapture(request({ scale: 1 }), limits({ pixelRatio: 1 })))
    const two = planned(planCapture(request({ scale: 1 }), limits({ pixelRatio: 2 })))
    expect(one.width).toBe(1920)
    expect(two.width).toBe(3840)
    expect(two.height).toBe(2160)
  })

  it('2× 屏上倍率天花板对半砍 —— 对话框写「4×」，GPU 收到的是 8×', () => {
    const at2x = limits({ pixelRatio: 2, maxTextureSize: 8192, maxRenderbufferSize: 8192, maxViewportDim: 8192 })
    const plan = planned(planCapture(request({ scale: 4 }), at2x))
    // 两级钳位叠着来：显卡把 4× 压到 2×（8192 / 3840 设备像素），长边硬上限再把 2× 压到 1×。
    // 断的是两句话都在——只断最终尺寸的话，删掉像素比之后 3840 这个数照样出得来。
    expect(plan.notice).toContain('当前显卡最大支持 8192 像素')
    expect(plan.notice).toContain(`导出长边上限为 ${MAX_EXPORT_EDGE} 像素`)
    expect(plan.scale).toBe(1)
    expect(plan.width).toBe(MAX_EXPORT_EDGE)
  })
})

describe('T-262 · 降级：透明背景不含描边（ADR-0021 腿 2）', () => {
  it('透明 × 后处理在跑 → 强制 direct、droppedOutline、逐字的那句中文', () => {
    const plan = planned(planCapture(request({ background: 'transparent' }), limits({ postFxActive: true })))
    expect(plan.pipelineMode).toBe('direct')
    expect(plan.droppedOutline).toBe(true)
    expect(plan.background).toBe('transparent')
    expect(plan.notice).toContain('透明背景导出不包含描边效果。')
    // P-11 拍板项：不许把雾一起列进去——雾画在物体像素上，背景像素仍然 alpha 0。
    expect(plan.notice).not.toContain('雾')
  })

  it('后处理没在跑时不谎报降级 —— 本来就没有描边可丢', () => {
    const plan = planned(planCapture(request({ background: 'transparent' }), limits({ postFxActive: false })))
    expect(plan.droppedOutline).toBe(false)
    expect(plan.notice).toBe('')
  })

  it('降级之后吃的是 direct 的 4×，不是 composed 的 2×', () => {
    // 这条是 ② 的反面：透明背景已经把管线拽回 direct，再按 composed 钳就是白白损失一半分辨率。
    const plan = planned(
      planCapture(request({ viewport: { width: 960, height: 540 }, background: 'transparent', scale: 4 }), limits({ postFxActive: true })),
    )
    expect(plan.scale).toBe(MAX_SCALE_DIRECT)
    expect(plan.notice).not.toContain('倍率上限')
  })

  it("background: 'auto' 按不透明处理，透明是显式选项", () => {
    const plan = planned(planCapture(request({ background: 'auto' }), limits({ postFxActive: true })))
    expect(plan.background).toBe('opaque')
    expect(plan.pipelineMode).toBe('composed')
  })
})

describe('T-262 · 输出恒定成立的性质', () => {
  /** 纵横比 / 整数性要在很大一片输入上成立，不是在五个精心挑的数上成立。 */
  const VIEWPORTS = [
    [1920, 1080],
    [1280, 720],
    [800, 600],
    [3000, 3000],
    [640, 1136],
    [2560, 1080],
    [1024, 768],
  ] as const

  it('宽高恒为 ≥ 1 的整数', () => {
    for (const [w, h] of VIEWPORTS) {
      for (const scale of [1, 1.5, 2, 3, 4, 8]) {
        for (const pixelRatio of [1, 1.5, 2]) {
          const plan = planned(planCapture(request({ viewport: { width: w, height: h }, scale }), limits({ pixelRatio })))
          expect(Number.isInteger(plan.width) && plan.width >= 1, `${w}×${h} @${scale} pr${pixelRatio}`).toBe(true)
          expect(Number.isInteger(plan.height) && plan.height >= 1).toBe(true)
        }
      }
    }
  })

  it('纵横比与视口一致（|w/h − vw/vh| < 0.01）', () => {
    for (const [w, h] of VIEWPORTS) {
      for (const scale of [1, 1.5, 2, 3, 4, 8]) {
        for (const pixelRatio of [1, 1.5, 2]) {
          const plan = planned(planCapture(request({ viewport: { width: w, height: h }, scale }), limits({ pixelRatio })))
          expect(Math.abs(plan.width / plan.height - w / h), `${w}×${h} @${scale} pr${pixelRatio}`).toBeLessThan(0.01)
        }
      }
    }
  })

  it('长边路径同样保比 —— 它走的是另一条分支', () => {
    for (const [w, h] of VIEWPORTS) {
      for (const longEdge of [MIN_EXPORT_EDGE, 1920, 2560, MAX_EXPORT_EDGE, 9999]) {
        const plan = planned(planCapture(request({ viewport: { width: w, height: h }, longEdge }), limits({ pixelRatio: 2 })))
        expect(Math.abs(plan.width / plan.height - w / h), `${w}×${h} → ${longEdge}`).toBeLessThan(0.01)
        expect(Math.max(plan.width, plan.height)).toBe(Math.min(longEdge, MAX_EXPORT_EDGE))
      }
    }
  })

  it('长边路径不乘像素比 —— 用户要的是一张恰好这么大的图', () => {
    const one = planned(planCapture(request({ longEdge: 2560 }), limits({ pixelRatio: 1 })))
    const two = planned(planCapture(request({ longEdge: 2560 }), limits({ pixelRatio: 2 })))
    expect(one.width).toBe(2560)
    expect(two.width).toBe(2560)
  })

  it('长边永不超过合同上限，哪怕请求里写着 99999', () => {
    const plan = planned(planCapture(request({ longEdge: 99999 }), limits()))
    expect(Math.max(plan.width, plan.height)).toBe(MAX_EXPORT_EDGE)
  })
})

describe('T-262 · 探针未知时的保守值', () => {
  it('三条探针全是 0（未知）→ 用保守边长，而不是「无限制」也不是「零」', () => {
    expect(effectiveEdgeLimit(limits({ maxTextureSize: 0, maxRenderbufferSize: 0, maxViewportDim: 0 }))).toBe(
      CONSERVATIVE_EDGE_LIMIT,
    )
  })

  it('只要有一条探针报了数，就以实测的最紧那条为准', () => {
    expect(effectiveEdgeLimit(limits({ maxTextureSize: 0, maxRenderbufferSize: 8192, maxViewportDim: 0 }))).toBe(8192)
    expect(effectiveEdgeLimit(limits({ maxTextureSize: 16384, maxRenderbufferSize: 8192, maxViewportDim: 4096 }))).toBe(4096)
  })

  it('未知不等于「钳到 1×」—— 4096 下 1920 的视口仍然能出 2×', () => {
    const plan = planned(planCapture(request({ scale: 4 }), limits({ maxTextureSize: 0, maxRenderbufferSize: 0, maxViewportDim: 0 })))
    expect(plan.scale).toBe(2)
  })
})

describe('T-262 · maxScaleFor 的接线（X-19）', () => {
  it('两个模式两个上限，且就是 T-263 会复用的那两个常量', () => {
    expect(maxScaleFor('direct')).toBe(MAX_SCALE_DIRECT)
    expect(maxScaleFor('composed')).toBe(MAX_SCALE_COMPOSED)
    expect(MAX_SCALE_DIRECT).toBe(4)
    expect(MAX_SCALE_COMPOSED).toBe(2)
  })

  it('接线是真的接上了：composed 下选 4× 拿不到 4×', () => {
    // X-19 说的就是这条——两张卡各交付一半、中间没人接线的话，这里会返回 4，
    // 而 4× composed 要约 2.2 GB 显存。
    const at = (postFxActive: boolean) =>
      planned(planCapture(request({ viewport: { width: 960, height: 540 }, scale: 4 }), limits({ postFxActive })))
    expect(at(true).scale).toBe(2)
    expect(at(false).scale).toBe(4)
  })
})
