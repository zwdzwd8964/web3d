#!/usr/bin/env node
/**
 * Gate G0-2 · run every mechanical constitution guard and report one verdict.
 *
 * NORTH_STAR §2: "没有检查手段的约束等于没有约束." What is checkable is checked here.
 * What is not checkable by a script is listed at the bottom under UNCHECKED, so
 * that a green run never reads as "all nine articles verified".
 *
 * Usage: node scripts/check-constitution.mjs [--require-build]
 */
import { spawnSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const REQUIRE_BUILD = process.argv.includes('--require-build')

const GUARDS = [
  { article: 'C2 + C8 + C5', script: 'check-core-purity.mjs', args: [], what: 'core is framework-agnostic; ECA is deterministic; executor has no type branches' },
  { article: 'C7', script: 'check-storage-abstraction.mjs', args: [], what: 'no concrete storage outside @w3/storage' },
  { article: 'MVP §3', script: 'check-deps-direction.mjs', args: [], what: 'package dependency graph has no reverse edges' },
  { article: 'C6', script: 'check-no-external.mjs', args: REQUIRE_BUILD ? [] : ['--allow-missing'], what: 'no external URL in build output' },
  { article: 'C6', script: 'sync-vendor.mjs', args: ['--check'], what: 'Draco / KTX2 decoders are vendored and match the locked three' },
  // v0.5 · T-173. The built-in library is content that ships WITH the app, so every file it
  // names is a C6 surface: one `https://` in a manifest entry and an air-gapped deployment
  // shows a broken tile. The licence field is enforced by the same script (D17 · 版权风险 V1),
  // because content nobody can account for is a legal problem, not a rendering one.
  { article: 'C6 + D17', script: 'check-library-manifest.mjs', args: [], what: 'built-in library manifest: no external URL, every item licensed, within budget' },
  // v1.0 · T-205. The fourteenth recurrence of "written, unit-tested, never wired up" is what
  // bought this line. Coverage cannot see the shape (all fourteen had tests), and typecheck
  // and lint both count a reference from a test as a use — so it had to become a machine.
  { article: 'C5 + D36', script: 'check-dead-exports.mjs', args: [], what: 'every exported symbol and public member has a production caller, an owner, or a baseline row' },
]

/** Articles no script can prove. Printed on every run so the gap stays visible. */
const UNCHECKED = [
  ['C1', 'single source of truth', 'PR review: "which document field holds this feature\'s state?"'],
  ['C3', 'one core, two views', '`pnpm test:parity` — state-trace equality between editor preview and player'],
  ['C4', 'schema forward compatibility', '`pnpm -F @w3/schema test` — every historical fixture still migrates + validates'],
  ['C8', 'engine testable without a GPU', 'ECA unit tests run in plain Node; 100% registered-action coverage'],
  ['C9', 'stable IDs are the only key', 'Zod ID format + checkIntegrity() dangling-reference scan'],
]

console.log('=== Constitution check (G0-2) ===\n')

let failed = 0
for (const g of GUARDS) {
  const r = spawnSync(process.execPath, [join(ROOT, 'scripts', g.script), ...g.args], {
    cwd: ROOT,
    encoding: 'utf8',
  })
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`.trimEnd()
  if (out) console.log(out)
  if (r.status !== 0) failed++
  console.log('')
}

console.log('--- UNCHECKED here (verified elsewhere) ---')
for (const [id, name, how] of UNCHECKED) {
  console.log(`  ${id.padEnd(3)} ${name.padEnd(34)} -> ${how}`)
}
console.log('')

if (failed > 0) {
  console.error(`=== CONSTITUTION: FAIL (${failed} guard(s) failed) ===`)
  process.exit(1)
}
console.log('=== CONSTITUTION: PASS ===')
