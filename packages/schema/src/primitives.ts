import { z } from 'zod'

/**
 * SCHEMA_SPEC §4 / §6 · shared value types.
 *
 * Note on `.finite()`: the spec writes plain `z.number()`. We narrow to finite because
 * SCHEMA_SPEC §0.5 requires `JSON.parse(JSON.stringify(doc))` to round-trip equal, and
 * NaN / Infinity serialise to `null`. This accepts strictly fewer documents and rejects
 * no valid one. Recorded in ADR-0006.
 */
const Num = z.number().finite()

export const Vec3Schema = z.tuple([Num, Num, Num])
export type Vec3 = z.infer<typeof Vec3Schema>

/** Quaternion `[x, y, z, w]`. Euler angles are a UI concern only (SCHEMA_SPEC §4.1-3). */
export const QuatSchema = z.tuple([Num, Num, Num, Num])
export type Quat = z.infer<typeof QuatSchema>

export const HexColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'expected #rrggbb')
export type HexColor = z.infer<typeof HexColorSchema>

/** ISO 8601 UTC instant. */
export const TimestampSchema = z.string().datetime()
export type Timestamp = z.infer<typeof TimestampSchema>

export const ContentHashSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/, 'expected "sha256:<64 hex>"')
export type ContentHash = z.infer<typeof ContentHashSchema>

export const TransformSchema = z
  .object({
    p: Vec3Schema.default([0, 0, 0]),
    r: QuatSchema.default([0, 0, 0, 1]),
    s: Vec3Schema.default([1, 1, 1]),
  })
  .strict()
export type Transform = z.infer<typeof TransformSchema>

export const IDENTITY_TRANSFORM: Transform = { p: [0, 0, 0], r: [0, 0, 0, 1], s: [1, 1, 1] }

/** A fresh identity transform. Never hand out the shared constant — callers mutate. */
export function identityTransform(): Transform {
  return { p: [0, 0, 0], r: [0, 0, 0, 1], s: [1, 1, 1] }
}

/** Partial transform used by tween endpoints (SCHEMA_SPEC §6.2). */
export const PartialTransformSchema = z
  .object({
    p: Vec3Schema.optional(),
    r: QuatSchema.optional(),
    s: Vec3Schema.optional(),
  })
  .strict()
export type PartialTransform = z.infer<typeof PartialTransformSchema>

/** SCHEMA_SPEC §6.2 · the closed easing set. */
export const EASINGS = [
  'linear',
  'easeInQuad',
  'easeOutQuad',
  'easeInOutQuad',
  'easeInCubic',
  'easeOutCubic',
  'easeInOutCubic',
  'easeInBack',
  'easeOutBack',
  'easeInOutBack',
] as const
export const EasingSchema = z.enum(EASINGS)
export type Easing = z.infer<typeof EasingSchema>

/** `order` step used when appending siblings (SCHEMA_SPEC §4.1-4). */
export const ORDER_STEP = 1000
