import { z } from 'zod'
import { AssetId, FlowId, FlowStepId, MediaId, NodeId, PageId, VariableId } from './ids.js'
import { Finite } from './primitives.js'

/**
 * MVP_V0 §1.2 · "not built" is not the same as "not in the schema".
 *
 * `pages`, `media` and `flows` have no v0 runtime and no v0 editing UI. Their field
 * and type definitions still land in schema v1, because introducing them in v1 would
 * force a schemaVersion bump and a migration for zero functional gain. Defining them
 * now is free; defining them later is not.
 *
 * Every enum here is closed on purpose — these are exactly the three requirements
 * most likely to inflate (R13 page builder, R04 constraints, media library).
 */

/* --- pages (R13: overlays, never a site builder) --------------------------- */

export const OVERLAY_TYPES = ['text', 'image', 'button', 'panel'] as const
export const OverlayType = z.enum(OVERLAY_TYPES)
export type OverlayType = z.infer<typeof OverlayType>

/** Normalised viewport coordinates so overlays survive a resize. */
export const OverlayRect = z
  .object({ x: Finite, y: Finite, w: Finite, h: Finite })
  .strict()

export const Overlay = z
  .object({
    id: z.string().min(1),
    type: OverlayType,
    rect: OverlayRect,
    text: z.string(),
    mediaId: MediaId.nullable(),
    visible: z.boolean(),
  })
  .strict()
export type Overlay = z.infer<typeof Overlay>

export const Page = z
  .object({
    id: PageId,
    name: z.string(),
    overlays: z.array(Overlay),
  })
  .strict()
export type Page = z.infer<typeof Page>

/* --- media ----------------------------------------------------------------- */

export const MEDIA_TYPES = ['image', 'audio', 'video'] as const
export const MediaType = z.enum(MEDIA_TYPES)
export type MediaType = z.infer<typeof MediaType>

export const MediaItem = z
  .object({
    id: MediaId,
    name: z.string(),
    type: MediaType,
    assetId: AssetId,
  })
  .strict()
export type MediaItem = z.infer<typeof MediaItem>

/* --- flows (a thin layer over rules + variables, never a BPM engine) ------- */

export const FlowStep = z
  .object({
    id: FlowStepId,
    name: z.string(),
    /** null = terminal step. */
    next: FlowStepId.nullable(),
  })
  .strict()
export type FlowStep = z.infer<typeof FlowStep>

export const Flow = z
  .object({
    id: FlowId,
    name: z.string(),
    steps: z.array(FlowStep),
    /** The variable holding the current step id; this is how a flow stays C1-compliant. */
    stateVariableId: VariableId.nullable(),
  })
  .strict()
export type Flow = z.infer<typeof Flow>

/* --- constraints (R04: shape intentionally undefined) ---------------------- */

/**
 * R04 · "constraint relationship integration" is the highest-variance line item on
 * the contract: parent/child binding is ~1 person-day, kinematic solving is 15+.
 * Until the customer clarifies, this field exists but has *no internal structure* —
 * writing one now would be guessing at a number that decides the project's margin.
 */
export const Constraint = z.object({ id: z.string().min(1) }).catchall(z.unknown())
export type Constraint = z.infer<typeof Constraint>

/* --- environment ----------------------------------------------------------- */

export const Environment = z
  .object({
    background: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    /** Simple three-light rig; no IBL in v0 (it would need an HDR asset pipeline). */
    ambientIntensity: z.number().min(0).max(10),
    keyIntensity: z.number().min(0).max(10),
    fillIntensity: z.number().min(0).max(10),
    showGrid: z.boolean(),
    showGround: z.boolean(),
  })
  .strict()
export type Environment = z.infer<typeof Environment>

export const DEFAULT_ENVIRONMENT: Environment = {
  background: '#14171a',
  ambientIntensity: 0.6,
  keyIntensity: 2.1,
  fillIntensity: 0.55,
  showGrid: true,
  showGround: true,
}

/** Reserved but unused in v0; declared so a future selection model has a home. */
export const NodeSelectionHint = z.object({ nodeId: NodeId }).strict()
