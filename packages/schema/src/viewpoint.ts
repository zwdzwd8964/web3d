import { z } from 'zod'
import { AssetIdSchema, ViewpointIdSchema } from './id.js'
import { Vec3Schema } from './primitives.js'

/**
 * SCHEMA_SPEC §6.5 · viewpoints.
 *
 * The camera stores `target` rather than a quaternion: it is what an orbit controller
 * already works in, it is readable in a diff, and it interpolates without the shortest-arc
 * surprises a quaternion pair produces mid-flight.
 */

export const CAMERA_KINDS = ['perspective', 'orthographic'] as const
export const CameraKindSchema = z.enum(CAMERA_KINDS)
export type CameraKind = z.infer<typeof CameraKindSchema>

export const CameraSchema = z
  .object({
    kind: CameraKindSchema.default('perspective'),
    position: Vec3Schema,
    target: Vec3Schema,
    up: Vec3Schema.default([0, 1, 0]),
    fov: z.number().min(1).max(179).default(50),
    /** Used by the orthographic camera. */
    zoom: z.number().positive().default(1),
    near: z.number().positive().default(0.1),
    far: z.number().positive().default(1000),
  })
  .strict()
export type Camera = z.infer<typeof CameraSchema>

export const ViewpointSchema = z
  .object({
    id: ViewpointIdSchema,
    name: z.string().min(1),
    camera: CameraSchema,
    /**
     * v3 · 由 `thumbnailUrl` 改名而来——**本次 bump 唯一一处字段删除**（X-07）。
     *
     * 老字段今天零读零写，而且形状本来就是错的：存 URL 意味着缩略图不进资产表，于是
     * 它不被 `remapAssetRefs` 认识、不进 `referencedHashes`、发布时丢字节。schema 在 v1
     * 只 bump 一次，这是唯一一次能改它的机会。
     *
     * ⚠ **这是一条新的资产入边**：`remapAssetRefs` 与 `referencedHashes` 必须认识它。
     */
    thumbnailAssetId: AssetIdSchema.optional(),
  })
  .strict()
export type Viewpoint = z.infer<typeof ViewpointSchema>
