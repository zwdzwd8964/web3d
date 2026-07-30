import { z } from 'zod'
import { AnimationIdSchema, AssetIdSchema, NodeIdSchema } from './id.js'
import { EasingSchema, PartialTransformSchema } from './primitives.js'

/**
 * SCHEMA_SPEC §6.2 · animations. This is R03's engineering defence line.
 *
 * `kind` is a closed discriminated union with exactly two members. When the customer
 * asks for "a keyframe timeline with curve editing", implementing it requires a third
 * `kind` — i.e. a schema change — which mechanically triggers triage Q3 (NORTH_STAR §4)
 * and therefore a written change order. Without the closed enum, that same request gets
 * absorbed as "we can support that" over a weekend, unpriced.
 */

export const ImportedAnimationSchema = z
  .object({
    kind: z.literal('imported'),
    id: AnimationIdSchema,
    name: z.string().min(1),
    assetId: AssetIdSchema,
    /** The clip's name inside the GLB. glTF has no stable clip ids, so this is by name. */
    clipName: z.string(),
    speed: z.number().positive().default(1),
    loop: z.boolean().default(false),
    clampWhenFinished: z.boolean().default(true),
  })
  .strict()
export type ImportedAnimation = z.infer<typeof ImportedAnimationSchema>

export const TweenTargetSchema = z
  .object({
    nodeId: NodeIdSchema,
    /**
     * Absent = capture the node's live state at the moment playback starts.
     * That is what almost every authored tween actually wants.
     */
    from: PartialTransformSchema.optional(),
    to: PartialTransformSchema,
  })
  .strict()
export type TweenTarget = z.infer<typeof TweenTargetSchema>

export const TweenAnimationSchema = z
  .object({
    kind: z.literal('tween'),
    id: AnimationIdSchema,
    name: z.string().min(1),
    /** Seconds. */
    duration: z.number().positive(),
    easing: EasingSchema.default('easeInOutCubic'),
    loop: z.boolean().default(false),
    yoyo: z.boolean().default(false),
    targets: z.array(TweenTargetSchema).min(1),
  })
  .strict()
export type TweenAnimation = z.infer<typeof TweenAnimationSchema>

export const AnimationSchema = z.discriminatedUnion('kind', [ImportedAnimationSchema, TweenAnimationSchema])
export type Animation = z.infer<typeof AnimationSchema>

export const ANIMATION_KINDS = ['imported', 'tween'] as const
export type AnimationKind = (typeof ANIMATION_KINDS)[number]
