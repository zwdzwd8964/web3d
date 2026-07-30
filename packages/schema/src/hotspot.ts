import { z } from 'zod'
import { HotspotIdSchema, MediaIdSchema, NodeIdSchema } from './id.js'
import { HexColorSchema, Vec3Schema } from './primitives.js'

/**
 * SCHEMA_SPEC §6.4 · hotspots.
 *
 * MVP_V0 §1.3 scopes v0 to the parts that are genuinely *core* capability — anchor
 * projection, occlusion testing and a plain-text panel. Rich text and embedded media
 * are feature-layer work and belong to v1; `mediaId` is defined here so that adding
 * them later costs no migration.
 */

export const HOTSPOT_MARKERS = ['dot', 'pin', 'number'] as const
export const HotspotMarkerSchema = z.enum(HOTSPOT_MARKERS)
export type HotspotMarker = z.infer<typeof HotspotMarkerSchema>

export const HotspotContentSchema = z
  .object({
    /** Closed enum with one member today — the extension point for v1, not a free string. */
    type: z.literal('panel'),
    title: z.string().default(''),
    text: z.string().default(''),
    /** v0 defines but does not render this. */
    mediaId: MediaIdSchema.optional(),
  })
  .strict()
export type HotspotContent = z.infer<typeof HotspotContentSchema>

export const HotspotStyleSchema = z
  .object({
    marker: HotspotMarkerSchema.default('dot'),
    color: HexColorSchema.default('#ffb020'),
  })
  .strict()
export type HotspotStyle = z.infer<typeof HotspotStyleSchema>

export const HotspotSchema = z
  .object({
    id: HotspotIdSchema,
    name: z.string().min(1),
    anchor: z
      .object({
        nodeId: NodeIdSchema,
        /** Offset in the node's local space. */
        offset: Vec3Schema.default([0, 0, 0]),
      })
      .strict(),
    /** MVP_V0 D7 · raycast camera -> anchor to decide whether the marker is behind geometry. */
    occlude: z.boolean().default(true),
    /** Initial visibility. Runtime visibility is not persisted (C1). */
    visible: z.boolean().default(true),
    fadeWithDistance: z.boolean().default(false),
    content: HotspotContentSchema,
    style: HotspotStyleSchema.default({ marker: 'dot', color: '#ffb020' }),
  })
  .strict()
export type Hotspot = z.infer<typeof HotspotSchema>
