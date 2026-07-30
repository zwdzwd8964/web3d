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
 * Empty at schemaVersion 1: there is no earlier version to come from. The array and
 * `migrate()` still exist and are still covered by tests, because SCHEMA_SPEC §10 is
 * explicit that day one is when this gets built — by week three there are already three
 * differently-shaped documents on disk.
 */
export const MIGRATIONS: readonly Migration[] = []

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
