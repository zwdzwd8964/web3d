import { describe, expect, it } from 'vitest'
import type { AssetStats } from '../src/assets.js'
import { DEFAULT_ASSET_POLICY, describePolicy, evaluateAsset, formatBytes } from '../src/assetPolicy.js'
import { createGoldenPathDocument } from '../src/samples.js'

const clean: AssetStats = {
  bytes: 8_412_300,
  triangles: 128_400,
  drawCalls: 18,
  meshes: 3,
  materials: 12,
  textures: 6,
  textureBytes: 42_991_616,
  maxTextureSize: 1024,
  animations: 0,
  nodes: 7,
}

describe('asset health check (R01)', () => {
  it('passes the golden path asset — the numbers the plan quotes in step 2', () => {
    const report = evaluateAsset(clean)
    expect(report.verdict).toBe('pass')
    expect(report.failing).toHaveLength(0)
    expect(report.summary).toContain('体检通过')
  })

  it('reports one line per threshold, each with the measured value and the limit', () => {
    const report = evaluateAsset(clean)
    expect(report.lines).toHaveLength(8)
    for (const line of report.lines) {
      expect(line.label.length).toBeGreaterThan(0)
      expect(line.limit).toBeGreaterThan(0)
      expect(['pass', 'warn', 'fail']).toContain(line.verdict)
    }
  })

  it('fails a CAD-sized export and names every offending item', () => {
    const cad: AssetStats = { ...clean, triangles: 4_200_000, bytes: 260 * 1024 * 1024, drawCalls: 3_400 }
    const report = evaluateAsset(cad)
    expect(report.verdict).toBe('fail')
    expect(report.failing.map((l) => l.key).sort()).toEqual(['bytes', 'drawCalls', 'triangles'])
    expect(report.summary).toContain('体检未通过')
    expect(report.summary).toContain('三角面数')
  })

  it('gives a concrete next step for every non-passing line, never a vague one', () => {
    const report = evaluateAsset({ ...clean, textureBytes: 900 * 1024 * 1024 })
    for (const line of report.lines) {
      if (line.verdict === 'pass') expect(line.advice).toBe('')
      else expect(line.advice.length).toBeGreaterThan(8)
    }
  })

  it('warns before it fails, at 80% of the limit', () => {
    const near: AssetStats = { ...clean, triangles: Math.floor(DEFAULT_ASSET_POLICY.maxTriangles * 0.85) }
    const report = evaluateAsset(near)
    expect(report.verdict).toBe('warn')
    expect(report.lines.find((l) => l.key === 'triangles')?.verdict).toBe('warn')
    expect(report.summary).toContain('接近上限')
  })

  it('treats exactly-at-the-limit as passing, not failing', () => {
    const exact: AssetStats = { ...clean, triangles: DEFAULT_ASSET_POLICY.maxTriangles }
    expect(evaluateAsset(exact).lines.find((l) => l.key === 'triangles')?.verdict).toBe('warn')
    expect(evaluateAsset(exact).failing).toHaveLength(0)
  })

  it('accepts an injected policy so a customer-specific Appendix A can be applied', () => {
    const strict = { ...DEFAULT_ASSET_POLICY, maxTriangles: 50_000 }
    expect(evaluateAsset(clean, strict).verdict).toBe('fail')
  })

  it('describePolicy renders the numbers Appendix A is written from', () => {
    const text = describePolicy()
    expect(text).toContain('三角面数')
    expect(text).toContain('300,000')
    expect(text.split('\n')).toHaveLength(8)
  })

  it('formats byte sizes the way the import dialog shows them', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(8_412_300)).toBe('8.0 MB')
    expect(formatBytes(1536)).toBe('1.5 KB')
  })

  it('the sample document carries stats the policy can actually read', () => {
    const stats = createGoldenPathDocument().assets[0]!.stats
    expect(stats).not.toBeNull()
    expect(evaluateAsset(stats!).verdict).toBe('pass')
  })
})
