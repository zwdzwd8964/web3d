import { z } from 'zod'
import { AnimationSchema } from './animation.js'
import { AssetSchema } from './asset.js'
import { FlowSchema, PageSchema } from './deferred.js'
import { HotspotSchema } from './hotspot.js'
import { AssetIdSchema, ProjectIdSchema } from './id.js'
import { MaterialSchema } from './material.js'
import { MediaSchema } from './media.js'
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

export const CURRENT_VERSION = 2

export const SCENE_UNITS = ['m', 'cm', 'mm'] as const
export const UP_AXES = ['Y', 'Z'] as const
/** v2 adds `'hdri'`: the environment map doubles as the visible backdrop. */
export const BACKGROUND_TYPES = ['color', 'transparent', 'hdri'] as const

export const BackgroundSchema = z
  .object({
    type: z.enum(BACKGROUND_TYPES),
    /** Kept even when `type` is not `'color'`, so switching back restores the user's pick. */
    color: HexColorSchema.default('#1a1a1a'),
  })
  .strict()
export type Background = z.infer<typeof BackgroundSchema>

/**
 * v2 · image-based lighting.
 *
 * `hdriAssetId` is the switch for the whole feature: non-null means core builds a PMREM
 * environment from that `.hdr` and — per D14 — the built-in default light rig stands down.
 * Null restores v0's look exactly, which is what gate G0.5-6 asserts.
 *
 * **`toneMapping` is deliberately NOT a field.** Which tone-mapping curve to use is a
 * rendering decision that follows from whether there is an HDRI at all (ACESFilmic when
 * there is, v0's setting when there is not). Exposing it would let a user produce a washed
 * out scene through a control they cannot connect to the symptom — the same reasoning that
 * keeps texture colour space out of the document (MVP_V0 D3).
 *
 * `exposure` IS a field: it is an artistic choice about the scene, not about the renderer.
 */
export const EnvironmentSchema = z
  .object({
    /** Points at an asset with `type: 'hdri'`. null = no IBL. Checked by I12. */
    hdriAssetId: AssetIdSchema.nullable().default(null),
    intensity: z.number().min(0).max(4).default(1),
    exposure: z.number().min(0.1).max(4).default(1),
  })
  .strict()
export type Environment = z.infer<typeof EnvironmentSchema>

export const DEFAULT_ENVIRONMENT: Environment = { hdriAssetId: null, intensity: 1, exposure: 1 }

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
    environment: EnvironmentSchema.default({ hdriAssetId: null, intensity: 1, exposure: 1 }),
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
    /** Defined in v0, given a runtime in v0.5 — see media.ts and SCHEMA_SPEC §6.7. */
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
