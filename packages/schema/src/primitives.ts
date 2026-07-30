import { z } from 'zod'

/** Finite numbers only: NaN and Infinity round-trip through JSON as `null`. */
export const Finite = z.number().finite()

export const Vec3 = z.tuple([Finite, Finite, Finite])
export type Vec3 = z.infer<typeof Vec3>

/** Rotation is stored as a quaternion [x, y, z, w]; Euler angles are a UI concern only. */
export const Quat = z.tuple([Finite, Finite, Finite, Finite])
export type Quat = z.infer<typeof Quat>

export const HexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'expected #rrggbb')
export type HexColor = z.infer<typeof HexColor>

export const Unit01 = z.number().min(0).max(1)

/**
 * Local transform, short keys as fixed by the technical assessment §1.2.
 * p = position, r = rotation (quaternion), s = scale.
 */
export const Transform = z
  .object({
    p: Vec3,
    r: Quat,
    s: Vec3,
  })
  .strict()
export type Transform = z.infer<typeof Transform>

export const IDENTITY_TRANSFORM: Transform = {
  p: [0, 0, 0],
  r: [0, 0, 0, 1],
  s: [1, 1, 1],
}

/** A transform where any component may be omitted — used by tween targets. */
export const PartialTransform = z
  .object({
    p: Vec3.optional(),
    r: Quat.optional(),
    s: Vec3.optional(),
  })
  .strict()
  .refine((t) => t.p !== undefined || t.r !== undefined || t.s !== undefined, {
    message: 'a tween target must change at least one of p / r / s',
  })
export type PartialTransform = z.infer<typeof PartialTransform>

/** ISO-8601 instant. Stored as a string so documents diff cleanly in git. */
export const Timestamp = z.string().datetime({ offset: true })
export type Timestamp = z.infer<typeof Timestamp>

/** `sha256:<64 lowercase hex>` — see D4, content-addressed assets. */
export const ContentHash = z.string().regex(/^sha256:[0-9a-f]{64}$/, 'expected "sha256:<64 hex>"')
export type ContentHash = z.infer<typeof ContentHash>

export const EASINGS = [
  'linear',
  'easeInQuad',
  'easeOutQuad',
  'easeInOutQuad',
  'easeInCubic',
  'easeOutCubic',
  'easeInOutCubic',
  'easeInQuart',
  'easeOutQuart',
  'easeInOutQuart',
  'easeInSine',
  'easeOutSine',
  'easeInOutSine',
  'easeInExpo',
  'easeOutExpo',
  'easeInOutExpo',
] as const
export const Easing = z.enum(EASINGS)
export type Easing = z.infer<typeof Easing>
