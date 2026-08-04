#!/usr/bin/env node
/**
 * T-105 · the player's size budget.
 *
 * MVP_V0 puts the player at gzip <= 400 KB excluding assets and the vendored decoders.
 * That number is not decoration: this product ships onto customer intranets, sometimes
 * over a VPN, and the first impression is how long a blank page lasts.
 *
 * Written by hand rather than with `size-limit`. The measurement is `gzipSync` over the
 * emitted files and a subtraction — about forty lines — while the package would be a
 * ~20 MB devDependency carrying its own bundler. That trade is only worth making for
 * something this file cannot do, and there is nothing here it cannot do. Deviation from
 * the card's wording is registered in IMPL_NOTES §3.
 *
 * Usage:
 *   node scripts/check-size-budget.mjs             check the player against its budget
 *   node scripts/check-size-budget.mjs --json      machine-readable, for METRICS
 */

import { gzipSync } from 'node:zlib'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))

/** gzip level 9, matching what a static file server serves precompressed. */
const gzipOf = (bytes) => gzipSync(bytes, { level: 9 }).byteLength

/**
 * T-208 · the budget moved out of this file and into `size-budget.json`.
 *
 * **The guard around it is not optional.** A budget read from a file that has been deleted or
 * renamed would leave `budgetBytes` undefined, and `total <= undefined` is `false`… which
 * fails loudly. `total > undefined` is also false — so whether a missing budget file reads as
 * pass or fail depends on which way the comparison happens to be written. That is exactly the
 * kind of accident this file's own header warns about, so it is refused outright instead.
 */
const BUDGET_FILE = join(ROOT, 'size-budget.json')
if (!existsSync(BUDGET_FILE)) {
  console.error('FAIL  size budget — size-budget.json 不存在。预算文件缺失时本脚本拒绝给出结论。')
  process.exit(1)
}
const BUDGET = JSON.parse(readFileSync(BUDGET_FILE, 'utf8'))
if (typeof BUDGET.player !== 'number' || BUDGET.unit !== 'KB-gzip') {
  console.error(`FAIL  size budget — size-budget.json 形状不对（要 { "player": <number>, "unit": "KB-gzip" }）`)
  process.exit(1)
}

const TARGETS = [
  {
    name: '@w3/player',
    dist: 'packages/player/dist',
    budgetBytes: BUDGET.player * 1024,
    /**
     * Excluded by what a file IS, never by which directory it landed in.
     *
     * The directory is the trap: Vite emits the main bundle into `dist/assets/` too, so
     * an `^assets/` rule drops `index-*.js` and the check passes while measuring nothing
     * but `index.html`. That is exactly the vacuous green this repo has been burned by
     * once already, so the rule is written against filenames.
     *
     *   draco / basis / ktx2   self-hosted decoders (C6). Fetched lazily and only when a
     *                          model actually uses that compression, so counting them
     *                          would make the budget describe a page nobody loads.
     *   .map                   never sent to a browser that is not debugging.
     *   .w3p / .glb / .bin     scene content, not code.
     */
    exclude: [
      /(^|\/)(draco|basis|ktx2)[\w.-]*\.(js|wasm)$/i,
      /\.map$/,
      /\.(w3p|glb|gltf|ktx2|bin)$/i,
      /**
       * T-208 · dot-files. Vite copies `public/` into `dist/` verbatim, dot-files included,
       * so `packages/player/public/.gitignore` (133 gzip bytes, a note about where the E2E
       * writes its `.w3p`) has been counted as part of the code budget all along.
       *
       * **By filename, not by directory** — the card says so and the reason is written above:
       * an `^assets/` style rule would drop the main bundle and leave the check measuring
       * `index.html`. A dot-file is not code in any directory.
       */
      /(^|\/)\.[\w.-]+$/,
    ],
  },
]

function walk(dir, base = dir) {
  const out = []
  let entries
  try {
    entries = readdirSync(dir)
  } catch {
    return out
  }
  for (const entry of entries) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...walk(full, base))
    else out.push({ path: relative(base, full), full })
  }
  return out
}

const json = process.argv.includes('--json')
const report = []
let failed = false

for (const target of TARGETS) {
  const dir = join(ROOT, target.dist)
  const files = walk(dir)

  if (files.length === 0) {
    // Not built is not the same as within budget, and reporting a pass here would be the
    // "假绿灯" the evaluation report called out.
    const message = `${target.name}: 未构建（${target.dist} 为空）。先跑 pnpm build。`
    if (json) report.push({ name: target.name, built: false })
    else console.error(`FAIL  ${message}`)
    failed = true
    continue
  }

  const counted = files.filter((f) => !target.exclude.some((re) => re.test(f.path.split(sep).join('/'))))
  const rows = counted
    .map((f) => {
      const bytes = readFileSync(f.full)
      return { path: f.path.split(sep).join('/'), raw: bytes.byteLength, gzip: gzipOf(bytes) }
    })
    .sort((a, b) => b.gzip - a.gzip)

  const totalGzip = rows.reduce((n, r) => n + r.gzip, 0)
  const totalRaw = rows.reduce((n, r) => n + r.raw, 0)
  const ok = totalGzip <= target.budgetBytes
  if (!ok) failed = true

  if (json) {
    report.push({
      name: target.name,
      built: true,
      ok,
      budgetBytes: target.budgetBytes,
      totalGzip,
      totalRaw,
      files: rows,
      excluded: files.length - counted.length,
    })
  } else {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${target.name} · gzip ${kb(totalGzip)} / ${kb(target.budgetBytes)}`)
    console.log(`      未压缩 ${kb(totalRaw)} · 计入 ${rows.length} 个文件 · 排除 ${files.length - counted.length} 个（vendor / assets / sourcemap）`)
    for (const row of rows.slice(0, 8)) {
      console.log(`      ${kb(row.gzip).padStart(9)}  ${row.path}`)
    }
    if (rows.length > 8) console.log(`      … 其余 ${rows.length - 8} 个文件`)
    if (!ok) {
      console.log(`      超出 ${kb(totalGzip - target.budgetBytes)}。`)
      console.log('      先看上面最大的那个文件：多半是某个依赖被整包打进来了。')
    }
  }
}

if (json) console.log(JSON.stringify(report, null, 2))
process.exit(failed ? 1 : 0)

function kb(bytes) {
  return `${(bytes / 1024).toFixed(1)} KB`
}
