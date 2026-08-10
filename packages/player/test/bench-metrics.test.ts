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
  gradeLoad,
  gradeStress,
  estimateShadowMemory,
  recommendShadowDefault,
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
  const rung = (copies: number, fps: number): StressLevel => ({
    copies,
    fps,
    drawCalls: copies * 100,
    triangles: copies * 50_000,
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
  const level = (lights: number, shadows: ShadowSetting, fps: number): LightLevel => ({
    lights,
    shadows,
    fps,
    drawCalls: 10 + lights,
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
  { lights: 0, shadows: 'off', fps: 60, drawCalls: 10 },
  { lights: 1, shadows: 'off', fps: 59, drawCalls: 11 },
  { lights: 4, shadows: 'off', fps: 58, drawCalls: 14 },
  { lights: 8, shadows: 'off', fps: 57, drawCalls: 18 },
  { lights: 0, shadows: 'low', fps: 56, drawCalls: 10 },
  { lights: 1, shadows: 'low', fps: 55, drawCalls: 11 },
  { lights: 4, shadows: 'low', fps: 54, drawCalls: 14 },
  { lights: 8, shadows: 'low', fps: 53, drawCalls: 18 },
  { lights: 0, shadows: 'medium', fps: 52, drawCalls: 10 },
  { lights: 1, shadows: 'medium', fps: 51, drawCalls: 11 },
  { lights: 4, shadows: 'medium', fps: 50, drawCalls: 14 },
  { lights: 8, shadows: 'medium', fps: 20, drawCalls: 18 },
  { lights: 0, shadows: 'high', fps: 49, drawCalls: 10 },
  { lights: 1, shadows: 'high', fps: 48, drawCalls: 11 },
  { lights: 4, shadows: 'high', fps: 24, drawCalls: 14 },
  { lights: 8, shadows: 'high', fps: 9, drawCalls: 18 },
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
    const rows2 = gradeLighting([{ lights: 1, shadows: 'high', fps: 10, drawCalls: 1 }])
    expect(rows2.find((r) => r.metric === '动态灯上限（high 阴影）')!.value).toBe('不足 1 盏')
    expect(rows2.find((r) => r.metric === '动态灯上限（high 阴影）')!.verdict).toBe('fail')
  })
})

describe('T-279 · recommendShadowDefault', () => {
  it('三档都带得动 1 盏时推荐 high', () => {
    const result = recommendShadowDefault([
      { lights: 1, shadows: 'low', fps: 60, drawCalls: 1 },
      { lights: 1, shadows: 'medium', fps: 58, drawCalls: 1 },
      { lights: 1, shadows: 'high', fps: 50, drawCalls: 1 },
    ])
    expect(result.setting).toBe('high')
    expect(result.reason).toContain('high')
  })

  it('high 带不动时退到 medium', () => {
    const result = recommendShadowDefault([
      { lights: 1, shadows: 'low', fps: 60, drawCalls: 1 },
      { lights: 1, shadows: 'medium', fps: 50, drawCalls: 1 },
      { lights: 1, shadows: 'high', fps: 20, drawCalls: 1 },
    ])
    expect(result.setting).toBe('medium')
  })

  it('只有 low 带得动时推荐 low', () => {
    const result = recommendShadowDefault([
      { lights: 1, shadows: 'low', fps: 46, drawCalls: 1 },
      { lights: 1, shadows: 'medium', fps: 30, drawCalls: 1 },
      { lights: 1, shadows: 'high', fps: 12, drawCalls: 1 },
    ])
    expect(result.setting).toBe('low')
  })

  it('三档都带不动 1 盏时推荐关闭，并说清为什么', () => {
    const result = recommendShadowDefault([
      { lights: 1, shadows: 'low', fps: 30, drawCalls: 1 },
      { lights: 1, shadows: 'medium', fps: 20, drawCalls: 1 },
      { lights: 1, shadows: 'high', fps: 8, drawCalls: 1 },
    ])
    expect(result.setting).toBe('off')
    // 这句话会被抄进验收单，所以它不是调试信息。
    expect(result.reason).toContain('用户不会把掉帧归因到这个开关上')
  })

  it('「0 盏也能跑」不算数 —— 门槛是至少带得动 1 盏投影灯', () => {
    // 0 盏投影灯下开着阴影和关着阴影是同一件事。把它算进去的话，任何机器都会被推荐 high。
    const result = recommendShadowDefault([
      { lights: 0, shadows: 'high', fps: 60, drawCalls: 1 },
      { lights: 1, shadows: 'high', fps: 10, drawCalls: 1 },
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
    const rows = gradeLighting([{ lights: 4, shadows: 'off', fps: 60, drawCalls: 1 }])
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
