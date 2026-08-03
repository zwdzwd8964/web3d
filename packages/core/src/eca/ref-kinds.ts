import type { DocIndex, SceneDocument } from '@w3/schema'
import type { RefKind } from './types.js'

/**
 * T-203 · everything the engine knows about one kind of reference, in one place.
 *
 * Before this file, that knowledge lived in two exhaustive `switch (kind)` statements in two
 * different packages: `refExists` in `executor.ts` and `refOptions` in the rule editor's
 * `ActionFields.tsx`. Adding a reference kind therefore lit up **both of the files
 * [ECA_SPEC](../../../../docs/ECA_SPEC.md) §10 forbids touching**, which makes it a 分诊 Q4 —
 * "stop, write an ADR, re-price the change order" — for what is really two lines of table.
 * v1.2's T-302 adds four kinds at once.
 *
 * See [ADR-0028](../../../../docs/adr/0028-refkind-注册表化.md) for the decision, its cost,
 * and the condition that reverses it. Same shape as ADR-0018 did for `engine.ts`: change it
 * once so it never has to change again.
 *
 * **Adding a kind is adding a row here and nothing else.** If a new kind needs the executor
 * to know about it somewhere other than these hooks, it is still Q4 — ADR-0028's cost 4.
 */
export interface RefKindSpec {
  /** Chinese, user-facing: it appears verbatim in 「引用了已不存在的对象」 style messages. */
  readonly label: string
  /** Whether `id` still resolves. ECA_SPEC §9.2 B9's whole implementation for this kind. */
  exists(index: DocIndex, id: string): boolean
  /** The document's records of this kind, as the rule editor's dropdown wants them. */
  options(doc: SceneDocument): { id: string; name: string }[]
  /**
   * The record's own declared `type`, for kinds that have one — `undefined` when they do not.
   *
   * ECA_SPEC §4.2 I14: `playMedia` may only point at an `audio` record. A rule aimed at a
   * video resolves (the id exists) and then plays silence, which sends the user to check
   * their speakers. Optional because most kinds have no sub-type at all, and a hook that
   * every implementation has to stub out with `undefined` teaches people to ignore it.
   */
  expectTypeOf?(index: DocIndex, id: string): string | undefined
}

/**
 * The registry. **Exhaustive `Record`, not an array** — a missing kind is a compile error
 * rather than an `undefined` at run time, which is the difference between "the build fails"
 * and "a rule silently resolves against nothing".
 */
export const REF_KINDS: Record<RefKind, RefKindSpec> = {
  node: {
    label: '对象',
    exists: (index, id) => index.nodeById.has(id),
    options: (doc) => doc.nodes.map((n) => ({ id: n.id, name: n.name })),
  },
  material: {
    label: '材质',
    exists: (index, id) => index.materialById.has(id),
    options: (doc) => doc.materials.map((m) => ({ id: m.id, name: m.name })),
  },
  animation: {
    label: '动画',
    exists: (index, id) => index.animationById.has(id),
    options: (doc) => doc.animations.map((a) => ({ id: a.id, name: a.name })),
  },
  hotspot: {
    label: '热点',
    exists: (index, id) => index.hotspotById.has(id),
    options: (doc) => doc.hotspots.map((h) => ({ id: h.id, name: h.name })),
  },
  viewpoint: {
    label: '视点',
    exists: (index, id) => index.viewpointById.has(id),
    options: (doc) => doc.viewpoints.map((v) => ({ id: v.id, name: v.name })),
  },
  variable: {
    label: '变量',
    exists: (index, id) => index.variableById.has(id),
    // The id is shown alongside the name because a variable's id is what the author typed
    // and what every condition expression refers to — two variables can share a name.
    options: (doc) => doc.variables.map((v) => ({ id: v.id, name: `${v.name}（${v.id}）` })),
  },
  media: {
    label: '多媒体',
    // v0.5 · media DOES have a runtime now. The `default: return true` left over from v0
    // meant a rule pointing at a deleted clip reported success and played nothing — the one
    // outcome B9 exists to prevent.
    exists: (index, id) => index.mediaById.has(id),
    // The record's OWN name (SCHEMA_SPEC §6.8), which defaults to the filename at import and
    // is what the user renames in the media panel. Reading the asset's name instead meant the
    // rule editor kept showing `alarm.wav` after they renamed it 「警报声」, and two clips cut
    // from one file were indistinguishable in the dropdown.
    options: (doc) => doc.media.map((m) => ({ id: m.id, name: m.name })),
    expectTypeOf: (index, id) => index.mediaById.get(id)?.type,
  },
}

/** Whether `id` still resolves as a `kind`. The executor's B9 check, in one call. */
export function refExists(index: DocIndex, kind: RefKind, id: string): boolean {
  return REF_KINDS[kind].exists(index, id)
}

/**
 * ECA_SPEC §9.2 B9 · the reference also has to be the right KIND of thing.
 *
 * True when the action asked for no particular sub-type, when the kind has no sub-type to
 * check, or when the record's own type matches.
 */
export function refTypeOk(index: DocIndex, ref: { kind: RefKind; id: string; expectType?: string }): boolean {
  if (ref.expectType === undefined) return true
  const actual = REF_KINDS[ref.kind].expectTypeOf?.(index, ref.id)
  if (actual === undefined) return true
  return actual === ref.expectType
}

/** The document's entities of one ref kind, as `{id, name}` for a dropdown. */
export function refOptions(doc: SceneDocument, kind: RefKind): { id: string; name: string }[] {
  return REF_KINDS[kind].options(doc)
}
