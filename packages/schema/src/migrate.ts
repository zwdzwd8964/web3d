import { CURRENT_SCHEMA_VERSION } from './document.js'
import type { SceneDocument } from './document.js'
import { DocumentValidationError, validate } from './validate.js'

/**
 * Constitution C4 · any historical snapshot must open in today's code, forever.
 *
 * The rule is one-directional and that is deliberate: v1 code opening a v2 document
 * is refused loudly rather than guessed at. Silently ignoring fields it does not
 * understand would let an old player save over a newer document and destroy work.
 */

export interface Migration {
  readonly from: number
  readonly to: number
  /** One line, shown in the migration log and in the publish dialog. */
  readonly describe: string
  /** Receives a deep-cloned plain object; must return the next version's shape. */
  up(doc: Record<string, unknown>): Record<string, unknown>
}

/**
 * Empty at schemaVersion 1 — there is no earlier version to come from.
 *
 * Adding an entry here is mandatory whenever CURRENT_SCHEMA_VERSION moves. The
 * fixture suite enforces the other half: `test/fixtures/v<N>/` keeps one real
 * document per historical version, and those files are append-only (C4).
 */
export const MIGRATIONS: readonly Migration[] = []

export interface MigrateResult {
  readonly document: SceneDocument
  readonly fromVersion: number
  readonly toVersion: number
  /** Human-readable descriptions of each step applied, in order. */
  readonly applied: readonly string[]
}

export class MigrationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MigrationError'
  }
}

function readVersion(raw: unknown): number {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new MigrationError('document must be a JSON object')
  }
  const v = (raw as Record<string, unknown>).schemaVersion
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 1) {
    throw new MigrationError(`missing or invalid schemaVersion: ${JSON.stringify(v)}`)
  }
  return v
}

export interface MigrateOptions {
  /** Defaults to the shipped chain. Injectable so the machinery is testable while MIGRATIONS is empty. */
  readonly migrations?: readonly Migration[]
  /**
   * Test seam only: pretend this build's current version is `targetVersion`.
   * Production always uses CURRENT_SCHEMA_VERSION.
   */
  readonly targetVersion?: number
  /** Set false to exercise a chain whose output is not a full document. Default true. */
  readonly validateResult?: boolean
}

/**
 * Bring a document of any historical version up to CURRENT_SCHEMA_VERSION and
 * validate the result.
 *
 * The chain and the target version are injectable so the migration *machinery* can be
 * exercised today, while the real chain is still empty. Without that seam, the first
 * genuine migration shipped in v1 would also be the first time this loop ever ran —
 * on a customer's document.
 */
export function migrate(raw: unknown, options: MigrateOptions = {}): MigrateResult {
  const migrations = options.migrations ?? MIGRATIONS
  const targetVersion = options.targetVersion ?? CURRENT_SCHEMA_VERSION
  const shouldValidate = options.validateResult ?? true
  const fromVersion = readVersion(raw)

  if (fromVersion > targetVersion) {
    throw new MigrationError(
      `document schemaVersion ${fromVersion} is newer than this build understands ` +
        `(${targetVersion}). Refusing to open it: downgrading would silently drop fields.`,
    )
  }

  let current = structuredClone(raw) as Record<string, unknown>
  const applied: string[] = []
  let version = fromVersion
  const byFrom = new Map<number, Migration>()
  for (const m of migrations) {
    if (m.to !== m.from + 1) {
      throw new MigrationError(`migration ${m.from}->${m.to} must be a single step`)
    }
    if (byFrom.has(m.from)) throw new MigrationError(`two migrations registered from version ${m.from}`)
    byFrom.set(m.from, m)
  }

  while (version < targetVersion) {
    const step = byFrom.get(version)
    if (!step) {
      throw new MigrationError(
        `no migration registered from schemaVersion ${version} to ${version + 1}. ` +
          'Bumping CURRENT_SCHEMA_VERSION without a migration is anti-pattern A4.',
      )
    }
    current = step.up(current)
    current.schemaVersion = step.to
    applied.push(`v${step.from} -> v${step.to}: ${step.describe}`)
    version = step.to
  }

  if (!shouldValidate) {
    return { document: current as unknown as SceneDocument, fromVersion, toVersion: version, applied }
  }
  const result = validate(current)
  if (!result.ok) {
    throw new DocumentValidationError(result.issues)
  }
  return { document: result.document, fromVersion, toVersion: version, applied }
}

/** True when `raw` needs migration work before it can be used. */
export function needsMigration(raw: unknown): boolean {
  return readVersion(raw) < CURRENT_SCHEMA_VERSION
}
