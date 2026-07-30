import { describe, expect, it } from 'vitest'
import { CURRENT_VERSION } from '../src/document.js'
import type { Migration } from '../src/migrate.js'
import { MIGRATIONS, applyMigrationChain, migrate, needsMigration } from '../src/migrate.js'
import { createGoldenPathDocument } from '../src/samples.js'

/**
 * T-013 · SCHEMA_SPEC §10, constitution C4.
 *
 * The shipped chain is empty at schemaVersion 1, so the *machinery* is driven here with
 * a synthetic chain and an injected target version. Without that seam the first real
 * migration written for v1 would also be the first execution of this loop — on a
 * customer's document, during their trial period.
 */
const syntheticChain: Migration[] = [
  {
    from: 1,
    to: 2,
    describe: 'move meta.background.color to meta.background.hex',
    up: (doc) => {
      const meta = doc.meta as Record<string, any>
      const { color, ...rest } = meta.background as Record<string, unknown>
      return { ...doc, meta: { ...meta, background: { ...rest, hex: color } } }
    },
  },
  {
    from: 2,
    to: 3,
    describe: 'add meta.locale',
    up: (doc) => ({ ...doc, meta: { ...(doc.meta as object), locale: 'zh-CN' } }),
  },
]

const unwrap = <T, E>(r: { ok: true; value: T } | { ok: false; error: E }): T => {
  if (!r.ok) throw new Error(`expected ok, got ${JSON.stringify(r.error)}`)
  return r.value
}

describe('migrate()', () => {
  it('passes a current-version document through unchanged', () => {
    const doc = createGoldenPathDocument()
    const result = unwrap(migrate(doc))
    expect(result.fromVersion).toBe(CURRENT_VERSION)
    expect(result.toVersion).toBe(CURRENT_VERSION)
    expect(result.applied).toEqual([])
    expect(result.document).toEqual(doc)
  })

  it('does not mutate its input', () => {
    const doc = createGoldenPathDocument()
    const before = JSON.stringify(doc)
    migrate(doc)
    expect(JSON.stringify(doc)).toBe(before)
  })

  it('is an identity function at v1, and that is asserted rather than assumed', () => {
    expect(CURRENT_VERSION).toBe(1)
    expect(MIGRATIONS).toHaveLength(0)
  })

  it('needsMigration is false at the current version and for malformed input', () => {
    expect(needsMigration(createGoldenPathDocument())).toBe(false)
    expect(needsMigration({})).toBe(false)
    expect(needsMigration(null)).toBe(false)
  })

  it('refuses a document from the future rather than dropping fields', () => {
    const r = migrate({ ...createGoldenPathDocument(), schemaVersion: CURRENT_VERSION + 5 })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error.kind).toBe('from-the-future')
    expect(r.error.message).toMatch(/newer than this build/)
  })

  it('reports malformed input as a result, never as a thrown exception', () => {
    for (const bad of [{}, { schemaVersion: '1' }, { schemaVersion: 0 }, { schemaVersion: 1.5 }, null, [], '{}']) {
      const r = migrate(bad)
      expect(r.ok, JSON.stringify(bad)).toBe(false)
      if (!r.ok) expect(r.error.kind).toBe('malformed')
    }
  })

  it('reports a structurally invalid document with the underlying validation errors', () => {
    const r = migrate({ schemaVersion: 1 })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error.kind).toBe('invalid-result')
    expect(r.error.validation?.length).toBeGreaterThan(0)
  })

  describe('the chain, driven with a synthetic set of migrations', () => {
    const opts = { migrations: syntheticChain, targetVersion: 3 }

    it('walks every step in order and records what it applied', () => {
      const result = unwrap(applyMigrationChain(createGoldenPathDocument(), opts))
      expect(result.fromVersion).toBe(1)
      expect(result.toVersion).toBe(3)
      expect(result.applied).toEqual([
        'v1 -> v2: move meta.background.color to meta.background.hex',
        'v2 -> v3: add meta.locale',
      ])
      const meta = result.raw.meta as Record<string, any>
      expect(meta.background).toEqual({ type: 'color', hex: '#1a1a1a' })
      expect(meta.locale).toBe('zh-CN')
      expect(result.raw.schemaVersion).toBe(3)
    })

    it('starts mid-chain when the document is already partly migrated', () => {
      const result = unwrap(applyMigrationChain({ schemaVersion: 2, meta: { background: {} } }, opts))
      expect(result.fromVersion).toBe(2)
      expect(result.applied).toEqual(['v2 -> v3: add meta.locale'])
    })

    it('the chain’s output is still validated by migrate() — nothing is trusted', () => {
      // The synthetic chain intentionally produces a shape v1 does not accept.
      const r = migrate(createGoldenPathDocument(), opts)
      expect(r.ok).toBe(false)
      if (r.ok) return
      expect(r.error.kind).toBe('invalid-result')
      expect(r.error.validation?.some((v) => v.path === 'meta.background')).toBe(true)
    })

    it('names a gap in the chain as anti-pattern A4', () => {
      const r = applyMigrationChain({ schemaVersion: 1 }, { migrations: [syntheticChain[1]!], targetVersion: 3 })
      expect(r.ok).toBe(false)
      if (r.ok) return
      expect(r.error.kind).toBe('missing-step')
      expect(r.error.message).toMatch(/no migration registered from schemaVersion 1 to 2/)
      expect(r.error.message).toMatch(/anti-pattern A4/)
    })

    it('rejects a migration entry that skips a version', () => {
      const bad: Migration[] = [{ from: 1, to: 3, describe: 'skips v2', up: (d) => d }]
      const r = applyMigrationChain({ schemaVersion: 1 }, { migrations: bad, targetVersion: 3 })
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.error.message).toMatch(/single step/)
    })

    it('rejects two migrations registered from the same version', () => {
      const dupes: Migration[] = [
        { from: 1, to: 2, describe: 'a', up: (d) => d },
        { from: 1, to: 2, describe: 'b', up: (d) => d },
      ]
      const r = applyMigrationChain({ schemaVersion: 1 }, { migrations: dupes, targetVersion: 2 })
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.error.message).toMatch(/two migrations/)
    })

    it('does no work when the document is already at the target version', () => {
      const result = unwrap(applyMigrationChain(createGoldenPathDocument(), { migrations: syntheticChain }))
      expect(result.applied).toEqual([])
      expect(result.raw).toEqual(JSON.parse(JSON.stringify(createGoldenPathDocument())))
    })

    it('migrations are pure — the same input twice gives byte-identical output', () => {
      const doc = createGoldenPathDocument()
      const a = applyMigrationChain(doc, opts)
      const b = applyMigrationChain(doc, opts)
      expect(JSON.stringify(a)).toBe(JSON.stringify(b))
    })
  })
})
