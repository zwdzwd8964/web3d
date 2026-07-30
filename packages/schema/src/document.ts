import { z } from 'zod'
import { AnimationSchema } from './animation.js'
import { AssetSchema } from './asset.js'
import { FlowSchema, MediaSchema, PageSchema } from './deferred.js'
import { HotspotSchema } from './hotspot.js'
import { ProjectIdSchema } from './id.js'
import { MaterialSchema } from './material.js'
import { NodeSchema } from './node.js'
import { HexColorSchema, TimestampSchema } from './primitives.js'
import { RuleSchema } from './rule.js'
import { VariableSchema } from './variable.js'
import { ViewpointSchema } from './viewpoint.js'

/**
 * SCHEMA_SPEC §1 · the single source of truth (C1).
 *
 * If a feature needs to survive a reload, it is a field here. If it cannot be pointed
 * at a field here, the feature is designed wrong — that is the one question every
 * change has to answer (NORTH_STAR §2, C1).
 *
 * Runtime state — the current playback head, the hovered object, the live camera
 * position, which panel happens to be open — is explicitly NOT here. It is derived and
 * per-session; persisting it would make every mouse move a document mutation.
 *
 * Every collection is an ARRAY, not a Map/Record: order is user-visible (hierarchy tree,
 * rule list, animation list), and an Immer patch path stays readable as
 * `/nodes/3/transform/p`. Lookup cost is solved by a runtime index (index-builder.ts),
 * never by changing the persisted shape.
 */

export const CURRENT_VERSION = 1

export const SCENE_UNITS = ['m', 'cm', 'mm'] as const
export const UP_AXES = ['Y', 'Z'] as const
export const BACKGROUND_TYPES = ['color', 'transparent'] as const

export const BackgroundSchema = z
  .object({
    type: z.enum(BACKGROUND_TYPES),
    color: HexColorSchema.default('#1a1a1a'),
  })
  .strict()
export type Background = z.infer<typeof BackgroundSchema>

/**
 * `unit` and `upAxis` record the DOCUMENT's target coordinate system. An asset whose
 * own system differs is normalised once at import (SCHEMA_SPEC §5.2); the runtime then
 * performs zero coordinate conversion.
 */
export const MetaSchema = z
  .object({
    unit: z.enum(SCENE_UNITS).default('m'),
    upAxis: z.enum(UP_AXES).default('Y'),
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
    background: BackgroundSchema.default({ type: 'color', color: '#1a1a1a' }),
  })
  .strict()
export type Meta = z.infer<typeof MetaSchema>

export const SceneDocumentSchema = z
  .object({
    schemaVersion: z.literal(CURRENT_VERSION),
    projectId: ProjectIdSchema,
    name: z.string().min(1).max(120),
    meta: MetaSchema,

    assets: z.array(AssetSchema),
    nodes: z.array(NodeSchema),
    materials: z.array(MaterialSchema),
    animations: z.array(AnimationSchema),
    hotspots: z.array(HotspotSchema),
    viewpoints: z.array(ViewpointSchema),
    variables: z.array(VariableSchema),
    rules: z.array(RuleSchema),

    // Defined in v0, no runtime until v1 — see deferred.ts and SCHEMA_SPEC §7.
    pages: z.array(PageSchema).default([]),
    flows: z.array(FlowSchema).default([]),
    media: z.array(MediaSchema).default([]),
  })
  .strict()
export type SceneDocument = z.infer<typeof SceneDocumentSchema>

/** Collections keyed by a generated id, in the order checkIntegrity reports them. */
export const ID_COLLECTIONS = [
  'assets',
  'nodes',
  'materials',
  'animations',
  'hotspots',
  'viewpoints',
  'variables',
  'rules',
  'pages',
  'flows',
  'media',
] as const
export type IdCollection = (typeof ID_COLLECTIONS)[number]
