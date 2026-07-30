import { z } from 'zod'
import { AssetId } from './ids.js'
import { ContentHash, Timestamp } from './primitives.js'

/**
 * D4 · assets are immutable and content-addressed.
 *
 * An asset entry is never edited. "Update the model" means: add a new asset, then
 * run remapAssetRefs() to move the configuration across (D5). This is what makes
 * a published snapshot reproducible years later — the bytes behind a hash cannot
 * have changed underneath it.
 */

export const ASSET_TYPES = ['model', 'texture', 'image', 'audio', 'video'] as const
export const AssetType = z.enum(ASSET_TYPES)
export type AssetType = z.infer<typeof AssetType>

/**
 * Import-time health report (R01). Its thresholds are the numeric source of
 * Appendix A, and its verdicts are the contractual shield when a customer hands
 * over a 4-million-triangle CAD export.
 */
export const AssetStats = z
  .object({
    bytes: z.number().int().nonnegative(),
    triangles: z.number().int().nonnegative(),
    drawCalls: z.number().int().nonnegative(),
    meshes: z.number().int().nonnegative(),
    materials: z.number().int().nonnegative(),
    textures: z.number().int().nonnegative(),
    /** Sum of decoded texture memory in bytes, not file size. This is what kills GPUs. */
    textureBytes: z.number().int().nonnegative(),
    maxTextureSize: z.number().int().nonnegative(),
    animations: z.number().int().nonnegative(),
    nodes: z.number().int().nonnegative(),
    /** Bounding box in source units, before normalisation. */
    boundsMin: z.tuple([z.number(), z.number(), z.number()]).optional(),
    boundsMax: z.tuple([z.number(), z.number(), z.number()]).optional(),
  })
  .strict()
export type AssetStats = z.infer<typeof AssetStats>

/** One object inside a model asset. Used for re-import matching (D5), never as a key. */
export const AssetObjectEntry = z
  .object({
    /** Slash-joined ancestry inside the asset, e.g. `Root/Pump/Body`. */
    path: z.string().min(1),
    name: z.string(),
    hasMesh: z.boolean(),
  })
  .strict()
export type AssetObjectEntry = z.infer<typeof AssetObjectEntry>

export const Asset = z
  .object({
    id: AssetId,
    type: AssetType,
    /** Original file name, for display only. Never a key (C9). */
    filename: z.string().min(1),
    mimeType: z.string().min(1),
    hash: ContentHash,
    /** Storage path derived from the hash: `assets/ab/12/ab12….glb` (D4). */
    url: z.string().min(1),
    bytes: z.number().int().nonnegative(),
    /**
     * Monotonic per logical asset lineage, not per hash. Two uploads of the same
     * bytes share a hash and never create a version 2.
     */
    version: z.number().int().positive(),
    /** Set when this asset supersedes an earlier one, so lineage survives re-import. */
    supersedes: AssetId.nullable(),
    stats: AssetStats.nullable(),
    /** Flat index of every object in a model asset, in traversal order. */
    objects: z.array(AssetObjectEntry),
    createdAt: Timestamp,
  })
  .strict()
export type Asset = z.infer<typeof Asset>

/**
 * The three-way redundancy demanded by the technical assessment §1.2 discipline 2.
 * `assetId` is the key; `objectPath` and `objectName` exist purely so that a
 * re-uploaded asset can be matched back (D5). Losing any one of the three costs
 * a whole strategy tier in the remap ladder.
 */
export const AssetRef = z
  .object({
    assetId: AssetId,
    objectPath: z.string().min(1),
    objectName: z.string(),
    /**
     * D5 · an orphaned reference is marked, never deleted. Deleting a customer's
     * configuration because a re-import missed one object is not acceptable.
     */
    missing: z.boolean().optional(),
  })
  .strict()
export type AssetRef = z.infer<typeof AssetRef>
