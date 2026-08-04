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
const MAX_EXEMPTIONS = 34

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
const MAX_LEGACY = 90

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

const exempted = new Set(rows.map((r) => r.symbol))
const legacy = readLegacyBaseline()
const unexplained = orphans.filter((o) => !exempted.has(o.id) && !legacy.has(o.id))
// A stale entry is a failure too: it hides nothing, and it makes both ratchets lie about how
// much debt is actually left.
const stale = rows.filter((r) => !orphans.some((o) => o.id === r.symbol))
const staleLegacy = [...legacy].filter((id) => !orphans.some((o) => o.id === id))

console.log('')
console.log(
  `  导出面 ${surface.length} / 生产引用 ${references} / 孤儿 ${orphans.length} / 豁免 ${rows.length} / 遗留基线 ${legacy.size}`,
)
for (const row of rows) console.log(`  exempt: ${row.symbol}  (owner ${row.owner} · 到期 ${row.expires}) — ${row.reason}`)
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
for (const row of stale) failures.push(`豁免表里的 ${row.symbol} 已经有生产调用者了（或已被删除），把这一行删掉`)
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
