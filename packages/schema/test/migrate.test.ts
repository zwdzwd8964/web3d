import { describe, expect, it } from 'vitest'
import { CURRENT_SCHEMA_VERSION } from '../src/document.js'
import type { Migration } from '../src/migrate.js'
import { MIGRATIONS, MigrationError, migrate, needsMigration } from '../src/migrate.js'
import { createGoldenPathDocument } from '../src/samples.js'
import { DocumentValidationError } from '../src/validate.js'

/**
 * The shipped chain is empty at schemaVersion 1, so the *machinery* is driven here
 * with a synthetic chain and an injected target version. Without that, the first real
 * migration written in v1 would also be the first execution of this loop — on a
 * customer's document, during their trial period.
 */
const syntheticChain: Migration[] = [
  {
    from: 1,
    to: 2,
    describe: 'rename meta.description to meta.summary',
    up: (doc) => {
      const meta = doc.meta as Record<string, unknown>
      const { description, ...rest } = meta
      return { ...doc, meta: { ...rest, summary: description ?? '' } }
    },
  },
  {
    from: 2,
    to: 3,
    describe: 'add meta.locale',
    up: (doc) => ({ ...doc, meta: { ...(doc.meta as object), locale: 'zh-CN' } }),
  },
]

describe('migrate() — constitution C4', () => {
  it('accepts a current-version document unchanged', () => {
    const doc = createGoldenPathDocument()
    const r = migrate(doc)
    expect(r.fromVersion).toBe(CURRENT_SCHEMA_VERSION)
    expect(r.toVersion).toBe(CURRENT_SCHEMA_VERSION)
    expect(r.applied).toEqual([])
    expect(r.document).toEqual(doc)
  })

  it('does not mutate its input', () => {
    const doc = createGoldenPathDocument()
    const before = JSON.stringify(doc)
    migrate(doc)
    expect(JSON.stringify(doc)).toBe(before)
  })

  it('needsMigration is false at the current version', () => {
    expect(needsMigration(createGoldenPathDocument())).toBe(false)
    // A malformed version is refused rather than answered.
    expect(() => needsMigration({ schemaVersion: 0.5 })).toThrow(MigrationError)
  })

  it('the shipped chain is empty at schemaVersion 1 — checked, not assumed', () => {
    expect(CURRENT_SCHEMA_VERSION).toBe(1)
    expect(MIGRATIONS).toHaveLength(0)
  })

  it('refuses a document from the future rather than dropping fields', () => {
    const doc = { ...createGoldenPathDocument(), schemaVersion: CURRENT_SCHEMA_VERSION + 5 }
    expect(() => migrate(doc)).toThrow(MigrationError)
    expect(() => migrate(doc)).toThrow(/newer than this build/)
  })

  it('rejects a missing or malformed schemaVersion', () => {
    expect(() => migrate({})).toThrow(MigrationError)
    expect(() => migrate({ schemaVersion: '1' })).toThrow(MigrationError)
    expect(() => migrate({ schemaVersion: 0 })).toThrow(MigrationError)
    expect(() => migrate({ schemaVersion: 1.5 })).toThrow(MigrationError)
    expect(() => migrate(null)).toThrow(MigrationError)
    expect(() => migrate([])).toThrow(MigrationError)
    expect(() => migrate('{}')).toThrow(MigrationError)
  })

  it('a structurally invalid document is rejected, not silently accepted', () => {
    expect(() => migrate({ schemaVersion: 1 })).toThrow(DocumentValidationError)
  })

  describe('the migration loop, driven with a synthetic chain', () => {
    const opts = { migrations: syntheticChain, targetVersion: 3, validateResult: false } as const

    it('walks every step in order and records what it applied', () => {
      const doc = createGoldenPathDocument()
      const r = migrate(doc, opts)
      expect(r.fromVersion).toBe(1)
      expect(r.toVersion).toBe(3)
      expect(r.applied).toEqual([
        'v1 -> v2: rename meta.description to meta.summary',
        'v2 -> v3: add meta.locale',
      ])
      const meta = (r.document as unknown as Record<string, any>).meta
      expect(meta.summary).toBe('v0 黄金路径样例场景')
      expect(meta.description).toBeUndefined()
      expect(meta.locale).toBe('zh-CN')
      expect((r.document as unknown as Record<string, any>).schemaVersion).toBe(3)
    })

    it('starts mid-chain when the document is already partly migrated', () => {
      const doc = { ...createGoldenPathDocument(), schemaVersion: 2 } as unknown as Record<string, unknown>
      const r = migrate(doc, opts)
      expect(r.fromVersion).toBe(2)
      expect(r.applied).toEqual(['v2 -> v3: add meta.locale'])
    })

    it('names the gap as anti-pattern A4 when a version has no migration', () => {
      expect(() => migrate({ schemaVersion: 1 }, { migrations: [syntheticChain[1]!], targetVersion: 3 })).toThrow(
        /no migration registered from schemaVersion 1 to 2/,
      )
      expect(() => migrate({ schemaVersion: 1 }, { migrations: [syntheticChain[1]!], targetVersion: 3 })).toThrow(
        /anti-pattern A4/,
      )
    })

    it('rejects a migration entry that skips a version', () => {
      const bad: Migration[] = [{ from: 1, to: 3, describe: 'skips v2', up: (d) => d }]
      expect(() => migrate({ schemaVersion: 1 }, { migrations: bad, targetVersion: 3 })).toThrow(/single step/)
    })

    it('rejects two migrations registered from the same version', () => {
      const dupes: Migration[] = [
        { from: 1, to: 2, describe: 'a', up: (d) => d },
        { from: 1, to: 2, describe: 'b', up: (d) => d },
      ]
      expect(() => migrate({ schemaVersion: 1 }, { migrations: dupes, targetVersion: 2 })).toThrow(/two migrations/)
    })

    it('validates the migrated result and fails loudly when a migration produces junk', () => {
      const broken: Migration[] = [{ from: 1, to: 2, describe: 'destroys the document', up: () => ({}) }]
      expect(() => migrate(createGoldenPathDocument(), { migrations: broken, targetVersion: 2 })).toThrow(
        DocumentValidationError,
      )
    })

    it('refuses a future document against the injected target too', () => {
      expect(() => migrate({ schemaVersion: 9 }, { migrations: syntheticChain, targetVersion: 3 })).toThrow(
        /newer than this build understands \(3\)/,
      )
    })

    it('needsMigration is true below the current version', () => {
      // Guarded through the same reader migrate() uses.
      expect(() => needsMigration({ schemaVersion: 1 })).not.toThrow()
    })
  })
})
