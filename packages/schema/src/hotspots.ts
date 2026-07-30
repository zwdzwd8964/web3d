import { z } from 'zod'
import { HotspotId, NodeId, ViewpointId } from './ids.js'
import { Finite, Vec3 } from './primitives.js'

/**
 * MVP_V0 §1.3 · hotspots are in scope for v0, but only the parts that are *core*
 * capability: anchor projection, occlusion testing, and a plain-text panel.
 * Rich text and embedded media are feature-layer work and belong to v1.
 */
export const Hotspot = z
  .object({
    id: HotspotId,
    name: z.string(),
    anchor: z
      .object({
        nodeId: NodeId,
        /** Offset from the node's world origin, in scene units. */
        offset: Vec3,
      })
      .strict(),
    /** D7 · raycast from camera to anchor each frame (or every N frames). */
    occlude: z.boolean(),
    visible: z.boolean(),
    /** Short marker text, always drawn. */
    label: z.string(),
    /**
     * `type` is a closed enum for the same reason as animation kinds: "information
     * panel" must not drift into "embedded web page" (R13).
     */
    content: z
      .object({
        type: z.literal('panel'),
        title: z.string(),
        body: z.string(),
      })
      .strict(),
  })
  .strict()
export type Hotspot = z.infer<typeof Hotspot>

export const CameraPose = z
  .object({
    position: Vec3,
    target: Vec3,
    /** Vertical field of view in degrees. */
    fov: Finite.gt(0).lt(180),
    near: Finite.gt(0),
    far: Finite.gt(0),
  })
  .strict()
  .refine((c) => c.far > c.near, { message: 'far must be greater than near' })
export type CameraPose = z.infer<typeof CameraPose>

export const Viewpoint = z
  .object({
    id: ViewpointId,
    name: z.string(),
    camera: CameraPose,
  })
  .strict()
export type Viewpoint = z.infer<typeof Viewpoint>
