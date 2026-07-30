import { z } from 'zod'

/**
 * SCHEMA_SPEC §2 · ID rules. Constitution C9.
 *
 * A reference key is always an ID — never `name`, never `objectPath`, never an array
 * index (anti-pattern A5). IDs are system-generated and not user-editable; `name` is
 * free for the user to change and changing it must break nothing.
 */

export const PREFIXES = {
  project: 'prj',
  asset: 'ast',
  node: 'nd',
  material: 'mat',
  animation: 'anm',
  hotspot: 'hs',
  viewpoint: 'vp',
  variable: 'var',
  rule: 'rl',
  page: 'pg',
  flow: 'flw',
  step: 'st',
  media: 'med',
} as const

export type Prefix = (typeof PREFIXES)[keyof typeof PREFIXES]
export type IdKind = keyof typeof PREFIXES

/** Shaped like `nd_k3f9a2xq` — prefix, underscore, exactly 8 chars of [0-9a-z]. */
export const Id = (p: string) =>
  z.string().regex(new RegExp(`^${p}_[0-9a-z]{8}$`), `expected an id of the form "${p}_xxxxxxxx"`)

export const ProjectIdSchema = Id(PREFIXES.project)
export const AssetIdSchema = Id(PREFIXES.asset)
export const NodeIdSchema = Id(PREFIXES.node)
export const MaterialIdSchema = Id(PREFIXES.material)
export const AnimationIdSchema = Id(PREFIXES.animation)
export const HotspotIdSchema = Id(PREFIXES.hotspot)
export const ViewpointIdSchema = Id(PREFIXES.viewpoint)
export const RuleIdSchema = Id(PREFIXES.rule)
export const PageIdSchema = Id(PREFIXES.page)
export const FlowIdSchema = Id(PREFIXES.flow)
export const StepIdSchema = Id(PREFIXES.step)
export const MediaIdSchema = Id(PREFIXES.media)

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz'
const ID_LENGTH = 8

function randomBody(): string {
  const bytes = new Uint8Array(ID_LENGTH)
  globalThis.crypto.getRandomValues(bytes)
  let out = ''
  for (let i = 0; i < ID_LENGTH; i++) out += ALPHABET[bytes[i]! % ALPHABET.length]
  return out
}

/**
 * Mint a fresh id.
 *
 * 8 base36 characters is ~2.8e12 of space, so an in-document collision is negligible —
 * but the check costs nothing, so SCHEMA_SPEC §2 requires it anyway. Callers that hold
 * the document (the write API) pass the ids already in use.
 */
export function newId(kind: IdKind, existingIds?: ReadonlySet<string> | readonly string[]): string {
  const taken =
    existingIds === undefined
      ? undefined
      : existingIds instanceof Set
        ? existingIds
        : new Set(existingIds as readonly string[])
  const prefix = PREFIXES[kind]
  for (let attempt = 0; attempt < 64; attempt++) {
    const candidate = `${prefix}_${randomBody()}`
    if (!taken?.has(candidate)) return candidate
  }
  throw new Error(`newId: could not mint a free ${kind} id after 64 attempts`)
}

export function isId(kind: IdKind, value: unknown): boolean {
  return typeof value === 'string' && new RegExp(`^${PREFIXES[kind]}_[0-9a-z]{8}$`).test(value)
}

/** Injectable minting, so fixtures and parity traces are byte-identical run to run. */
export interface IdFactory {
  (kind: IdKind, existingIds?: ReadonlySet<string> | readonly string[]): string
}

export const defaultIdFactory: IdFactory = newId

/** Deterministic ids for tests and fixtures: `nd_00000001`, `nd_00000002`, … */
export function createSequentialIdFactory(start = 1): IdFactory {
  const counters = new Map<IdKind, number>()
  return (kind) => {
    const n = (counters.get(kind) ?? start - 1) + 1
    counters.set(kind, n)
    return `${PREFIXES[kind]}_${String(n).padStart(ID_LENGTH, '0')}`
  }
}

/* -------------------------------------------------------------------------- */
/* Variable ids — the one user-authored key                                   */
/* -------------------------------------------------------------------------- */

/**
 * SCHEMA_SPEC §2 · variables are the sole exception to "ids are generated": they
 * appear inside rule expressions and in the user-visible debug panel, so `step` beats
 * `var_k3f9a2xq` for readability. The cost is that renaming one is a
 * rename-with-references operation, not a free relabel.
 */
export const VARIABLE_ID_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]{0,31}$/

/** SCHEMA_SPEC §6.3 · reserved words that must not be used as a variable id. */
export const RESERVED_VARIABLE_IDS: readonly string[] = [
  'true',
  'false',
  'null',
  'undefined',
  'if',
  'then',
  'else',
  'and',
  'or',
  'not',
  'var',
  'event',
  'target',
  'self',
  'scene',
]

const RESERVED_SET = new Set(RESERVED_VARIABLE_IDS)

export function isReservedVariableId(id: string): boolean {
  return RESERVED_SET.has(id)
}

export const VariableIdSchema = z
  .string()
  .regex(VARIABLE_ID_PATTERN, 'variable id must start with a letter or _, then letters/digits/_ (max 32)')
  .refine((id) => !isReservedVariableId(id), { message: 'variable id is a reserved word' })
export type VariableId = z.infer<typeof VariableIdSchema>
