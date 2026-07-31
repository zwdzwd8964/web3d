import { z } from 'zod'
import { AssetIdSchema, MaterialIdSchema, NodeIdSchema } from './id.js'
import { LightSchema } from './light.js'
import { PrimitiveSchema } from './primitive.js'
import { TransformSchema } from './primitives.js'

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
    transform: TransformSchema,
    visible: z.boolean().default(true),
    /** Editor-only: blocks picking and gizmo. Still rendered, still scriptable. */
    locked: z.boolean().default(false),
    overrides: NodeOverridesSchema.default({}),
  })
  .strict()
export type Node = z.infer<typeof NodeSchema>
