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

/**
 * A v1-SHAPED document, hand-written rather than derived from the sample.
 *
 * `createGoldenPathDocument()` tracks CURRENT_VERSION, so it stopped being a v1 document
 * the moment v2 shipped. Deriving a "v1" from it by overwriting `schemaVersion` would
 * produce a document that already has every v2 field — and the v1 -> v2 migration would
 * then be tested against input it will never see. This is what a v1 document actually
 * looked like: no `primitive`, no `light`, no `meta.environment`, media without a name.
 *
 * The frozen `fixtures/v1/golden-path.json` is the other half of this coverage
 * (fixtures.test.ts) — that one is a real historical file rather than a reconstruction.
 */
const v1Document = () => ({
  schemaVersion: 1,
  projectId: 'prj_a1b2c3d4',
  name: '旧文档',
  meta: {
    unit: 'm',
    upAxis: 'Y',
    createdAt: '2026-08-01T02:10:00.000Z',
    updatedAt: '2026-08-01T03:42:11.000Z',
    background: { type: 'color', color: '#1a1a1a' },
  },
  assets: [
    {
      id: 'ast_9k2m4p7q',
      type: 'audio',
      name: 'alarm.wav',
      hash: `sha256:${'ab12cd34ef567890'.repeat(4)}`,
      url: 'assets/ab/12/ab12cd34ef567890ab12cd34ef567890ab12cd34ef567890ab12cd34ef567890.wav',
      version: 1,
      lineageId: 'ast_9k2m4p7q',
      stats: { tris: 0, materials: 0, textures: 0, bytes: 220544, textureBytes: 0, nodes: 0, animations: [] },
    },
  ],
  nodes: [
    {
      id: 'nd_r5t8y1u3',
      name: '泵组',
      parent: null,
      order: 1000,
      assetRef: null,
      transform: { p: [0, 0, 0], r: [0, 0, 0, 1], s: [1, 1, 1] },
      visible: true,
      locked: false,
      overrides: {},
    },
  ],
  materials: [],
  animations: [],
  hotspots: [],
  viewpoints: [],
  variables: [],
  rules: [],
  pages: [],
  flows: [],
  media: [{ id: 'med_q1s3u5w7', type: 'audio', assetId: 'ast_9k2m4p7q' }],
})

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

  it('ships one migration per version step, with no gaps', () => {
    // The invariant, not the count: a bump that forgets its migration is anti-pattern A4,
    // and the failure mode is silent — `migrate()` only complains when someone opens an
    // old document, which is typically the customer, during their trial.
    expect(MIGRATIONS).toHaveLength(CURRENT_VERSION - 1)
    for (let v = 1; v < CURRENT_VERSION; v++) {
      expect(MIGRATIONS.filter((m) => m.from === v), `no migration from v${v}`).toHaveLength(1)
    }
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

  /**
   * v1 -> v2, the real one.
   *
   * Every assertion here reads `applyMigrationChain`'s RAW output rather than `migrate`'s
   * validated document, and that is the whole point. All the v2 fields except
   * `media[].name` carry zod defaults, so `validate()` would fill them in even if `up()`
   * were `d => d` — a migration that does nothing would pass any test written against
   * `migrate()`. The raw output is where "the migration actually did it" is observable,
   * and it is also what the NEXT migration in the chain will receive.
   */
  describe('v1 -> v2 (v0.5 的一次性字段增量, D11)', () => {
    const raw = () => unwrap(applyMigrationChain(v1Document())).raw as Record<string, any>

    it('writes the carrier fields onto every node instead of leaving them to zod', () => {
      const nodes = raw().nodes as Record<string, unknown>[]
      for (const node of nodes) {
        expect(Object.hasOwn(node, 'primitive'), 'primitive 缺席 = 下一条迁移会读到 undefined').toBe(true)
        expect(Object.hasOwn(node, 'light')).toBe(true)
        expect(node.primitive).toBeNull()
        expect(node.light).toBeNull()
      }
    })

    it('writes the default environment block onto meta', () => {
      expect((raw().meta as Record<string, unknown>).environment).toEqual({
        hdriAssetId: null,
        intensity: 1,
        exposure: 1,
      })
    })

    it('names each media record after the asset it points at', () => {
      expect((raw().media as Record<string, unknown>[])[0]).toEqual({
        id: 'med_q1s3u5w7',
        type: 'audio',
        assetId: 'ast_9k2m4p7q',
        name: 'alarm.wav',
      })
    })

    it('falls back to the media id when the asset reference is already dangling', () => {
      // Not a hypothetical: v1 never had UI to create media, so any media record found in
      // a v1 document was hand-written. `name` has no default and cannot have one, so the
      // choice is between a traceable id and refusing to open the document at all.
      const doc = v1Document()
      doc.media = [{ id: 'med_q1s3u5w7', type: 'audio', assetId: 'ast_00000000' }]
      const migrated = unwrap(applyMigrationChain(doc)).raw as Record<string, any>
      expect(migrated.media[0].name).toBe('med_q1s3u5w7')
    })

    it('does not inject light nodes (D14)', () => {
      // The default rig is a display default, like the background colour. Materialising it
      // would make every existing project sprout three tree entries the user never made,
      // cannot explain, and turns the scene black by deleting.
      const before = v1Document().nodes.length
      const nodes = raw().nodes as Record<string, unknown>[]
      expect(nodes).toHaveLength(before)
      expect(nodes.some((n) => n.light !== null)).toBe(false)
    })

    it('fills gaps without normalising what is already there', () => {
      const doc = v1Document() as Record<string, any>
      doc.meta.environment = { hdriAssetId: null, intensity: 2.5, exposure: 1 }
      doc.nodes[0].primitive = { kind: 'sphere', radius: 2 }
      doc.media[0].name = '用户改过的名字'
      const migrated = unwrap(applyMigrationChain(doc)).raw as Record<string, any>
      expect(migrated.meta.environment.intensity).toBe(2.5)
      expect(migrated.nodes[0].primitive).toEqual({ kind: 'sphere', radius: 2 })
      expect(migrated.media[0].name).toBe('用户改过的名字')
    })

    it('produces a document that validates and equals what a second run produces', () => {
      const first = unwrap(migrate(v1Document()))
      expect(first.fromVersion).toBe(1)
      expect(first.toVersion).toBe(2)
      expect(first.applied).toHaveLength(1)
      expect(first.applied[0]).toMatch(/^v1 -> v2: /)
      expect(JSON.stringify(unwrap(migrate(v1Document())).document)).toBe(JSON.stringify(first.document))
    })

    it('leaves the input untouched', () => {
      const doc = v1Document()
      const before = JSON.stringify(doc)
      migrate(doc)
      expect(JSON.stringify(doc)).toBe(before)
    })
  })

  describe('the chain, driven with a synthetic set of migrations', () => {
    const opts = { migrations: syntheticChain, targetVersion: 3 }
    // The synthetic chain starts at v1, so it needs a v1-versioned input. Only
    // `meta.background` is touched by it, so the v1 document above is a fine vehicle.

    it('walks every step in order and records what it applied', () => {
      const result = unwrap(applyMigrationChain(v1Document(), opts))
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
      // The synthetic chain intentionally produces a shape no version accepts.
      const r = migrate(v1Document(), opts)
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
