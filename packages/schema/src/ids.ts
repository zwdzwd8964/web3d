import { z } from 'zod'

/**
 * Constitution C9 · stable IDs are the only primary key.
 *
 * Never key anything off a GLB object name, an object path, or an array index.
 * Names get renamed, paths get restructured, indices shift on re-import — and every
 * one of those breaks every rule, material override and hotspot that referenced it
 * (technical assessment R02, anti-pattern A5). The three-way redundancy in
 * `assetRef` exists to *recover* from that, not to be used as a key.
 */

export const ID_PREFIXES = {
  project: 'prj',
  asset: 'ast',
  node: 'nd',
  material: 'mat',
  animation: 'anm',
  hotspot: 'hs',
  viewpoint: 'vp',
  rule: 'rl',
  page: 'pg',
  media: 'med',
  flow: 'flw',
  flowStep: 'st',
  snapshot: 'snp',
} as const

export type IdKind = keyof typeof ID_PREFIXES
export type IdPrefix = (typeof ID_PREFIXES)[IdKind]

/** `<prefix>_<8..32 chars of [0-9a-z]>`, e.g. `nd_k3f9a1x8`. */
const ID_BODY = '[0-9a-z]{6,32}'

const idPattern = (prefix: IdPrefix) => new RegExp(`^${prefix}_${ID_BODY}$`)

/** A Zod string schema constrained to one ID kind. */
export function zId<K extends IdKind>(kind: K) {
  const prefix = ID_PREFIXES[kind]
  return z.string().regex(idPattern(prefix), `must be a ${kind} id of the form "${prefix}_xxxxxxxx"`)
}

export const ProjectId = zId('project')
export const AssetId = zId('asset')
export const NodeId = zId('node')
export const MaterialId = zId('material')
export const AnimationId = zId('animation')
export const HotspotId = zId('hotspot')
export const ViewpointId = zId('viewpoint')
export const RuleId = zId('rule')
export const PageId = zId('page')
export const MediaId = zId('media')
export const FlowId = zId('flow')
export const FlowStepId = zId('flowStep')
export const SnapshotId = zId('snapshot')

export type ProjectId = z.infer<typeof ProjectId>
export type AssetId = z.infer<typeof AssetId>
export type NodeId = z.infer<typeof NodeId>
export type MaterialId = z.infer<typeof MaterialId>
export type AnimationId = z.infer<typeof AnimationId>
export type HotspotId = z.infer<typeof HotspotId>
export type ViewpointId = z.infer<typeof ViewpointId>
export type RuleId = z.infer<typeof RuleId>
export type PageId = z.infer<typeof PageId>
export type MediaId = z.infer<typeof MediaId>
export type FlowId = z.infer<typeof FlowId>
export type FlowStepId = z.infer<typeof FlowStepId>
export type SnapshotId = z.infer<typeof SnapshotId>

/**
 * Variables are the one exception: their key is authored by the user, because
 * rules read as `step == 1` and a generated id would make every rule unreadable.
 * The tradeoff is that renaming a variable is a rename-with-references operation,
 * not a free relabel — which is why the editor must never expose it as a plain
 * text field on an existing variable.
 */
export const VariableId = z
  .string()
  .regex(/^[A-Za-z_][A-Za-z0-9_]{0,63}$/, 'variable id must be an identifier: letter or _, then letters/digits/_')
export type VariableId = z.infer<typeof VariableId>

export function isId(kind: IdKind, value: unknown): boolean {
  return typeof value === 'string' && idPattern(ID_PREFIXES[kind]).test(value)
}

/** Mints ids. Injectable so document factories are deterministic under test. */
export interface IdFactory {
  (kind: IdKind): string
}

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz'

function randomBody(length: number): string {
  const bytes = new Uint8Array(length)
  globalThis.crypto.getRandomValues(bytes)
  let out = ''
  for (let i = 0; i < length; i++) {
    // biome-ignore lint: index is bounded by the loop
    out += ALPHABET[bytes[i]! % ALPHABET.length]
  }
  return out
}

/** Default factory: 10 random base36 characters from the platform CSPRNG. */
export const createId: IdFactory = (kind) => `${ID_PREFIXES[kind]}_${randomBody(10)}`

/**
 * Deterministic factory for tests and fixtures: `nd_000001`, `nd_000002`, …
 * Counters are per-kind so ids stay readable in assertion failures.
 */
export function createSequentialIdFactory(start = 1): IdFactory {
  const counters = new Map<IdKind, number>()
  return (kind) => {
    const n = (counters.get(kind) ?? start - 1) + 1
    counters.set(kind, n)
    return `${ID_PREFIXES[kind]}_${String(n).padStart(6, '0')}`
  }
}
