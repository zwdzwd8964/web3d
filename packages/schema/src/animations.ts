import { z } from 'zod'
import { AnimationId, AssetId, NodeId } from './ids.js'
import { Easing, PartialTransform } from './primitives.js'

/**
 * R03 · `kind` is a *closed* enum, deliberately.
 *
 * "Animation authoring" is the single most inflatable requirement on this contract:
 * left open it becomes a keyframe timeline with curve editing and a state machine.
 * Because the enum is closed, adding a third kind requires a schema change, which
 * mechanically triggers triage Q3 (NORTH_STAR §4) — i.e. a written decision and a
 * re-priced change order, instead of a quiet weekend of scope creep.
 */

export const ImportedAnimation = z
  .object({
    id: AnimationId,
    name: z.string(),
    kind: z.literal('imported'),
    assetId: AssetId,
    /** The clip's name inside the GLB. Not an id — glTF has no stable clip ids. */
    clipName: z.string().min(1),
    loop: z.boolean(),
    speed: z.number().positive(),
  })
  .strict()
export type ImportedAnimation = z.infer<typeof ImportedAnimation>

export const TweenTarget = z
  .object({
    nodeId: NodeId,
    /** Omitted = capture the node's live transform when the tween starts. */
    from: PartialTransform.nullable(),
    to: PartialTransform,
  })
  .strict()
export type TweenTarget = z.infer<typeof TweenTarget>

export const TweenAnimation = z
  .object({
    id: AnimationId,
    name: z.string(),
    kind: z.literal('tween'),
    targets: z.array(TweenTarget).min(1),
    durationMs: z.number().positive(),
    easing: Easing,
    loop: z.boolean(),
  })
  .strict()
export type TweenAnimation = z.infer<typeof TweenAnimation>

export const Animation = z.discriminatedUnion('kind', [ImportedAnimation, TweenAnimation])
export type Animation = z.infer<typeof Animation>

export const ANIMATION_KINDS = ['imported', 'tween'] as const
export type AnimationKind = (typeof ANIMATION_KINDS)[number]
