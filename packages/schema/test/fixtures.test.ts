import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { CURRENT_VERSION } from '../src/document.js'
import { checkIntegrity, errorsOf } from '../src/integrity.js'
import { migrate } from '../src/migrate.js'
import { createGoldenPathDocument } from '../src/samples.js'

/**
 * T-018 · gate G0-3, constitution C4.
 *
 * One real document per historical schema version lives under test/fixtures/v<N>/.
 * These files are APPEND-ONLY: adding is fine, editing or deleting is not. The moment a
 * fixture is "fixed up" to satisfy a new schema, this suite stops proving anything —
 * which is exactly how anti-pattern A4 slips through.
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
      if (file.endsWith('.json')) out.push({ version: Number(m[1]), name: `${dir}/${file}`, path: join(full, file) })
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

const fixtures = collectFixtures()

describe('schema fixtures', () => {
  it('there is at least one fixture for every shipped schema version', () => {
    const versions = new Set(fixtures.map((f) => f.version))
    for (let v = 1; v <= CURRENT_VERSION; v++) {
      expect(versions.has(v), `no fixture for schemaVersion ${v} — C4 cannot be proven`).toBe(true)
    }
  })

  it.each(fixtures.map((f) => [f.name, f] as const))('%s migrates, validates and resolves', (_name, fixture) => {
    const raw = JSON.parse(readFileSync(fixture.path, 'utf8'))

    // The directory must agree with what the file says about itself.
    expect(raw.schemaVersion).toBe(fixture.version)

    const migrated = migrate(raw)
    expect(migrated.ok, migrated.ok ? '' : JSON.stringify(migrated.error, null, 2)).toBe(true)
    if (!migrated.ok) return
    expect(migrated.value.toVersion).toBe(CURRENT_VERSION)

    const issues = checkIntegrity(migrated.value.document)
    const errors = errorsOf(issues)
    expect(errors, `${fixture.name}: ${errors.map((e) => `${e.path} ${e.message}`).join('; ')}`).toHaveLength(0)
  })

  it.each(fixtures.filter((f) => f.version === CURRENT_VERSION).map((f) => [f.name, f] as const))(
    '%s round-trips byte-identically',
    (_name, fixture) => {
      const raw = JSON.parse(readFileSync(fixture.path, 'utf8'))
      const migrated = migrate(raw)
      expect(migrated.ok).toBe(true)
      if (!migrated.ok) return
      expect(JSON.parse(JSON.stringify(migrated.value.document))).toEqual(raw)
    },
  )
})

describe('the golden path fixture and the in-code sample are one document', () => {
  it('SCHEMA_SPEC §12 transcription matches createGoldenPathDocument() exactly', () => {
    const onDisk = JSON.parse(readFileSync(join(FIXTURE_ROOT, 'v1/golden-path.json'), 'utf8'))
    // If these ever diverge, every consumer that uses the builder (core ECA tests,
    // player parity, the editor sample project) is testing a different scene than the
    // fixture regression suite is.
    expect(onDisk).toEqual(JSON.parse(JSON.stringify(createGoldenPathDocument())))
  })
})
