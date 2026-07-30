import { z } from 'zod'
import { AssetIdSchema, MaterialIdSchema, NodeIdSchema } from './id.js'
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
    /** null = a pure grouping node (an empty Group), created by the user. */
    assetRef: AssetRefSchema.nullable(),
    transform: TransformSchema,
    visible: z.boolean().default(true),
    /** Editor-only: blocks picking and gizmo. Still rendered, still scriptable. */
    locked: z.boolean().default(false),
    overrides: NodeOverridesSchema.default({}),
  })
  .strict()
export type Node = z.infer<typeof NodeSchema>
