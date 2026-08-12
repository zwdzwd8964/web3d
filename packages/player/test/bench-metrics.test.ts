import { DEFAULT_POLICY, shadowMapSizeFor } from '@w3/core'
import { SHADOW_QUALITIES } from '@w3/schema'
import { describe, expect, it } from 'vitest'
import {
  BENCH_LIMITS,
  LIGHT_COUNTS,
  SHADOW_MODES,
  STRESS_COPIES,
  estimateTextureMemory,
  gradeFrames,
  gradeScene,
  gradeLighting,
  HARD_CAP_FACTOR,
  MIN_SAMPLES,
  classifySection,
  gradeExplode,
  gradeLoad,
  gradePostFx,
  gradeSection,
  gradeStress,
  estimateShadowMemory,
  recommendShadowDefault,
  isMeasured,
  notMeasured,
  shouldKeepSampling,
  summariseFrames,
  toJsonReport,
  toMarkdown,
} from '../src/bench/metrics.js'
import type { LightLevel, ShadowSetting } from '../src/bench/metrics.js'
import type { StressLevel } from '../src/bench/metrics.js'
import type { CapabilityReport } from '@w3/core'

/**
 * T-110 · the arithmetic and the grading, tested.
 *
 * The numbers this page produces are destined for 附件A and, from there, for a contract.
 * The thresholds were restated by hand once and the triangle ceiling came out five times
 * too high — so the binding test here is that they are READ from the policy rather than
 * copied.
 */

const software: CapabilityReport = {
  level: 'software',
  webgl2: true,
  renderer: 'SwiftShader Device',
  vendor: 'Google Inc.',
  maxTextureSize: 8192,
  // T-262 加的两条探针。这份桩只用来判软渲档位，与出图钳位无关，所以按「未知」填 0。
  maxRenderbufferSize: 0,
  maxViewportDim: 0,
  message: '',
  advice: '',
}

describe('BENCH_LIMITS', () => {
  it('reads scene budgets from the asset policy rather than restating them', () => {
    // The regression this guards: a hand-copied 1,500,000 against a real 300,000.
    expect(BENCH_LIMITS.triangles).toBe(DEFAULT_POLICY.maxTriangles)
    expect(BENCH_LIMITS.textures).toBe(DEFAULT_POLICY.maxTextures)
    expect(BENCH_LIMITS.textureBytes).toBe(DEFAULT_POLICY.maxTextureBytes)
  })

  it('grades against every limit it declares', () => {
    // `textures` was read from the policy, asserted here, and used by nothing: the report
    // printed the texture count with limit「—」and verdict pass, forever. An assertion that
    // a decorative constant has the right value is an assertion about decoration.
    //
    // Written as a sweep rather than as one more hand-listed row so the next limit added
    // to the table cannot repeat the trick.
    const graded = gradeScene({
      triangles: DEFAULT_POLICY.maxTriangles + 1,
      drawCalls: BENCH_LIMITS.drawCalls + 1,
      textures: DEFAULT_POLICY.maxTextures + 1,
      textureMemoryBytes: DEFAULT_POLICY.maxTextureBytes + 1,
      geometries: 1,
      programs: 1,
    })
    const limits = graded.filter((r) => r.limit !== '—')
    expect(limits.map((r) => r.metric)).toEqual(['三角面数', 'Draw call', '贴图数量', '贴图显存（估算）'])
    // Every declared limit, blown past, must produce a non-pass verdict.
    expect(limits.filter((r) => r.verdict === 'pass')).toEqual([])
  })
})

describe('summariseFrames', () => {
  it('picks the exact 95th-percentile frame from a known distribution', () => {
    // 1..100 ms, one frame each. Nearest-rank at floor(n × 0.95): sorted[95] = 96 ms.
    // The number is pinned rather than bounded because the previous assertion —
    // `p95FrameMs >= 16.7` on a sample whose slowest frame was 400 ms — was satisfied by
    // every plausible wrong answer, the worst frame and the mean included. A percentile
    // that reads as "the slowest frame" turns the report's headline metric into a
    // duplicate of the row below it, and nothing here noticed.
    const stats = summariseFrames(Array.from({ length: 100 }, (_, i) => i + 1))
    expect(stats.p95FrameMs).toBe(96)
    expect(stats.worstFrameMs).toBe(100)
    expect(stats.frames).toBe(100)
  })

  it('reports p95, not the mean or the worst — that is where stutter hides', () => {
    // 60 fps with one 400 ms hitch: the mean says "fine". At 1 in 100 the hitch is below
    // the 95th percentile too, and the honest reading is that only 最慢单帧 catches it.
    const stats = summariseFrames([...Array(99).fill(16.7), 400])
    expect(stats.fps).toBeGreaterThan(40)
    expect(stats.worstFrameMs).toBe(400)
    expect(stats.p95FrameMs).toBeCloseTo(16.7, 6)
    expect(stats.p95FrameMs).not.toBe(stats.worstFrameMs)
  })

  it('grades a scene that hitches 1 frame in 11 as not-passing on frame time', () => {
    // 22 frames, two of them at 120 ms: sorted[20] = 120, over the 66 ms fail line.
    const stats = summariseFrames([...Array(20).fill(16.7), ...Array(2).fill(120)])
    expect(stats.p95FrameMs).toBe(120)
    const p95 = gradeFrames(stats).find((r) => r.metric === 'P95 帧时间')!
    expect(p95.verdict).toBe('fail')
  })

  it('degenerates to the slowest frame on samples too short to have a 95th', () => {
    // Nearest-rank: at 20 frames or fewer, floor(n × 0.95) lands on the last element, so
    // p95 and 最慢单帧 necessarily report the same number. That is a property of the
    // estimator, not a defect — but it is why the bench collects hundreds of frames, and
    // why the 100-frame case above is the one that can tell the two apart at all.
    expect(summariseFrames([42]).p95FrameMs).toBe(42)
    expect(summariseFrames([10, 20]).p95FrameMs).toBe(20)
    expect(summariseFrames(Array.from({ length: 20 }, (_, i) => i + 1)).p95FrameMs).toBe(20)
    // 21 frames is where it starts being a percentile again.
    expect(summariseFrames(Array.from({ length: 21 }, (_, i) => i + 1)).p95FrameMs).toBe(20)
  })

  it('survives an empty sample rather than dividing by zero', () => {
    expect(summariseFrames([])).toEqual({ fps: 0, p95FrameMs: 0, worstFrameMs: 0, frames: 0 })
  })
})

describe('estimateTextureMemory', () => {
  it('counts RGBA8 plus a mip chain', () => {
    // 1024² × 4 bytes × 4/3 ≈ 5.59 MB
    expect(estimateTextureMemory([{ width: 1024, height: 1024 }])).toBe(Math.ceil(1024 * 1024 * 4 * (4 / 3)))
  })

  it('is zero for no textures', () => {
    expect(estimateTextureMemory([])).toBe(0)
  })
})

describe('gradeScene', () => {
  const base = { triangles: 0, drawCalls: 0, geometries: 0, textures: 0, programs: 0, textureMemoryBytes: 0 }

  it('fails a model over the policy triangle ceiling', () => {
    const row = gradeScene({ ...base, triangles: DEFAULT_POLICY.maxTriangles + 1 }).find((r) => r.metric === '三角面数')!
    expect(row.verdict).toBe('fail')
  })

  it('passes one exactly at the ceiling — the limit is inclusive', () => {
    const row = gradeScene({ ...base, triangles: DEFAULT_POLICY.maxTriangles }).find((r) => r.metric === '三角面数')!
    expect(row.verdict).toBe('pass')
  })

  it('fails a scene over the policy texture ceiling and passes one exactly at it', () => {
    const over = gradeScene({ ...base, textures: DEFAULT_POLICY.maxTextures + 1 }).find((r) => r.metric === '贴图数量')!
    const at = gradeScene({ ...base, textures: DEFAULT_POLICY.maxTextures }).find((r) => r.metric === '贴图数量')!
    expect(over.verdict).toBe('fail')
    expect(at.verdict).toBe('pass')
    expect(over.limit).toBe(String(DEFAULT_POLICY.maxTextures))
  })

  it('says out loud that the draw-call ceiling has no measured source', () => {
    // 附件A's acceptance is "每个数值都有实测或阈值来源，不是拍脑袋". A number without one
    // has to say so in the report itself, or it will be read as a finding.
    const row = gradeScene(base).find((r) => r.metric === 'Draw call')!
    expect(row.note).toContain('尚无实测来源')
  })
})

/**
 * T-116 · ADR-0016 · the staged load ramp T-110 listed and never shipped.
 *
 * The page part needs a browser; the part that turns rungs into a capacity claim does not,
 * and that is the part that ends up in 附件A.
 */
describe('gradeStress', () => {
  // ADR-0042 · 60 帧 = 采到样了。既有断言全部关心 fps 的分级，不关心样本数，
  // 所以统一给一个「测到了」的值，让那些断言继续测它们本来测的东西。
  const rung = (copies: number, fps: number, frames = 60): StressLevel => ({
    copies,
    fps,
    drawCalls: copies * 100,
    triangles: copies * 50_000,
    frames,
  })
  const ceilingOf = (levels: readonly StressLevel[]) => gradeStress(levels).find((r) => r.metric === '承载上限')!

  it('reports the largest rung that held the frame rate, not the last one measured', () => {
    // The ramp stops early exactly when things went badly, so "the last rung" and "the
    // ceiling" are the same number only when nothing failed. Reading the last rung would
    // turn a machine that collapsed at ×4 into a machine certified for ×4.
    const row = ceilingOf([rung(1, 60), rung(2, 52), rung(4, 18)])
    expect(row.value).toContain('2 份场景')
    expect(row.value).toContain('200 drawcall')
    expect(row.verdict).toBe('pass')
  })

  it('fails outright when even one copy cannot hold the frame rate', () => {
    const row = ceilingOf([rung(1, 21)])
    expect(row.value).toBe('不足 1 份')
    expect(row.verdict).toBe('fail')
  })

  it('treats exactly the warn threshold as passing', () => {
    expect(ceilingOf([rung(1, BENCH_LIMITS.fpsWarn)]).verdict).toBe('pass')
    expect(ceilingOf([rung(1, BENCH_LIMITS.fpsWarn - 0.1)]).verdict).toBe('fail')
  })

  it('grades each rung on the same frame-rate thresholds as the headline metric', () => {
    const rows = gradeStress([rung(1, 60), rung(2, 30), rung(4, 10)])
    expect(rows.filter((r) => r.metric.startsWith('逐级加载')).map((r) => r.verdict)).toEqual(['pass', 'warn', 'fail'])
  })

  it('says in the report itself that the ramp does not stress VRAM', () => {
    // ADR-0016 cost 1. 附件A quotes this row; the limitation has to travel with it, or the
    // number gets read as "this machine handles a scene 4× the size" full stop.
    expect(ceilingOf([rung(1, 60)]).note).toContain('不压显存')
  })

  it('produces nothing at all when the ramp never ran', () => {
    expect(gradeStress([])).toEqual([])
  })

  it('climbs by doubling, so a machine 8× over the model still gets a bounded answer', () => {
    expect([...STRESS_COPIES]).toEqual([1, 2, 4, 8])
  })
})

describe('toMarkdown', () => {
  const rows = gradeFrames(summariseFrames([16.7, 16.7, 16.7]))

  it('refuses to let software-rendered numbers be read as acceptance data', () => {
    const md = toMarkdown({
      capability: software,
      rows,
      scene: { triangles: 1, drawCalls: 2, geometries: 3, textures: 4, programs: 5, textureMemoryBytes: 6 },
      userAgent: 'test',
      screen: '800×600 @1x',
      takenAt: '2026-07-31T00:00:00.000Z',
      source: 'demo.w3p',
    })
    expect(md).toContain('不可作为验收依据')
    expect(md).toContain('SwiftShader Device')
  })

  it('omits the warning when the run was hardware accelerated', () => {
    const md = toMarkdown({
      capability: { ...software, level: 'ok', renderer: 'NVIDIA RTX' },
      rows,
      scene: { triangles: 1, drawCalls: 2, geometries: 3, textures: 4, programs: 5, textureMemoryBytes: 6 },
      userAgent: 'test',
      screen: '800×600 @1x',
      takenAt: '2026-07-31T00:00:00.000Z',
      source: 'demo.w3p',
    })
    expect(md).not.toContain('不可作为验收依据')
  })

  it('is a table anyone can paste into a ticket', () => {
    const md = toMarkdown({
      capability: software,
      rows,
      scene: { triangles: 1, drawCalls: 2, geometries: 3, textures: 4, programs: 5, textureMemoryBytes: 6 },
      userAgent: 'test',
      screen: '800×600 @1x',
      takenAt: '2026-07-31T00:00:00.000Z',
      source: 'demo.w3p',
    })
    expect(md).toContain('| 指标 | 实测 | 上限 | 结论 | 说明 |')
    for (const row of rows) expect(md).toContain(row.metric)
  })
})

describe('the lighting ladder (T-174)', () => {
  const level = (lights: number, shadows: ShadowSetting, fps: number, frames = 60): LightLevel => ({
    lights,
    shadows,
    fps,
    drawCalls: 10 + lights,
    frames,
  })

  it('reports the two ceilings SEPARATELY', () => {
    // Conflating them is how people conclude 「灯很慢」 and stop using lights. More lights
    // costs per-pixel shading and grows smoothly; shadows cost a depth pass per casting
    // light and grow in steps — and the two numbers differ by roughly the factor that
    // actually matters when planning a scene.
    const rows = gradeLighting([
      level(0, 'off', 60),
      level(1, 'off', 60),
      level(4, 'off', 58),
      level(8, 'off', 55),
      level(0, 'medium', 60),
      level(1, 'medium', 52),
      level(4, 'medium', 28),
      level(8, 'medium', 12),
    ])

    const noShadow = rows.find((r) => r.metric === '动态灯上限（无阴影）')!
    const withShadow = rows.find((r) => r.metric === '动态灯上限（medium 阴影）')!
    expect(noShadow.value).toContain('8 盏')
    expect(withShadow.value, '开了阴影之后上限应当明显更低').toContain('1 盏')
    expect(noShadow.verdict).toBe('pass')
  })

  it('says "不足 1 盏" rather than picking the least-bad rung', () => {
    // Reporting the last rung measured would read as a capacity finding while actually
    // reporting where the ramp gave up — same trap `gradeStress` documents.
    const rows = gradeLighting([level(0, 'off', 20), level(1, 'off', 14)])
    const ceiling = rows.find((r) => r.metric === '动态灯上限（无阴影）')!
    expect(ceiling.value).toBe('不足 1 盏')
    expect(ceiling.verdict).toBe('fail')
  })

  it('grades each rung against the same frame-rate limits as everything else', () => {
    const rows = gradeLighting([level(4, 'high', BENCH_LIMITS.fpsFail - 1)])
    const rung = rows.find((r) => r.metric === '灯 ×4 · 阴影 high')!
    expect(rung.verdict).toBe('fail')
  })

  it('returns nothing at all when the ramp never ran', () => {
    expect(gradeLighting([])).toEqual([])
  })

  it('climbs the counts and modes the page actually uses', () => {
    expect(LIGHT_COUNTS).toEqual([0, 1, 4, 8])
    // T-279 · low 补上了。**测的档必须等于文档能表达的档**——在此之前 low 是一档
    // 用户选得到、报告里永远没有数的设置。
    expect(SHADOW_MODES).toEqual(['off', ...SHADOW_QUALITIES])
    expect(SHADOW_MODES).toEqual(['off', 'low', 'medium', 'high'])
  })
})

/* -------------------------------------------------------------------------- */
/* v1.0 · T-279                                                                */
/* -------------------------------------------------------------------------- */

/**
 * 三档的测试数据**每一档的数字都不一样**。
 *
 * 这不是凑数：卡面点名的变异 ② 是「`ceilingFor('high')` 用了 medium 的数据」，而三档
 * 数字相同的话，那条变异是**绿的**——它读错了一列却读出同一个答案。同一个坑 v0.5 的
 * T-184 踩过一次（基准文档恰好已排好序，于是排序是空操作）。
 */
const LADDER: LightLevel[] = [
  { lights: 0, shadows: 'off', fps: 60, drawCalls: 10, frames: 60 },
  { lights: 1, shadows: 'off', fps: 59, drawCalls: 11, frames: 60 },
  { lights: 4, shadows: 'off', fps: 58, drawCalls: 14, frames: 60 },
  { lights: 8, shadows: 'off', fps: 57, drawCalls: 18, frames: 60 },
  { lights: 0, shadows: 'low', fps: 56, drawCalls: 10, frames: 60 },
  { lights: 1, shadows: 'low', fps: 55, drawCalls: 11, frames: 60 },
  { lights: 4, shadows: 'low', fps: 54, drawCalls: 14, frames: 60 },
  { lights: 8, shadows: 'low', fps: 53, drawCalls: 18, frames: 60 },
  { lights: 0, shadows: 'medium', fps: 52, drawCalls: 10, frames: 60 },
  { lights: 1, shadows: 'medium', fps: 51, drawCalls: 11, frames: 60 },
  { lights: 4, shadows: 'medium', fps: 50, drawCalls: 14, frames: 60 },
  { lights: 8, shadows: 'medium', fps: 20, drawCalls: 18, frames: 60 },
  { lights: 0, shadows: 'high', fps: 49, drawCalls: 10, frames: 60 },
  { lights: 1, shadows: 'high', fps: 48, drawCalls: 11, frames: 60 },
  { lights: 4, shadows: 'high', fps: 24, drawCalls: 14, frames: 60 },
  { lights: 8, shadows: 'high', fps: 9, drawCalls: 18, frames: 60 },
]

describe('T-279 · 三档阴影各有一条结论行', () => {
  const rows = gradeLighting(LADDER)
  const ceiling = (quality: string) => rows.find((r) => r.metric === `动态灯上限（${quality} 阴影）`)!

  it('low / medium / high 三行都在', () => {
    for (const quality of SHADOW_QUALITIES) expect(ceiling(quality), quality).toBeDefined()
  })

  it('每一档读的是自己那一列的数据', () => {
    // 三档的上限灯数与帧率互不相同——读错一列就会读出别人的数字。
    expect(ceiling('low').value).toContain('8 盏')
    expect(ceiling('low').value).toContain('53.0 fps')
    expect(ceiling('medium').value).toContain('4 盏')
    expect(ceiling('medium').value).toContain('50.0 fps')
    expect(ceiling('high').value).toContain('1 盏')
    expect(ceiling('high').value).toContain('48.0 fps')
  })

  it('无阴影那一行仍然单列，且是最高的', () => {
    const none = rows.find((r) => r.metric === '动态灯上限（无阴影）')!
    expect(none.value).toContain('8 盏')
    expect(none.value).toContain('57.0 fps')
  })

  it('每一档的说明里写着它的贴图边长', () => {
    for (const quality of SHADOW_QUALITIES) {
      expect(ceiling(quality).note, quality).toContain(String(shadowMapSizeFor(quality)))
    }
  })

  it('一档都过不了时，那一档判 fail 而不是挑一个最不差的', () => {
    const rows2 = gradeLighting([{ lights: 1, shadows: 'high', fps: 10, drawCalls: 1, frames: 60 }])
    expect(rows2.find((r) => r.metric === '动态灯上限（high 阴影）')!.value).toBe('不足 1 盏')
    expect(rows2.find((r) => r.metric === '动态灯上限（high 阴影）')!.verdict).toBe('fail')
  })
})

describe('T-279 · recommendShadowDefault', () => {
  it('三档都带得动 1 盏时推荐 high', () => {
    const result = recommendShadowDefault([
      { lights: 1, shadows: 'low', fps: 60, drawCalls: 1, frames: 60 },
      { lights: 1, shadows: 'medium', fps: 58, drawCalls: 1, frames: 60 },
      { lights: 1, shadows: 'high', fps: 50, drawCalls: 1, frames: 60 },
    ])
    expect(result.setting).toBe('high')
    expect(result.reason).toContain('high')
  })

  it('high 带不动时退到 medium', () => {
    const result = recommendShadowDefault([
      { lights: 1, shadows: 'low', fps: 60, drawCalls: 1, frames: 60 },
      { lights: 1, shadows: 'medium', fps: 50, drawCalls: 1, frames: 60 },
      { lights: 1, shadows: 'high', fps: 20, drawCalls: 1, frames: 60 },
    ])
    expect(result.setting).toBe('medium')
  })

  it('只有 low 带得动时推荐 low', () => {
    const result = recommendShadowDefault([
      { lights: 1, shadows: 'low', fps: 46, drawCalls: 1, frames: 60 },
      { lights: 1, shadows: 'medium', fps: 30, drawCalls: 1, frames: 60 },
      { lights: 1, shadows: 'high', fps: 12, drawCalls: 1, frames: 60 },
    ])
    expect(result.setting).toBe('low')
  })

  it('三档都带不动 1 盏时推荐关闭，并说清为什么', () => {
    const result = recommendShadowDefault([
      { lights: 1, shadows: 'low', fps: 30, drawCalls: 1, frames: 60 },
      { lights: 1, shadows: 'medium', fps: 20, drawCalls: 1, frames: 60 },
      { lights: 1, shadows: 'high', fps: 8, drawCalls: 1, frames: 60 },
    ])
    expect(result.setting).toBe('off')
    // 这句话会被抄进验收单，所以它不是调试信息。
    expect(result.reason).toContain('用户不会把掉帧归因到这个开关上')
  })

  it('「0 盏也能跑」不算数 —— 门槛是至少带得动 1 盏投影灯', () => {
    // 0 盏投影灯下开着阴影和关着阴影是同一件事。把它算进去的话，任何机器都会被推荐 high。
    const result = recommendShadowDefault([
      { lights: 0, shadows: 'high', fps: 60, drawCalls: 1, frames: 60 },
      { lights: 1, shadows: 'high', fps: 10, drawCalls: 1, frames: 60 },
    ])
    expect(result.setting).toBe('off')
  })

  it('完全没测过时推荐关闭', () => {
    expect(recommendShadowDefault([]).setting).toBe('off')
  })

  it('建议会出现在报告里，不只是一个函数', () => {
    const row = gradeLighting(LADDER).find((r) => r.metric === '建议出厂默认阴影档')!
    expect(row).toBeDefined()
    expect(row.value).toBe('high')
  })
})

describe('T-279 · 阴影贴图显存估算', () => {
  it('灯数成正比，档位成平方', () => {
    expect(estimateShadowMemory(1, 'low')).toBe(512 * 512 * 4)
    expect(estimateShadowMemory(4, 'low')).toBe(4 * 512 * 512 * 4)
    expect(estimateShadowMemory(1, 'high')).toBe(estimateShadowMemory(1, 'low') * 16)
  })

  it('边长读的是 core 的那张表，不是又抄了一遍', () => {
    // BENCH_LIMITS 抄阈值抄错过一次（1,500,000 对 300,000），代价是一个destined for
    // 合同附件的数字。这里从源头读。
    for (const quality of SHADOW_QUALITIES) {
      expect(estimateShadowMemory(1, quality)).toBe(shadowMapSizeFor(quality) ** 2 * 4)
    }
  })

  it('0 盏投影灯是 0 字节，负数不会算出负显存', () => {
    expect(estimateShadowMemory(0, 'high')).toBe(0)
    expect(estimateShadowMemory(-3, 'high')).toBe(0)
  })

  it('报告里那一行报的是最重的那一档', () => {
    const row = gradeLighting(LADDER).find((r) => r.metric === '阴影贴图显存（估算）')!
    expect(row).toBeDefined()
    expect(row.value).toContain('8 盏')
  })

  it('全程没开过阴影时不报这一行', () => {
    const rows = gradeLighting([{ lights: 4, shadows: 'off', fps: 60, drawCalls: 1, frames: 60 }])
    expect(rows.find((r) => r.metric === '阴影贴图显存（估算）')).toBeUndefined()
  })
})

describe('T-279 · 首屏加载时间', () => {
  const timing = { unpackMs: 120, buildMs: 830, firstFrameMs: 260 }

  it('三段加一个合计，共四行', () => {
    expect(gradeLoad(timing)).toHaveLength(4)
  })

  it('合计是三段之和，不是另测的一个数', () => {
    const total = gradeLoad(timing).find((r) => r.metric === '首屏 · 合计')!
    expect(total.value).toBe('1210 ms')
  })

  it('每一段都报自己的数', () => {
    const rows = gradeLoad(timing)
    expect(rows.find((r) => r.metric === '首屏 · 解包')!.value).toBe('120 ms')
    expect(rows.find((r) => r.metric === '首屏 · 建场景')!.value).toBe('830 ms')
    expect(rows.find((r) => r.metric === '首屏 · 首帧')!.value).toBe('260 ms')
  })

  it('limit 一律是「—」：这四个数没有阈值来源', () => {
    // 编一个阈值比不报更糟——它会被当成实测结论引用（附件A 的验收口径）。
    for (const row of gradeLoad(timing)) expect(row.limit, row.metric).toBe('—')
    expect(gradeLoad(timing).find((r) => r.metric === '首屏 · 合计')!.note).toContain('无阈值来源')
  })

  it('首帧那一行说清了它为什么与面数关系不大', () => {
    expect(gradeLoad(timing).find((r) => r.metric === '首屏 · 首帧')!.note).toContain('着色器编译')
  })

  it('全零也能报，不会除零或者产出 NaN', () => {
    for (const row of gradeLoad({ unpackMs: 0, buildMs: 0, firstFrameMs: 0 })) {
      expect(row.value).not.toContain('NaN')
    }
  })
})

describe('T-279 · JSON 报告', () => {
  const input = {
    capability: software,
    rows: gradeLoad({ unpackMs: 1, buildMs: 2, firstFrameMs: 3 }),
    scene: { triangles: 100, drawCalls: 20, geometries: 5, textures: 3, programs: 2, textureMemoryBytes: 4096 },
    userAgent: 'test-ua',
    screen: '800×600 @1x',
    takenAt: '2026-08-10T00:00:00.000Z',
    source: 'demo.w3p',
  }

  it('五样东西都在：capability / rows / scene / takenAt / machine', () => {
    const report = toJsonReport(input)
    expect(report.capability.level).toBe('software')
    expect(report.rows).toHaveLength(4)
    expect(report.scene.triangles).toBe(100)
    expect(report.takenAt).toBe('2026-08-10T00:00:00.000Z')
    expect(report.machine).toEqual({ userAgent: 'test-ua', screen: '800×600 @1x' })
  })

  it('带版本号 —— 回填脚本要能说出「这份是旧格式」', () => {
    // 报告文件会跨版本躺在 docs/bench-reports/ 里。没有版本号的话，读它的脚本只会
    // 默默读出 undefined 然后写一份空的附件A。
    expect(toJsonReport(input).version).toBe(1)
  })

  it('是可序列化的 —— 不带函数、不带循环引用', () => {
    expect(() => JSON.parse(JSON.stringify(toJsonReport(input)))).not.toThrow()
  })

  it('Markdown 与 JSON 同源：表里每一行在 JSON 里都有', () => {
    const markdown = toMarkdown(input)
    for (const row of toJsonReport(input).rows) expect(markdown).toContain(row.metric)
  })

  it('软渲这件事在 JSON 里也写着，不只在 Markdown 的那段警告里', () => {
    // 回填脚本（T-280）要据此拒绝把软渲报告写进附件A。只写在 Markdown 里的话，
    // 脚本只能去正则匹配一段中文——而那段中文一改措辞，拒绝就失效了。
    expect(toJsonReport(input).capability.level).toBe('software')
    expect(toJsonReport({ ...input, capability: { ...software, level: 'ok' } }).capability.level).toBe('ok')
  })
})

/* -------------------------------------------------------------------------- */
/* v1.0 · T-281 · 剖切与爆炸                                                   */
/* -------------------------------------------------------------------------- */

/**
 * 断言的是**形状**，不是毫秒（同 `scale.test.ts` 的做法）。
 *
 * 「开一次剖切要花多少毫秒」是这台机器的属性，写死一个数等于把开发机的显卡写进测试。
 * 能被钉住的是：两次切换各报各的数、program 差值是算出来的、没有剖切平面时报的是
 * 「不适用」而不是一个 0。
 */
describe('T-281 · 剖切切换的首帧代价', () => {
  const cost = {
    onFirstFrameMs: 42.4,
    offFirstFrameMs: 7.1,
    programsBefore: 12,
    programsAfterOn: 24,
    programsAfterOff: 25,
    clipPlanes: 2,
  }

  it('**开与关两次分别报数**，不是一个数字用两遍', () => {
    // 卡面点名的那条：把首帧代价改成复用上一次的数字，只有这条断言抓得到。
    // 两个输入故意差一个数量级——相等的话，「复用」与「分别量」产出同一张表。
    const rows = gradeSection(cost)
    const on = rows.find((r) => r.metric === '剖切切换首帧代价（开）')!
    const off = rows.find((r) => r.metric === '剖切切换首帧代价（关）')!
    expect(on.value).toBe('42 ms')
    expect(off.value).toBe('7 ms')
    expect(on.value).not.toBe(off.value)
  })

  it('回切那一行说清了为什么它要单独量', () => {
    const off = gradeSection(cost).find((r) => r.metric === '剖切切换首帧代价（关）')!
    expect(off.note).toContain('两次分别量')
  })

  it('**program 那一行报绝对数，不再报差值** —— 决策 4 撤回后的诚实形态', () => {
    // 原来它报「+N 个 program」并断言「开一次剖切等于全场材质重编译一遍」。对抗式复核
    // 证明那个差值**结构上恒为 0**：`renderStats.programs` 读的是 program 缓存，而
    // 「首屏 · 首帧」为了计时必然先按文档态画过一帧——走到这里的前提又正是 clipPlanes > 0，
    // 即那一帧已经把 clip=N 的变体编译完了。真实代价被记进了「首屏 · 首帧」。
    const row = gradeSection(cost).find((r) => r.metric === '剖切期间的 shader program 数')!
    expect(row.value).toBe('24 个')
    expect(row.value).not.toContain('+')
  })

  it('那一行的说明**承认自己量不到编译代价**，而不是声称量到了', () => {
    // 「留着一条声称已修好的行」比没有这一行更坏。
    const row = gradeSection(cost).find((r) => r.metric === '剖切期间的 shader program 数')!
    expect(row.note).toContain('这一行量不到那次编译的代价')
    expect(row.note).toContain('首屏 · 首帧')
    expect(row.note).not.toContain('这个数是上面那两个毫秒数的成因')
  })


  it('两个毫秒数的 limit 都是「—」：这一档没有阈值来源', () => {
    for (const row of gradeSection(cost)) expect(row.limit, row.metric).toBe('—')
  })

  it('裁剪平面条数与 program 变化都进了说明', () => {
    const on = gradeSection(cost).find((r) => r.metric === '剖切切换首帧代价（开）')!
    expect(on.note).toContain('2 条裁剪平面')
    expect(on.note).toContain('12 → 24')
  })

  it('没有剖切平面时报「不适用」，而不是省掉这一档', () => {
    // 一份少了一整档的报告与一份「这一档不适用」的报告，在读者眼里是两件事，
    // 而只有后者能被信任。
    const rows = gradeSection({ skipped: 'no-section' })
    expect(rows).toHaveLength(1)
    expect(rows[0]!.value).toContain('不适用')
    expect(rows[0]!.value).not.toBe('0 ms')
  })
})

describe('T-281 · 爆炸进行中的稳态帧率', () => {
  const cost = { groupName: '径向分组', members: 3, fps: 52.5, drawCalls: 210, frames: 60 }

  it('按与其余各档同一条帧率线评级', () => {
    expect(gradeExplode(cost)[0]!.verdict).toBe('pass')
    expect(gradeExplode({ ...cost, fps: BENCH_LIMITS.fpsWarn - 0.1 })[0]!.verdict).toBe('warn')
    expect(gradeExplode({ ...cost, fps: BENCH_LIMITS.fpsFail - 0.1 })[0]!.verdict).toBe('fail')
  })

  it('报的是分组名与在动的成员数', () => {
    const row = gradeExplode(cost)[0]!
    expect(row.value).toBe('52.5 fps · 210 drawcall')
    expect(row.note).toContain('径向分组')
    expect(row.note).toContain('3 个直接成员')
  })

  it('说清了量的是进行中而不是终态', () => {
    // 终态与静止画面没有区别，量它会量出一个和没爆炸时一模一样的数。
    expect(gradeExplode(cost)[0]!.note).toContain('终态与静止画面没有区别')
  })

  it('没有爆炸分组时报「不适用」', () => {
    const rows = gradeExplode(null)
    expect(rows).toHaveLength(1)
    expect(rows[0]!.value).toContain('不适用')
  })
})

describe('T-281 · 两档都跟着软渲警告一起走', () => {
  it('软渲时这两档的数字也在那段警告的管辖之下', () => {
    // 这两档同样是帧率类数据。它们进的是同一张表、同一份 Markdown，于是那段
    // 「不可作为验收依据」自动罩着它们——这一条断言的是「没有绕过去的第二条路」。
    const md = toMarkdown({
      capability: software,
      rows: [...gradeSection({
        onFirstFrameMs: 42,
        offFirstFrameMs: 7,
        programsBefore: 1,
        programsAfterOn: 2,
        programsAfterOff: 2,
        clipPlanes: 1,
      }), ...gradeExplode({ groupName: 'g', members: 1, fps: 10, drawCalls: 1, frames: 60 })],
      scene: { triangles: 1, drawCalls: 2, geometries: 3, textures: 4, programs: 5, textureMemoryBytes: 6 },
      userAgent: 'test',
      screen: '800×600 @1x',
      takenAt: '2026-08-10T00:00:00.000Z',
      source: 'demo.w3p',
    })
    expect(md).toContain('不可作为验收依据')
    expect(md).toContain('剖切切换首帧代价（开）')
    expect(md).toContain('爆炸进行中帧率')
  })
})

/* -------------------------------------------------------------------------- */
/* ADR-0042 · 「没测到」必须与「测出来是 0」长得不一样                          */
/* -------------------------------------------------------------------------- */

/**
 * 这一组守的是**一个在合同附件里出现假数字**的路径。
 *
 * 试跑实测（e2e 自己的环境：`--disable-gpu` + `?fast=1`）报告头三行是
 *   [fail] 平均帧率   = 0.0 fps
 *   [pass] P95 帧时间 = 0.0 ms      ← 0 毫秒的帧时间，判「通过」
 *   [pass] 最慢单帧   = 0.0 ms
 * 而 `pnpm test:e2e bench` 在这份报告上是绿的。
 */

describe('ADR-0042 · 采样不足的判据', () => {
  it('判据是 8 个样本，不是 1 个', () => {
    // frames === 1 的窗口实测出现过：那一帧吞了约 357ms 的编译卡顿，算出 2.8 fps，
    // 照样把整条爬坡截断。只挡 frames === 0 治的是表征，不是成因。
    expect(MIN_SAMPLES).toBe(8)
    expect(isMeasured(0)).toBe(false)
    expect(isMeasured(1)).toBe(false)
    expect(isMeasured(MIN_SAMPLES - 1)).toBe(false)
    expect(isMeasured(MIN_SAMPLES)).toBe(true)
  })

  it('未测到的文案带上样本数 —— 读者要看得出差多少', () => {
    expect(notMeasured(3)).toBe('未测到（样本 3/8）')
  })
})

describe('ADR-0042 · gradeFrames 样本不足', () => {
  const starved = summariseFrames([])

  it('空样本时**三行一起**报未测到', () => {
    // 三行一起，而不是只改第一行：p95 与 worst 在空样本下都是 0，而「0 毫秒的帧时间」
    // 会被 <= 33ms 判成通过——一份写着「P95 帧时间 0.0 ms ✅」的报告比写着 fail 的更危险。
    const rows = gradeFrames(starved)
    expect(rows).toHaveLength(3)
    for (const row of rows) {
      expect(row.value, row.metric).toBe('未测到（样本 0/8）')
      expect(row.verdict, row.metric).toBe('warn')
    }
  })

  it('**没有一行判 pass** —— 这是塌掉的那一格', () => {
    expect(gradeFrames(starved).some((r) => r.verdict === 'pass')).toBe(false)
  })

  it('7 个样本仍算未测到，8 个才作数', () => {
    const seven = summariseFrames(Array.from({ length: 7 }, () => 16.7))
    const eight = summariseFrames(Array.from({ length: 8 }, () => 16.7))
    expect(gradeFrames(seven)[0]!.value).toContain('未测到')
    expect(gradeFrames(eight)[0]!.value).toContain('fps')
    expect(gradeFrames(eight)[0]!.verdict).toBe('pass')
  })

  it('说明里写清了怎么办，而不只是说它坏了', () => {
    expect(gradeFrames(starved)[0]!.note).toContain('?fast=1')
    expect(gradeFrames(starved)[0]!.note).toContain('不要引用')
  })
})

describe('ADR-0042 · 未测到的档不参与任何推导', () => {
  /** low 全测到且很快；medium 的高灯档「没测到」；high 全测到但慢。 */
  const mixed: LightLevel[] = [
    { lights: 1, shadows: 'low', fps: 60, drawCalls: 1, frames: 60 },
    { lights: 8, shadows: 'low', fps: 55, drawCalls: 8, frames: 60 },
    { lights: 1, shadows: 'medium', fps: 58, drawCalls: 1, frames: 60 },
    // 采样不足：fps 字段是 0，但它不是读数
    { lights: 8, shadows: 'medium', fps: 0, drawCalls: 8, frames: 0 },
    { lights: 1, shadows: 'high', fps: 50, drawCalls: 1, frames: 60 },
    { lights: 8, shadows: 'high', fps: 46, drawCalls: 8, frames: 60 },
  ]

  it('上限只从测到的档里取', () => {
    // medium 的 8 盏没测到，所以 medium 的上限是 1 盏，不是「8 盏但 0 fps」也不是被它拖成 fail。
    const rows = gradeLighting(mixed)
    expect(rows.find((r) => r.metric === '动态灯上限（medium 阴影）')!.value).toContain('1 盏')
    expect(rows.find((r) => r.metric === '动态灯上限（low 阴影）')!.value).toContain('8 盏')
  })

  it('没测到的那一档在明细里报「未测到」并判 warn，不判 fail', () => {
    const row = gradeLighting(mixed).find((r) => r.metric === '灯 ×8 · 阴影 medium')!
    expect(row.value).toBe('未测到（样本 0/8）')
    expect(row.verdict).toBe('warn')
    expect(row.value).not.toContain('0.0 fps')
  })

  it('推荐档不被假 0 拖下去', () => {
    // high 的 8 盏是真读数且过线，所以推荐 high。假 0 若参与，medium 会被判成撑不住，
    // 而 high 反而看起来更好——那正是试跑里看到的反序。
    expect(recommendShadowDefault(mixed).setting).toBe('high')
  })

  it('**一档都没测到时，说的是「没跑成」而不是「硬件不行」**', () => {
    // 两件事给同一句话的话，一次坏采样会被当成一条硬件结论抄进验收单。
    const allStarved: LightLevel[] = SHADOW_QUALITIES.map((q) => ({
      lights: 1,
      shadows: q,
      fps: 0,
      drawCalls: 1,
      frames: 0,
    }))
    const result = recommendShadowDefault(allStarved)
    expect(result.setting).toBe('off')
    expect(result.reason).toContain('一档都没测到')
    expect(result.reason).toContain('重跑')
    expect(result.reason).not.toContain('带不动')
  })

  it('真的带不动时仍然说「带不动」', () => {
    const tooSlow: LightLevel[] = SHADOW_QUALITIES.map((q) => ({
      lights: 1,
      shadows: q,
      fps: 10,
      drawCalls: 1,
      frames: 60,
    }))
    expect(recommendShadowDefault(tooSlow).reason).toContain('带不动')
  })

  it('承载上限也只从测到的档里取', () => {
    const rows = gradeStress([
      { copies: 1, fps: 60, drawCalls: 100, triangles: 1000, frames: 60 },
      { copies: 2, fps: 55, drawCalls: 200, triangles: 2000, frames: 60 },
      { copies: 4, fps: 0, drawCalls: 400, triangles: 4000, frames: 0 },
    ])
    expect(rows.find((r) => r.metric === '承载上限')!.value).toContain('2 份场景')
    const starved = rows.find((r) => r.metric === '逐级加载 ×4')!
    expect(starved.value).toBe('未测到（样本 0/8）')
    expect(starved.verdict).toBe('warn')
  })

  it('爆炸档同理', () => {
    const row = gradeExplode({ groupName: 'g', members: 2, fps: 0, drawCalls: 1, frames: 2 })[0]!
    expect(row.value).toBe('未测到（样本 2/8）')
    expect(row.verdict).toBe('warn')
  })
})

describe('ADR-0042 · 阴影贴图显存取最贵的那一档', () => {
  it('按显存取最大，不是按灯数取最大', () => {
    // 原实现是 `l.lights > best.lights`（严格大于 + 插入序），于是永远取第一个达到最大
    // 灯数的档——也就是 low，最便宜的。这个错在完全干净的跑里也成立。
    const levels: LightLevel[] = [
      { lights: 8, shadows: 'low', fps: 60, drawCalls: 8, frames: 60 },
      { lights: 8, shadows: 'medium', fps: 55, drawCalls: 8, frames: 60 },
      { lights: 8, shadows: 'high', fps: 50, drawCalls: 8, frames: 60 },
    ]
    const row = gradeLighting(levels).find((r) => r.metric === '阴影贴图显存（估算）')!
    expect(row.value).toContain('high')
    expect(row.value).not.toContain('low')
    const mb = estimateShadowMemory(8, 'high') / (1024 * 1024)
    expect(row.value).toContain(mb.toFixed(1))
  })

  it('灯少但档高时也取显存大的那个', () => {
    // 4 盏 high = 4×2048²×4 = 64MB > 8 盏 low = 8×512²×4 = 8MB
    const levels: LightLevel[] = [
      { lights: 8, shadows: 'low', fps: 60, drawCalls: 8, frames: 60 },
      { lights: 4, shadows: 'high', fps: 50, drawCalls: 4, frames: 60 },
    ]
    expect(gradeLighting(levels).find((r) => r.metric === '阴影贴图显存（估算）')!.value).toContain('4 盏 · high')
  })

  it('没测到的档不进选择', () => {
    const levels: LightLevel[] = [
      { lights: 1, shadows: 'low', fps: 60, drawCalls: 1, frames: 60 },
      { lights: 8, shadows: 'high', fps: 0, drawCalls: 8, frames: 0 },
    ]
    expect(gradeLighting(levels).find((r) => r.metric === '阴影贴图显存（估算）')!.value).toContain('1 盏 · low')
  })
})

describe('ADR-0042 · 剖切「有刀但都关着」与「没有刀」分开报', () => {
  it('没有刀：不适用，判 pass', () => {
    const rows = gradeSection({ skipped: 'no-section' })
    expect(rows).toHaveLength(1)
    expect(rows[0]!.value).toContain('不适用')
    expect(rows[0]!.verdict).toBe('pass')
  })

  it('**有刀但都关着：未测到，判 warn**', () => {
    // 送检资产带了刀却量不到，是需要重测的信号，不是通过。原实现两种共用一句
    // 「不适用」并判 pass——于是一份带着关刀的资产会得到三行绿色的 0 ms。
    const rows = gradeSection({ skipped: 'no-planes', sectionNodes: 2 })
    expect(rows).toHaveLength(1)
    expect(rows[0]!.value).toContain('未测到')
    expect(rows[0]!.verdict).toBe('warn')
    expect(rows[0]!.value).not.toContain('不适用')
  })

  it('两种跳过的文案不一样 —— 合成一句的话第二种会被当成第一种放过去', () => {
    const a = gradeSection({ skipped: 'no-section' })[0]!
    const b = gradeSection({ skipped: 'no-planes', sectionNodes: 1 })[0]!
    expect(a.value).not.toBe(b.value)
    expect(a.verdict).not.toBe(b.verdict)
  })

  it('「都关着」那条说清了有几把刀、以及怎么办', () => {
    const row = gradeSection({ skipped: 'no-planes', sectionNodes: 3 })[0]!
    expect(row.note).toContain('3 个剖切节点')
    expect(row.note).toContain('ADR-0039')
    expect(row.note).toContain('不是「代价为 0」')
  })

  it('一个 0 ms 都不会出现在跳过的那一行里', () => {
    // 这是本条修复的全部要点：0 ms 只能来自真的量了一次。
    for (const m of [{ skipped: 'no-section' } as const, { skipped: 'no-planes', sectionNodes: 1 } as const]) {
      expect(gradeSection(m)[0]!.value).not.toContain('0 ms')
    }
  })
})

describe('ADR-0042 · shouldKeepSampling —— 缺陷的根', () => {
  const FAST_LIGHTING = 200

  it('标称窗口没到就继续，与原来一样', () => {
    expect(shouldKeepSampling({ elapsedMs: 10, samples: 0, durationMs: FAST_LIGHTING })).toBe(true)
    expect(shouldKeepSampling({ elapsedMs: 199, samples: 999, durationMs: FAST_LIGHTING })).toBe(true)
  })

  it('到点且样本够了就收', () => {
    expect(shouldKeepSampling({ elapsedMs: 200, samples: MIN_SAMPLES, durationMs: FAST_LIGHTING })).toBe(false)
  })

  it('**到点但样本不够就延长** —— 这一条就是修复本身', () => {
    // 原实现在这里返回 false，于是 times 是空的，summariseFrames 算出 fps 0，
    // 而那个 0 与「真的 0 fps」在下游完全同形。
    expect(shouldKeepSampling({ elapsedMs: 200, samples: 0, durationMs: FAST_LIGHTING })).toBe(true)
    expect(shouldKeepSampling({ elapsedMs: 400, samples: MIN_SAMPLES - 1, durationMs: FAST_LIGHTING })).toBe(true)
  })

  it('延长有上限 —— 一台一帧几百毫秒的机器不该把 bench 挂在那里', () => {
    expect(shouldKeepSampling({ elapsedMs: 200 * HARD_CAP_FACTOR, samples: 0, durationMs: FAST_LIGHTING })).toBe(false)
    expect(shouldKeepSampling({ elapsedMs: 200 * HARD_CAP_FACTOR - 1, samples: 0, durationMs: FAST_LIGHTING })).toBe(true)
  })

  it('实测那条时间线：一次 334ms 的编译卡顿不再让这一档归零', () => {
    // 试跑抓到的真实窗口：dur=339.7ms frames=2 frameMs=[6,334]，warmup=4。
    // 两帧全被 warmup 吃掉，有效样本 0。
    //
    // 旧规则：elapsed(340) >= duration(200) → 停 → times=[] → 0.0 fps → 判 fail →
    //         截断爬坡 → 污染上限与推荐 → 经 T-280 落进合同附件 A §7。
    // 新规则：样本 0 < 8 且 340 < 600 → 继续。卡顿过去之后帧回到 ~7ms，
    //         再有 60ms 就能收满 8 个。
    expect(shouldKeepSampling({ elapsedMs: 339.7, samples: 0, durationMs: FAST_LIGHTING })).toBe(true)
    // 收满之后的下一次判定：停。
    expect(shouldKeepSampling({ elapsedMs: 400, samples: MIN_SAMPLES, durationMs: FAST_LIGHTING })).toBe(false)
  })

  it('主采样档（?fast=1 下 600ms / warmup 30）同一条规则', () => {
    // 这一档才是最刺眼的那个：e2e 自己的环境下它报出「平均帧率 0.0 fps」。
    expect(shouldKeepSampling({ elapsedMs: 600, samples: 0, durationMs: 600 })).toBe(true)
    expect(shouldKeepSampling({ elapsedMs: 1800, samples: 0, durationMs: 600 })).toBe(false)
  })

  it('硬上限是标称的 3 倍，写在常量里而不是散在两处', () => {
    expect(HARD_CAP_FACTOR).toBe(3)
  })
})

/* -------------------------------------------------------------------------- */
/* ADR-0042 第二轮 · 对抗式复核查出来的                                        */
/* -------------------------------------------------------------------------- */

/**
 * 第一轮的净效果是正的，但复核判它**站不住**，两条 blocker：
 *
 * 1. 「一档都没测到」在**五条产能结论行**上仍然长成硬件结论——值写「不足 1 盏 / 不足
 *    1 份」、判 fail。同一个文件的 `recommendShadowDefault` 明明为这件事单开了分支并写了
 *    注释，作者自己的规矩没往上一格走。而第一轮新加的 e2e 守卫写的是「值含『未测到』才查
 *    warn」，这五行不含那三个字，正好从守卫底下过。**那是起因那三行 0.0 fps 换了个措辞活下来。**
 * 2. `docs/MUTATIONS.md` 里为决策 3 登记的「红 2 条」不可能成立：被变异的那一行
 *    （`measureSection` 里的 `clipPlanes === 0`）全仓**零测试引用**。账本里一条
 *    「声称红、实际绿」的记录，比没有记录更坏——它让下一个人以为这里有守卫。
 */

describe('ADR-0042 第二轮 · 「没测到」不许长成硬件结论（blocker A1）', () => {
  /** 一整组灯光档，全部采样不足。 */
  const starved: LightLevel[] = (['off', ...SHADOW_QUALITIES] as ShadowSetting[]).flatMap((shadows) =>
    [0, 1].map((lights) => ({ lights, shadows, fps: 0, drawCalls: 1, frames: 2 })),
  )

  it('四条「动态灯上限」报未测到并判 **warn**，不是「不足 1 盏」判 fail', () => {
    const rows = gradeLighting(starved)
    for (const metric of [
      '动态灯上限（无阴影）',
      '动态灯上限（low 阴影）',
      '动态灯上限（medium 阴影）',
      '动态灯上限（high 阴影）',
    ]) {
      const row = rows.find((r) => r.metric === metric)!
      expect(row.value, metric).toContain('未测到')
      expect(row.value, metric).not.toContain('不足 1 盏')
      expect(row.verdict, metric).toBe('warn')
    }
  })

  it('那四行的说明里写着「这不是硬件结论」', () => {
    const row = gradeLighting(starved).find((r) => r.metric === '动态灯上限（无阴影）')!
    expect(row.note).toContain('这不是硬件结论')
    expect(row.note).toContain('重跑')
  })

  it('「承载上限」同样：未测到 → warn，不是「不足 1 份」→ fail', () => {
    const rows = gradeStress([
      { copies: 1, fps: 0, drawCalls: 1, triangles: 10, frames: 0 },
      { copies: 2, fps: 0, drawCalls: 1, triangles: 10, frames: 3 },
    ])
    const row = rows.find((r) => r.metric === '承载上限')!
    expect(row.value).toContain('未测到')
    expect(row.verdict).toBe('warn')
    expect(row.note).toContain('这不是硬件结论')
  })

  it('**真的测了、真的一档都不过线时，仍然判 fail** —— 那才是硬件结论', () => {
    // 两种成因必须分得开：把 none-passed 也改成 warn 的话，一台真的跑不动的机器
    // 会得到一份「需要重测」的报告，而它已经测过了。
    const tooSlow: LightLevel[] = [{ lights: 1, shadows: 'off', fps: 10, drawCalls: 1, frames: 60 }]
    const row = gradeLighting(tooSlow).find((r) => r.metric === '动态灯上限（无阴影）')!
    expect(row.value).toBe('不足 1 盏')
    expect(row.verdict).toBe('fail')

    const stress = gradeStress([{ copies: 1, fps: 10, drawCalls: 1, triangles: 10, frames: 60 }])
    expect(stress.find((r) => r.metric === '承载上限')!.verdict).toBe('fail')
  })

  it('部分测到时不受影响 —— 只有「一档都没测到」才是 not-measured', () => {
    const mixed: LightLevel[] = [
      { lights: 1, shadows: 'off', fps: 60, drawCalls: 1, frames: 60 },
      { lights: 8, shadows: 'off', fps: 0, drawCalls: 8, frames: 0 },
    ]
    const row = gradeLighting(mixed).find((r) => r.metric === '动态灯上限（无阴影）')!
    expect(row.value).toContain('1 盏')
    expect(row.verdict).toBe('pass')
  })
})

describe('ADR-0042 第二轮 · 阴影显存那一行的三处（A2 / A3 / A5）', () => {
  it('**0 盏不当选** —— 爬坡在 count=0 就收摊时不报「0.0 MB（0 盏 · low）」', () => {
    // 第一版会把「没爬上去」印成一个判 pass 的读数，读者据此得出「阴影几乎不占显存」。
    // 而第一版新加的 e2e 零值守卫按量纲写死成 fps|ms，MB 从底下走过去了。
    const zeroOnly: LightLevel[] = SHADOW_QUALITIES.map((q) => ({
      lights: 0,
      shadows: q as ShadowSetting,
      fps: 30,
      drawCalls: 1,
      frames: 60,
    }))
    expect(gradeLighting(zeroOnly).find((r) => r.metric === '阴影贴图显存（估算）'), '0 盏不该产出这一行').toBeUndefined()
  })

  it('**平手取更贵的档** —— 严格大于在平手时仍然偏向便宜的那个', () => {
    // 2 盏 high = 2×2048²×4 = 32 MB；8 盏 medium = 8×1024²×4 = 32 MB。平手在真实网格上可达。
    expect(estimateShadowMemory(2, 'high')).toBe(estimateShadowMemory(8, 'medium'))
    const tie: LightLevel[] = [
      { lights: 8, shadows: 'medium', fps: 50, drawCalls: 8, frames: 60 },
      { lights: 2, shadows: 'high', fps: 50, drawCalls: 2, frames: 60 },
    ]
    expect(gradeLighting(tie).find((r) => r.metric === '阴影贴图显存（估算）')!.value).toContain('high')
  })

  it('**一档都没测到时报「未测到」，而不是整行消失**', () => {
    // 同一个文件上方 gradeSection 的注释刚写过「少了一整档的报告与『这一档没量到』的
    // 报告，在读者眼里是两件事」。两处纪律要一致。
    const starved: LightLevel[] = SHADOW_QUALITIES.map((q) => ({
      lights: 4,
      shadows: q as ShadowSetting,
      fps: 0,
      drawCalls: 4,
      frames: 1,
    }))
    const row = gradeLighting(starved).find((r) => r.metric === '阴影贴图显存（估算）')!
    expect(row, '这一行不该消失').toBeDefined()
    expect(row.value).toContain('未测到')
    expect(row.verdict).toBe('warn')
  })

  it('那一行不再与「上限」打架 —— 说明里写清了它报的就是压垮爬坡的那一档', () => {
    const row = gradeLighting(LADDER).find((r) => r.metric === '阴影贴图显存（估算）')!
    expect(row.note).toContain('已测到的档里最重的那一个')
    expect(row.note).toContain('不矛盾')
  })
})

describe('ADR-0042 第二轮 · classifySection（blocker C1 + B3）', () => {
  /**
   * 判据从 `measureSection` 里抽出来，因为那个函数全仓**零测试引用**——模块私有，
   * 而 bench 的 e2e 夹具每个节点写死 `section: null`。账本里为它登记的「红 2 条」
   * 引的是 `gradeSection` 这个纯函数喂手搓输入的用例，与被变异的那一行毫无关系。
   */
  it('一把刀都没有 → no-section', () => {
    expect(classifySection({ sectionNodes: 0, clipPlanes: 0 })).toEqual({ skipped: 'no-section' })
    // 有平面但没有节点是不可能的状态；判据仍以节点数优先，因为那是「与这份资产无关」。
    expect(classifySection({ sectionNodes: 0, clipPlanes: 3 })).toEqual({ skipped: 'no-section' })
  })

  it('**有刀但一条平面都没装 → no-planes**，且带上刀的数量', () => {
    expect(classifySection({ sectionNodes: 2, clipPlanes: 0 })).toEqual({ skipped: 'no-planes', sectionNodes: 2 })
  })

  it('装上了平面 → 可以量', () => {
    expect(classifySection({ sectionNodes: 1, clipPlanes: 1 })).toBeNull()
    expect(classifySection({ sectionNodes: 3, clipPlanes: 2 })).toBeNull()
  })

  it('两种跳过给出的形状不同 —— 下游据此判 pass 还是 warn', () => {
    const a = classifySection({ sectionNodes: 0, clipPlanes: 0 })!
    const b = classifySection({ sectionNodes: 1, clipPlanes: 0 })!
    expect(gradeSection(a)[0]!.verdict).toBe('pass')
    expect(gradeSection(b)[0]!.verdict).toBe('warn')
  })
})

/**
 * T-294 · 后处理三档。
 *
 * 在此之前 bench 已经在量「开 / 关后处理」两档了（T-235），但结果只 `console.info`。
 * **不进表就等于没量**：报告导出的是 `rows`，回填脚本读的也是 `rows`，一个只在控制台
 * 出现过的数字，第二天就没人找得到。
 */
describe('gradePostFx · 后处理链的三档', () => {
  const cost = { offFps: 60, onePassFps: 54, twoPassFps: 45, mode: 'composed', frames: 40 }

  it('报的是相对代价，不是绝对帧率', () => {
    const rows = gradePostFx(cost)
    // 绝对帧率只在这一台机器上有意义；「开一条描边掉 10%」才是能跨机器比的那个数。
    expect(rows[0]!.value).toContain('10.0%')
    expect(rows[1]!.value).toContain('25.0%')
    // 原始读数也要留着，否则读者没法判断这台机器本来快不快。
    expect(rows[0]!.value).toContain('60.0')
  })

  it('两条 pass 那一行说清它是上限', () => {
    // `MAX_ACTIVE_OUTLINE_PRESETS = 2`，而这个默认值**今天是拍的不是测的**。
    expect(gradePostFx(cost)[1]!.metric).toContain('上限')
  })

  it('采样不足时报「未测到」，不是报 0%', () => {
    const rows = gradePostFx({ ...cost, frames: 3 })
    // ADR-0042 的同一条纪律：没量到与「代价为 0」是两件事，而后者会被读成好消息。
    expect(rows).toHaveLength(1)
    expect(rows[0]!.value).toContain('未测到')
    expect(rows[0]!.verdict).toBe('warn')
    expect(rows[0]!.value).not.toContain('0.0%')
  })

  it('整轮没跑到时也出一行，不是整行消失', () => {
    const rows = gradePostFx(null)
    // 整行消失读起来像「这一档不存在」，而实际是「这一档没量到」。
    expect(rows).toHaveLength(1)
    expect(rows[0]!.verdict).toBe('warn')
    expect(rows[0]!.value).toContain('未测到')
  })

  it('代价越界时判 fail，不是永远 pass', () => {
    // 一条永远 pass 的判据，与没有判据是同一件事。
    expect(gradePostFx({ ...cost, twoPassFps: 20 })[1]!.verdict).toBe('fail')
    expect(gradePostFx({ ...cost, onePassFps: 30 })[0]!.verdict).toBe('fail')
  })
})
