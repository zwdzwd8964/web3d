import { z } from 'zod'
import { ExplodeSchema } from './explode.js'
import { AssetIdSchema, MaterialIdSchema, NodeIdSchema } from './id.js'
import { LightSchema } from './light.js'
import { PrefabRefSchema } from './prefab-ref.js'
import { PrimitiveSchema } from './primitive.js'
import { TransformSchema, Vec3Schema } from './primitives.js'
import { SectionSchema } from './section.js'

/**
 * SCHEMA_SPEC §4 · a scene node is an instance that stores only the delta against its
 * source asset.
 *
 * The five disciplines that make or break this file:
 *   1. absent from `overrides` means "inherit from the asset" — do NOT copy the source
 *      asset's properties into the node at import, or swapping the source asset stops
 *      propagating and the low-code experience dies;
 *   2. `transform` is local to the parent, never world;
 *   3. `r` is a quaternion, not Euler — Euler brings gimbal lock and interpolation
 *      ambiguity into persisted data;
 *   4. `parent` + `order` define the tree; reordering writes `order` only, so one drag
 *      produces one patch instead of N;
 *   5. the three redundant fields in `assetRef` are all load-bearing for the remap
 *      ladder (§5.3) — drop one and a whole tier degrades to guessing.
 */

export const AssetRefSchema = z
  .object({
    assetId: AssetIdSchema,
    /** Full ancestry inside the asset, `/`-joined: `Root/Pump/Body`. */
    objectPath: z.string(),
    objectName: z.string(),
    /** Set by the remap when nothing matched. Marked, never deleted (§5.3). */
    missing: z.boolean().default(false),
  })
  .strict()
export type AssetRef = z.infer<typeof AssetRefSchema>

/**
 * `castShadow` / `receiveShadow` were defined in v1 and did nothing until v2 wired up the
 * shadow pipeline. Their SHAPE is unchanged — v2 only gave them an effect. Semantics: with
 * shadows on, meshes cast and receive by default and these two turn an individual node
 * off; absent still means "inherit", exactly like every other override.
 */
export const NodeOverridesSchema = z
  .object({
    materialId: MaterialIdSchema.optional(),
    castShadow: z.boolean().optional(),
    receiveShadow: z.boolean().optional(),
  })
  .strict()
export type NodeOverrides = z.infer<typeof NodeOverridesSchema>

export const NodeSchema = z
  .object({
    id: NodeIdSchema,
    name: z.string().min(1).max(120),
    /** null = root node. */
    parent: NodeIdSchema.nullable(),
    /**
     * Sort key among siblings. Integers spaced by ORDER_STEP; inserting takes the
     * midpoint, and a batch renumber runs when the gap is exhausted.
     */
    order: z.number().int(),
    /**
     * The three CARRIERS. A node has at most one; all three null is a pure grouping node
     * (an empty Group), which is what the user gets when they create a folder in the tree.
     *
     * Mutual exclusion is enforced by integrity check I11 (error level), NOT by a zod
     * union. A union would make the field positions depend on which carrier is present,
     * and every patch path — `/nodes/3/light/intensity` — would stop being stable and
     * readable. Keeping the fields side by side costs one integrity rule and buys a patch
     * path that D1's incremental sync can dispatch on.
     */
    assetRef: AssetRefSchema.nullable(),
    /** v2 · a parametric box / sphere / … created in the editor, no asset involved. */
    primitive: PrimitiveSchema.nullable().default(null),
    /** v2 · a light. D12: a light is a node, so it inherits everything nodes already have. */
    light: LightSchema.nullable().default(null),
    /** v3 · 第四种承载体：剖切平面。位置与法向就是本节点的 transform。 */
    section: SectionSchema.nullable().default(null),
    transform: TransformSchema,
    visible: z.boolean().default(true),
    /** Editor-only: blocks picking and gizmo. Still rendered, still scriptable. */
    locked: z.boolean().default(false),
    /** v3 · 非空表示「本节点是爆炸分组」，成员是它的**直接**子节点。 */
    explode: ExplodeSchema.nullable().default(null),
    /** v3 · 父为爆炸分组时，本件在 factor=1 的位移（父的局部空间）。null = 由算法派生。 */
    explodeOffset: Vec3Schema.nullable().default(null),
    /** v3 · 本节点由哪个 prefab 实例化而来。v2 才有写入路径（T-232 是纯占位面）。 */
    prefabRef: PrefabRefSchema.nullable().default(null),
    overrides: NodeOverridesSchema.default({}),
  })
  .strict()
export type Node = z.infer<typeof NodeSchema>

/** The cap `NodeSchema.name` enforces. Exported so producers clamp against the real number. */
export const NODE_NAME_MAX = 120

/**
 * Fits an externally-supplied name inside `NODE_NAME_MAX`.
 *
 * Lives beside the constraint on purpose: the limit and the thing that respects it drifting
 * apart is how the bug this fixes happened. A GLB whose object name ran past 120 characters
 * produced a node the schema rejects — and because nothing re-validates on the way in, the
 * project SAVED and then refused to open, sending the user back to the sample scene with
 * their work apparently gone (T-176 审查所得).
 *
 * The tail is kept rather than the head: exporters generate names like
 * `Assembly_Rev3_SubAssembly_…_Bolt_M6x20`, where everything that tells two of them apart
 * is at the END. Truncating from the right would turn a hierarchy into forty identical rows.
 */
export function clampNodeName(raw: string): string {
  const name = raw.trim() === '' ? '对象' : raw.trim()
  if (name.length <= NODE_NAME_MAX) return name
  return `…${name.slice(name.length - (NODE_NAME_MAX - 1))}`
}
