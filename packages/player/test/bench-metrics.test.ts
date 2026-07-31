import { DEFAULT_POLICY } from '@w3/core'
import { describe, expect, it } from 'vitest'
import { BENCH_LIMITS, estimateTextureMemory, gradeFrames, gradeScene, summariseFrames, toMarkdown } from '../src/bench/metrics.js'
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
})

describe('summariseFrames', () => {
  it('reports p95, not the mean — that is where stutter hides', () => {
    // 60 fps with one 400 ms hitch: the mean says "fine", p95 and worst say otherwise.
    const frames = [...Array(99).fill(16.7), 400]
    const stats = summariseFrames(frames)
    expect(stats.fps).toBeGreaterThan(40)
    expect(stats.worstFrameMs).toBe(400)
    expect(stats.p95FrameMs).toBeGreaterThanOrEqual(16.7)
  })

  it('grades that scene as a warning on frame time despite an acceptable average', () => {
    const rows = gradeFrames(summariseFrames([...Array(20).fill(16.7), ...Array(2).fill(120)]))
    const p95 = rows.find((r) => r.metric === 'P95 帧时间')!
    expect(p95.verdict).not.toBe('pass')
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

  it('says out loud that the draw-call ceiling has no measured source', () => {
    // 附件A's acceptance is "每个数值都有实测或阈值来源，不是拍脑袋". A number without one
    // has to say so in the report itself, or it will be read as a finding.
    const row = gradeScene(base).find((r) => r.metric === 'Draw call')!
    expect(row.note).toContain('尚无实测来源')
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
