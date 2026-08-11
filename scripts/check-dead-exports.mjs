#!/usr/bin/env node
/**
 * T-205 · the member-level zero-caller guard.
 *
 * The failure mode this exists for has now recurred **fourteen times**: a module is written,
 * unit-tested, ticked off, and never wired into anything. `ClipPlayer`'s whole stack ·
 * `StorageProvider.touch()` · `deleteProject` · `AssetLoader.evict()` · `suggestUnit` ·
 * `AuditResult.summary` · `describePolicy` · `SAMPLE_OBJECT_PATHS` · `timer.startOn:'manual'` ·
 * the acceptance-case generator · `createRuntimeBridge.reload` — plus v0.5's `MediaBus.waitForEnd`,
 * `EnvironmentController` and `createLightNode`.
 *
 * **None of the three existing checks can see it.** Coverage is blind — all fourteen have unit
 * tests, so coverage is full. `typecheck` and `lint` count a reference from a test as a use.
 * The capability-entry audit catches "has callers but no user entry", which is orthogonal.
 *
 * So the answer had to be a machine, not another written rule: the rule already existed, in
 * writing, and was missed fourteen times.
 *
 * **Member level is a hard requirement**, not a refinement: symbol level catches 5 of the 11
 * surveyed; member level catches 10. The other six are public methods on exported classes or
 * fields on exported interfaces, and a symbol-level scan sees the class being imported and
 * calls the whole thing used.
 *
 * Usage: node scripts/check-dead-exports.mjs
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { collectFiles, stripComments } from './lib/scan.mjs'
import { readExemptions } from './lib/exemptions.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PACKAGES = ['schema', 'storage', 'core', 'editor', 'player']
const ALLOWLIST = join(ROOT, 'docs', 'DEAD_EXPORTS_ALLOWLIST.md')
const BACKLOGS = ['docs/TASK_BACKLOG_V1.md', 'docs/TASK_BACKLOG_V0_5.md', 'docs/TASK_BACKLOG.md']

/**
 * Ratchet on deliberate, owned exemptions. **Only ever goes down.**
 *
 * This constant IS gate G1.2-9's implementation ("豁免表条数只降不升"). Without it the gate has
 * no landing point, and「把它加进豁免表」becomes the cheapest way to make this script green.
 * Raising it requires a reason in the commit message and a line in the allowlist's ratchet log.
 */
const MAX_EXEMPTIONS = 21

/**
 * ADR-0033 · 第三张表：**接口先落、消费者在后**。
 *
 * v1.0 按规划 §4 的冻结清单交付 API，而它们的消费者排在 v1.2 / v1.5。连着三张卡
 * （T-225 / T-240 / T-237）都因此上调了 `MAX_EXEMPTIONS`，把「只降不升」的棘轮变成了
 * 一本记账簿——**棘轮想拦的是「随手加个导出没人用」，而不是「照冻结清单交付」，两者
 * 混在一张表里，那条规则没法既严格又诚实。**
 *
 * 所以这张表不计入 `MAX_EXEMPTIONS`，代价是它必须有一把**比人工审查更硬的门锁**，
 * 否则它就是新的垃圾桶。门锁是 `assertNamedInSpec`：每一行的符号名必须**逐字出现在
 * 它自己 `spec` 列点名的那一节冻结规范的代码跨度里**。写不进规范的东西进不来这张表。
 *
 * 它**没有条数上限**，理由与上限本身同源：这张表的长度由冻结清单决定，而冻结清单
 * 自己就是冻的。到期检查一字不改——到期未清照样 CI 转红（NORTH_STAR §8）。
 */
const FROZEN_COLUMNS = ['symbol', 'reason', 'owner', 'expires', 'spec']

/**
 * `spec` 列的封闭取值：文档 + 小节标题。**封闭是关键**——允许自由填写等于允许指向
 * 一份不存在的规范，而那和没有门锁是一回事。
 */
const SPEC_SOURCES = {
  '规划§4': { file: 'docs/MVP_V1_进化规划.md', heading: '## 4. 规范增量（逐字实现）' },
  SCHEMA_SPEC: { file: 'docs/SCHEMA_SPEC.md', heading: null },
  ECA_SPEC: { file: 'docs/ECA_SPEC.md', heading: null },
}

/**
 * 一节规范里出现过的所有**代码标识符**。
 *
 * 「出现在这一节里」不够——散文里的英文单词会蒙混过关（实测：`schema:touch` 因为
 * 规划 §4 的一段 JSDoc 里写着 "touch nothing that is already there" 而通过了第一版
 * 检查）。所以只认两种位置：**行内代码跨度**，以及**围栏代码块里注释以外的部分**。
 */
function identifiersIn(file, heading) {
  const all = readFileSync(join(ROOT, file), 'utf8').split(/\r?\n/)
  let lines = all
  if (heading) {
    const from = all.findIndex((l) => l.trim() === heading)
    // 找不到标题就是**失败**，不是「退回全文件」——退回全文件会让门锁悄悄松开一整级。
    if (from === -1) return { ids: null, reason: `在 ${file} 里找不到小节标题「${heading}」` }
    const rest = all.slice(from + 1).findIndex((l) => /^## /.test(l))
    lines = all.slice(from + 1, rest === -1 ? all.length : from + 1 + rest)
  }

  const ids = new Set()
  const take = (text) => {
    for (const m of text.matchAll(/[A-Za-z_$][A-Za-z0-9_$]*/g)) ids.add(m[0])
  }
  let fenced = false
  for (const line of lines) {
    if (/^\s*```/.test(line)) {
      fenced = !fenced
      continue
    }
    if (fenced) {
      // 注释先剥掉，否则围栏块里的英文散文与代码同权
      take(line.replace(/\/\*.*?\*\//g, ' ').replace(/(^|\s)(\/\/|\*|\/\*\*).*$/, ' '))
      continue
    }
    for (const m of line.matchAll(/`([^`]+)`/g)) take(m[1])
  }
  return { ids, reason: null }
}

/**
 * 冻结规范里至少要认出多少个标识符才算「这一节真的被读到了」。
 *
 * D36 的 M6 形状，与 `MIN_EXPORT_SURFACE` 同一个理由：**标题正则一坏，抽出来的集合
 * 是空的，于是「每一行都不在规范里」——但如果反过来写成「集合为空就放行」，它会变成
 * 每一行都通过。** 这里选的是前者（空集合 = 每行都失败），再补一条下限把「抽空了」
 * 与「规范里真没有」分开报。规划 §4 实测 1000+ 个，取远低的下限。
 */
const MIN_SPEC_IDENTIFIERS = 200

/**
 * Ratchet on the v0 / v0.5 backlog. **Only ever goes down.**
 *
 * The first run measured **121** zero-caller exports, not the 11 the survey had named. That
 * number is the discovery, and it changes what the four-column table can be: an owner, an
 * expiry and a ten-character justification for 121 symbols would take longer than the
 * milestone, and most of the extra 110 are v0-era helpers with no owner anyone could name
 * honestly.
 *
 * So the allowlist splits in two, on one question — **can this be attributed to a card?**
 *
 *   yes → the four-column exemption table. Owner and expiry required, both checked.
 *   no  → the legacy baseline: a bare list of what was already there on 2026-08-03,
 *         ratcheted so it can only shrink.
 *
 * A symbol in NEITHER list fails the build. That makes recurrence #15 impossible while
 * leaving #1–#14 as visible, countable, shrinking debt instead of an unreadable table.
 *
 * 2026-08-03: 121 orphans total — 31 attributable (they go in the four-column table), 90 not.
 */
const MAX_LEGACY = 82

/**
 * Floor on the size of the scanned export surface.
 *
 * D36 names this as the one thing every `--check` script needs and almost never has: a glob
 * that stops matching turns the whole guard green, and "zero orphans" is exactly what a
 * script that scanned nothing reports. So the script asserts it saw something — and when it
 * fails, the message says the SCAN broke, not that the code is clean.
 *
 * Set below the measured value (1040 on 2026-08-03), rounded well down.
 */
const MIN_EXPORT_SURFACE = 600

/**
 * Declaration kinds that produce something at run time.
 *
 * `type` and `interface` are excluded from the SYMBOL scan — their MEMBERS are not. A type
 * alias cannot be "implemented, tested and never called": it has no run-time existence at
 * all. Including them turned a 121-finding report into a 144-finding one, and none of the
 * extra 23 was the failure mode this guard is named after.
 */
const RUNTIME_KINDS = new Set(['function', 'function*', 'const', 'let', 'var', 'class', 'enum', 'named'])

/* -------------------------------------------------------------------------- */
/* 1 · what each package exports                                              */
/* -------------------------------------------------------------------------- */

/** `export function foo` / `export const foo` / `export class Foo` / `export interface Foo`… */
/**
 * `async` was missing until T-222 tripped over it.
 *
 * `export async function buildPumpDemoGlb` matched nothing, so the symbol never entered the
 * export surface and its zero callers were never counted. A guard whose declaration pattern
 * misses a whole declaration form is under-reporting silently — the direction this script's
 * header promises it errs in, but only because nobody had checked. Found by adding an
 * `export async function` and watching the orphan count stay put.
 */
const DECL_RE = /^export\s+(?:declare\s+)?(?:abstract\s+)?(?:async\s+)?(function\*?|const|let|var|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/gm
/** `export { a, b as c }` — excluding `export … from`, which re-exports another file. */
const NAMED_RE = /^export\s*\{([^}]*)\}\s*(?!from)/gm
/** `export * from './x.js'` */
const STAR_RE = /^export\s*\*\s*from\s*['"]([^'"]+)['"]/gm

/**
 * Every named export reachable from `packages/<pkg>/src/index.ts`, with its defining file.
 *
 * Barrels are followed one level at a time rather than resolved through the TypeScript
 * compiler API: this repository's barrels are plain `export * from './x.js'` chains, and a
 * 40-line walker that is obviously correct beats a dependency on `typescript`'s program
 * builder inside a script that has to keep working when the workspace does not compile.
 */
function exportsOf(pkg) {
  const entry = join(ROOT, 'packages', pkg, 'src', 'index.ts')
  if (!existsSync(entry)) return []

  const seen = new Set()
  const out = []
  const visit = (file) => {
    if (seen.has(file) || !existsSync(file)) return
    seen.add(file)
    const text = stripComments(readFileSync(file, 'utf8'))

    for (const m of text.matchAll(DECL_RE)) out.push({ name: m[2], kind: m[1], file, pkg })
    for (const m of text.matchAll(NAMED_RE)) {
      for (const part of (m[1] ?? '').split(',')) {
        const pieces = part.trim().split(/\s+as\s+/)
        const name = pieces[pieces.length - 1]?.trim()
        if (name && /^[A-Za-z_$][\w$]*$/.test(name)) out.push({ name, kind: 'named', file, pkg })
      }
    }
    for (const m of text.matchAll(STAR_RE)) {
      const spec = m[1] ?? ''
      if (!spec.startsWith('.')) continue
      visit(resolve(dirname(file), spec.replace(/\.js$/, '.ts')))
    }
  }
  visit(entry)
  return out
}

/** Members every class has, or words that are not member names at all. */
const RESERVED_MEMBERS = new Set(['constructor', 'return', 'if', 'for', 'while', 'switch', 'this', 'new', 'typeof'])

/** A member declaration at one indent level inside a class or interface body. */
const MEMBER_RE = /^\s{2}(?:readonly\s+|static\s+|async\s+|get\s+|set\s+)*([a-z_$][\w$]*)\s*[(<:?]/gm

/**
 * The public members of an exported class or interface, as `Type.member`.
 *
 * Regex over the declaration body rather than an AST walk, for the reason above. The cost is
 * real and is stated rather than hidden: an unusually formatted member declaration is missed,
 * and a missed member is a false NEGATIVE. This script under-reports rather than over-reports,
 * which is the right direction for something that gates CI — and probe M7 in the card exists
 * precisely to keep the member scan honest about it.
 */
function membersOf(name, file) {
  if (!existsSync(file)) return []
  const text = stripComments(readFileSync(file, 'utf8'))
  const decl = new RegExp(`^export\\s+(?:declare\\s+)?(?:abstract\\s+)?(?:class|interface)\\s+${escapeRe(name)}\\b`, 'm')
  const at = text.search(decl)
  if (at === -1) return []
  const open = text.indexOf('{', at)
  if (open === -1) return []

  // Brace matching, so a nested object type inside a member does not end the body early.
  let depth = 0
  let close = text.length
  for (let i = open; i < text.length; i++) {
    if (text[i] === '{') depth++
    else if (text[i] === '}' && --depth === 0) {
      close = i
      break
    }
  }
  const out = new Set()
  for (const m of text.slice(open + 1, close).matchAll(MEMBER_RE)) {
    if (m[1] && !RESERVED_MEMBERS.has(m[1])) out.add(m[1])
  }
  return [...out]
}

/* -------------------------------------------------------------------------- */
/* 2 · where production code references them                                  */
/* -------------------------------------------------------------------------- */

/**
 * Every production source file. **Tests are excluded, and that exclusion is the point.**
 *
 * All fourteen known dead exports have unit tests. Counting a test as a caller is exactly
 * what makes `typecheck`, `lint` and coverage blind to them.
 */
function productionFiles() {
  const files = []
  for (const pkg of PACKAGES) {
    for (const file of collectFiles(join(ROOT, 'packages', pkg, 'src'), ['.ts', '.tsx'])) {
      if (/[\\/]test[\\/]/.test(file) || /\.test\.tsx?$/.test(file)) continue
      files.push(file)
    }
  }
  return files
}

/* -------------------------------------------------------------------------- */
/* 3 · run                                                                    */
/* -------------------------------------------------------------------------- */

const surface = []
for (const pkg of PACKAGES) {
  for (const { name, kind, file } of exportsOf(pkg)) {
    if (RUNTIME_KINDS.has(kind)) surface.push({ id: `${pkg}:${name}`, name, file, pkg })
    for (const member of membersOf(name, file)) {
      surface.push({ id: `${pkg}:${name}.${member}`, name: member, file, pkg, owner: name })
    }
  }
}

const bodies = new Map()
for (const file of productionFiles()) bodies.set(file, stripComments(readFileSync(file, 'utf8')))

/**
 * One question per symbol: **is there an occurrence that is not a declaration?**
 *
 * Getting this rule right is the whole guard, and the first version got it wrong in a way
 * worth recording. It counted every occurrence outside the defining file and reported 347
 * orphans — mostly zod fragments like `AssetTypeSchema`, exported for completeness and
 * consumed one line below by the schema that composes them. A guard that reports 347 findings
 * on a healthy repository is a guard nobody reads.
 *
 * Two rules, because declarations look different for the two kinds:
 *
 *   Symbols — any occurrence that is not the `export const X` / `export {X}` line itself. An
 *             in-file use counts: a building block used by the thing it builds is not dead.
 *   Members — only a PROPERTY ACCESS counts (`x.foo`, `x?.foo`). This is what makes the member
 *             scan worth having: `deleteProject` is declared in `provider.ts` and again in
 *             both implementations, so counting declarations would call it used — and it is
 *             one of the eleven.
 */
const orphans = []
let references = 0
for (const entry of surface) {
  const name = escapeRe(entry.name)
  const use = entry.owner ? new RegExp(`[.?]\\s*${name}\\b`, 'g') : new RegExp(`(?<![.\\w$])${name}\\b`, 'g')
  const declaration = entry.owner
    ? null
    : new RegExp(
        // `async` here too — without it, `export async function X` counts its own declaration
        // line as a USE, so a brand-new zero-caller export reports as used. Two regexes, one
        // blind spot, and only the second one was visible from the orphan count.
        `^\\s*export\\s+(?:declare\\s+)?(?:abstract\\s+)?(?:async\\s+)?(?:function\\*?|const|let|var|class|interface|type|enum)\\s+${name}\\b` +
          `|^\\s*export\\s*\\{[^}]*\\b${name}\\b`,
        'gm',
      )

  let uses = 0
  for (const [file, text] of bodies) {
    let count = (text.match(use) ?? []).length
    if (declaration && file === entry.file) count -= (text.match(declaration) ?? []).length
    uses += Math.max(0, count)
  }
  references += uses
  if (uses === 0) orphans.push(entry)
}

const current = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).w3Version ?? 'v1.0'
const backlogText = BACKLOGS.filter((p) => existsSync(join(ROOT, p)))
  .map((p) => readFileSync(join(ROOT, p), 'utf8'))
  .join('\n')
const { rows, problems } = readExemptions(ALLOWLIST, { current, cardExists: (card) => backlogText.includes(card) })

const frozen = readExemptions(ALLOWLIST, {
  current,
  cardExists: (card) => backlogText.includes(card),
  columns: FROZEN_COLUMNS,
})

const exemptedFour = new Set(rows.map((r) => r.symbol))
const exempted = new Set([...rows, ...frozen.rows].map((r) => r.symbol))
const legacy = readLegacyBaseline()
const unexplained = orphans.filter((o) => !exempted.has(o.id) && !legacy.has(o.id))
// A stale entry is a failure too: it hides nothing, and it makes both ratchets lie about how
// much debt is actually left.
const stale = [
  ...rows.map((r) => ({ ...r, table: '豁免表' })),
  ...frozen.rows.map((r) => ({ ...r, table: '冻结接口表' })),
].filter((r) => !orphans.some((o) => o.id === r.symbol))
const staleLegacy = [...legacy].filter((id) => !orphans.some((o) => o.id === id))

console.log('')
console.log(
  `  导出面 ${surface.length} / 生产引用 ${references} / 孤儿 ${orphans.length} / 豁免 ${rows.length} / 冻结接口 ${frozen.rows.length} / 遗留基线 ${legacy.size}`,
)
for (const row of rows) console.log(`  exempt: ${row.symbol}  (owner ${row.owner} · 到期 ${row.expires}) — ${row.reason}`)
for (const row of frozen.rows) console.log(`  frozen: ${row.symbol}  (${row.spec} · owner ${row.owner} · 到期 ${row.expires})`)
console.log('')

const failures = []
if (surface.length < MIN_EXPORT_SURFACE) {
  // D36's "most important" probe. Read the message: it says the SCAN failed, not that the code
  // is clean. A glob that matches nothing reports zero orphans, and zero orphans reads like
  // success in every other line of this output.
  failures.push(`导出面只扫到 ${surface.length} 个符号（下限 ${MIN_EXPORT_SURFACE}）——扫描范围坏了，不是代码干净了`)
}
if (rows.length > MAX_EXEMPTIONS) {
  failures.push(`豁免表 ${rows.length} 条，超过棘轮上限 ${MAX_EXEMPTIONS}（这个常量只能降不能升）`)
}
if (legacy.size > MAX_LEGACY) {
  failures.push(`遗留基线 ${legacy.size} 条，超过棘轮上限 ${MAX_LEGACY}（这个常量只能降不能升）`)
}
for (const p of problems) failures.push(`${rel(ALLOWLIST)}:${p.line}  ${p.message}`)
for (const p of frozen.problems) failures.push(`${rel(ALLOWLIST)}:${p.line}  冻结接口表：${p.message}`)
failures.push(...assertNamedInSpec(frozen.rows))
for (const row of frozen.rows) {
  if (exemptedFour.has(row.symbol)) {
    failures.push(`${row.symbol} 同时列在豁免表与冻结接口表里，删掉其中一行`)
  }
}
for (const row of stale) failures.push(`${row.table}里的 ${row.symbol} 已经有生产调用者了（或已被删除），把这一行删掉`)
for (const id of staleLegacy) failures.push(`遗留基线里的 ${id} 已经有生产调用者了（或已被删除），把这一行删掉并把 MAX_LEGACY 调低`)
for (const o of unexplained) {
  failures.push(`${rel(o.file)}  ${o.id} 有导出、无生产调用者。接上它、删掉它，或在豁免表里写清谁会用到它`)
}

if (failures.length === 0) {
  console.log(`PASS  C5 + D36 · dead exports  (${bodies.size} file(s) scanned)`)
  process.exit(0)
}
console.error(`FAIL  C5 + D36 · dead exports  — ${failures.length} violation(s)`)
for (const f of failures) console.error(`      ${f}`)
process.exit(1)

/**
 * ADR-0033 的门锁：冻结接口表里的每一行，符号名都得逐字写在它点名的那节规范里。
 *
 * 这是这张表与豁免表**唯一**的结构性差别，也是它可以不受条数棘轮约束的全部理由。
 * 少了它，「不计入上限的表」就是把 G1.2-9 那条门槛整个绕开的合法通道。
 */
function assertNamedInSpec(frozenRows) {
  const out = []
  const cache = new Map()
  for (const row of frozenRows) {
    const source = SPEC_SOURCES[row.spec]
    if (!source) {
      out.push(
        `${rel(ALLOWLIST)}:${row.line}  spec 列必须是封闭取值之一（${Object.keys(SPEC_SOURCES).join(' / ')}），实际是「${row.spec}」`,
      )
      continue
    }
    if (!cache.has(row.spec)) cache.set(row.spec, identifiersIn(source.file, source.heading))
    const { ids, reason } = cache.get(row.spec)
    if (!ids) {
      out.push(`冻结规范读不到：${reason}——是标题改了还是路径改了，不是这一行有问题`)
      continue
    }
    if (ids.size < MIN_SPEC_IDENTIFIERS) {
      out.push(
        `从 ${source.file} 的「${row.spec}」只抽出 ${ids.size} 个标识符（下限 ${MIN_SPEC_IDENTIFIERS}）——抽取坏了，不是规范变空了`,
      )
      continue
    }
    const name = row.symbol.includes('.') ? row.symbol.split('.').pop() : row.symbol.split(':').pop()
    if (!ids.has(name)) {
      out.push(
        `${rel(ALLOWLIST)}:${row.line}  ${row.symbol} 不在「${row.spec}」的冻结清单里（按代码跨度逐字比对）。` +
          `这张表只收「规范里写了、消费者在后面」的东西；随手加的导出请走豁免表并接受条数棘轮`,
      )
    }
  }
  return out
}

/** The bare-id legacy list, read out of the same allowlist document. */
function readLegacyBaseline() {
  const out = new Set()
  if (!existsSync(ALLOWLIST)) return out
  let inList = false
  for (const line of readFileSync(ALLOWLIST, 'utf8').split('\n')) {
    if (line.startsWith('## ')) {
      inList = line.includes('遗留基线')
      continue
    }
    if (!inList) continue
    const m = /^-\s+`([^`]+)`/.exec(line.trim())
    if (m && m[1]) out.add(m[1])
  }
  return out
}

function rel(file) {
  return relative(ROOT, file).split('\\').join('/')
}

function escapeRe(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
