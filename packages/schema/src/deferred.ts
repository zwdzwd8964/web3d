import { z } from 'zod'
import { AssetIdSchema, FlowIdSchema, MediaIdSchema, PageIdSchema, StepIdSchema } from './id.js'
import { ActionSchema } from './rule.js'

/**
 * SCHEMA_SPEC §7 · defined in v0, executed in v1.
 *
 * These structures have no v0 runtime and no v0 editing UI, and they are still in the
 * schema. Introducing them in v1 would force a schemaVersion bump plus a migration for
 * zero functional gain; defining them now is free. (MVP_V0 §1.2.)
 *
 * Every enum here is closed on purpose — these are exactly the three requirements most
 * likely to inflate under pressure.
 *
 * `constraints` is deliberately ABSENT. R04 is still awaiting customer clarification,
 * and its shape swings between ~1 person-day (parent/child binding) and 15+ (kinematic
 * solving). Guessing a structure would be worse than having none: it would look
 * decided.
 */

/* --- pages · R13's defence line against a page builder --------------------- */

export const OVERLAY_TYPES = ['text', 'image', 'button', 'panel'] as const
export const OverlayTypeSchema = z.enum(OVERLAY_TYPES)
export type OverlayType = z.infer<typeof OverlayTypeSchema>

export const OVERLAY_ANCHORS = ['tl', 'tc', 'tr', 'ml', 'mc', 'mr', 'bl', 'bc', 'br'] as const
export const OverlayAnchorSchema = z.enum(OVERLAY_ANCHORS)
export type OverlayAnchor = z.infer<typeof OverlayAnchorSchema>

export const OverlaySchema = z
  .object({
    id: z.string().min(1),
    type: OverlayTypeSchema,
    rect: z
      .object({
        x: z.number().finite(),
        y: z.number().finite(),
        w: z.number().finite(),
        h: z.number().finite(),
      })
      .strict(),
    anchor: OverlayAnchorSchema.default('tl'),
    props: z.record(z.string(), z.unknown()).default({}),
  })
  .strict()
export type Overlay = z.infer<typeof OverlaySchema>

export const PageSchema = z
  .object({
    id: PageIdSchema,
    name: z.string(),
    overlays: z.array(OverlaySchema).default([]),
  })
  .strict()
  .describe('v0 未实现')
export type Page = z.infer<typeof PageSchema>

/* --- flows · a thin layer over variables, never a BPM engine --------------- */

export const FlowStepSchema = z
  .object({
    id: StepIdSchema,
    name: z.string(),
    next: StepIdSchema.nullable(),
    onEnter: z.array(ActionSchema).default([]),
  })
  .strict()
export type FlowStep = z.infer<typeof FlowStepSchema>

export const FlowSchema = z
  .object({
    id: FlowIdSchema,
    name: z.string(),
    /** Which variable holds the current step — this is why flows stay C1-compliant. */
    variableId: z.string(),
    steps: z.array(FlowStepSchema).default([]),
  })
  .strict()
  .describe('v0 未实现')
export type Flow = z.infer<typeof FlowSchema>

/* --- media ----------------------------------------------------------------- */

export const MEDIA_TYPES = ['image', 'video', 'audio'] as const
export const MediaTypeSchema = z.enum(MEDIA_TYPES)
export type MediaType = z.infer<typeof MediaTypeSchema>

export const MediaSchema = z
  .object({
    id: MediaIdSchema,
    type: MediaTypeSchema,
    assetId: AssetIdSchema,
  })
  .strict()
  .describe('v0 未实现')
export type Media = z.infer<typeof MediaSchema>
