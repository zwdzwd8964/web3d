import { DEFAULT_POLICY } from '@w3/core'
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
  gradeStress,
  summariseFrames,
  toMarkdown,
} from '../src/bench/metrics.js'
import type { LightLevel } from '../src/bench/metrics.js'
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
  const level = (lights: number, shadows: 'off' | 'medium' | 'high', fps: number): LightLevel => ({
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
    expect(SHADOW_MODES).toEqual(['off', 'medium', 'high'])
  })
})
