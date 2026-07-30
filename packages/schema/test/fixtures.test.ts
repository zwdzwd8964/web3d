import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { CURRENT_SCHEMA_VERSION } from '../src/document.js'
import { checkIntegrity } from '../src/integrity.js'
import { migrate } from '../src/migrate.js'

/**
 * Gate G0-3 · constitution C4.
 *
 * One real document per historical schema version lives under test/fixtures/v<N>/.
 * These files are APPEND-ONLY: adding is fine, editing or deleting is not. The moment
 * a fixture is "fixed up" to satisfy a new schema, this suite stops proving anything —
 * which is exactly how anti-pattern A4 gets through unnoticed.
 *
 * Every fixture must migrate to the current version, validate, and be free of
 * integrity errors.
 */

const FIXTURE_ROOT = fileURLToPath(new URL('./fixtures', import.meta.url))

interface Fixture {
  version: number
  name: string
  path: string
}

function collectFixtures(): Fixture[] {
  const out: Fixture[] = []
  for (const dir of readdirSync(FIXTURE_ROOT)) {
    const full = join(FIXTURE_ROOT, dir)
    if (!statSync(full).isDirectory()) continue
    const m = /^v(\d+)$/.exec(dir)
    if (!m) throw new Error(`fixture directory must be named v<N>, got "${dir}"`)
    for (const file of readdirSync(full)) {
      if (!file.endsWith('.json')) continue
      out.push({ version: Number(m[1]), name: `${dir}/${file}`, path: join(full, file) })
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

const fixtures = collectFixtures()

describe('schema fixtures (C4 · G0-3)', () => {
  it('there is at least one fixture per shipped schema version', () => {
    const versions = new Set(fixtures.map((f) => f.version))
    for (let v = 1; v <= CURRENT_SCHEMA_VERSION; v++) {
      expect(versions.has(v), `no fixture for schemaVersion ${v} — C4 cannot be proven`).toBe(true)
    }
  })

  it.each(fixtures.map((f) => [f.name, f] as const))('%s opens in the current build', (_name, fixture) => {
    const raw = JSON.parse(readFileSync(fixture.path, 'utf8'))

    // The file's directory must agree with what it says about itself.
    expect(raw.schemaVersion).toBe(fixture.version)

    const result = migrate(raw)
    expect(result.toVersion).toBe(CURRENT_SCHEMA_VERSION)

    const integrity = checkIntegrity(result.document)
    expect(integrity.errors, `${fixture.name}: ${integrity.errors.map((e) => e.message).join('; ')}`).toHaveLength(0)
  })

  it.each(fixtures.map((f) => [f.name, f] as const))('%s re-serialises byte-identically after a round trip', (_name, fixture) => {
    const raw = JSON.parse(readFileSync(fixture.path, 'utf8'))
    const { document } = migrate(raw)
    // Only meaningful for fixtures already at the current version: a migrated
    // document is expected to differ from its on-disk ancestor.
    if (fixture.version === CURRENT_SCHEMA_VERSION) {
      expect(JSON.parse(JSON.stringify(document))).toEqual(raw)
    }
  })
})
