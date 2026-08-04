#!/usr/bin/env node
/**
 * G1.0-13 · `CONSTITUTION-EXCEPTION` 到期守卫。
 *
 * `NORTH_STAR §8` has said since v0 that breaking the constitution requires four steps, the
 * fourth being 「到期未清理，CI 转为失败」. **The script that reads an expiry version did not
 * exist**, so steps 3 and 4 were prose. Three ADRs say so about themselves, in their own
 * 代价 columns:
 *
 *   - **ADR-0022** · `§3` · 到期 `v1.0` — the target-machine benchmark's mount point
 *   - **ADR-0024** · `C7` · 到期 `v1.5` — the player's one `fetch`, until `HttpApiProvider`
 *   - **ADR-0025** · `渲染出口` · 到期 `v2` — the capture pass's extra overlay draw
 *
 * ⚠ **None of the three is in the code yet, and that is not this script's failure.** Their
 * landing places do not exist: `ADR-0025`'s belongs on a `captureImage()` that is still
 * T-266's un-wired stub; `ADR-0022`'s belongs in a benchmark script nobody has written;
 * `ADR-0024`'s sits above a `fetch` whose replacement is a v1.5 card. So the card's ⚠ 栏
 * (「确认三条到期承诺现在都能被脚本解析出来」) is met the only way it can be: **the fixtures
 * reproduce all three lines verbatim**, and `--self-test` proves the parser reads them.
 *
 * The scan surface deliberately excludes `docs/**`. Including it would sweep in the ADRs'
 * own quoted examples — and ADR-0022's 到期 `v1.0` would turn this red on the day it shipped,
 * against a promise whose code has not been written.
 *
 * Usage:
 *   node scripts/check-expiry.mjs
 *   node scripts/check-expiry.mjs --self-test
 */
import { readFileSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { VERSION_LADDER, isExpired } from './lib/exemptions.mjs'
import { collectFiles } from './lib/scan.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SELF_TEST = process.argv.includes('--self-test')

const SCAN_ROOTS = [
  ['packages/core/src', ['.ts', '.tsx']],
  ['packages/editor/src', ['.ts', '.tsx']],
  ['packages/player/src', ['.ts', '.tsx']],
  ['packages/schema/src', ['.ts']],
  ['packages/storage/src', ['.ts']],
  ['scripts', ['.mjs', '.js']],
]

/**
 * Directories inside the scan surface that must NOT be scanned.
 *
 * `scripts/fixtures/expiry/` holds a deliberately-expired sample. Left in, the default run
 * would fail on it and the card's 「exit 0」 acceptance would be unreachable. The fixtures also
 * use a `.ts.fixture` suffix that no extension list matches — **both layers on purpose**:
 * relying on the suffix alone means the day someone renames a fixture to `.ts`, this script
 * starts failing on its own test data and the reason will not be obvious.
 */
const SKIP_DIRS = ['scripts/fixtures']

/**
 * Places that legitimately spell the marker without being one.
 *
 * Exactly one today: `scripts/lib/exemptions.mjs`'s own JSDoc explains what the mechanism is
 * for. **The card asserts this set is empty** (「今天零命中」) — it is not, and the one hit
 * lands inside the scan surface AND would be judged 「格式写错」 by the rule below. Declaring
 * it as a set that must match exactly is the honest fix; tightening the regex until it
 * happens to miss would leave the next prose mention to be judged at random.
 */
const PROSE_SITES = new Map([
  ['scripts/lib/exemptions.mjs', 'T-205 的 JSDoc 在解释这套机制本身，不是一条例外'],
  // This file itself. It quotes the marker in its JSDoc, holds it as a string constant and
  // builds it into a regex — and its own error messages contain it. **A declared entry, not a
  // silent self-exemption**: it is in the same table as every other prose site, the set has
  // to match exactly, and removing this file from the scan surface entirely would have been
  // the version nobody could audit.
  ['scripts/check-expiry.mjs', '本守卫自己：JSDoc 引用格式、常量与正则里都写着这个标记，报错文案里也有'],
  // The GUARDS registration line, whose `what` names what this script checks. Declared rather
  // than reworded: 「把措辞改到扫描器碰巧看不见」 is the same move as tightening the regex until
  // it misses, and this file's own JSDoc argues against exactly that.
  ['scripts/check-constitution.mjs', 'GUARDS 里本守卫那一行的 what 字段在说明它检查什么'],
])

/**
 * The anchor, with its colon.
 *
 * `NORTH_STAR §8` step 2 writes `// CONSTITUTION-EXCEPTION: C5 · ADR-0019 · 到期 v2`. Matching
 * the bare word would make every sentence about the mechanism into a malformed exception.
 */
const ANCHOR = 'CONSTITUTION-EXCEPTION:'

/**
 * Three segments, `·`-separated.
 *
 * **`<条款>` is any non-empty text without a `·`, NOT `/^C[1-9]$/`.** The four real shapes in
 * the tree are `C5` · `C7` · `§3` · `渲染出口`; narrowing it to constitution articles would
 * reject two of the three live promises, and the rule below says unparseable means red — so
 * the guard would have condemned ADR-0022 and ADR-0025 on day one.
 */
const EXCEPTION_RE = /CONSTITUTION-EXCEPTION:\s*([^·]+?)\s*·\s*(ADR-\d{4})\s*·\s*到期\s*([^\s（(]*)/

/**
 * The version, anchored — and this is the trap the card names, hiding inside its own example.
 *
 * ADR-0024's verbatim line ends `到期 v1.5（改走 HttpApiProvider）`. A greedy `(\S+)` captures
 * `v1.5（改走`, which `VERSION_LADDER.indexOf` reports as -1, which `isExpired` turns into a
 * silent `false` — **a real, expiring exception waved through by the guard written to catch
 * exactly that**.
 *
 * **The first draft of this file described that trap in this very comment and then used
 * `(\S+)` anyway**; the `not-due` fixture is what caught it. The capture now stops at
 * whitespace or an opening bracket of either width, and what it captures is re-checked
 * against the shape AND against the ladder. Capturing the empty string is deliberate too:
 * 「到期」 with nothing after it then reports 「到期版本号「」不成形」 rather than the vaguer
 * 「格式解析不出来」.
 */
const VERSION_RE = /^v\d+(?:\.\d+)?$/

/**
 * Below this the glob is broken rather than the repository clean.
 *
 * 156 + 18 files today. **The floor is on the FILE count, not the exception count** — there
 * are legitimately zero live exceptions right now, so a floor on those would make this card
 * unpassable on the day it lands, while a broken glob drops the file count to 0 and this
 * catches it. D36's M6, sixth recurrence in v1.
 */
const MIN_FILES = 150

/* -------------------------------------------------------------------------- */

/**
 * The current version of this repository, on the ladder — or a refusal.
 *
 * ⚠ **`package.json` has no ladder version.** `"version": "0.0.0"` and no `w3Version`, so
 * the card's 「与 package.json 的当前版本比较」 taken literally yields
 * `isExpired('v1.0', '0.0.0')`, whose `indexOf` is -1, whose answer is always `false`:
 * **a guard that can never be red.** That is D36's M6 in a new place.
 *
 * There is also an existing debt worth naming: this repository already has **two** answers to
 * "what version is it" — `check-dead-exports.mjs:270` derives `v1.0`, `check-no-external.mjs`
 * derives `v0.5` from the same `package.json`. This is the third, and it refuses rather than
 * guesses when the answer is not on the ladder.
 */
function resolveCurrentVersion() {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
  const declared = pkg.w3Version ?? FALLBACK_VERSION
  if (!VERSION_LADDER.includes(declared)) {
    return { version: null, why: `当前版本「${declared}」不在版本阶梯上（${VERSION_LADDER.join(' / ')}）。拒绝比较——把一个阶梯外的字符串喂给 isExpired，答案永远是「未到期」` }
  }
  return { version: declared, why: pkg.w3Version ? 'package.json 的 w3Version' : `package.json 没有 w3Version，回落到常量 ${FALLBACK_VERSION}（与 check-dead-exports.mjs 对齐）` }
}

/** Kept next to `check-dead-exports.mjs`'s own constant; both should move together. */
const FALLBACK_VERSION = 'v1.0'

const rel = (file) => relative(ROOT, file).split(sep).join('/')

function scan(roots) {
  const files = []
  for (const [dir, exts] of roots) {
    for (const file of collectFiles(join(ROOT, dir), exts)) {
      const path = rel(file)
      if (SKIP_DIRS.some((skip) => path.startsWith(`${skip}/`))) continue
      files.push(file)
    }
  }
  return files
}

/** Every marker occurrence in `files`, parsed or refused. */
function findExceptions(files) {
  const found = []
  const prose = []
  for (const file of files) {
    const path = rel(file)
    const lines = readFileSync(file, 'utf8').split(/\r?\n/)
    for (let i = 0; i < lines.length; i++) {
      if (!lines[i].includes('CONSTITUTION-EXCEPTION')) continue
      if (!lines[i].includes(ANCHOR)) {
        // The bare word without its colon. Prose, or a typo — the declared table decides.
        prose.push({ path, line: i + 1, text: lines[i].trim() })
        continue
      }
      const m = EXCEPTION_RE.exec(lines[i])
      found.push({ path, line: i + 1, text: lines[i].trim(), match: m })
    }
  }
  return { found, prose }
}

function verdict(files, current, { checkProseSet = true } = {}) {
  const problems = []
  const { found, prose } = findExceptions(files)

  // Prose mentions: set equality, not "the regex happened to miss it".
  for (const site of prose) {
    if (PROSE_SITES.has(site.path)) continue
    problems.push(`${site.path}:${site.line}  出现 CONSTITUTION-EXCEPTION 但没有冒号，既不是一条例外也没有登记为散文说明：${site.text.slice(0, 90)}`)
  }
  // Only on a full run. `--self-test` feeds one fixture at a time, and a declared site is of
  // course absent from a file that is not it — asserting the set there would make every
  // fixture red for a reason that has nothing to do with what it is testing.
  if (checkProseSet) {
    for (const [path, why] of PROSE_SITES) {
      if (prose.some((p) => p.path === path)) continue
      problems.push(`${path}  申报的散文说明消失了（${why}）。删掉这条申报，或者查清楚它去哪了`)
    }
  }

  let due = 0
  for (const hit of found) {
    // A declared prose site is about the mechanism; its marker-shaped lines are quotations.
    if (PROSE_SITES.has(hit.path)) continue
    if (!hit.match) {
      problems.push(`${hit.path}:${hit.line}  格式解析不出来。应为 \`CONSTITUTION-EXCEPTION: <条款> · ADR-nnnn · 到期 v<x>\`，实际是：${hit.text.slice(0, 90)}`)
      continue
    }
    const [, clause, adr, rawVersion] = hit.match
    if (!clause.trim()) {
      problems.push(`${hit.path}:${hit.line}  缺 <条款> 段`)
    }
    if (!VERSION_RE.test(rawVersion)) {
      problems.push(`${hit.path}:${hit.line}  到期版本号「${rawVersion}」不成形。**缺版本号或写坏了必须红，不许静默跳过**——一条解析不出来的例外与一条不存在的例外，在「静默跳过」的实现里是同一个结果`)
      continue
    }
    if (!VERSION_LADDER.includes(rawVersion)) {
      problems.push(`${hit.path}:${hit.line}  到期版本号「${rawVersion}」不在版本阶梯上（${VERSION_LADDER.join(' / ')}）。${adr} 的这条例外没有一个机器能比较的到期日`)
      continue
    }
    if (isExpired(rawVersion, current)) {
      due++
      problems.push(`${hit.path}:${hit.line}  ${adr} 的例外已于 ${rawVersion} 到期（当前 ${current}）：${clause.trim()}。清理它，或写一条新的 ADR 把到期日往后推——不许就这么留着`)
    }
  }
  return { problems, found, prose, due }
}

/* -------------------------------------------------------------------------- */
/* --self-test                                                                 */
/* -------------------------------------------------------------------------- */

if (SELF_TEST) {
  const dir = join(ROOT, 'scripts/fixtures/expiry')
  const cases = [
    ['not-due.ts.fixture', false, '未到期（逐字复刻 ADR-0024，含版本号后的全角括号补语）'],
    ['due.ts.fixture', true, '已到期'],
    ['missing-version.ts.fixture', true, '缺到期版本号'],
    ['malformed.ts.fixture', true, '格式写错'],
    ['off-ladder.ts.fixture', true, '版本号不在阶梯上'],
  ]
  let failed = 0
  console.log('  --self-test · 五份夹具（**零真实例外的今天，夹具是这个脚本唯一的行为证据**）')
  for (const [name, shouldFail, label] of cases) {
    const { problems } = verdict([join(dir, name)], 'v1.0', { checkProseSet: false })
    const red = problems.length > 0
    const ok = red === shouldFail
    if (!ok) failed++
    console.log(`    ${ok ? '✓' : '✗'} ${label.padEnd(34)} 期望${shouldFail ? '红' : '绿'} · 实际${red ? '红' : '绿'}${red ? ` · ${problems[0].slice(problems[0].indexOf('  ') + 2, 999).slice(0, 70)}` : ''}`)
  }
  if (failed > 0) {
    console.error(`FAIL  --self-test — ${failed} 份夹具的判定与期望不符`)
    process.exit(1)
  }
  console.log('  --self-test 五种情形全部按预期')
}

/* -------------------------------------------------------------------------- */

const { version: current, why } = resolveCurrentVersion()
if (current === null) {
  console.error(`FAIL  NORTH_STAR §8 · 例外到期守卫  — ${why}`)
  process.exit(1)
}

const files = scan(SCAN_ROOTS)
const { problems, found, prose, due } = verdict(files, current)

console.log(`  扫描文件数 ${files.length} / 命中例外数 ${found.length} / 已到期数 ${due}`)
console.log(`  当前版本 ${current}（${why}）· 跳过目录 ${SKIP_DIRS.join('、')} · 散文说明申报 ${PROSE_SITES.size} 处、实测 ${prose.length} 处`)

if (files.length < MIN_FILES) {
  problems.push(`扫描面塌了：只看到 ${files.length} 个文件，下限 ${MIN_FILES}。多半是 SCAN_ROOTS 的路径写错了，不是仓库变小了——**零命中的守卫和坏掉的守卫，输出长得一模一样**`)
}

if (problems.length === 0) {
  console.log(`PASS  NORTH_STAR §8 · 例外到期守卫  (${files.length} file(s) scanned)`)
  process.exit(0)
}
console.error(`FAIL  NORTH_STAR §8 · 例外到期守卫  — ${problems.length} 处`)
for (const p of problems) console.error(`      ${p}`)
process.exit(1)
