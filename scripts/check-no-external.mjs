#!/usr/bin/env node
/**
 * Constitution C6 · zero external runtime dependencies.
 *
 * Scans every text artefact under each package's build output for absolute URLs.
 * A single `<link href="https://fonts.googleapis...">` is a white screen on a
 * customer intranet, and it is always found on go-live day (anti-pattern A7).
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

const TEXT_EXT = ['.js', '.mjs', '.cjs', '.css', '.html', '.json', '.map', '.svg', '.webmanifest', '.d.ts']

/**
 * URLs that cannot cause a runtime request. Every entry is a hole in the guard,
 * so each one states why it is inert. Keep this list short.
 */
const ALLOWED = [
  // Tooling metadata in .json / .map files — never fetched by the app.
  /^https?:\/\/json\.schemastore\.org\//,
  // XML namespace identifiers in inline SVG. Namespaces are names, not addresses.
  /^https?:\/\/www\.w3\.org\/(2000\/svg|1999\/xhtml|1999\/xlink)/,
  // Homepage / license URLs inside dependency banner comments.
  /^https?:\/\/(www\.)?(threejs\.org|github\.com|opensource\.org|unlicense\.org|zod\.dev)\//,
]

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

for (const dir of present) {
  const files = walkDist(join(ROOT, dir))
  report.filesScanned += files.length
  for (const file of files) {
    const lines = readFileSync(file, 'utf8').split('\n')
    for (let i = 0; i < lines.length; i++) {
      URL_RE.lastIndex = 0
      let m
      while ((m = URL_RE.exec(lines[i])) !== null) {
        if (ALLOWED.some((re) => re.test(m[0]))) continue
        report.add(file, i + 1, `external URL in build output: ${m[0].slice(0, 120)}`)
      }
    }
  }
}

process.exit(printReport(report, ROOT))
