import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * T-261 · 附件A 的机械校验。
 *
 * ## 为什么一份合同附件需要一个守卫
 *
 * 附件A 是**合同的一部分**：客户按它准备资产，我们按它判定「性能表现是否进入验收范围」。
 * 而它的每一个数字在代码里都有一个对应物（`DEFAULT_POLICY`），两边靠人手同步。
 *
 * 人手同步的失效方式不是「写错一个数」那么轻——它是**单向的**：有人为了让一份客户资产
 * 过检而调宽 `DEFAULT_POLICY`，附件A 不动，于是合同里写着 60 MB、系统里放行 80 MB。
 * 那份文档从此不再是我们承诺的东西，而在这条守卫存在之前，没有任何测试会因此转红。
 *
 * ## 五条检查，逐条对应一种真实的漂移
 *
 * 1. 附件A §2 的每个上限 = `DEFAULT_POLICY` 的对应值（黄灯 = 上限 × `WARN_RATIO`）
 * 2. `METRICS` 里每条有上限的指标，附件A §2 必须有一行
 * 3. §8 送检清单里点名的数字与代码一致
 * 4. §7 的验收前提是编号列表且条数足够
 * 5. 文档里不出现我们不支持的格式名
 *
 * ## 为什么读源码而不是 import
 *
 * 这条守卫挂在 `pnpm check:constitution` 上，而那条命令**不保证 `dist/` 已经构建**。
 * 从 `packages/core/dist` 引入会让守卫在干净检出上直接崩掉——一条崩掉的守卫和一条
 * 不存在的守卫是同一件事。所以两份数据都从 TS 源码里正则抽出来，并且**抽不到就报错**，
 * 不静默跳过（扫描面下限，D36 M6）。
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const ANNEX = join(ROOT, 'docs/附件A_数字资产规范_草案.md')
const POLICY_SRC = join(ROOT, 'packages/core/src/assets/policy.ts')

/** 已废弃 / 从未支持的格式名。写进合同附件就是在承诺我们做不到的事（v0 起只支持 glTF/GLB）。 */
const RETIRED_FORMATS = ['.fbx', '.obj', '.dae', '.3ds', '.max', '.step', '.iges']

/** `60 * 1024 * 1024` / `300_000` → 数字。只认数字、下划线、`*`、`+` 与空白。 */
function evalArithmetic(expression) {
  const cleaned = expression.replace(/_/g, '').trim()
  if (!/^[\d\s*+.]+$/.test(cleaned)) return null
  // 只有加法与乘法，按优先级手算——不引 `eval`，也不引一个表达式解析器。
  const sum = cleaned
    .split('+')
    .map((term) => term.split('*').reduce((a, b) => a * Number(b.trim()), 1))
    .reduce((a, b) => a + b, 0)
  return Number.isFinite(sum) ? sum : null
}

/** 从 `policy.ts` 里抽出 `DEFAULT_POLICY` 的数值字段。 */
function readPolicy(source) {
  const start = source.indexOf('export const DEFAULT_POLICY')
  if (start === -1) return null
  const end = source.indexOf('\n}', start)
  if (end === -1) return null
  const body = source.slice(start, end)
  const policy = {}
  for (const match of body.matchAll(/^\s*(max\w+):\s*([^,\n]+),/gm)) {
    const value = evalArithmetic(match[2])
    if (value !== null) policy[match[1]] = value
  }
  return policy
}

/** 从 `policy.ts` 里抽出 METRICS 的 `{ metric, label, policyKey, hasThreshold }`。 */
function readMetrics(source) {
  const start = source.indexOf('export const METRICS')
  if (start === -1) return null
  const body = source.slice(start)
  const out = []
  for (const match of body.matchAll(/metric:\s*'([^']+)',\s*\n\s*label:\s*'([^']+)',\s*\n\s*limit:\s*\(\w+\)\s*=>\s*([^,\n]+),/g)) {
    const key = /\.(\w+)/.exec(match[3])
    out.push({
      metric: match[1],
      label: match[2],
      policyKey: key ? key[1] : null,
      // `level:` 自定义判级的指标（NPOT 警告那种）没有可写进合同的阈值：
      // 「非 2 的幂尺寸 ≤ 0」不是一句人话。
      hasThreshold: !/level:\s*\(/.test(body.slice(match.index, match.index + 700)),
    })
  }
  return out
}

/** 附件A 里所有形如 `| 指标 | 上限 | 黄灯 | …DEFAULT_POLICY.x… |` 的行。 */
function limitRows(lines) {
  const rows = []
  lines.forEach((line, i) => {
    const key = /DEFAULT_POLICY\.(\w+)/.exec(line)
    if (!key) return
    const cells = line.split('|').map((c) => c.trim())
    if (cells.length < 5) return
    // 来源列里的「指标 `x`」是 T-261 加的机械锚点，不是给人读的装饰：没有它，规则 2
    // 只能按策略键核对，而**一条复用了已有上限的新指标会整条溜过去**（实测：给 METRICS
    // 加一条 `limit: (p) => p.maxNodes` 的新指标，守卫全绿）。
    const metric = /指标 `(\w+)`/.exec(line)
    rows.push({ line: i + 1, key: key[1], metric: metric ? metric[1] : null, limitText: cells[2], warnText: cells[3] })
  })
  return rows
}

/** `**60 MB**` / `300,000` / `2048 px` → 字节数 / 个数。看不懂返回 null。 */
function parseAmount(text) {
  const cleaned = text.replace(/\*\*/g, '').replace(/,/g, '').trim()
  const match = /^([\d.]+)\s*(MB|KB|px)?$/.exec(cleaned)
  if (!match) return null
  const value = Number(match[1])
  if (!Number.isFinite(value)) return null
  if (match[2] === 'MB') return value * 1024 * 1024
  if (match[2] === 'KB') return value * 1024
  return value
}

/** 一节的正文（到下一个同级标题为止）。 */
function sectionOf(lines, heading) {
  const from = lines.findIndex((l) => l.startsWith(heading))
  if (from === -1) return ''
  const rest = lines.slice(from + 1).findIndex((l) => /^## /.test(l))
  return lines.slice(from + 1, rest === -1 ? lines.length : from + 1 + rest).join('\n')
}

/* ========================================================================== */

const source = readFileSync(POLICY_SRC, 'utf8')
const text = readFileSync(ANNEX, 'utf8')
const lines = text.split(/\r?\n/)
const violations = []

const policy = readPolicy(source)
const metrics = readMetrics(source)
const warnRatio = Number(/export const WARN_RATIO = ([\d.]+)/.exec(source)?.[1])

/* 扫描面下限：读不出源码里的数字时，下面每一条检查都会「通过」——那是最坏的情况。 */
if (!policy || Object.keys(policy).length < 8) {
  violations.push(`从 ${'packages/core/src/assets/policy.ts'} 里只读出 ${Object.keys(policy ?? {}).length} 个上限（至少 8 个）——正则与源码对不上了`)
}
if (!metrics || metrics.length < 10) {
  violations.push(`只读出 ${metrics?.length ?? 0} 条 METRICS（至少 10 条）——正则与源码对不上了`)
}
if (!Number.isFinite(warnRatio)) violations.push('读不到 WARN_RATIO')

const rows = limitRows(lines)
if (rows.length < 8) {
  violations.push(`附件A 里只认出 ${rows.length} 行上限（至少 8 行）——要么表格格式变了，要么真的漏了行`)
}

if (policy && metrics && Number.isFinite(warnRatio)) {
  /* 规则 1 · 数值一致 ------------------------------------------------------ */
  for (const row of rows) {
    const expected = policy[row.key]
    if (expected === undefined) {
      violations.push(`附件A:${row.line}  DEFAULT_POLICY.${row.key} 不存在——策略里改过名字，附件A 没跟上`)
      continue
    }
    const actual = parseAmount(row.limitText)
    if (actual === null) {
      violations.push(`附件A:${row.line}  上限「${row.limitText}」读不出数字`)
      continue
    }
    if (actual !== expected) {
      violations.push(
        `附件A:${row.line}  ${row.key} 写的是「${row.limitText}」（= ${actual}），而 DEFAULT_POLICY 是 ${expected}。合同里的数字与系统放行的数字不一致`,
      )
    }
    const warn = parseAmount(row.warnText)
    if (warn !== null && Math.abs(warn - expected * warnRatio) > Math.max(1, expected * warnRatio * 0.01)) {
      violations.push(`附件A:${row.line}  黄灯「${row.warnText}」不等于上限 × ${warnRatio}`)
    }
  }

  /* 规则 2 · METRICS 无遗漏 ------------------------------------------------ */
  // 按**指标 id** 核对，不按策略键：两条指标完全可以共用一个上限（实测 `maxTextureSize`
  // 就同时服务于模型与独立贴图两档），那时按键核对会把后来的那条判成「已覆盖」。
  const covered = new Set(rows.map((r) => r.metric).filter(Boolean))
  const unanchored = rows.filter((r) => r.metric === null)
  if (unanchored.length > 0) {
    violations.push(
      `附件A 有 ${unanchored.length} 行上限没写「指标 \`x\`」锚点（第 ${unanchored.map((r) => r.line).join(' / ')} 行）——` +
        `没有锚点，规则 2 就退化成按策略键核对，而那漏得掉复用已有上限的新指标`,
    )
  }
  for (const spec of metrics) {
    if (!spec.hasThreshold || spec.policyKey === null) continue
    if (!covered.has(spec.metric)) {
      violations.push(
        `METRICS 有「${spec.label}」（指标 ${spec.metric}），附件A §2 没有对应的行——新增指标没写进合同，客户按旧清单送检会莫名其妙地不合格`,
      )
    }
  }

  /* 规则 3 · 送检清单与代码一致 -------------------------------------------- */
  const checklist = sectionOf(lines, '## 8.')
  for (const [pattern, expected, label] of [
    [/三角面数\s*≤\s*([\d,]+)/, policy.maxTriangles, '三角面数'],
    [/贴图\s*≤\s*([\d,]+)\s*张/, policy.maxTextures, '贴图张数'],
    [/单张边长\s*≤\s*([\d,]+)\s*px/, policy.maxTextureSize, '单张贴图边长'],
    [/材质\s*≤\s*([\d,]+)\s*个/, policy.maxMaterials, '材质数量'],
  ]) {
    const found = pattern.exec(checklist)
    if (!found) {
      violations.push(`附件A §8 送检清单里找不到「${label}」那一条——清单与 §2 的表已经不是同一份东西`)
      continue
    }
    const value = Number(found[1].replace(/,/g, ''))
    if (value !== expected) violations.push(`附件A §8  「${label}」写的是 ${value}，而 DEFAULT_POLICY 是 ${expected}`)
  }
}

/* 规则 4 · §7 的前提格式合法 ---------------------------------------------- */
const numbered = sectionOf(lines, '## 7.')
  .split('\n')
  .filter((l) => /^\d+\.\s+\S/.test(l))
if (numbered.length < 4) {
  violations.push(
    `附件A §7 的验收前提只认出 ${numbered.length} 条编号项（至少 4 条）。这一节是「性能表现不作为验收依据」的全部判据，格式散掉就等于没有判据`,
  )
}

/* 规则 5 · 无废弃格式名 ---------------------------------------------------- */
for (const format of RETIRED_FORMATS) {
  // 词边界是必须的，而且两侧都要。`.max` 既是 3ds Max 的扩展名，也是
  // `DEFAULT_POLICY.maxTextureBytes` 的开头**和** zod 的 `.max(120)`——第一版没有边界，
  // 当场把附件A 自己的策略键名判成了废弃格式；补了左边界之后又被 `.max(120)` 命中。
  // 后括号排除是第二块补丁：扩展名后面不会跟一个左括号，方法调用才会。
  // 两侧都要边界，而且右边界还要排除左括号。`.max` 既是 3ds Max 的扩展名，也是
  // `DEFAULT_POLICY.maxTextureBytes` 的开头**和** zod 的 `.max(120)`：第一版没有左边界，
  // 当场把附件A 自己的策略键名判成了废弃格式；补上左边界之后又被 `.max(120)` 命中。
  // 扩展名后面不会跟一个左括号，方法调用才会。
  const pattern = new RegExp(`(?<![\\w.])\\${format}(?![\\w(])`, 'i')
  const at = lines.findIndex((l) => pattern.test(l))
  if (at >= 0) violations.push(`附件A:${at + 1}  出现了「${format}」——v0 起只支持 glTF/GLB，写进合同附件就是在承诺我们做不到的事`)
}

/* ========================================================================== */

if (violations.length > 0) {
  console.log(`FAIL  合同 · 附件A 与 DEFAULT_POLICY 一致  — ${violations.length} 处`)
  for (const v of violations) console.log(`      ${v}`)
  process.exit(1)
}

console.log(
  `  策略上限 ${Object.keys(policy).length} 项 / METRICS ${metrics.length} 条 / 附件A 上限行 ${rows.length} 行 / §7 前提 ${numbered.length} 条`,
)
console.log('PASS  合同 · 附件A 与 DEFAULT_POLICY 一致（五条规则）')
