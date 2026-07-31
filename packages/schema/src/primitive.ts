import { z } from 'zod'
import { Vec3Schema } from './primitives.js'

/**
 * SCHEMA_SPEC §4.3 · v0.5 进化规划 §4.1.2 · parametric primitives.
 *
 * A node carries at most one of `assetRef` / `primitive` / `light` (§4.1.1). A primitive
 * node is a box, a sphere, a cylinder — geometry the editor can create without any
 * imported asset, which is what makes an empty project usable at all.
 *
 * **Semantic dimensions only, no segment counts.** How many radial segments a cylinder is
 * tessellated with is a rendering decision, and putting it in the document would (a) make
 * the same document look different across core versions that tune it, and (b) hand the
 * user a knob whose only effect is to make things slower. Core fixes the tessellation, the
 * same way it fixes texture colour space (MVP_V0 D3) — the parallel is deliberate.
 *
 * `kind` is a closed discriminated union: an eighth primitive is a schema change, which
 * mechanically triggers triage Q3 (NORTH_STAR §4) instead of being added on a quiet
 * afternoon.
 */

export const PRIMITIVE_KINDS = ['box', 'sphere', 'cylinder', 'cone', 'torus', 'plane', 'capsule'] as const
export const PrimitiveKindSchema = z.enum(PRIMITIVE_KINDS)
export type PrimitiveKind = z.infer<typeof PrimitiveKindSchema>

/** Chinese labels for the library panel. Here rather than in the editor: one list, one order. */
export const PRIMITIVE_LABELS: Record<PrimitiveKind, string> = {
  box: '立方体',
  sphere: '球体',
  cylinder: '圆柱',
  cone: '圆锥',
  torus: '圆环',
  plane: '平面',
  capsule: '胶囊体',
}

export const PrimitiveSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('box'), size: Vec3Schema.default([1, 1, 1]) }).strict(),
  z.object({ kind: z.literal('sphere'), radius: z.number().positive().default(0.5) }).strict(),
  z
    .object({
      kind: z.literal('cylinder'),
      // Non-negative rather than positive: a zero radius at one end is how a cone-frustum
      // is expressed, and refusing it would make the user pick `cone` and lose the other end.
      radiusTop: z.number().nonnegative().default(0.5),
      radiusBottom: z.number().nonnegative().default(0.5),
      height: z.number().positive().default(1),
    })
    .strict(),
  z
    .object({ kind: z.literal('cone'), radius: z.number().positive().default(0.5), height: z.number().positive().default(1) })
    .strict(),
  z
    .object({ kind: z.literal('torus'), radius: z.number().positive().default(0.5), tube: z.number().positive().default(0.15) })
    .strict(),
  z
    .object({ kind: z.literal('plane'), width: z.number().positive().default(1), height: z.number().positive().default(1) })
    .strict(),
  z
    .object({ kind: z.literal('capsule'), radius: z.number().positive().default(0.3), length: z.number().positive().default(0.6) })
    .strict(),
])
export type Primitive = z.infer<typeof PrimitiveSchema>
