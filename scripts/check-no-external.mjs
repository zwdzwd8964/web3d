#!/usr/bin/env node
/**
 * Constitution C6 · zero external runtime dependencies.
 *
 * Two passes, because they answer different questions.
 *
 * **Pass 1 — fetchable positions. Zero tolerance, no allowlist.**
 * A URL in a `<link href>`, `<script src>`, CSS `url()`, `@import` or a literal
 * `fetch()`/`import()` argument *will* hit the network. Anti-pattern A7 is exactly this:
 * `<link href="https://fonts.googleapis…">`, which is a white screen on a customer
 * intranet and is always found on go-live day. Nothing may be excused here.
 *
 * **Pass 2 — any absolute URL anywhere. Allowlisted by category.**
 * A broad string scan catches things pass 1 cannot see (a URL assembled at runtime, a
 * decoder path). But real dependencies mention URLs constantly — XML namespace
 * identifiers, JSON Schema `$id`s, links in error messages and regex comments — and none
 * of those fetch anything. Failing on them would get this guard disabled or
 * blanket-allowlisted within a week, which is worse than a categorised allowlist.
 *
 * Usage:
 *   node scripts/check-no-external.mjs                  # fail if nothing is built yet
 *   node scripts/check-no-external.mjs --allow-missing  # report SKIPPED instead
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { makeReport, printReport } from './lib/scan.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const ALLOW_MISSING = process.argv.includes('--allow-missing')

const OUT_DIRS = [
  'packages/schema/dist',
  'packages/storage/dist',
  'packages/core/dist',
  'packages/editor/dist',
  'packages/player/dist',
]

/**
 * `.map` is deliberately absent.
 *
 * A source map is a development artefact: the app never fetches it, and a browser only
 * requests it with devtools open, same-origin. But it embeds every dependency's ORIGINAL
 * source, comments included — three.js alone cites a dozen Wikipedia articles in its
 * maths. Scanning maps buries the signal under other people's comments, which is how a
 * guard stops being read.
 */
const TEXT_EXT = ['.js', '.mjs', '.cjs', '.css', '.html', '.json', '.svg', '.webmanifest', '.d.ts']

/* -------------------------------------------------------------------------- */
/* Pass 1 — positions that actually cause a request                           */
/* -------------------------------------------------------------------------- */

const FETCHABLE = [
  [/<link\b[^>]*\bhref\s*=\s*["']?(https?:\/\/[^"'\s>]+)/i, 'a <link> pointing off-origin'],
  [/<script\b[^>]*\bsrc\s*=\s*["']?(https?:\/\/[^"'\s>]+)/i, 'a <script> pointing off-origin'],
  [/<img\b[^>]*\bsrc\s*=\s*["']?(https?:\/\/[^"'\s>]+)/i, 'an <img> pointing off-origin'],
  [/@import\s+(?:url\()?\s*["']?(https?:\/\/[^"')\s;]+)/i, 'a CSS @import from off-origin'],
  [/\burl\(\s*["']?(https?:\/\/[^"')\s]+)/i, 'a CSS url() pointing off-origin'],
  [/\bfetch\(\s*["'](https?:\/\/[^"']+)["']/i, 'a literal fetch() to an absolute URL'],
  [/\bimport\(\s*["'](https?:\/\/[^"']+)["']/i, 'a dynamic import from an absolute URL'],
  [/\bnew\s+(?:Worker|EventSource|WebSocket)\(\s*["'](\w+:\/\/[^"']+)["']/i, 'a worker/socket at an absolute URL'],
]

/* -------------------------------------------------------------------------- */
/* Pass 2 — every absolute URL, with categorised exemptions                    */
/* -------------------------------------------------------------------------- */

/**
 * Each entry states the category and why it cannot cause a request. Adding one is a
 * deliberate act: it widens a constitutional guard.
 */
const INERT = [
  // XML namespace URIs. Names, not addresses — no parser fetches them.
  [/^https?:\/\/www\.w3\.org\/(XML\/1998|1998\/Math|2000\/svg|1999\/xhtml|1999\/xlink)/, 'XML namespace identifier'],
  // JSON Schema dialect ids, emitted by zod's toJSONSchema and by tsconfig metadata.
  [/^https?:\/\/(json-schema\.org|json\.schemastore\.org)\//, 'JSON Schema dialect id'],
  // Links inside error messages and code comments shipped by dependencies.
  [/^https?:\/\/(react\.dev|developer\.mozilla\.org|stackoverflow\.com|blog\.stevenlevithan\.com|thekevinscott\.com)\//, 'documentation link in a message or comment'],
  [/^https?:\/\/bit\.ly\//, 'shortened documentation link in a dependency comment'],
  // Paper and reference citations in dependency comments (three cites its maths).
  [/^https?:\/\/(en\.wikipedia\.org|jcgt\.org|www\.w3\.org\/TR\/)/, 'specification or paper citation in a comment'],
  // RFC 2606 reserves `.example`; it can never resolve. gltf-transform uses it as the
  // sentinel base for resolving relative asset paths.
  [/^https?:\/\/[^/]*\.(example|invalid|test)(\/|$)/, 'RFC 2606 reserved host used as a sentinel'],
  // Homepage / licence URLs in banner comments.
  [/^https?:\/\/(www\.)?(threejs\.org|github\.com|opensource\.org|unlicense\.org|zod\.dev)\//, 'licence or homepage banner'],
]

/** A template placeholder cannot be a literal address — it is URL-building code. */
const isTemplateFragment = (url) => url.includes('${')

function inertReason(url) {
  for (const [pattern, reason] of INERT) if (pattern.test(url)) return reason
  return null
}

const URL_RE = /\bhttps?:\/\/[^\s"'`)\\<>\]}]+/g

/** dist/ is excluded by the shared collector by design; here it is the target. */
function walkDist(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walkDist(full, out)
    else if (TEXT_EXT.some((e) => full.endsWith(e))) out.push(full)
  }
  return out
}

const report = makeReport('no external runtime dependency', 'C6')

const present = OUT_DIRS.filter((d) => existsSync(join(ROOT, d)) && statSync(join(ROOT, d)).isDirectory())

if (present.length === 0) {
  if (ALLOW_MISSING) {
    console.log('SKIP  C6 · no external runtime dependency — nothing built yet (run `pnpm build` first)')
    process.exit(0)
  }
  console.error('FAIL  C6 · no external runtime dependency — nothing built yet. Run `pnpm build` first.')
  process.exit(1)
}

report.note(`checked build output of: ${present.map((d) => d.split('/')[1]).join(', ')}`)
const absent = OUT_DIRS.filter((d) => !present.includes(d))
if (absent.length > 0) {
  // Never let an unbuilt package read as "clean".
  report.note(`NOT built, therefore NOT checked: ${absent.map((d) => d.split('/')[1]).join(', ')}`)
}

const exempted = new Map()

for (const dir of present) {
  for (const file of walkDist(join(ROOT, dir))) {
    const lines = readFileSync(file, 'utf8').split('\n')
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]

      // Pass 1 — no excuses.
      for (const [pattern, why] of FETCHABLE) {
        const match = pattern.exec(line)
        if (match) report.add(file, i + 1, `${why}: ${match[1].slice(0, 100)}`)
      }

      // Pass 2 — categorised.
      URL_RE.lastIndex = 0
      let m
      while ((m = URL_RE.exec(line)) !== null) {
        const url = m[0]
        if (isTemplateFragment(url)) continue
        const reason = inertReason(url)
        if (reason) {
          exempted.set(reason, (exempted.get(reason) ?? 0) + 1)
          continue
        }
        report.add(file, i + 1, `external URL in build output: ${url.slice(0, 120)}`)
      }
    }
    report.filesScanned++
  }
}

// Print what was excused, so an allowlist that is quietly doing heavy lifting is visible.
for (const [reason, count] of [...exempted].sort((a, b) => b[1] - a[1])) {
  report.note(`exempt (${count}×): ${reason}`)
}

process.exit(printReport(report, ROOT))
