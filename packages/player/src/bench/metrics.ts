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

/**
 * ADR-0042 · 一档读数要作数，至少要这么多个采样帧。
 *
 * ## 为什么需要这条线
 *
 * `measure()` 用**墙钟**结束采样窗口，却用**帧数**扣 warmup——两把尺子不同量纲。窗口里
 * 跑不满 `warmupFrames + 1` 帧时 `times` 是空的，而 `summariseFrames([])` 返回 `fps: 0`。
 * **「没测到」与「测出来是 0」于是长得一模一样**，而下游把它当成「太慢了」：判 fail、
 * 截断爬坡、污染上限与推荐，最后经 T-280 的回填脚本落进合同附件 A §7。
 *
 * ## 为什么是 8 而不是 1
 *
 * 实测过一个 `frames === 1` 的窗口：那一帧吞了约 357 ms 的编译卡顿，算出 2.8 fps，
 * 照样把整条爬坡截断。**只挡 `frames === 0` 治的是表征**，不是成因。
 *
 * ⚠⚠ **8 不够，而且这里原本写的理由是错的。** 原文说「8 个样本足以让一次卡顿不再主导
 * 均值」——算一下就知道不成立：一次 334 ms 的卡顿配 7 ms 的稳态帧，要摊到 fail 线
 * （40 ms/帧）以上需要 ≥ 10 个样本，摊到 warn 线（22.2 ms/帧）以上需要 ≥ 22 个。
 * 恰好 8 个样本时算出 20.9 fps —— `isMeasured` 放行，`shouldStop` 照样截断整条爬坡，
 * 决策 1 要治的下游后果原样复现，只是从「未测到（诚实）」换成了「20.9 fps（看起来是
 * 读数，实际是一次卡顿）」。
 *
 * 还有一处退化：`summariseFrames` 的 `index = min(n-1, floor(n * 0.95))`，在 n ≤ 20 时
 * 恒等于 n-1，**于是「P95 帧时间」就是「最慢单帧」**。恰好 8 个样本时这两行报同一个数，
 * 而 P95 是回填进附件A §7 的四行之一。
 *
 * 数字本身**没有在这一轮改**：它要么是 24（跨过 p95 退化区且摊得下一次 334 ms 卡顿），
 * 要么该由 G0.5-8 的目标机器实测定。改大会让 `?fast=1` 下大量档位变成「未测到」，
 * 而那个取舍需要真机数据，不是拍脑袋。**登记在 IMPL_NOTES，随 G0.5-8 结账。**
 *
 * ⚠ 这个数是**拍的，不是测的**（ADR-0042 代价 3，同 NORTH_STAR §8 破例清单那三个默认值）。
 */
export const MIN_SAMPLES = 8

/** 这一档的读数作不作数。**唯一判据**，不许在别处另写一遍。 */
export const isMeasured = (frames: number): boolean => frames >= MIN_SAMPLES

/** 未测到时那一格写什么。三处共用一份措辞，好让读者一眼认出这是同一种情形。 */
export const notMeasured = (frames: number): string => `未测到（样本 ${frames}/${MIN_SAMPLES}）`

/** 窗口最多延长到标称时长的几倍。**拍的**（ADR-0042 代价 3）。 */
export const HARD_CAP_FACTOR = 3

/**
 * ADR-0042 决策 1 · 采样窗口还要不要继续。
 *
 * ## 为什么它是一个纯函数，而不是 `measure()` 里的一行
 *
 * 这一行是整条缺陷链的**根**：窗口按墙钟收、warmup 按帧扣，两把尺子不同量纲。
 * 而它在浏览器里**测不出确定的红**——要复现饥饿得让一次 shader 编译卡顿正好落在
 * warmup 帧里，而那取决于这台机器、这个驱动、这一刻。实测把修复回退掉之后，
 * bench 的 e2e 照样绿（那一轮机器够快，没饿着）。
 *
 * **一条只在某些机器上某些时刻会红的守卫，等于没有守卫。** 所以把判据抽成纯函数，
 * 用构造出来的时间线钉死它。
 *
 * @param elapsedMs 从窗口开始到现在
 * @param samples   已经收到的**有效**样本数（warmup 之后的）
 * @param durationMs 标称窗口
 */
export function shouldKeepSampling(state: {
  readonly elapsedMs: number
  readonly samples: number
  readonly durationMs: number
}): boolean {
  // 标称窗口没到：无条件继续，与原来一样。
  if (state.elapsedMs < state.durationMs) return true
  // 到点了但样本不够：延长，直到硬上限。到硬上限还不够就如实收摊——延长不是万能的，
  // 一台一帧要几百毫秒的机器延到多久都凑不满，而那时正确的输出是「未测到」。
  return state.samples < MIN_SAMPLES && state.elapsedMs < state.durationMs * HARD_CAP_FACTOR
}

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
  // ADR-0042 决策 1 · 样本不足时三行一起报「未测到」。
  //
  // 三行一起，而不是只改第一行：`p95FrameMs` 与 `worstFrameMs` 在空样本下都是 0，
  // 而「0 毫秒的帧时间」会被 `<= 33ms` 判成**通过**——一份写着「P95 帧时间 0.0 ms ✅」
  // 的报告比一份写着 fail 的更危险，因为它看起来是个好消息。
  if (!isMeasured(stats.frames)) {
    const why =
      `采样窗口里只收到 ${stats.frames} 个有效帧（至少要 ${MIN_SAMPLES}）。` +
      '常见成因：窗口太短（`?fast=1`）、或者这台机器在这个场景上一帧就要几百毫秒。**这一行不是读数，不要引用。**'
    return [
      { metric: '平均帧率', value: notMeasured(stats.frames), limit: `≥ ${BENCH_LIMITS.fpsWarn} fps`, verdict: 'warn', note: why },
      { metric: 'P95 帧时间', value: notMeasured(stats.frames), limit: `≤ ${BENCH_LIMITS.p95FrameWarn} ms`, verdict: 'warn', note: why },
      { metric: '最慢单帧', value: notMeasured(stats.frames), limit: '—', verdict: 'warn', note: why },
    ]
  }
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
  /** ADR-0042 · 这一档收到几个有效采样帧。不足 MIN_SAMPLES 时 fps 没有意义。 */
  readonly frames: number
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

  // ADR-0042 决策 1（第二轮）· 「一档都没测到」与「测了但一档都撑不住」是两件事。
  //
  // 第一轮只 `filter(isMeasured)` 就 reduce 成 `null`，然后一律印「不足 1 份」判 fail——
  // 于是一次没跑成的测量，被印成「这台机器连 1 份场景都撑不住」。与四条「动态灯上限」
  // 同型，同一次对抗式复核查出。
  const measured = levels.filter((l) => isMeasured(l.frames))
  const ceiling: Ceiling<StressLevel> =
    measured.length === 0
      ? { kind: 'not-measured' }
      : (() => {
          const best = measured
            .filter((l) => l.fps >= BENCH_LIMITS.fpsWarn)
            .reduce<StressLevel | null>((top, l) => (top && top.copies >= l.copies ? top : l), null)
          return best ? { kind: 'ok' as const, level: best } : { kind: 'none-passed' as const }
        })()

  const rows: BenchRow[] = [
    {
      metric: '承载上限',
      value:
        ceiling.kind === 'ok'
          ? `${ceiling.level.copies} 份场景（${ceiling.level.drawCalls} drawcall · ${ceiling.level.triangles.toLocaleString('en-US')} 面）`
          : ceiling.kind === 'not-measured'
            ? '未测到（一个样本都没采够）'
            : '不足 1 份',
      limit: `≥ ${BENCH_LIMITS.fpsWarn} fps`,
      verdict: verdictOf(ceiling.kind),
      note:
        ceiling.kind === 'not-measured'
          ? '**这不是硬件结论**：爬坡一档都没采够样本，所以给不出承载上限。去掉 `?fast=1` 重跑一次。'
          : '把整个场景复制若干份同时渲染，一级一级加到跌破帧率为止。副本共享几何与贴图，' +
            '所以本项压的是 drawcall 与顶点吞吐，**不压显存**——同等倍数的真实模型通常还会带来成倍的贴图。',
    },
  ]

  for (const level of levels) {
    const measured = isMeasured(level.frames)
    rows.push({
      metric: `逐级加载 ×${level.copies}`,
      value: measured ? `${level.fps.toFixed(1)} fps · ${level.drawCalls} drawcall` : notMeasured(level.frames),
      limit: '—',
      verdict: !measured
        ? 'warn'
        : level.fps >= BENCH_LIMITS.fpsWarn
          ? 'pass'
          : level.fps >= BENCH_LIMITS.fpsFail
            ? 'warn'
            : 'fail',
      note: measured
        ? `${level.triangles.toLocaleString('en-US')} 面。`
        : `${level.triangles.toLocaleString('en-US')} 面。采样窗口没收到足够的帧，这一档**没有读数**——它不参与上面的承载上限。`,
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
 * 这一档为什么没量到。
 *
 * ADR-0042 决策 3 · **两种跳过要分开说。**「场景里没有刀」是资产的属性，读者据此知道
 * 这一档与他无关；「有刀但都关着」是**这次测量的问题**，读者据此知道要重测。合成一句
 * 「不适用」的话，第二种会被当成第一种放过去。
 */
export type SectionSkip =
  /** 文档里一个 `section` 节点都没有。 */
  | { readonly skipped: 'no-section' }
  /** 有剖切节点，但强制开之后渲染器上一条裁剪平面都没装（按 ADR-0039，世界不可见的刀不装）。 */
  | { readonly skipped: 'no-planes'; readonly sectionNodes: number }

/** 一次剖切测量的结果：读数，或者一个说得出理由的跳过。 */
export type SectionMeasurement = SectionCost | SectionSkip

const isSkip = (m: SectionMeasurement): m is SectionSkip => 'skipped' in m

/**
 * ADR-0042 决策 3 的判据本身，抽成纯函数。
 *
 * ## 为什么抽出来
 *
 * 第一轮它是 `main.ts` 里 `measureSection` 的两行。对抗式复核查出：`measureSection`
 * 全仓**零测试引用**（它是模块私有函数，而 bench 的 e2e 夹具每个节点写死 `section: null`，
 * 于是那条路径在任何自动化里一次都没被执行过）。而 `docs/MUTATIONS.md` 里为它登记的
 * 那条「红 2 条」**不可能成立**——被引用的两条红打的是 `gradeSection` 这个纯函数，
 * 喂的是手搓的 `{ skipped: 'no-planes' }`，与被变异的那一行毫无关系。
 *
 * **账本里一条「声称红、实际绿」的记录，比没有记录更坏**：它让下一个人以为这里有守卫。
 * 判据抽到这里，变异才真的红得起来。
 *
 * @returns 跳过的理由；`null` = 可以量。
 */
export function classifySection(probe: { readonly sectionNodes: number; readonly clipPlanes: number }): SectionSkip | null {
  // 一把刀都没有：这一档与这份资产无关。
  if (probe.sectionNodes === 0) return { skipped: 'no-section' }
  // 有刀，但开起来之后渲染器上一条裁剪平面都没装。**这才是真正的判据**——
  // 「文档里配了刀」不保证「量得到东西」，而带一把关着的刀是合法文档。
  if (probe.clipPlanes === 0) return { skipped: 'no-planes', sectionNodes: probe.sectionNodes }
  return null
}

/**
 * 剖切那一档，成表。
 *
 * **报一行说明而不是省掉这一档**：一份少了一整档的报告与一份「这一档没量到」的报告，
 * 在读者眼里是两件事，而只有后者能被信任。
 */
export function gradeSection(measurement: SectionMeasurement): BenchRow[] {
  if (isSkip(measurement)) {
    // ADR-0042 决策 3 · 「有刀但都关着」判 warn 而不是 pass。
    //
    // 送检资产带了刀却量不到，是需要重测的信号，不是通过。原实现两种情形共用一句
    // 「不适用（本场景没有剖切平面）」并判 pass——于是一份带着一把关着的刀的资产，
    // 会得到三行绿色「通过」的 `0 ms`，读者据此得出「剖切几乎免费」，与事实相反。
    const noSection = measurement.skipped === 'no-section'
    return [
      {
        metric: '剖切切换首帧代价',
        value: noSection ? '不适用（本场景没有剖切平面）' : '未测到（剖切平面都是关的）',
        limit: '—',
        verdict: noSection ? 'pass' : 'warn',
        note: noSection
          ? '这一档只有在场景里真的有剖切平面时才测得出来。送检资产带剖切时请重测。'
          : `场景里有 ${measurement.sectionNodes} 个剖切节点，但渲染器上一条裁剪平面都没装。` +
            '常见成因有两种：那把刀（或它的某个祖先）不可见（[ADR-0039](../../../docs/adr/0039-剖切面的启用判定用世界可见性.md) 的世界可见性判定），' +
            '或者它被关掉了。**这一档没有读数，不是「代价为 0」。** 把要验收的那把刀打开、并确认它的祖先都可见，然后重测。',
      },
    ]
  }
  const cost = measurement

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
      metric: '剖切期间的 shader program 数',
      // ADR-0042 决策 4（**已撤回**）· 这一行报的是**绝对数**，不是差值。
      //
      // 原来它报 `+N 个 program` 并断言「开一次剖切等于全场材质重编译一遍」。对抗式复核
      // 证明那个差值**结构上恒为 0**：`renderStats.programs` 读的是 program 缓存，而
      // 「首屏 · 首帧」为了计时必然先按文档态画过一帧——走到这里的前提又正是
      // `clipPlanes > 0`，即那一帧已经把 clip=N 的变体编译完了。真实的编译代价被记进了
      // 「首屏 · 首帧」，这里再也看不见它。
      //
      // 决策 4 曾把这一档挪到爬坡之前想让缓存变冷，**没用**（首帧那一帧在更前面），
      // 反而让 bench 自己编译出来的变体混进了「几何体 / 着色器」那一行。档序已还原。
      value: `${cost.programsAfterOn} 个`,
      limit: '—',
      verdict: 'pass',
      note:
        'three 把裁剪平面的**数量**放进 program 的 cache key，所以开剖切确实会让全场材质各多编译一份变体。' +
        '**但这一行量不到那次编译的代价**：首帧那一帧已经按文档态把它编译完了，编译时间落在「首屏 · 首帧」里。' +
        '这里报的是绝对数，供两台机器之间横向比较，不是「开剖切多花了多少」。',
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
  /** ADR-0042 · 这一档收到几个有效采样帧。 */
  readonly frames: number
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
  const measured = isMeasured(cost.frames)
  const scope = `分组「${cost.groupName}」的 ${cost.members} 个直接成员同时在动。量的是**动画进行中**，不是终态——终态与静止画面没有区别。`
  return [
    {
      metric: '爆炸进行中帧率',
      value: measured ? `${cost.fps.toFixed(1)} fps · ${cost.drawCalls} drawcall` : notMeasured(cost.frames),
      limit: `≥ ${BENCH_LIMITS.fpsWarn} fps`,
      verdict: !measured
        ? 'warn'
        : cost.fps >= BENCH_LIMITS.fpsWarn
          ? 'pass'
          : cost.fps >= BENCH_LIMITS.fpsFail
            ? 'warn'
            : 'fail',
      note: measured ? scope : `${scope}采样窗口没收到足够的帧，这一档**没有读数**。`,
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
  /** ADR-0042 · 这一档收到几个有效采样帧。不足 MIN_SAMPLES 时 fps 没有意义。 */
  readonly frames: number
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

  const noShadow = ceilingFor(levels, 'off')
  const rows: BenchRow[] = [
    {
      metric: '动态灯上限（无阴影）',
      value: describeCeiling(noShadow),
      limit: `≥ ${BENCH_LIMITS.fpsWarn} fps`,
      verdict: verdictOf(noShadow.kind),
      note:
        noShadow.kind === 'not-measured'
          ? '**这不是硬件结论**：这一档一个样本都没采够，所以给不出上限。去掉 `?fast=1` 重跑一次再看这一行。'
          : '灯数只增加逐像素的着色量，代价是平滑上升的。',
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
      verdict: verdictOf(ceiling.kind),
      note:
        ceiling.kind === 'not-measured'
          ? `阴影贴图 ${shadowMapSizeFor(quality)}²。**这不是硬件结论**：这一档一个样本都没采够。`
          : quality === 'low'
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
  //
  // ADR-0042 决策 2 · **按显存取最大，不是按灯数取最大。** 原来是 `l.lights > best.lights`
  // （严格大于 + 插入序），于是永远取第一个到达最大灯数的档，也就是最便宜的 `low`。
  // **这个错在完全没有采样问题的干净跑里也成立**：慢跑 12 档全过，它照样报「8.0 MB（8 盏 · low）」。
  //
  // 第二轮补三条（对抗式复核查出）：
  //
  // 1. **0 盏不算数。** 爬坡在 count=0 就收摊时，`levels` 里全是 `lights: 0`，于是这一行
  //    印出「0.0 MB（0 盏 · low）」并判 pass —— 把「没爬上去」印成一个读数，读者据此得出
  //    「阴影几乎不占显存」。
  // 2. **平手取更贵的档。** 2 盏 high 与 8 盏 medium 都是 32 MB，严格 `>` 在平手时保留先
  //    遇到的那个，也就是仍然偏向便宜档——ADR 要消灭的结构在平手分支上原样活着。
  // 3. **一档都没测到时报「未测到」，而不是整行消失。** 同一个文件上方 `gradeSection` 的
  //    注释刚写过「少了一整档的报告与『这一档没量到』的报告，在读者眼里是两件事」。
  const shadowed = levels.filter((l) => l.shadows !== 'off' && l.lights >= 1)
  const measuredShadowed = shadowed.filter((l) => isMeasured(l.frames))
  const memoryOf = (l: LightLevel) => estimateShadowMemory(l.lights, l.shadows as ShadowQuality)
  const worst = measuredShadowed.reduce<LightLevel | null>(
    (best, l) => (!best || memoryOf(l) >= memoryOf(best) ? l : best),
    null,
  )
  if (worst) {
    const bytes = memoryOf(worst)
    rows.push({
      metric: '阴影贴图显存（估算）',
      value: `${(bytes / (1024 * 1024)).toFixed(1)} MB（${worst.lights} 盏 · ${worst.shadows}）`,
      limit: '—',
      verdict: 'pass',
      note:
        `按「投影灯数 × 贴图边长² × 4 字节」推算，边长取 ${shadowMapSizeFor(worst.shadows as ShadowQuality)}。` +
        '与灯数成正比，与档位成平方。**报的是已测到的档里最重的那一个**，而爬坡跌破红线就收摊——' +
        '所以这一档往往正是把爬坡压垮的那一档，它与上面几行「上限」不矛盾，是同一件事的两种说法。',
    })
  } else if (shadowed.length > 0) {
    rows.push({
      metric: '阴影贴图显存（估算）',
      value: '未测到（带阴影的档一个都没采够样本）',
      limit: '—',
      verdict: 'warn',
      note: '**这一行不是「不占显存」，是没量到。** 去掉 `?fast=1` 重跑一次。',
    })
  }

  for (const level of levels) {
    const measured = isMeasured(level.frames)
    rows.push({
      metric: `灯 ×${level.lights} · 阴影 ${level.shadows}`,
      value: measured ? `${level.fps.toFixed(1)} fps · ${level.drawCalls} drawcall` : notMeasured(level.frames),
      limit: '—',
      verdict: !measured
        ? 'warn'
        : level.fps >= BENCH_LIMITS.fpsWarn
          ? 'pass'
          : level.fps >= BENCH_LIMITS.fpsFail
            ? 'warn'
            : 'fail',
      note: measured ? '' : '采样窗口没收到足够的帧，这一档**没有读数**——它不参与上面的上限与推荐。',
    })
  }
  return rows
}

/**
 * 一条产能结论：撑得住多少，或者**为什么给不出这个数**。
 *
 * ADR-0042 决策 1（第二轮）· **`null` 有两种成因，而它们不是同一件事。**
 *
 * - `none-passed`：真的测了，真的没一档过线 —— 这是**硬件结论**，判 fail。
 * - `not-measured`：一档都没采到足够的样本 —— 这是**一次没跑成的测量**，判 warn。
 *
 * 第一轮只 `filter(isMeasured)` 然后 reduce 成 `null`，于是两种成因合流，全部印成
 * 「不足 1 盏」判 fail。**那正是这条 ADR 起因的那三行 `0.0 fps` 换了个措辞活下来**：
 * 一次没跑成的测量，被印成「这台机器连 1 盏投影灯都撑不住」。而第一轮新加的 e2e 守卫
 * 写的是「值里含『未测到』才查 warn」，这五行不含那三个字，正好从守卫底下走过去。
 */
export type Ceiling<T> = { readonly kind: 'ok'; readonly level: T } | { readonly kind: 'none-passed' } | { readonly kind: 'not-measured' }

/** 某一档设置下，还能跑在黄灯线以上的最多灯数。 */
function ceilingFor(levels: readonly LightLevel[], shadows: ShadowSetting): Ceiling<LightLevel> {
  const inGroup = levels.filter((l) => l.shadows === shadows)
  const measured = inGroup.filter((l) => isMeasured(l.frames))
  // 这一组一档都没测到 —— 给不出结论，且这**不是**关于硬件的结论。
  if (inGroup.length > 0 && measured.length === 0) return { kind: 'not-measured' }
  const best = measured
    .filter((l) => l.fps >= BENCH_LIMITS.fpsWarn)
    .reduce<LightLevel | null>((top, l) => (top && top.lights >= l.lights ? top : l), null)
  return best ? { kind: 'ok', level: best } : { kind: 'none-passed' }
}

const describeCeiling = (ceiling: Ceiling<LightLevel>): string =>
  ceiling.kind === 'ok'
    ? `${ceiling.level.lights} 盏 · ${ceiling.level.fps.toFixed(1)} fps`
    : ceiling.kind === 'not-measured'
      ? '未测到（这一档一个样本都没采够）'
      : '不足 1 盏'

/** 三种结论各自的判定。**`not-measured` 判 warn，不判 fail** —— 它不是硬件结论。 */
const verdictOf = (kind: Ceiling<unknown>['kind']): Verdict =>
  kind === 'ok' ? 'pass' : kind === 'not-measured' ? 'warn' : 'fail'

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
  //
  // `ceilingFor` 已经滤掉没测到的档（ADR-0042 决策 1），所以这里拿到的必定是真实读数。
  for (const quality of [...SHADOW_QUALITIES].reverse()) {
    const ceiling = ceilingFor(levels, quality)
    if (ceiling.kind === 'ok' && ceiling.level.lights >= 1) {
      return {
        setting: quality,
        reason: `这台机器在 ${quality} 档下还能带 ${ceiling.level.lights} 盏投影灯跑到 ${ceiling.level.fps.toFixed(1)} fps。`,
      }
    }
  }
  // ADR-0042 决策 1 · **「都没测到」与「都带不动」是两件事，不能给同一句话。**
  // 前者要人重测，后者要人关掉阴影。给同一句话的话，一次坏采样会被当成一条硬件结论。
  const anyMeasured = levels.some((l) => l.shadows !== 'off' && isMeasured(l.frames))
  if (!anyMeasured) {
    return {
      setting: 'off',
      reason:
        '三档阴影**一档都没测到**（采样窗口没收到足够的帧），所以这不是硬件结论，是一次没跑成的测量。' +
        '请去掉 `?fast=1` 重跑一次再看这一行。',
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
