import { z } from 'zod'
import { ViewpointIdSchema } from './id.js'
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
    thumbnailUrl: z.string().optional(),
  })
  .strict()
export type Viewpoint = z.infer<typeof ViewpointSchema>
