#!/usr/bin/env node
/**
 * T-207 · 文档零漂移的七条规则。Gate G1.0-7 · A6 的 Q-1。
 *
 * 这个仓库已经实证过五处文档漂移，其中一处是**一条按字面执行会「命令不存在」的晋级门槛**
 * （`pnpm size-limit`，写在四份文档里，包括宪法的 G0.5-7）。一条执行即失败的门槛不是严格的
 * 门槛，是**没有门槛**——而它在两个版本的晋级评审里都被当成过了。
 *
 * 七条规则里最重要的是**规则 6**，它防的是同一个错误的第二次犯：
 * 规则 1 只校验 `pnpm <script>` 的**脚本名**存在，对 `pnpm -F @w3/editor test boot-migrate`
 * 这种错误**结构上失明**——`test` 是存在的，错的是过滤器 `boot-migrate`，而
 * **vitest / playwright 匹配 0 个文件时退出码是 0**。于是这类门槛不是「报错」，是「静默通过」。
 * 本版起草时同一形状犯了五次。
 *
 * **每条规则都带一个抽取面下限。** 一个正则写坏了的规则报告「零问题」，与一条干净的文档
 * 长得一模一样——这是 D36 对所有 `--check` 类脚本点名的天生风险，本仓已为它写过三次
 * （T-205 的 M6、T-207 的规则 6 变异 ⑧、T-297 的变异 ⑤）。
 *
 * 用法：node scripts/check-docs.mjs
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PLAN = 'docs/MVP_V1_进化规划.md'
const BACKLOG = 'docs/TASK_BACKLOG_V1.md'

const failures = []
const notes = []
const fail = (rule, message) => failures.push(`${rule}  ${message}`)
const note = (message) => notes.push(message)

const cache = new Map()
const read = (rel) => {
  if (!cache.has(rel)) cache.set(rel, readFileSync(join(ROOT, rel), 'utf8'))
  return cache.get(rel)
}

/**
 * `docs/CLAUDE.md` is a frozen historical copy.
 *
 * Its own header says so verbatim: 「不要再修改本文件，也不要把它当成规范引用」. Its links were
 * correct when it lived at the repository root and are wrong from `docs/`, and fixing them
 * would be modifying a file whose whole purpose is to record what things looked like before.
 * Excluded from every rule, and named here rather than silently skipped.
 */
const FROZEN_DOCS = new Set(['docs/CLAUDE.md'])

/**
 * `docs/MUTATIONS.md` records deliberately broken states, verbatim.
 *
 * Every row says「我把 X 改成了 Y，然后它红了」, so a row about ADR counts contains a wrong ADR
 * count on purpose. Rule 3 caught exactly that on the day this log was written — correct
 * behaviour, wrong target: the log is evidence that the guard works, not a claim about the
 * system. Excluded, with the reason written down rather than the prose contorted to dodge
 * the regex forever.
 */
const LOG_DOCS = new Set(['docs/MUTATIONS.md'])

/**
 * Files whose numbers are deliberately frozen SNAPSHOTS.
 *
 * `METRICS.md` is a trend table: its v0 column saying 12 ADRs and its v0.5 column saying 14
 * is the point of the document. "Correcting" them destroys the trend, which is what they are
 * for. `EVAL_REPORT` is a dated report.
 */
const SNAPSHOT_DOCS = new Set(['docs/METRICS.md', 'docs/EVAL_REPORT_v0_7eefa95.md'])

/** Every markdown file describing the current system. */
function docFiles() {
  const out = ['README.md', 'CLAUDE.md']
  const walk = (dir) => {
    for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
      const path = `${dir}/${entry.name}`
      if (entry.isDirectory()) walk(path)
      else if (entry.name.endsWith('.md')) out.push(path)
    }
  }
  walk('docs')
  return out.filter((f) => !FROZEN_DOCS.has(f) && !LOG_DOCS.has(f))
}

/* -------------------------------------------------------------------------- */
/* 「还没交付」的统一判据，规则 1 与规则 6 共用                                  */
/* -------------------------------------------------------------------------- */

/**
 * A command may legitimately not resolve yet — but only while a specific, real, unfinished
 * card owns it. Two shapes count, and **both expire the moment that card is ticked**:
 *
 *   ① 它写在一张未勾选的任务卡里（`### [ ] T-xxx` 到下一个 `###` 之间）。
 *      一张卡的自测命令引用它自己将要创建的脚本，是正当的。
 *   ② 同一格里带 `（… 由 T-xxx 交付）` 标记，且 T-xxx 未标 `[x]`。
 *
 * 「一旦标 `[x]`，标记立即失效」是这条判据的全部价值：它把「写了但不存在」变成一笔
 * **会自己到期的债**，而不是一句永远有效的注释。
 */
function makeDeferralIndex() {
  const backlog = read(BACKLOG)
  const done = new Set([...backlog.matchAll(/^###\s*\[x\]\s*(T-\d{3})/gm)].map((m) => m[1]))
  const known = new Set([...backlog.matchAll(/^###\s*\[[ x]\]\s*(T-\d{3})/gm)].map((m) => m[1]))

  /** For each backlog-ish file, the line ranges that belong to an UNCHECKED card. */
  const openCardRanges = new Map()
  for (const file of docFiles()) {
    if (!/TASK_BACKLOG/.test(file)) continue
    const ranges = []
    let open = null
    read(file).split('\n').forEach((line, i) => {
      const m = /^###\s*\[( |x)\]\s*(T-\d{3})/.exec(line)
      if (m) {
        if (open) ranges.push([open, i])
        open = m[1] === ' ' ? i : null
        return
      }
      if (/^##[^#]/.test(line) && open) {
        ranges.push([open, i])
        open = null
      }
    })
    if (open) ranges.push([open, Number.MAX_SAFE_INTEGER])
    openCardRanges.set(file, ranges)
  }

  return {
    cardExists: (card) => known.has(card),
    cardDone: (card) => done.has(card),
    /** True when this line sits inside an unchecked card. */
    insideOpenCard: (file, lineIndex) => (openCardRanges.get(file) ?? []).some(([a, b]) => lineIndex >= a && lineIndex < b),
    /** The `由 T-xxx 交付` owner named in `text`, if any. */
    ownerIn: (text) => /由\s*\*{0,2}(T-\d{3})\*{0,2}\s*(?:当卡)?交付/.exec(text)?.[1] ?? null,
  }
}

const DEFER = makeDeferralIndex()

/* ========================================================================== */
/* 规则 1 · 文档里的每个 `pnpm <script>` 都必须存在                            */
/* ========================================================================== */

/** pnpm's own subcommands — not package scripts, so not this rule's business. */
const PNPM_BUILTINS = new Set(['install', 'add', 'remove', 'run', 'exec', 'dlx', 'why', 'store', 'peers', 'list', 'update', 'link', 'publish', 'pack', 'audit', 'outdated', 'rebuild', 'prune', 'import', 'setup', 'env', 'root', 'bin', 'config'])

/**
 * Commands the docs deliberately cite as NOT existing.
 *
 * `pnpm size-limit` is the whole reason this file exists: five places now say「不是
 * `pnpm size-limit`，该命令不存在」, and a rule that flagged those sentences would be telling
 * us to delete the correction. **This map is the one hole in rule 1**, so every entry needs a
 * reason and the map has to stay tiny.
 */
const DELIBERATE_COUNTEREXAMPLES = new Map([
  ['size-limit', '四份文档曾把体积门槛写成它；A6 的 Q-1 把订正语留在正文里，订正语本身必须能引用这个错名'],
])

function ruleOneScripts() {
  const rootScripts = new Set(Object.keys(JSON.parse(read('package.json')).scripts ?? {}))
  const pkgScripts = new Map()
  const manifests = ['e2e/package.json', 'test/parity/package.json', 'tools/lint/package.json']
  for (const entry of readdirSync(join(ROOT, 'packages'), { withFileTypes: true })) {
    if (entry.isDirectory()) manifests.push(`packages/${entry.name}/package.json`)
  }
  for (const manifest of manifests) {
    if (!existsSync(join(ROOT, manifest))) continue
    const json = JSON.parse(read(manifest))
    pkgScripts.set(json.name, new Set(Object.keys(json.scripts ?? {})))
  }

  let checked = 0
  let deferred = 0
  for (const file of docFiles()) {
    read(file).split('\n').forEach((line, i) => {
      for (const command of extractPnpmCommands(line)) {
        const { script, filter, pkg } = command
        if (!script || script.includes('<') || (pkg && pkg.includes('<'))) continue
        if (PNPM_BUILTINS.has(script)) continue
        checked++
        if (DELIBERATE_COUNTEREXAMPLES.has(script)) continue
        const owner = DEFER.ownerIn(line)
        if (DEFER.insideOpenCard(file, i) || (owner && DEFER.cardExists(owner) && !DEFER.cardDone(owner))) {
          deferred++
          continue
        }
        const scripts = pkg ? pkgScripts.get(pkg) : rootScripts
        const where = `${file}:${i + 1}`
        if (!scripts) {
          fail('规则 1', `${where}  \`pnpm -F ${pkg} …\` —— 工作区里没有名为 ${pkg} 的包`)
          continue
        }
        if (!scripts.has(script)) {
          fail('规则 1', `${where}  \`pnpm ${pkg ? `-F ${pkg} ` : ''}${script}${filter ? ` ${filter}` : ''}\` —— 脚本 ${script} 不存在`)
        }
      }
    })
  }
  if (checked < 100) fail('规则 1', `只扫到 ${checked} 条 pnpm 命令（下限 100）——抽取正则坏了，不是文档干净了`)
  note(`规则 1 · 扫到 ${checked} 条 \`pnpm …\`，其中 ${deferred} 条由未完成的卡认领`)
}

/** Every `` `pnpm …` `` on one line, parsed into {pkg, script, filter}. */
function extractPnpmCommands(line) {
  const out = []
  for (const m of line.matchAll(/`pnpm\s+([^`]+)`/g)) {
    const parts = (m[1] ?? '').trim().split(/\s+/)
    let pkg = null
    let i = 0
    while (i < parts.length) {
      const token = parts[i]
      if (token === '-r' || token === '-w' || token === '--silent') { i++; continue }
      if (token === '-F' || token === '--filter') { pkg = parts[i + 1] ?? null; i += 2; continue }
      break
    }
    const script = parts[i]
    if (!script || script.startsWith('-')) continue
    const next = parts[i + 1]
    out.push({ pkg, script, filter: next && !next.startsWith('-') && !next.startsWith('&') ? next : null })
  }
  return out
}

/* ========================================================================== */
/* 规则 2 · 文档内链必须可达                                                   */
/* ========================================================================== */

function ruleTwoLinks() {
  let checked = 0
  let broken = 0
  for (const file of docFiles()) {
    const dir = dirname(join(ROOT, file))
    read(file).split('\n').forEach((line, i) => {
      // Code spans are stripped first: a regex written inside backticks (there are three in
      // these documents) contains `[...](...)`-shaped text that is not a link.
      const prose = line.replace(/`[^`]*`/g, '')
      for (const m of prose.matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)) {
        const href = m[1] ?? ''
        if (/^(https?:|mailto:|#)/.test(href)) continue
        checked++
        const target = decodeURI((href.split('#')[0] ?? '').replace(/^<|>$/g, ''))
        if (!target) continue
        if (!existsSync(resolve(dir, target))) {
          broken++
          fail('规则 2', `${file}:${i + 1}  内链指向不存在的文件：${href}`)
        }
      }
    })
  }
  if (checked < 100) fail('规则 2', `只扫到 ${checked} 条内链（下限 100）——抽取正则坏了`)
  note(`规则 2 · 扫到 ${checked} 条文档内链，${broken} 条断裂`)
}

/* ========================================================================== */
/* 规则 3 · ADR 计数与目录一致                                                 */
/* ========================================================================== */

function ruleThreeAdrCount() {
  const actual = readdirSync(join(ROOT, 'docs/adr')).filter((f) => /^\d{4}-.*\.md$/.test(f)).length
  let claims = 0
  for (const file of docFiles()) {
    if (SNAPSHOT_DOCS.has(file)) continue
    let frozen = false
    read(file).split('\n').forEach((line, i) => {
      // `<details>` blocks hold verbatim frozen originals, kept only for contrast.
      if (line.includes('<details>')) frozen = true
      if (line.includes('</details>')) frozen = false
      if (frozen) return
      for (const m of line.matchAll(/(\d+)\s*条\s*(?:架构决策记录|ADR)/g)) {
        claims++
        if (Number(m[1]) !== actual) fail('规则 3', `${file}:${i + 1}  声称 ${m[1]} 条 ADR，实际 ${actual} 条`)
      }
    })
  }
  // The card names this trap explicitly: a script that counts the directory but never
  // compares it against a document passes all three of its own mutations.
  if (claims < 2) fail('规则 3', `只找到 ${claims} 处 ADR 计数声明（下限 2）——没有比对面，这条规则是装饰品`)
  note(`规则 3 · docs/adr 实有 ${actual} 条，文档里 ${claims} 处声明`)
}

/* ========================================================================== */
/* 规则 4 · 「合计」必须等于其下条目之和；跨文档引用的卡数 / 人日与台账真值一致    */
/* ========================================================================== */

function ruleFourTotals() {
  const lines = read(BACKLOG).split('\n')
  let surface = 0

  // 4a · 散文式小计：`**M14 小计：27 张 / 23.4 人日**` / `**v1.0 合计：100 张 / 111.0 人日**`
  // 与它上方那一段里的卡数、`**预估** X.Xd` 求和比对。这是台账里合计行的真实形态——
  // 表格式的只有附录 C 三张，本规则两种都认。
  let lastBoundary = 0
  lines.forEach((line, i) => {
    if (/^##\s/.test(line)) lastBoundary = i
    const m = /\*\*(M\d+|v1\.\d)\s*(?:小计|合计)：\s*(\d+)\s*张\s*\/\s*([\d.]+)\s*人日/.exec(line)
    if (!m) return
    surface++
    const [, label, statedCards, statedDays] = [m[0], m[1], Number(m[2]), Number(m[3])]
    const isVersionTotal = /^v1\./.test(label)
    // A version total sums the milestone subtotals above it; a milestone subtotal sums the
    // cards in its own section.
    const from = isVersionTotal ? versionStart(lines, i) : lastBoundary
    const slice = lines.slice(from, i)
    const cards = isVersionTotal
      ? slice.filter((l) => /\*\*M\d+\s*小计：/.test(l)).map((l) => Number(/(\d+)\s*张/.exec(l)?.[1] ?? 0)).reduce((a, b) => a + b, 0)
      : slice.filter((l) => /^###\s*\[[ x]\]\s*T-\d{3}/.test(l)).length
    const days = isVersionTotal
      ? slice.filter((l) => /\*\*M\d+\s*小计：/.test(l)).map((l) => Number(/([\d.]+)\s*人日/.exec(l)?.[1] ?? 0)).reduce((a, b) => a + b, 0)
      : slice.map((l) => Number(/\*\*预估\*\*\s*([\d.]+)d/.exec(l)?.[1] ?? 0)).reduce((a, b) => a + b, 0)
    if (cards !== statedCards) fail('规则 4', `${BACKLOG}:${i + 1}  ${label} 声称 ${statedCards} 张，实数 ${cards} 张`)
    // Tolerance is the maximum rounding error the displayed rows can hide — appendix C.3
    // states 259.1 while its three displayed rows add to 259.2, and the合计 is the right one.
    if (Math.abs(days - statedDays) > 0.05 * Math.max(1, cards) + 1e-9) {
      fail('规则 4', `${BACKLOG}:${i + 1}  ${label} 声称 ${statedDays} 人日，实算 ${days.toFixed(1)} 人日`)
    }
  })

  // 4b · 表格式合计行：第一格逐字是「合计」/「小计」，逐列与其上同表各行求和比对。
  lines.forEach((line, i) => {
    if (!line.trim().startsWith('|')) return
    const cells = splitRow(line)
    if (!/^\*{0,2}(合计|小计)\*{0,2}$/.test(cells[0] ?? '')) return
    surface++
    const table = tableAbove(lines, i)
    if (table.length < 2) return
    for (let col = 1; col < cells.length; col++) {
      // Percentage columns are rounded per row on purpose — appendix C.2 says so in prose
      // (「逐行四舍五入，加起来是 102 而不是 100」).
      if (cells[col].includes('%')) continue
      const stated = numberIn(cells[col])
      if (stated === null) continue
      const column = table.map((r) => numberIn(r[col] ?? '')).filter((n) => n !== null)
      if (column.length < 2) continue
      const sum = column.reduce((a, b) => a + b, 0)
      const tolerance = 0.05 * column.length + 1e-9
      if (Math.abs(sum - stated) > tolerance) {
        fail('规则 4', `${BACKLOG}:${i + 1}  第 ${col + 1} 列合计 ${stated}，其上 ${column.length} 行之和 ${sum.toFixed(2)}（容差 ${tolerance.toFixed(2)}）`)
      }
    }
  })

  // 4c · 跨文档：别处引用台账的「N 张卡 / X 人日」必须等于台账自己的全版本合计。
  // **这是规则 4 今天唯一非空的检查面。** 4a/4b 的合计行本版起草时就已全部自洽，而
  // `CLAUDE.md` 整整一版写着 196 / 220.5 —— P-14~P-20 拍板前的旧值。
  const truth = /\|\s*\*\*合计\*\*\s*\|\s*\*\*(\d+)\*\*\s*\|\s*\*\*([\d.]+)\*\*/.exec(read(BACKLOG))
  if (!truth) {
    fail('规则 4', `${BACKLOG} 里找不到全版本合计行——4c 失去比对基准`)
  } else {
    const [cards, days] = [Number(truth[1]), Number(truth[2])]
    let refs = 0
    for (const file of docFiles()) {
      if (SNAPSHOT_DOCS.has(file) || file === BACKLOG) continue
      read(file).split('\n').forEach((line, i) => {
        const m = /(\d+)\s*张卡\s*\/\s*([\d.]+)\s*人日/.exec(line)
        if (!m) return
        refs++
        surface++
        if (Number(m[1]) !== cards || Number(m[2]) !== days) {
          fail('规则 4', `${file}:${i + 1}  引用「${m[1]} 张卡 / ${m[2]} 人日」，台账真值是 ${cards} / ${days}`)
        }
      })
    }
    note(`规则 4 · 检查面 ${surface} 处（散文小计 + 表格合计 + 跨文档引用 ${refs} 处），基准 ${cards} 张 / ${days} 人日`)
  }
  if (surface < 15) fail('规则 4', `只扫到 ${surface} 处合计（下限 15）——抽取正则坏了`)
}

const splitRow = (line) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim())
const numberIn = (cell) => {
  const m = /(-?\d+(?:\.\d+)?)/.exec(cell.replace(/\*/g, ''))
  return m ? Number(m[1]) : null
}

/** Where the version section containing `index` starts (the `# 第X部分` heading). */
function versionStart(lines, index) {
  for (let i = index; i >= 0; i--) if (/^#\s/.test(lines[i] ?? '')) return i
  return 0
}

/** The contiguous data rows immediately above `index`, as cell arrays. */
function tableAbove(lines, index) {
  const out = []
  for (let i = index - 1; i >= 0; i--) {
    const line = lines[i] ?? ''
    if (!line.trim().startsWith('|')) break
    const cells = splitRow(line)
    if (cells.every((c) => /^:?-+:?$/.test(c))) break
    if (/^\*{0,2}(合计|小计)\*{0,2}$/.test(cells[0] ?? '')) continue
    out.push(cells)
  }
  return out
}

/* ========================================================================== */
/* 规则 5 · 规划 §1.1 的每条 In Scope 能力，在 NORTH_STAR §3 里都有落点          */
/* ========================================================================== */

/**
 * The card writes this rule as 「NORTH_STAR §3 的 v1 清单与规划 §1.2 的 Out of Scope 清单
 * 并集必须覆盖 R1 列举的全部能力」.
 *
 * **`R1` has no referent in this repository.** The technical proposal numbers its entries
 * `R01`–`R15` and they are a RISK register, not a capability list (`R01` = 「资产失控」); the
 * merged design documents that `R1` appears to cite (`merged/backlog.md`) were never
 * committed. A rule anchored to something that does not exist is exactly the decorative gate
 * this card exists to delete, so it is re-anchored — and the re-anchoring is written down
 * rather than left implicit:
 *
 *   **能力的真源 = 规划 §1.1 的三张 In Scope 表**（每行一个领域，含版本归属）。
 *   规则 5 断言：每个领域在 NORTH_STAR §3 对应那一级的「新增」清单里都找得到落点。
 *
 * 领域名与宪法的散文措辞不逐字相同（「爆炸与剖切」vs「爆炸视图与剖切平面」），所以对照关系
 * 写成下面这张表而不是靠模糊匹配。**表本身也被检查**：§1.1 里出现的每个领域都必须有一行，
 * 少一行即红——所以它不会因为新增能力而悄悄失效。
 *
 * 它写出来当天抓到一条：v1.0 的 **AI provider 插座**（T-299，已计入 111.0 人日）在
 * NORTH_STAR §3 的清单里一个字都没有。
 */
const SCOPE_ANCHORS = new Map([
  // v1.0
  ['六张地基卡', '六张地基卡'],
  ['门槛可信度修复', '门槛可信度修复'],
  ['v0 / v0.5 债务清偿', 'v0/v0.5 债务清偿'],
  ['schema v3 一次冻结', 'schema v3 一次性冻结'],
  ['描边与雾', '描边与雾'],
  ['爆炸与剖切', '爆炸视图与剖切平面'],
  ['渲染出图', '渲染出图'],
  ['播放器嵌入 SDK', '播放器嵌入 SDK'],
  ['泵组样板工程', '泵组样板工程'],
  ['完整项目层', '项目层（新建 / 列表 / 重命名 / 删除）'],
  ['编辑器三条打磨', '编辑器三条打磨'],
  ['AI provider 插座', 'AI provider 插座'],
  // v1.2
  ['flows 线性步骤', 'flows 线性步骤'],
  ['pages 槽位覆盖层', 'pages 槽位覆盖层'],
  ['动画序列编排增强', '动画序列编排增强'],
  ['动画倒放', '含倒放'],
  ['相机路径巡游', '相机路径巡游'],
  ['规则模板与场景模板', '规则模板与**场景模板**'],
  ['新事件通电', '三种新事件'],
  // v1.5
  ['后端全量', '后端服务'],
  ['`HttpApiProvider`', '`HttpApiProvider`'],
  ['服务端资产转码', '服务端资产转码'],
  ['多场景与 `goToScene`', '多场景与 `goToScene`'],
  ['分享链接', '分享链接与二维码'],
  ['外部数据源（功能部分）', '外部数据源'],
  ['部署三件套 + 验收材料', '部署产物三件套'],
])

function ruleFiveScopeCoverage() {
  const plan = read(PLAN)
  const north = read('docs/NORTH_STAR.md')
  const levels = [
    ['v1.0', '#### v1.0「地基与表现力」', '### v1.0 · 地基与表现力'],
    ['v1.2', '#### v1.2「编排与复用」', '### v1.2 · 编排与复用'],
    ['v1.5', '#### v1.5「合同交付」', '### v1.5 · 合同交付'],
  ]

  let domains = 0
  for (const [level, planHeading, northHeading] of levels) {
    const planAt = plan.indexOf(planHeading)
    const northAt = north.indexOf(northHeading)
    if (planAt === -1 || northAt === -1) {
      fail('规则 5', `找不到 ${level} 的小节标题（规划「${planHeading}」/ 宪法「${northHeading}」）`)
      continue
    }
    const planSection = plan.slice(planAt, nextHeading(plan, planAt))
    // **The `**新增**：` LINE, not the whole section.** Searching the section was a false
    // green: the paragraph explaining why an item had been missing itself contains the item's
    // name, so deleting the item from the list left the rule green. Caught by mutation ⑩′ —
    // reading the code would not have found it.
    const northSection = (/^\*\*新增\*\*：.*$/m.exec(north.slice(northAt, nextHeading(north, northAt))) ?? [''])[0]

    for (const line of planSection.split('\n')) {
      if (!line.trim().startsWith('|')) continue
      const domain = (splitRow(line)[0] ?? '').replace(/\*\*/g, '').trim()
      if (!domain || domain === '领域' || /^:?-+:?$/.test(domain)) continue
      domains++
      const anchor = SCOPE_ANCHORS.get(domain)
      if (anchor === undefined) {
        fail('规则 5', `规划 §1.1 的 ${level} 有一个领域「${domain}」不在 check-docs 的对照表里——新增能力必须同时登记落点`)
        continue
      }
      if (!northSection.includes(anchor)) {
        fail('规则 5', `${level} 交付「${domain}」，而 NORTH_STAR §3 的 ${level} 新增清单里找不到它的落点「${anchor}」`)
      }
    }
  }
  if (domains < 20) fail('规则 5', `只扫到 ${domains} 个 In Scope 领域（下限 20）——抽取面坏了`)
  note(`规则 5 · 规划 §1.1 共 ${domains} 个交付领域，逐个在 NORTH_STAR §3 对应级别比对`)
}

/** Offset of the next `###`/`####` heading after `from`, or end of text. */
function nextHeading(text, from) {
  const candidates = [text.indexOf('\n#### ', from + 5), text.indexOf('\n### ', from + 5), text.indexOf('\n## ', from + 5)]
    .filter((n) => n !== -1)
  return candidates.length === 0 ? text.length : Math.min(...candidates)
}

/* ========================================================================== */
/* 规则 6 · 门槛表里的每个脚本路径与测试过滤器都必须落地                        */
/* ========================================================================== */

const GATE_SECTIONS = [
  '#### v1.0 晋级门槛（G1.0-1 ~ G1.0-22）',
  '#### v1.2 晋级门槛（G1.2-1 ~ G1.2-9）',
  '#### v1.5 晋级门槛（G1.5-1 ~ G1.5-16）',
  '#### A6 的门槛可信度修复',
]

function ruleSixGateCommands() {
  const plan = read(PLAN)
  const rows = []
  for (const heading of GATE_SECTIONS) {
    const at = plan.indexOf(heading)
    if (at === -1) {
      fail('规则 6', `找不到门槛表小节：${heading}`)
      continue
    }
    for (const line of plan.slice(at, nextHeading(plan, at)).split('\n')) {
      if (!line.trim().startsWith('|')) continue
      const cells = splitRow(line)
      if (cells.every((c) => /^:?-+:?$/.test(c))) continue
      const id = (cells[0] ?? '').replace(/\*/g, '').trim()
      if (id === '#' || id === '修复') continue
      // The owner marker is looked up across the WHOLE ROW, not the cell. G1.5-13 puts the
      // job name in the 门槛 column and 「由 T-417 交付」 in the 命令 column — per-cell lookup
      // reports it as an un-owned missing job, which is the opposite of the truth.
      for (const cell of cells) rows.push({ id, cell, row: cells.join(' | ') })
    }
  }

  let total = 0
  let landed = 0
  let pending = 0
  let counterExamples = 0
  const unclassified = []

  for (const { id, cell, row } of rows) {
    for (const m of cell.matchAll(/`([^`]+)`/g)) {
      const raw = (m[1] ?? '').trim()
      const kind = classify(raw, cell)
      if (kind === 'prose') continue
      total++
      if (isCounterExample(cell, m.index, raw.length)) {
        counterExamples++
        continue
      }
      const owner = DEFER.ownerIn(row)
      if (owner && !DEFER.cardExists(owner)) {
        fail('规则 6', `${id}  \`${raw}\` 标着「由 ${owner} 交付」，而台账里没有这张卡`)
        continue
      }
      const verdict = verify(kind, raw)
      if (verdict.ok) {
        landed++
        continue
      }
      if (owner && !DEFER.cardDone(owner)) {
        pending++
        continue
      }
      if (kind === 'unknown') {
        unclassified.push(`${id}  认不出这一格：\`${raw}\``)
        continue
      }
      fail('规则 6', `${id}  \`${raw}\` ${verdict.why}${owner ? `（${owner} 已标 [x]，「待交付」标记已失效）` : ''}`)
    }
  }

  for (const u of unclassified) fail('规则 6', u)
  if (total < 45) fail('规则 6', `只抽到 ${total} 条门槛命令（下限 45）——抽取面坏了，不是门槛都落地了`)
  note(`规则 6 · 校验命令数 ${total} / 已落地 ${landed} / 待交付 ${pending} / 故意反例 ${counterExamples}`)
}

/**
 * Whether a backticked command is one the table cites in order to say it is WRONG.
 *
 * These tables argue about commands, so a naive "every backtick must resolve" rule tells us
 * to delete the very corrections that make the tables honest — 「**不是** `pnpm size-limit`，
 * 该命令不存在」 and 「规则 1 抓不到 `pnpm -F @w3/editor test boot-migrate` 这种错」 are the
 * two shapes, and both are load-bearing prose.
 *
 * Both sides are examined, because the negation can precede or follow the command.
 */
const NEGATION_BEFORE = /(?:不是|抓不到|防的是|错误|写错)\s*\*{0,2}\s*$/
const NEGATION_AFTER = /^\s*\*{0,2}\s*(?:这种错|这类错|——那个|——全仓没有|不存在)/

function isCounterExample(cell, index, length) {
  return (
    NEGATION_BEFORE.test(cell.slice(Math.max(0, index - 18), index)) ||
    NEGATION_AFTER.test(cell.slice(index + length + 2, index + length + 20))
  )
}

/**
 * What sort of thing a backticked gate cell holds.
 *
 * Deliberately conservative: anything that is not recognisably one of the five executable
 * shapes is `prose` and skipped. These tables are full of identifiers (`refExists`,
 * `fullRebuildCount`, `pages`) that are being NAMED, not run — treating them as commands
 * produced 25 false failures on the first run.
 */
function classify(raw, cell) {
  // `pnpm <script>` / `pnpm -F <pkg> test <filter>` — angle brackets mean the table is
  // describing a SHAPE of command, not naming one. Same skip rule 1 applies.
  if (raw.includes('<') || raw.includes('>')) return 'prose'
  if (/^node\s+scripts\/[\w.-]+\.mjs/.test(raw)) return 'script'
  if (/^node\s+--test\s+\S+/.test(raw)) return 'nodetest'
  if (/^pnpm\s/.test(raw)) return extractPnpmCommands(`\`${raw}\``)[0]?.filter ? 'filter' : 'plain'
  if (/^(git\s+diff|grep\s)/.test(raw)) return 'shell'
  // A path only counts when it names a directory: `executor.ts` in prose is a file being
  // discussed, `packages/core/src/eca/executor.ts` is a path being asserted to exist.
  if (raw.includes('/') && /\.(ya?ml|json|md|tsx?|mjs|glb)$/.test(raw) && !raw.includes(' ')) return 'path'
  // A job name only counts when the cell says it is one.
  if (/CI job|ci\.yml|workflows/.test(cell) && /^[a-z][\w-]*$/.test(raw)) return 'jobname'
  return 'prose'
}

function verify(kind, raw) {
  if (kind === 'script') {
    const path = /scripts\/[\w.-]+\.mjs/.exec(raw)?.[0] ?? ''
    return existsSync(join(ROOT, path)) ? { ok: true } : { ok: false, why: `脚本文件不存在：${path}` }
  }
  if (kind === 'nodetest') {
    const path = raw.replace(/^node\s+--test\s+/, '').trim()
    return existsSync(join(ROOT, path)) ? { ok: true } : { ok: false, why: `测试文件不存在：${path}` }
  }
  if (kind === 'path') return existsSync(join(ROOT, raw)) ? { ok: true } : { ok: false, why: '路径不存在' }
  if (kind === 'plain' || kind === 'filter') {
    const command = extractPnpmCommands(`\`${raw}\``)[0]
    if (!command) return { ok: false, why: '解析不出 pnpm 命令' }
    if (command.pkg && !existsSync(join(ROOT, 'packages', command.pkg.replace('@w3/', '')))) {
      return { ok: false, why: `工作区里没有 ${command.pkg} 这个包` }
    }
    if (!command.filter) {
      const manifest = command.pkg ? `packages/${command.pkg.replace('@w3/', '')}/package.json` : 'package.json'
      if (!existsSync(join(ROOT, manifest))) return { ok: false, why: `找不到 ${manifest}` }
      const scripts = Object.keys(JSON.parse(read(manifest)).scripts ?? {})
      return scripts.includes(command.script) ? { ok: true } : { ok: false, why: `${manifest} 里没有 ${command.script} 这个脚本` }
    }
    return testFilesMatching(command).length > 0
      ? { ok: true }
      : { ok: false, why: `过滤器 "${command.filter}" 在测试文件路径里匹配 0 个文件（而 vitest / playwright 匹配 0 个时退出码是 0）` }
  }
  if (kind === 'shell') {
    const paths = raw.split(/\s+/).filter((t) => t.includes('/') && !t.startsWith('-') && !t.includes('..'))
    const missing = paths.map((p) => p.replace(/["']/g, '')).filter((p) => !existsSync(join(ROOT, p)))
    return missing.length === 0 ? { ok: true } : { ok: false, why: `命令里的路径不存在：${missing.join(' ')}` }
  }
  if (kind === 'jobname') {
    const ci = existsSync(join(ROOT, '.github/workflows/ci.yml')) ? read('.github/workflows/ci.yml') : ''
    return new RegExp(`^\\s{2}${raw}:`, 'm').test(ci) ? { ok: true } : { ok: false, why: `ci.yml 里没有名为 ${raw} 的 job` }
  }
  return { ok: false, why: '认不出' }
}

/** Test files whose path contains the filter, in the package the command names. */
function testFilesMatching(command) {
  const roots = command.pkg ? [`packages/${command.pkg.replace('@w3/', '')}/test`] : ['e2e/tests', 'test']
  const out = []
  for (const root of roots) {
    if (!existsSync(join(ROOT, root))) continue
    const walk = (dir) => {
      for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
        const path = `${dir}/${entry.name}`
        if (entry.isDirectory()) walk(path)
        else if (/\.(test|spec)\.tsx?$/.test(entry.name) && path.includes(command.filter)) out.push(path)
      }
    }
    walk(root)
  }
  return out
}

/* ========================================================================== */
/* 规则 7 · 门槛编号区间在规划与台账里必须相等                                  */
/* ========================================================================== */

function ruleSevenGateRanges() {
  const plan = read(PLAN)
  const actual = new Map()
  for (const level of ['1.0', '1.2', '1.5']) {
    const rows = [...plan.matchAll(new RegExp(`^\\|\\s*\\*\\*G${level.replace('.', '\\.')}-(\\d+)\\*\\*`, 'gm'))]
    const max = rows.length === 0 ? 0 : Math.max(...rows.map((m) => Number(m[1])))
    actual.set(level, max)
    if (rows.length !== max) fail('规则 7', `G${level} 表有 ${rows.length} 行但最大编号是 ${max}——编号不连续或有重复`)
  }

  let declarations = 0
  for (const file of docFiles()) {
    read(file).split('\n').forEach((line, i) => {
      // 形状 ① 区间写法 · 形状 ② 附录 D 小节标题（同一正则命中）
      for (const m of line.matchAll(/G(1\.[025])-1\s*~\s*G\1-(\d+)/g)) {
        declarations++
        const [level, high] = [m[1], Number(m[2])]
        if (high !== actual.get(level)) fail('规则 7', `${file}:${i + 1}  声明 G${level}-1 ~ G${level}-${high}，规划 §7.1 实有 ${actual.get(level)} 行（${high} vs ${actual.get(level)}）`)
      }
      // 形状 ③ 卡面「**N 条**以规划 §7.1 的表行数为准」
      // `**` around the count is optional: two of the three cards write it bold and one
      // does not. Requiring the bold markers made this shape silently match nothing, which
      // the ⑨″ mutation is what exposed — the regex had been read, not run.
      const m3 = /G(1\.[025])-1 ~ G\1-\d+[\s\S]*?\*{0,2}(\d+) 条\*{0,2}以规划/.exec(line)
      if (m3) {
        declarations++
        if (Number(m3[2]) !== actual.get(m3[1])) fail('规则 7', `${file}:${i + 1}  卡面写「${m3[2]} 条」，规划 §7.1 实有 ${actual.get(m3[1])} 行（${m3[2]} vs ${actual.get(m3[1])}）`)
      }
    })
  }
  // Three shapes with three different extraction regexes. Testing only one leaves the other
  // two free to rot silently, so the floor keeps all of them inside the surface.
  if (declarations < 10) fail('规则 7', `只扫到 ${declarations} 处门槛编号声明（下限 10）——抽取面坏了`)
  note(`规则 7 · G1.0=${actual.get('1.0')} · G1.2=${actual.get('1.2')} · G1.5=${actual.get('1.5')}，全仓 ${declarations} 处声明逐一比对`)
}

/* ========================================================================== */

ruleOneScripts()
ruleTwoLinks()
ruleThreeAdrCount()
ruleFourTotals()
ruleFiveScopeCoverage()
ruleSixGateCommands()
ruleSevenGateRanges()

console.log('')
for (const n of notes) console.log(`  ${n}`)
console.log('')
if (failures.length === 0) {
  console.log('PASS  G1.0-7 · 文档零漂移（七条规则）')
  process.exit(0)
}
console.error(`FAIL  G1.0-7 · 文档零漂移  — ${failures.length} violation(s)`)
for (const f of failures) console.error(`      ${f}`)
process.exit(1)
