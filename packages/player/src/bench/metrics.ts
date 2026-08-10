import { DEFAULT_POLICY, shadowMapSizeFor } from '@w3/core'
import type { CapabilityReport } from '@w3/core'
import { SHADOW_QUALITIES } from '@w3/schema'
import type { ShadowQuality } from '@w3/schema'

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

/* -------------------------------------------------------------------------- */
/* v1.0 · T-281 · 剖切与爆炸                                                   */
/* -------------------------------------------------------------------------- */

/**
 * 开 / 关剖切各自的**首帧**代价。
 *
 * 为什么单量首帧而不是稳态：three 把裁剪平面的**数量**放进 shader program 的 cache key
 * （`SceneRuntime.renderStats` 的注释写着这件事，T-252 登记过）。于是开一次剖切 =
 * 全场材质重编译一遍，代价一次性落在切换后的那一帧上，稳态帧率里一点都看不见。
 *
 * 用户的体感是「点一下剖切，卡一下」——而那一下正是这里要量的数。
 */
export interface SectionCost {
  /** 从「关」切到「开」之后的第一帧，毫秒。 */
  readonly onFirstFrameMs: number
  /** 再切回「关」之后的第一帧，毫秒。 */
  readonly offFirstFrameMs: number
  /** 切换前 / 开之后 / 关之后，各自的 shader program 数。 */
  readonly programsBefore: number
  readonly programsAfterOn: number
  readonly programsAfterOff: number
  /** 开着的时候装了几条裁剪平面。 */
  readonly clipPlanes: number
}

/**
 * 剖切那一档，成表。
 *
 * `null` = 本场景没有剖切平面。**报一行说明而不是省掉这一档**：一份少了一整档的报告
 * 与一份「这一档不适用」的报告，在读者眼里是两件事，而只有后者能被信任。
 */
export function gradeSection(cost: SectionCost | null): BenchRow[] {
  if (cost === null) {
    return [
      {
        metric: '剖切切换首帧代价',
        value: '不适用（本场景没有剖切平面）',
        limit: '—',
        verdict: 'pass',
        note: '这一档只有在场景里真的有剖切平面时才测得出来。送检资产带剖切时请重测。',
      },
    ]
  }

  const ms = (value: number) => `${value.toFixed(0)} ms`
  return [
    {
      metric: '剖切切换首帧代价（开）',
      value: ms(cost.onFirstFrameMs),
      limit: '—',
      verdict: 'pass',
      note: `从「关」切到「开」之后的第一帧。装了 ${cost.clipPlanes} 条裁剪平面，shader program ${cost.programsBefore} → ${cost.programsAfterOn}。`,
    },
    {
      metric: '剖切切换首帧代价（关）',
      value: ms(cost.offFirstFrameMs),
      limit: '—',
      verdict: 'pass',
      note: `再切回「关」之后的第一帧，shader program ${cost.programsAfterOn} → ${cost.programsAfterOff}。**两次分别量**——复用同一个数字会让「回切也要重编译一遍」这件事看不见。`,
    },
    {
      metric: '剖切引起的 shader 重编译',
      value: `+${Math.max(0, cost.programsAfterOn - cost.programsBefore)} 个 program`,
      limit: '—',
      verdict: 'pass',
      note: 'three 把裁剪平面的**数量**放进 program 的 cache key，所以开一次剖切等于全场材质重编译一遍。这个数是上面那两个毫秒数的成因，不是另一件事。',
    },
  ]
}

/** 爆炸动画进行中的稳态读数。**不是终态**——终态与没爆炸时是同一种画面。 */
export interface ExplodeCost {
  readonly groupName: string
  /** 这个分组下有几个直接成员在动。 */
  readonly members: number
  readonly fps: number
  readonly drawCalls: number
}

/**
 * 爆炸那一档，成表。
 *
 * 量的是**动画进行中**：那时每一帧都要重算成员的世界矩阵并重传，而终态与静止画面
 * 没有区别。把终态当成「爆炸的性能」量，会量出一个和没爆炸时一模一样的数。
 */
export function gradeExplode(cost: ExplodeCost | null): BenchRow[] {
  if (cost === null) {
    return [
      {
        metric: '爆炸进行中帧率',
        value: '不适用（本场景没有爆炸分组）',
        limit: '—',
        verdict: 'pass',
        note: '这一档只有在场景里真的有爆炸分组时才测得出来。送检资产带爆炸视图时请重测。',
      },
    ]
  }
  return [
    {
      metric: '爆炸进行中帧率',
      value: `${cost.fps.toFixed(1)} fps · ${cost.drawCalls} drawcall`,
      limit: `≥ ${BENCH_LIMITS.fpsWarn} fps`,
      verdict: cost.fps >= BENCH_LIMITS.fpsWarn ? 'pass' : cost.fps >= BENCH_LIMITS.fpsFail ? 'warn' : 'fail',
      note: `分组「${cost.groupName}」的 ${cost.members} 个直接成员同时在动。量的是**动画进行中**，不是终态——终态与静止画面没有区别。`,
    },
  ]
}

/** 一次测量的全部输入。Markdown 与 JSON 两份产出都只从它出发。 */
export interface BenchReportInput {
  readonly capability: CapabilityReport
  readonly rows: readonly BenchRow[]
  readonly scene: SceneStats
  readonly userAgent: string
  readonly screen: string
  readonly takenAt: string
  readonly source: string
}

/**
 * T-279 · 机器可读的那一份。
 *
 * `apply-bench-report.mjs`（T-280）拿它回填附件A，而回填脚本**不该去解析 Markdown 表格**：
 * 那等于让一份给人看的排版成为机器契约，改一个空格就断。
 *
 * `version` 是给回填脚本用的：报告文件会躺在 `docs/bench-reports/` 里跨版本存在，
 * 而读它的脚本要能说出「这份是旧格式」而不是默默读出 undefined。
 */
export interface BenchReport {
  readonly version: 1
  readonly takenAt: string
  readonly source: string
  readonly capability: {
    readonly level: CapabilityReport['level']
    readonly vendor: string | null
    readonly renderer: string | null
    readonly webgl2: boolean
    readonly maxTextureSize: number
  }
  readonly machine: { readonly userAgent: string; readonly screen: string }
  readonly scene: SceneStats
  readonly rows: readonly BenchRow[]
}

/** 结构化报告。**Markdown 由它渲染**，两者不会分叉。 */
export function toJsonReport(options: BenchReportInput): BenchReport {
  return {
    version: 1,
    takenAt: options.takenAt,
    source: options.source,
    capability: {
      level: options.capability.level,
      vendor: options.capability.vendor ?? null,
      renderer: options.capability.renderer ?? null,
      webgl2: options.capability.webgl2,
      maxTextureSize: options.capability.maxTextureSize,
    },
    machine: { userAgent: options.userAgent, screen: options.screen },
    scene: options.scene,
    rows: options.rows,
  }
}

/**
 * Copy-to-clipboard Markdown. The card asks for it: this is what gets pasted into a ticket.
 *
 * T-279 起它**从 `toJsonReport` 的产物渲染**。两份产出各自读一遍输入的话，迟早会有一份
 * 少一个字段——而少的那份通常是没人天天看的那份。
 */
export function toMarkdown(options: BenchReportInput): string {
  // 解构而不是 `const report = …` 之后一路 `report.xxx`。
  //
  // 不是风格偏好：`check-dead-exports.mjs` 的成员扫描是跨包全文正则（`[.?]\s*name\b`），
  // 任意一处同名属性访问都算「这个成员有调用者」。写成 `report.rows` 会让遗留基线里
  // 那条 `schema:RemapResult.report` 变成陈旧记录，守卫于是要求把它删掉并调低棘轮——
  // 而它其实一个调用者都没有。**闸门失明的第四个实例，且是第一次朝「误判为活着」
  // 这个方向失明**（前三次记在 T-246 / T-256 / T-262，都是新成员被误判为死的）。
  const { takenAt, source, capability: env, machine, rows } = toJsonReport(options)
  const symbol = (v: Verdict) => (v === 'pass' ? '✅' : v === 'warn' ? '⚠️' : '❌')
  const lines = [
    '# Web3D 播放器 · 性能实测',
    '',
    `- 测试时间：${takenAt}`,
    `- 场景来源：${source}`,
    `- 图形环境：${env.vendor ?? '未知'} · ${env.renderer ?? '未知'}`,
    `- 渲染方式：${env.level === 'software' ? '**软件渲染（数据仅供相对参考）**' : '硬件加速'}`,
    `- 分辨率：${machine.screen}`,
    `- UA：\`${machine.userAgent}\``,
    '',
    '| 指标 | 实测 | 上限 | 结论 | 说明 |',
    '|---|---|---|---|---|',
    ...rows.map((r) => `| ${r.metric} | ${r.value} | ${r.limit} | ${symbol(r.verdict)} | ${r.note} |`),
    '',
  ]
  if (env.level === 'software') {
    lines.push(
      '> ⚠️ 本次为软件渲染（未启用硬件加速或无独立显卡）。帧率类数据**不可作为验收依据**，',
      '> 仅可用于同一台机器上不同模型之间的相对比较。',
      '',
    )
  }
  return lines.join('\n')
}

/* -------------------------------------------------------------------------- */
/* v0.5 · T-174 · the lighting ladder                                          */
/* -------------------------------------------------------------------------- */

/** 一档阴影设置：关，或者文档能表达的三档之一。 */
export type ShadowSetting = 'off' | ShadowQuality

/** One measured rung of the lighting ladder. */
export interface LightLevel {
  /** Dynamic lights added on top of the scene's own. */
  readonly lights: number
  readonly shadows: ShadowSetting
  readonly fps: number
  readonly drawCalls: number
}

/** Light counts the page climbs. 0 is the baseline: the scene as published. */
export const LIGHT_COUNTS: readonly number[] = [0, 1, 4, 8]

/**
 * Shadow settings each light count is measured at.
 *
 * T-279 · **测的档必须等于文档能表达的档。** 到 T-279 之前这里是 `['off','medium','high']`，
 * 而 `ShadowQualitySchema` 的三档是 low/medium/high——于是 `low` 是一档**用户选得到、
 * 报告里永远没有数**的设置。写成从 `SHADOW_QUALITIES` 派生而不是再抄一遍：抄的那份
 * 迟早会和 schema 分叉，而分叉的症状恰好是「某一档静静地没被测过」。
 */
export const SHADOW_MODES: readonly ShadowSetting[] = ['off', ...SHADOW_QUALITIES]

/**
 * The lighting ladder, graded.
 *
 * Two different costs are being separated here, and conflating them is how people conclude
 * "lights are slow" and stop using them:
 *
 * - **more lights** costs shading work per pixel, and grows smoothly;
 * - **shadows** costs an extra depth pass PER shadow-casting light, and grows in steps.
 *
 * So the headline is the pair — how many lights are affordable WITH shadows, and how many
 * without. A single number would hide the fact that the answer differs by roughly the
 * factor people most need to know.
 */
export function gradeLighting(levels: readonly LightLevel[]): BenchRow[] {
  if (levels.length === 0) return []

  const rows: BenchRow[] = [
    {
      metric: '动态灯上限（无阴影）',
      value: describeCeiling(ceilingFor(levels, 'off')),
      limit: `≥ ${BENCH_LIMITS.fpsWarn} fps`,
      verdict: ceilingFor(levels, 'off') ? 'pass' : 'fail',
      note: '灯数只增加逐像素的着色量，代价是平滑上升的。',
    },
  ]

  // T-279 · 三档各一行。到这张卡之前只有 off 与 medium 两条结论行，high 只落在明细里——
  // 于是「出厂默认该开哪一档」这个问题在报告里**拿不到可比较的第三个数**（遗留决议 S3）。
  for (const quality of SHADOW_QUALITIES) {
    const ceiling = ceilingFor(levels, quality)
    rows.push({
      metric: `动态灯上限（${quality} 阴影）`,
      value: describeCeiling(ceiling),
      limit: `≥ ${BENCH_LIMITS.fpsWarn} fps`,
      verdict: ceiling ? 'pass' : 'fail',
      note:
        quality === 'low'
          ? `阴影贴图 ${shadowMapSizeFor(quality)}²。`
          : `阴影贴图 ${shadowMapSizeFor(quality)}²，是 low 的 ${(shadowMapSizeFor(quality) / shadowMapSizeFor('low')) ** 2} 倍像素。`,
    })
  }

  const recommendation = recommendShadowDefault(levels)
  rows.push({
    metric: '建议出厂默认阴影档',
    value: recommendation.setting === 'off' ? '关闭阴影' : recommendation.setting,
    limit: `≥ ${BENCH_LIMITS.fpsWarn} fps`,
    verdict: recommendation.setting === 'off' ? 'warn' : 'pass',
    note: recommendation.reason,
  })

  // 阴影贴图显存。**估算**，与「贴图显存（估算）」同一个口径：它给的是数量级，
  // 而这个数量级正是「为什么开到 8 盏 high 会掉帧」的那半个解释——另外半个是深度 pass。
  const worst = levels.reduce<LightLevel | null>(
    (best, l) => (l.shadows !== 'off' && (!best || l.lights > best.lights) ? l : best),
    null,
  )
  if (worst) {
    const bytes = estimateShadowMemory(worst.lights, worst.shadows as ShadowQuality)
    rows.push({
      metric: '阴影贴图显存（估算）',
      value: `${(bytes / (1024 * 1024)).toFixed(1)} MB（${worst.lights} 盏 · ${worst.shadows}）`,
      limit: '—',
      verdict: 'pass',
      note: `按「投影灯数 × 贴图边长² × 4 字节」推算，边长取 ${shadowMapSizeFor(worst.shadows as ShadowQuality)}。与灯数成正比，与档位成平方。`,
    })
  }

  for (const level of levels) {
    rows.push({
      metric: `灯 ×${level.lights} · 阴影 ${level.shadows}`,
      value: `${level.fps.toFixed(1)} fps · ${level.drawCalls} drawcall`,
      limit: '—',
      verdict: level.fps >= BENCH_LIMITS.fpsWarn ? 'pass' : level.fps >= BENCH_LIMITS.fpsFail ? 'warn' : 'fail',
      note: '',
    })
  }
  return rows
}

/** 某一档设置下，还能跑在黄灯线以上的最多灯数。 */
function ceilingFor(levels: readonly LightLevel[], shadows: ShadowSetting): LightLevel | null {
  return levels
    .filter((l) => l.shadows === shadows && l.fps >= BENCH_LIMITS.fpsWarn)
    .reduce<LightLevel | null>((best, l) => (best && best.lights >= l.lights ? best : l), null)
}

const describeCeiling = (level: LightLevel | null): string =>
  level ? `${level.lights} 盏 · ${level.fps.toFixed(1)} fps` : '不足 1 盏'

/** 阴影贴图占的显存，字节。`投影灯数 × 边长² × 4`。 */
export function estimateShadowMemory(castingLights: number, quality: ShadowQuality): number {
  const size = shadowMapSizeFor(quality)
  return Math.max(0, castingLights) * size * size * 4
}

/** 一条出厂默认档的建议。 */
export interface ShadowRecommendation {
  readonly setting: ShadowSetting
  /** 中文理由。它会被抄进验收单，所以不是调试信息。 */
  readonly reason: string
}

/**
 * T-279 · 遗留决议 S3：这台机器上出厂默认该开哪一档阴影。
 *
 * 规则是一句话：**取「至少还能带 1 盏投影灯跑在黄灯线以上」的最高一档**。
 *
 * 为什么门槛是 1 盏而不是 4 盏：一盏投影灯是「阴影这个功能开着」的最低成立条件，
 * 而默认档要回答的是「开还是不开」。带不动 1 盏就该默认关——给用户一个开着但一开
 * 就掉帧的默认值，比默认关掉更糟，因为他不会把掉帧归因到这个开关上。
 *
 * 纯函数，不碰 GPU：四种情形（三档全过 / 只到 medium / 只到 low / 一档都不过）
 * 都在单测里，见 `bench-metrics.test.ts`。
 */
export function recommendShadowDefault(levels: readonly LightLevel[]): ShadowRecommendation {
  // 从高到低找第一档过线的。顺序取自 `SHADOW_QUALITIES` 的倒序而不是手写
  // ['high','medium','low']：手写的那份在 schema 加第四档时不会有任何东西提醒它。
  for (const quality of [...SHADOW_QUALITIES].reverse()) {
    const ceiling = ceilingFor(levels, quality)
    if (ceiling && ceiling.lights >= 1) {
      return {
        setting: quality,
        reason: `这台机器在 ${quality} 档下还能带 ${ceiling.lights} 盏投影灯跑到 ${ceiling.fps.toFixed(1)} fps。`,
      }
    }
  }
  return {
    setting: 'off',
    reason: '三档阴影都带不动 1 盏投影灯。默认开着而一开就掉帧，比默认关掉更糟——用户不会把掉帧归因到这个开关上。',
  }
}

/* -------------------------------------------------------------------------- */
/* v1.0 · T-279 · 首屏加载时间                                                 */
/* -------------------------------------------------------------------------- */

/**
 * 首屏三段计时，毫秒。
 *
 * 拆三段而不是报一个总数：三段各有各的成因，而合起来那个数没有任何可操作性。
 * 解包慢 = 包大或者机器 IO 慢；建场景慢 = 几何/贴图多；首帧慢 = 着色器编译。
 * 客户说「打开要好几秒」时，只有分段的数能回答「该改模型还是该换机器」。
 */
export interface LoadTiming {
  /** `.w3p` 解压 + 解析。 */
  readonly unpackMs: number
  /** 建运行时、加载资产、`session.start()`。 */
  readonly buildMs: number
  /** 从 start 返回到第一帧画完。着色器编译主要落在这里。 */
  readonly firstFrameMs: number
}

/**
 * 首屏加载时间，四行。
 *
 * `limit` 一律写 `—`：**这四个数没有阈值来源**。首屏时间的可接受范围取决于包多大、
 * 网络在哪一端、客户的耐心，没有一条能写进合同的通用线。报一个编出来的阈值，比不
 * 报更糟——它会被当成实测结论引用。
 */
export function gradeLoad(timing: LoadTiming): BenchRow[] {
  const total = timing.unpackMs + timing.buildMs + timing.firstFrameMs
  const ms = (value: number) => `${value.toFixed(0)} ms`
  return [
    { metric: '首屏 · 解包', value: ms(timing.unpackMs), limit: '—', verdict: 'pass', note: '解压 .w3p 并解析文档。与包的字节数成正比。' },
    { metric: '首屏 · 建场景', value: ms(timing.buildMs), limit: '—', verdict: 'pass', note: '建运行时、上传几何与贴图、跑完 start()。与模型复杂度成正比。' },
    {
      metric: '首屏 · 首帧',
      value: ms(timing.firstFrameMs),
      limit: '—',
      verdict: 'pass',
      note: '从 start() 返回到第一帧画完。着色器编译主要落在这里，所以它与材质种类数相关，与面数关系不大。',
    },
    {
      metric: '首屏 · 合计',
      value: ms(total),
      limit: '—',
      verdict: 'pass',
      note: '**无阈值来源**：可接受的首屏时间取决于包多大、网络在哪一端、客户的耐心。这里只报数，不判定。',
    },
  ]
}
