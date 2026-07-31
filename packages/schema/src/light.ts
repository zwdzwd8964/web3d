import { z } from 'zod'
import { HexColorSchema } from './primitives.js'

/**
 * SCHEMA_SPEC §4.4 · v0.5 进化规划 §4.1.3 · lights.
 *
 * A light is a NODE carrier, not a top-level collection (D12). That one decision is what
 * makes lights free: they inherit the hierarchy tree, the transform, the gizmo, undo,
 * visibility, `locked`, `refsTo` and incremental patching, all of which would otherwise
 * have to be written a second time for a `lights: []` array. The only new code is "build
 * the three object".
 *
 * **Directional and spot lights shine along the node's local -Z, and there is no `target`
 * object** (D13). Copying three's two-object light/target model into the document would
 * put a second thing in the tree that has to move together, undo together and be copied
 * together with the first. Core derives the target from the node's world matrix every
 * frame; that is an implementation detail and stays out of the document.
 *
 * `angleDeg` is stored in degrees because that is what the user types. Core converts.
 */

export const LIGHT_KINDS = ['ambient', 'hemisphere', 'directional', 'point', 'spot'] as const
export const LightKindSchema = z.enum(LIGHT_KINDS)
export type LightKind = z.infer<typeof LightKindSchema>

/** Chinese labels for the hierarchy tree and the library panel. */
export const LIGHT_LABELS: Record<LightKind, string> = {
  ambient: '环境光',
  hemisphere: '半球光',
  directional: '平行光',
  point: '点光源',
  spot: '聚光灯',
}

export const SHADOW_QUALITIES = ['low', 'medium', 'high'] as const
export const ShadowQualitySchema = z.enum(SHADOW_QUALITIES)
export type ShadowQuality = z.infer<typeof ShadowQualitySchema>

/**
 * Shadow settings for the lights that can cast one.
 *
 * `quality` is three buckets rather than a pixel count: the map size is a rendering
 * decision core owns (512 / 1024 / 2048), and a free-form number is a knob whose wrong
 * settings look like "the product is slow". `bias` has to be exposed — shadow acne is
 * scene-dependent and no default fits every model — but it is clamped to a range where a
 * wrong value degrades the picture instead of erasing the shadow entirely.
 */
export const ShadowSchema = z
  .object({
    enabled: z.boolean().default(false),
    quality: ShadowQualitySchema.default('medium'),
    bias: z.number().min(-0.01).max(0.01).default(-0.0005),
  })
  .strict()
  .default({ enabled: false, quality: 'medium', bias: -0.0005 })
export type Shadow = z.infer<typeof ShadowSchema>

export const LightSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('ambient'),
      color: HexColorSchema.default('#ffffff'),
      intensity: z.number().min(0).max(10).default(0.6),
    })
    .strict(),
  z
    .object({
      kind: z.literal('hemisphere'),
      skyColor: HexColorSchema.default('#ffffff'),
      groundColor: HexColorSchema.default('#444444'),
      intensity: z.number().min(0).max(10).default(0.6),
    })
    .strict(),
  z
    .object({
      kind: z.literal('directional'),
      color: HexColorSchema.default('#ffffff'),
      intensity: z.number().min(0).max(20).default(1.5),
      shadow: ShadowSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('point'),
      color: HexColorSchema.default('#ffffff'),
      intensity: z.number().min(0).max(20).default(1),
      /** 0 = unlimited. three's own convention, kept so the number means what it says. */
      range: z.number().nonnegative().default(0),
      decay: z.number().min(0).max(4).default(2),
      shadow: ShadowSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('spot'),
      color: HexColorSchema.default('#ffffff'),
      intensity: z.number().min(0).max(20).default(2),
      range: z.number().nonnegative().default(0),
      decay: z.number().min(0).max(4).default(2),
      /** Half-angle of the cone, in degrees. Core converts to radians. */
      angleDeg: z.number().min(1).max(89).default(30),
      penumbra: z.number().min(0).max(1).default(0.2),
      shadow: ShadowSchema,
    })
    .strict(),
])
export type Light = z.infer<typeof LightSchema>

/** The kinds that can cast a shadow — the others have no direction to cast one from. */
export const SHADOW_CAPABLE_KINDS: readonly LightKind[] = ['directional', 'point', 'spot']
