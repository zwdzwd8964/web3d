import { DEFAULT_POLICY } from '@w3/core'
import type { CapabilityReport } from '@w3/core'

/**
 * T-110 · what the benchmark measures, and how it turns numbers into a verdict.
 *
 * Split from the page so it is unit-testable: every threshold and every bit of arithmetic
 * lives here, and the page only draws. 技术方案 §3.2-5 is the source of the metric list;
 * the thresholds are the same ones `@w3/core`'s asset policy uses, because a benchmark
 * that graded against different numbers than the import health check would be telling the
 * customer two different stories about the same model.
 */

export type Verdict = 'pass' | 'warn' | 'fail'

export interface Sample {
  readonly frames: number
  readonly elapsedMs: number
}

export interface FrameStats {
  readonly fps: number
  /** The frame time 95% of frames came in under. Stutter hides in this, not in the mean. */
  readonly p95FrameMs: number
  readonly worstFrameMs: number
  readonly frames: number
}

export interface SceneStats {
  readonly triangles: number
  readonly drawCalls: number
  readonly geometries: number
  readonly textures: number
  readonly programs: number
  /** Rough VRAM for textures, in bytes. Estimate — see `estimateTextureMemory`. */
  readonly textureMemoryBytes: number
}

export interface BenchRow {
  readonly metric: string
  readonly value: string
  readonly limit: string
  readonly verdict: Verdict
  readonly note: string
}

/**
 * Frame statistics from raw frame times.
 *
 * p95 rather than a mean: a scene that runs at 60 fps with one 400 ms hitch per second
 * averages out to something that looks acceptable and feels broken. The worst frame is
 * reported too, because that is the number a customer describes as "it freezes".
 */
export function summariseFrames(frameTimesMs: readonly number[]): FrameStats {
  if (frameTimesMs.length === 0) return { fps: 0, p95FrameMs: 0, worstFrameMs: 0, frames: 0 }
  const sorted = [...frameTimesMs].sort((a, b) => a - b)
  const total = frameTimesMs.reduce((n, t) => n + t, 0)
  const index = Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))
  return {
    fps: total > 0 ? (frameTimesMs.length * 1000) / total : 0,
    p95FrameMs: sorted[index]!,
    worstFrameMs: sorted[sorted.length - 1]!,
    frames: frameTimesMs.length,
  }
}

/**
 * Texture VRAM, estimated.
 *
 * Called an estimate on purpose and labelled as one in the report. The GPU's actual
 * allocation depends on the driver's internal format, compression and alignment, and
 * WebGL exposes none of that. What this gives is the right order of magnitude and a
 * reliable relative comparison between two models, which is what the number is for.
 *
 * RGBA8 plus a full mip chain: 4 bytes per texel × 4/3.
 */
export function estimateTextureMemory(textures: readonly { width: number; height: number }[]): number {
  return textures.reduce((total, t) => total + Math.ceil(t.width * t.height * 4 * (4 / 3)), 0)
}

/**
 * The grading table.
 *
 * Every threshold is sourced, and the source is printed in the report — 附件A (T-113) has
 * to be defensible in a contract negotiation, and a number nobody can trace is a number
 * the customer's engineer will refuse.
 */
export const BENCH_LIMITS = {
  /**
   * Frame-rate thresholds. NOT measured — chosen from the standard perception figures
   * (60 Hz display, 45 fps is where camera drag starts to read as sluggish, 25 fps is
   * where it reads as broken). 附件A must label these as conventions, not as findings,
   * until someone has run this page on the target hardware.
   */
  fpsWarn: 45,
  fpsFail: 25,
  /** One frame in twenty over ~2 display refreshes and the motion is visibly uneven. */
  p95FrameWarn: 33,
  p95FrameFail: 66,

  /**
   * Scene budgets, taken from `DEFAULT_POLICY` rather than restated.
   *
   * They were restated once, and the restated triangle ceiling was 1,500,000 against a
   * real policy of 300,000 — a five-fold error in a number that is destined for a
   * contract annex. Reading the constant is the only way this stays true when the policy
   * moves.
   */
  triangles: DEFAULT_POLICY.maxTriangles,
  textures: DEFAULT_POLICY.maxTextures,
  textureBytes: DEFAULT_POLICY.maxTextureBytes,

  /**
   * Draw calls have NO policy source: the import health check counts materials and
   * meshes, not batches. This figure is a conventional ceiling for integrated graphics
   * and is flagged as unmeasured in 附件A.
   */
  drawCalls: 1_200,
} as const

export function gradeFrames(stats: FrameStats): BenchRow[] {
  return [
    {
      metric: '平均帧率',
      value: `${stats.fps.toFixed(1)} fps`,
      limit: `≥ ${BENCH_LIMITS.fpsWarn} fps`,
      verdict: stats.fps >= BENCH_LIMITS.fpsWarn ? 'pass' : stats.fps >= BENCH_LIMITS.fpsFail ? 'warn' : 'fail',
      note: '拖动相机时的连续渲染帧率。低于 25 fps 时交互会明显拖沓。',
    },
    {
      metric: 'P95 帧时间',
      value: `${stats.p95FrameMs.toFixed(1)} ms`,
      limit: `≤ ${BENCH_LIMITS.p95FrameWarn} ms`,
      verdict:
        stats.p95FrameMs <= BENCH_LIMITS.p95FrameWarn
          ? 'pass'
          : stats.p95FrameMs <= BENCH_LIMITS.p95FrameFail
            ? 'warn'
            : 'fail',
      note: '每 20 帧里最慢的那一帧。平均帧率好看但这一项超标，表现为「时不时卡一下」。',
    },
    {
      metric: '最慢单帧',
      value: `${stats.worstFrameMs.toFixed(1)} ms`,
      limit: '—',
      verdict: 'pass',
      note: '仅供参考。首帧与着色器编译通常落在这里。',
    },
  ]
}

export function gradeScene(stats: SceneStats): BenchRow[] {
  const memMB = stats.textureMemoryBytes / (1024 * 1024)
  return [
    {
      metric: '三角面数',
      value: stats.triangles.toLocaleString('en-US'),
      limit: BENCH_LIMITS.triangles.toLocaleString('en-US'),
      verdict: stats.triangles <= BENCH_LIMITS.triangles ? 'pass' : 'fail',
      note: '来源：DEFAULT_POLICY.maxTriangles，与导入体检同一常量。',
    },
    {
      metric: 'Draw call',
      value: String(stats.drawCalls),
      limit: String(BENCH_LIMITS.drawCalls),
      verdict: stats.drawCalls <= BENCH_LIMITS.drawCalls ? 'pass' : 'fail',
      note: '每帧的绘制批次。集成显卡上这一项常比面数更早成为瓶颈。**该阈值为经验值，尚无实测来源。**',
    },
    {
      metric: '贴图数量',
      value: String(stats.textures),
      limit: String(BENCH_LIMITS.textures),
      // Same rule as 三角面数 and as the import health check: over the policy ceiling is a
      // fail, exactly at it passes. `BENCH_LIMITS.textures` was read from the policy and
      // then never used to grade anything — a limit that grades nothing is decoration, and
      // the test asserting it "came from the policy" was guarding decoration.
      verdict: stats.textures <= BENCH_LIMITS.textures ? 'pass' : 'fail',
      note: '来源：DEFAULT_POLICY.maxTextures，与导入体检同一常量。贴图数同时推高绘制批次与常驻显存。',
    },
    {
      metric: '贴图显存（估算）',
      value: `${memMB.toFixed(1)} MB`,
      limit: `${(BENCH_LIMITS.textureBytes / (1024 * 1024)).toFixed(0)} MB`,
      verdict: stats.textureMemoryBytes <= BENCH_LIMITS.textureBytes ? 'pass' : 'warn',
      note: '来源：DEFAULT_POLICY.maxTextureBytes。按 RGBA8 + 完整 mip 链估算，真实占用取决于驱动的内部格式，WebGL 不暴露。',
    },
    {
      metric: '几何体 / 着色器',
      value: `${stats.geometries} / ${stats.programs}`,
      limit: '—',
      verdict: 'pass',
      note: '两者都是常驻显存的对象数量，用于横向比较两个模型。贴图数已单列并参与评级。',
    },
  ]
}

/**
 * T-116 · ADR-0016 · one rung of the staged load ramp.
 *
 * `copies` counts the whole scene, so rung 1 is the scene as published.
 */
export interface StressLevel {
  readonly copies: number
  readonly fps: number
  readonly drawCalls: number
  readonly triangles: number
}

/** The rungs the bench page climbs, until one of them drops under `fpsFail`. */
export const STRESS_COPIES: readonly number[] = [1, 2, 4, 8]

/**
 * The ramp, graded.
 *
 * The headline row is the ceiling: the LARGEST rung that still rendered at or above
 * `fpsWarn`. Reporting the last rung measured instead would read as a capacity finding
 * while actually reporting where the ramp stopped — and the ramp stops early precisely
 * when things went badly.
 *
 * What this cannot tell you is written into the note rather than left for the reader to
 * work out: copies share geometry and textures, so the ramp stresses draw calls and vertex
 * throughput and leaves VRAM flat (ADR-0016, cost 1).
 */
export function gradeStress(levels: readonly StressLevel[]): BenchRow[] {
  if (levels.length === 0) return []

  const passing = levels.filter((l) => l.fps >= BENCH_LIMITS.fpsWarn)
  const ceiling = passing.reduce<StressLevel | null>((best, l) => (best && best.copies >= l.copies ? best : l), null)

  const rows: BenchRow[] = [
    {
      metric: '承载上限',
      value: ceiling
        ? `${ceiling.copies} 份场景（${ceiling.drawCalls} drawcall · ${ceiling.triangles.toLocaleString('en-US')} 面）`
        : '不足 1 份',
      limit: `≥ ${BENCH_LIMITS.fpsWarn} fps`,
      verdict: ceiling ? 'pass' : 'fail',
      note:
        '把整个场景复制若干份同时渲染，一级一级加到跌破帧率为止。副本共享几何与贴图，' +
        '所以本项压的是 drawcall 与顶点吞吐，**不压显存**——同等倍数的真实模型通常还会带来成倍的贴图。',
    },
  ]

  for (const level of levels) {
    rows.push({
      metric: `逐级加载 ×${level.copies}`,
      value: `${level.fps.toFixed(1)} fps · ${level.drawCalls} drawcall`,
      limit: '—',
      verdict: level.fps >= BENCH_LIMITS.fpsWarn ? 'pass' : level.fps >= BENCH_LIMITS.fpsFail ? 'warn' : 'fail',
      note: `${level.triangles.toLocaleString('en-US')} 面。`,
    })
  }
  return rows
}

/** Copy-to-clipboard Markdown. The card asks for it: this is what gets pasted into a ticket. */
export function toMarkdown(options: {
  readonly capability: CapabilityReport
  readonly rows: readonly BenchRow[]
  readonly userAgent: string
  readonly screen: string
  readonly takenAt: string
  readonly source: string
}): string {
  const symbol = (v: Verdict) => (v === 'pass' ? '✅' : v === 'warn' ? '⚠️' : '❌')
  const lines = [
    '# Web3D 播放器 · 性能实测',
    '',
    `- 测试时间：${options.takenAt}`,
    `- 场景来源：${options.source}`,
    `- 图形环境：${options.capability.vendor ?? '未知'} · ${options.capability.renderer ?? '未知'}`,
    `- 渲染方式：${options.capability.level === 'software' ? '**软件渲染（数据仅供相对参考）**' : '硬件加速'}`,
    `- 分辨率：${options.screen}`,
    `- UA：\`${options.userAgent}\``,
    '',
    '| 指标 | 实测 | 上限 | 结论 | 说明 |',
    '|---|---|---|---|---|',
    ...options.rows.map((r) => `| ${r.metric} | ${r.value} | ${r.limit} | ${symbol(r.verdict)} | ${r.note} |`),
    '',
  ]
  if (options.capability.level === 'software') {
    lines.push(
      '> ⚠️ 本次为软件渲染（未启用硬件加速或无独立显卡）。帧率类数据**不可作为验收依据**，',
      '> 仅可用于同一台机器上不同模型之间的相对比较。',
      '',
    )
  }
  return lines.join('\n')
}
