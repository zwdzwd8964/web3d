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
  it('SCHEMA_SPEC §12, migrated to today’s version, matches createGoldenPathDocument()', () => {
    // The fixture is frozen at v1 (append-only) while the builder tracks CURRENT_VERSION,
    // so the two are now related BY THE MIGRATION rather than by transcription. Which
    // makes this a stronger assertion than it was: it says the v1 -> v2 migration produces
    // exactly the document the code claims v2 looks like, field for field.
    //
    // If they ever diverge, every consumer of the builder (core ECA tests, player parity,
    // the editor sample project) is testing a different scene than the fixture suite is.
    const onDisk = JSON.parse(readFileSync(join(FIXTURE_ROOT, 'v1/golden-path.json'), 'utf8'))
    const migrated = migrate(onDisk)
    expect(migrated.ok, migrated.ok ? '' : JSON.stringify(migrated.error, null, 2)).toBe(true)
    if (!migrated.ok) return
    expect(JSON.parse(JSON.stringify(migrated.value.document))).toEqual(
      JSON.parse(JSON.stringify(createGoldenPathDocument())),
    )
  })

  it('the v1 fixture on disk is still a v1 document — append-only means never edited', () => {
    // The failure this guards is subtle and fatal: "fixing up" a historical fixture so it
    // satisfies the current schema makes the C4 suite green while proving nothing at all.
    // A v1 file that no longer declares v1, or that has grown v2 fields, has been edited.
    const onDisk = JSON.parse(readFileSync(join(FIXTURE_ROOT, 'v1/golden-path.json'), 'utf8'))
    expect(onDisk.schemaVersion).toBe(1)
    expect(onDisk.meta.environment, 'v1 文档不该有 environment —— 这份 fixture 被改过').toBeUndefined()
    for (const node of onDisk.nodes) {
      expect(node.primitive, 'v1 节点不该有 primitive —— 这份 fixture 被改过').toBeUndefined()
      expect(node.light).toBeUndefined()
    }
  })
})
