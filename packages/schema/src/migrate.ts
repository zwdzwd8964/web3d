import { CURRENT_VERSION } from './document.js'
import type { SceneDocument } from './document.js'
import type { Result, ValidationError } from './validate.js'
import { err, ok, validate } from './validate.js'

/**
 * SCHEMA_SPEC §10 · constitution C4. Any historical snapshot must open in today's code,
 * forever.
 *
 * The non-negotiable procedure: changing the schema means schemaVersion +1 AND a
 * Migration AND a fixture. All three, every time. Two out of three is anti-pattern A4 —
 * historical snapshots break silently and it surfaces during the customer's trial run
 * at the earliest.
 *
 * Migration is upward only. A v1 build handed a v2 document refuses it loudly rather
 * than guessing; silently ignoring unknown fields would let an old player save over a
 * newer document and destroy work.
 */

export interface Migration {
  readonly from: number
  readonly to: number
  /** One line, shown in the migration log and the publish dialog. */
  readonly describe: string
  /**
   * Pure function. No external state, no network. Fill missing fields with defaults;
   * KEEP unknown fields — a future downgrade-read may want them.
   */
  up(doc: Record<string, unknown>): Record<string, unknown>
}

/**
 * v1 → v2 · the v0.5 field set, in ONE bump (D11).
 *
 * Additive only: every new field gets its documented default and nothing existing is
 * touched. That is what makes the whole of v0.5 — primitives, lights, environment,
 * material maps, media — cost a single migration and a single fixture generation instead
 * of four of each.
 *
 * **It writes the defaults explicitly rather than leaving the fields absent for zod to
 * fill.** Zod would fill them, and `migrate()` would still return a valid document, so
 * this function could be `d => d` and every test that only looks at `migrate()` would
 * stay green. Two reasons it must not be:
 *
 *   1. the next migration (v2 → v3) receives this function's RAW output, not zod's — it
 *      would find `undefined` where the v2 shape promises a value;
 *   2. `media[].name` has no default and cannot have one, because the sensible value comes
 *      from a different collection. A v1 document that actually used `media` would fail
 *      validation outright without this step.
 *
 * **No light node is injected** (D14). The default three-light rig is a display default,
 * like the default background colour — not scene content. Materialising it into three
 * document nodes would make every existing project sprout three tree entries the user
 * never created, cannot explain, and turns the scene black by deleting.
 */
const V1_TO_V2: Migration = {
  from: 1,
  to: 2,
  describe: '新增原始体/灯光承载体、环境与背景 HDRI、材质贴图变换与 physical 参数、媒体记录名称与时长',
  up(doc) {
    const assetNames = new Map<string, string>()
    for (const asset of asArray(doc.assets)) {
      const record = asRecord(asset)
      if (typeof record?.id === 'string' && typeof record.name === 'string') assetNames.set(record.id, record.name)
    }

    const meta = asRecord(doc.meta) ?? {}
    return {
      ...doc,
      meta: {
        ...meta,
        // Spread-then-default, never overwrite: a document that somehow already carries an
        // environment block keeps it. Migrations fill gaps; they do not normalise.
        environment: { hdriAssetId: null, intensity: 1, exposure: 1, ...(asRecord(meta.environment) ?? {}) },
      },
      nodes: asArray(doc.nodes).map((node) => ({ primitive: null, light: null, ...(asRecord(node) ?? {}) })),
      media: asArray(doc.media).map((entry) => {
        const record = asRecord(entry) ?? {}
        if (typeof record.name === 'string' && record.name.length > 0) return record
        const assetId = typeof record.assetId === 'string' ? record.assetId : ''
        // The asset's filename is the name the user recognises. When the reference is
        // already dangling the id is kept instead of inventing a label — an unhelpful but
        // TRACEABLE name, on a document that integrity check I14 is about to flag anyway.
        const fallback = typeof record.id === 'string' ? record.id : '媒体'
        return { ...record, name: assetNames.get(assetId) ?? fallback }
      }),
    }
  },
}

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null

const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : [])

/**
 * The shipped chain, in ascending `from` order.
 *
 * It was built and tested while still empty at schemaVersion 1 (SCHEMA_SPEC §10 is
 * explicit that day one is when this gets built), which is why adding the first real entry
 * here was a five-line change rather than a project.
 */
export const MIGRATIONS: readonly Migration[] = [V1_TO_V2]

export interface MigrationFailure {
  readonly kind: 'malformed' | 'from-the-future' | 'missing-step' | 'bad-chain' | 'invalid-result'
  readonly message: string
  /** Present when the migrated document failed structural validation. */
  readonly validation?: readonly ValidationError[]
}

export interface MigrationSuccess {
  readonly document: SceneDocument
  readonly fromVersion: number
  readonly toVersion: number
  readonly applied: readonly string[]
}

export interface MigrateOptions {
  /** Defaults to the shipped chain. Injectable so the machinery is exercised while MIGRATIONS is empty. */
  readonly migrations?: readonly Migration[]
  /** Test seam only. Production always targets CURRENT_VERSION. */
  readonly targetVersion?: number
}

function readVersion(raw: unknown): Result<number, MigrationFailure> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return err({ kind: 'malformed', message: 'document must be a JSON object' })
  }
  const v = (raw as Record<string, unknown>).schemaVersion
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 1) {
    return err({ kind: 'malformed', message: `missing or invalid schemaVersion: ${JSON.stringify(v)}` })
  }
  return ok(v)
}

export interface ChainResult {
  /** The migrated plain object. Not yet validated. */
  readonly raw: Record<string, unknown>
  readonly fromVersion: number
  readonly toVersion: number
  readonly applied: readonly string[]
}

/**
 * Walks the chain and returns the raw migrated object.
 *
 * Split out from `migrate()` on purpose: because `schemaVersion` is a literal, a chain
 * that ends above the current version can never validate, so this loop would otherwise
 * be unobservable until the day a real migration ships. Here it is directly testable
 * with a synthetic chain, and `migrate()` stays the only entry point that also
 * validates.
 */
export function applyMigrationChain(
  raw: unknown,
  options: MigrateOptions = {},
): Result<ChainResult, MigrationFailure> {
  const migrations = options.migrations ?? MIGRATIONS
  const targetVersion = options.targetVersion ?? CURRENT_VERSION

  const versionResult = readVersion(raw)
  if (!versionResult.ok) return versionResult
  const fromVersion = versionResult.value

  if (fromVersion > targetVersion) {
    return err({
      kind: 'from-the-future',
      message:
        `document schemaVersion ${fromVersion} is newer than this build understands (${targetVersion}). ` +
        'Refusing to open it: a downgrade would silently drop fields.',
    })
  }

  const byFrom = new Map<number, Migration>()
  for (const m of migrations) {
    if (m.to !== m.from + 1) {
      return err({ kind: 'bad-chain', message: `migration ${m.from}->${m.to} must be a single step` })
    }
    if (byFrom.has(m.from)) {
      return err({ kind: 'bad-chain', message: `two migrations registered from version ${m.from}` })
    }
    byFrom.set(m.from, m)
  }

  let current = structuredClone(raw) as Record<string, unknown>
  const applied: string[] = []
  let version = fromVersion

  while (version < targetVersion) {
    const step = byFrom.get(version)
    if (!step) {
      return err({
        kind: 'missing-step',
        message:
          `no migration registered from schemaVersion ${version} to ${version + 1}. ` +
          'Bumping the version without a migration is anti-pattern A4.',
      })
    }
    current = step.up(current)
    current.schemaVersion = step.to
    applied.push(`v${step.from} -> v${step.to}: ${step.describe}`)
    version = step.to
  }

  return ok({ raw: current, fromVersion, toVersion: version, applied })
}

export function migrate(raw: unknown, options: MigrateOptions = {}): Result<MigrationSuccess, MigrationFailure> {
  const chain = applyMigrationChain(raw, options)
  if (!chain.ok) return chain

  const validated = validate(chain.value.raw)
  if (!validated.ok) {
    return err({
      kind: 'invalid-result',
      message: `migrated document failed validation (${validated.error.length} issue(s))`,
      validation: validated.error,
    })
  }
  return ok({
    document: validated.value,
    fromVersion: chain.value.fromVersion,
    toVersion: chain.value.toVersion,
    applied: chain.value.applied,
  })
}

/** True when `raw` is below the current version. Returns false for anything malformed. */
export function needsMigration(raw: unknown): boolean {
  const v = readVersion(raw)
  return v.ok && v.value < CURRENT_VERSION
}
