#!/usr/bin/env node
/**
 * Constitution C6 · zero external runtime dependencies.
 *
 * Draco and KTX2/Basis decoders are WASM blobs that three.js does NOT bundle into
 * its module graph — the loaders fetch them at runtime. The three.js examples fetch
 * them from a CDN. On a customer intranet that is a white screen, and it is always
 * discovered on go-live day (anti-pattern A7).
 *
 * So we copy them out of the locked `three` dependency into vendor/, commit them,
 * and serve them from our own origin. Source is a pinned dependency, never the network,
 * which keeps `--offline` builds honest.
 *
 * Run: node scripts/sync-vendor.mjs [--check]
 *   --check  verify vendor/ is in sync with the installed three, exit 1 if not
 */
import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const CHECK_ONLY = process.argv.includes('--check')

/** @type {{ from: string, to: string, label: string }[]} */
const COPIES = [
  { from: 'examples/jsm/libs/draco', to: 'vendor/draco', label: 'Draco decoder' },
  { from: 'examples/jsm/libs/basis', to: 'vendor/basis', label: 'KTX2 / Basis transcoder' },
]

function findThreeRoot() {
  // Resolve through the workspace, not through hoisting: @w3/core is the declared owner.
  const candidates = [
    join(ROOT, 'packages/core/node_modules/three'),
    join(ROOT, 'node_modules/three'),
  ]
  for (const c of candidates) if (existsSync(join(c, 'package.json'))) return c
  const pnpmDir = join(ROOT, 'node_modules/.pnpm')
  if (existsSync(pnpmDir)) {
    const hit = readdirSync(pnpmDir).find((d) => /^three@/.test(d))
    if (hit) {
      const p = join(pnpmDir, hit, 'node_modules/three')
      if (existsSync(join(p, 'package.json'))) return p
    }
  }
  return null
}

function walk(dir, base = dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, base, out)
    else out.push(relative(base, full).split('\\').join('/'))
  }
  return out
}

const sha1 = (buf) => createHash('sha1').update(buf).digest('hex')

const threeRoot = findThreeRoot()
if (!threeRoot) {
  console.error('[sync-vendor] three.js not found. Run `pnpm install` first.')
  process.exit(1)
}
const threeVersion = JSON.parse(readFileSync(join(threeRoot, 'package.json'), 'utf8')).version

let drift = 0
let copied = 0

for (const { from, to, label } of COPIES) {
  const src = join(threeRoot, from)
  const dst = join(ROOT, to)
  if (!existsSync(src)) {
    console.error(`[sync-vendor] missing in three@${threeVersion}: ${from}`)
    process.exit(1)
  }

  if (CHECK_ONLY) {
    if (!existsSync(dst)) {
      console.error(`[sync-vendor] MISSING  ${to}  (${label})`)
      drift++
      continue
    }
    const srcFiles = walk(src).sort()
    const dstFiles = walk(dst).filter((f) => f !== 'VENDOR.md').sort()
    const same =
      srcFiles.length === dstFiles.length &&
      srcFiles.every(
        (f, i) => f === dstFiles[i] && sha1(readFileSync(join(src, f))) === sha1(readFileSync(join(dst, f))),
      )
    if (!same) {
      console.error(`[sync-vendor] DRIFT    ${to}  (differs from three@${threeVersion})`)
      drift++
    } else {
      console.log(`[sync-vendor] ok       ${to}`)
    }
    continue
  }

  rmSync(dst, { recursive: true, force: true })
  mkdirSync(dst, { recursive: true })
  cpSync(src, dst, { recursive: true })
  const n = walk(dst).length
  copied += n
  console.log(`[sync-vendor] copied ${String(n).padStart(3)} file(s)  ${from} -> ${to}   (${label})`)
}

if (CHECK_ONLY) {
  if (drift > 0) {
    console.error(`\n[sync-vendor] vendor/ is out of sync with three@${threeVersion}.`)
    console.error('              Run: node scripts/sync-vendor.mjs')
    process.exit(1)
  }
  console.log(`\n[sync-vendor] vendor/ matches three@${threeVersion}.`)
  process.exit(0)
}

console.log(`\n[sync-vendor] ${copied} file(s) vendored from three@${threeVersion}.`)
