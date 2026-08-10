#!/usr/bin/env node
/**
 * T-280 · 把 bench 页导出的 JSON 报告回填进附件A §7。
 *
 * ## 为什么要有这个脚本
 *
 * 附件A §7 那四行是**合同附件里的性能承诺**。它们今天是「待定」，而填上它们的那一刻，
 * 数字就有了法律含义。手工抄一遍的失效方式一样都不少：抄错一位、抄了另一台机器的数、
 * 抄完忘了改状态列、或者最坏的——**抄了一份软件渲染的报告**，而软渲帧率与真实 GPU
 * 没有可比性。
 *
 * 所以这条路是脚本走的，规则写在代码里：
 *
 * 1. **数字只来自实测**（§7 回填规则 1）。值逐字取自报告，不取整、不外推。
 * 2. **软渲报告拒绝回填**（§7 前提 3）。给中文原因并退出 1，不是警告。
 * 3. **一次实测只覆盖一档配置**（§7 回填规则 5）。每一档硬件自己一组行，不做插值。
 * 4. **状态列同步改写**（§7 回填规则 4）。`[待实测]` → `[实测] M2 · 代号 · 日期`，
 *    并保留原经验阈值以便对照。
 *
 * ## `--check` 做的是**重生成后逐字节比对**
 *
 * 不是「文件在不在」，也不是「有没有 [实测] 字样」。那两种写法天生空转：附件A 被人
 * 手改一个字之后它们照样绿，而这一节恰恰是最不能被手改的一节——**手改的那个字会
 * 进合同**。
 *
 * 挂在 `pnpm verify` 里，所以没有报告的今天它也在跑：它守的是那四行「待实测」的
 * 措辞一个字都没被动过。
 *
 * 用法：
 *   node scripts/apply-bench-report.mjs                    # 回填 docs/bench-reports/*.json
 *   node scripts/apply-bench-report.mjs a.json b.json      # 指定文件
 *   node scripts/apply-bench-report.mjs --check            # 只比对，不写
 */

import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
const ANNEX = join(ROOT, 'docs', '附件A_数字资产规范_草案.md')
const REPORT_DIR = join(ROOT, 'docs', 'bench-reports')

const START = '<!-- bench:table:start -->'
const END = '<!-- bench:table:end -->'

/**
 * 四行的回填规则，逐字。
 *
 * `from` 是报告里那一行的**指标名**——不是行号、不是位置。bench 页的行数会随版本变
 * （T-279 就加了首屏四行与阴影三档），按位置取值等于每加一行就悄悄错一次。
 *
 * `baseline` 是没有实测时那一行的措辞，**同时也是有实测时保留在状态列里的对照**
 * （§7 回填规则 4：「保留一行原经验阈值以便对照」）。
 */
const METRICS = [
  { metric: '平均帧率', from: '平均帧率', baseline: '当前经验阈值 45 fps（黄灯）/ 25 fps（红灯），**尚无目标机器实测**' },
  { metric: 'P95 帧时间', from: 'P95 帧时间', baseline: '当前经验阈值 33 ms / 66 ms' },
  { metric: '首屏加载时间', from: '首屏 · 合计', baseline: '取决于资产体积与网络，需在客户实际网络环境下测' },
  { metric: '显存占用', from: '贴图显存（估算）', baseline: 'benchmark 给的是估算值，真实占用取决于驱动内部格式' },
]

/** 认得的硬件档位。§7 回填规则 5：一档一次，不插值。 */
const TIERS = ['M1', 'M2', 'M3']

const args = process.argv.slice(2)
const checkOnly = args.includes('--check')
const explicit = args.filter((a) => !a.startsWith('--'))

/* ── 读报告 ───────────────────────────────────────────────────────────────── */

/**
 * 档位与代号来自**文件名**：`M2-车间工控机.json`。
 *
 * 不放进 JSON 里，是因为那份 JSON 是浏览器导出的，而浏览器不知道这台机器在合同里
 * 叫什么档。让操作的人在存盘时命名，比让他事后改一个 JSON 字段可靠。
 */
function parseName(file) {
  const name = basename(file).replace(/\.json$/i, '')
  const match = /^(M[123])-(.+)$/.exec(name)
  if (!match) {
    return { error: `文件名要写成 \`<档位>-<代号>.json\`（档位取 ${TIERS.join(' / ')}），实际是「${basename(file)}」。` }
  }
  return { tier: match[1], codename: match[2] }
}

function loadReports() {
  const files = explicit.length > 0 ? explicit.map((f) => resolve(ROOT, f)) : listReportDir()
  const reports = []
  const problems = []

  for (const file of files) {
    if (!existsSync(file)) {
      problems.push(`找不到 ${file}`)
      continue
    }
    const named = parseName(file)
    if (named.error) {
      problems.push(named.error)
      continue
    }

    let report
    try {
      report = JSON.parse(readFileSync(file, 'utf8'))
    } catch (error) {
      problems.push(`${basename(file)} 不是合法 JSON：${error.message}`)
      continue
    }

    if (report.version !== 1) {
      // 版本号存在就是为了这一句。没有它，一份旧格式报告会被默默读出一堆 undefined，
      // 然后写进合同附件。
      problems.push(`${basename(file)} 的报告格式版本是 ${report.version}，本脚本只认 1。请用当前版本的 bench 页重新导出。`)
      continue
    }

    // **软渲报告不许进附件A。** §7 前提 3：软件渲染下的表现不作为依据。
    // 这一条是拒绝，不是警告——一条警告会在某个赶工的下午被忽略，而它的代价落在合同上。
    if (report.capability?.level === 'software') {
      problems.push(
        `${basename(file)} 是软件渲染下测出来的（renderer: ${report.capability.renderer ?? '未知'}），` +
          `不能用于回填附件A §7。软渲帧率与真实 GPU 没有可比性，填进合同附件就是一个将来会被引用的错数字。` +
          `请在目标机器上开启硬件加速后重测。`,
      )
      continue
    }

    const missing = METRICS.filter((m) => !findRow(report, m.from)).map((m) => m.from)
    if (missing.length > 0) {
      problems.push(`${basename(file)} 里找不到这些指标行：${missing.join('、')}。这份报告是不是没跑完？`)
      continue
    }

    reports.push({ file, tier: named.tier, codename: named.codename, report })
  }

  const byTier = new Map()
  for (const entry of reports) {
    const seen = byTier.get(entry.tier)
    if (seen) {
      problems.push(`${entry.tier} 有两份报告（${basename(seen.file)} 与 ${basename(entry.file)}）。一档只能有一次实测，不做合并。`)
      continue
    }
    byTier.set(entry.tier, entry)
  }

  return { byTier, problems }
}

function listReportDir() {
  if (!existsSync(REPORT_DIR)) return []
  return readdirSync(REPORT_DIR)
    .filter((f) => f.toLowerCase().endsWith('.json'))
    .sort()
    .map((f) => join(REPORT_DIR, f))
}

const findRow = (report, metric) => (report.rows ?? []).find((r) => r.metric === metric)

/* ── 生成那张表 ───────────────────────────────────────────────────────────── */

/** 日期取报告自己的时间戳的日期部分。脚本跑的那天不算数——回填的是**测的那天**。 */
const dateOf = (report) => String(report.takenAt ?? '').slice(0, 10)

function renderTable(byTier) {
  const lines = ['| 指标 | 目标值 | 状态 |', '|---|---|---|']

  if (byTier.size === 0) {
    for (const m of METRICS) lines.push(`| ${m.metric} | 待定 | \`[待实测]\` ${m.baseline} |`)
    return lines.join('\n')
  }

  // 档位按 M1 → M3 排，与报告文件的落盘顺序无关：一份会进合同的文档，它的行序
  // 不该取决于谁先被拷进目录。
  for (const tier of TIERS) {
    const entry = byTier.get(tier)
    if (!entry) continue
    const stamp = `\`[实测] ${tier} · ${entry.codename} · ${dateOf(entry.report)}\``
    for (const m of METRICS) {
      const row = findRow(entry.report, m.from)
      lines.push(`| ${m.metric} | ${row.value} | ${stamp} ${entry.report.capability.renderer ?? '未知 GPU'}；对照 ${m.baseline} |`)
    }
  }
  return lines.join('\n')
}

/** 表下面那句话。有实测之后它换一种说法，否则「留空是刻意的」会与已填的数字打架。 */
function renderNote(byTier) {
  if (byTier.size === 0) {
    return '> **这四行留空是刻意的。** 一份带错数字的合同附件，比一份留白的危险得多。'
  }
  const tiers = TIERS.filter((t) => byTier.has(t))
  return (
    `> 上表由 \`node scripts/apply-bench-report.mjs\` 从 \`docs/bench-reports/\` 的实测报告生成，` +
    `**不要手改**——\`pnpm verify\` 会逐字节比对。已实测 ${tiers.length} 档：${tiers.join(' / ')}。` +
    `未列出的硬件档位不在承诺范围内（§7 回填规则 5：不做插值）。`
  )
}

/* ── 主流程 ───────────────────────────────────────────────────────────────── */

const { byTier, problems } = loadReports()

if (problems.length > 0) {
  console.error('')
  for (const p of problems) console.error(`  ✗ ${p}`)
  console.error('')
  console.error('FAIL  T-280 · bench 报告回填')
  process.exit(1)
}

const original = readFileSync(ANNEX, 'utf8')
const eol = original.includes('\r\n') ? '\r\n' : '\n'
const text = original.replace(/\r\n/g, '\n')

const from = text.indexOf(START)
const to = text.indexOf(END)
if (from < 0 || to < 0) {
  console.error(`FAIL  附件A 里找不到 ${START} / ${END} 标记。这两行是回填的落点，删掉它们等于关掉这道闸门。`)
  process.exit(1)
}

const block = [START, '', renderTable(byTier), '', renderNote(byTier), '', END].join('\n')
const next = text.slice(0, from) + block + text.slice(to + END.length)
const rendered = eol === '\r\n' ? next.replace(/\n/g, '\r\n') : next

if (checkOnly) {
  if (rendered === original) {
    console.log(`  报告 ${byTier.size} 份 · §7 表 ${renderTable(byTier).split('\n').length - 2} 行`)
    console.log('PASS  T-280 · 附件A §7 与实测报告一致')
    process.exit(0)
  }
  console.error('')
  console.error('  ✗ 附件A §7 的表与 `docs/bench-reports/` 里的报告对不上。')
  console.error('    要么有人手改了那张表（那一个字会进合同），要么报告变了而表没重生成。')
  console.error('    跑一次 `node scripts/apply-bench-report.mjs` 重生成。')
  console.error('')
  console.error('FAIL  T-280 · bench 报告回填')
  process.exit(1)
}

if (rendered === original) {
  console.log(`  报告 ${byTier.size} 份 · 附件A §7 无需改动`)
} else {
  writeFileSync(ANNEX, rendered)
  console.log(`  报告 ${byTier.size} 份 · 已回填附件A §7`)
}
console.log('PASS  T-280 · bench 报告回填')
