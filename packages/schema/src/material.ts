import { z } from 'zod'
import { AssetIdSchema, MaterialIdSchema } from './id.js'
import { HexColorSchema, Vec2Schema } from './primitives.js'

/**
 * SCHEMA_SPEC §6.1 · materials.
 *
 * Every field in `params` is optional, and that is the point: a missing field means
 * "inherit from the source material", exactly like node overrides. Materialising the
 * full parameter set at import would silently freeze the instance against its asset.
 *
 * Colour space is deliberately NOT a document field. It is fixed per texture slot by
 * the runtime (MVP_V0 D3): base-colour-ish maps are sRGB, data maps are linear.
 * Exposing it would let a user mis-set it, and the symptom — the whole scene slightly
 * off-colour — gets reliably misdiagnosed as an art problem.
 */

export const MATERIAL_BASES = ['standard', 'physical', 'basic', 'lambert'] as const
export const MaterialBaseSchema = z.enum(MATERIAL_BASES)
export type MaterialBase = z.infer<typeof MaterialBaseSchema>

export const MATERIAL_SIDES = ['front', 'back', 'double'] as const
export const MaterialSideSchema = z.enum(MATERIAL_SIDES)
export type MaterialSide = z.infer<typeof MaterialSideSchema>

export const MaterialMapsSchema = z
  .object({
    map: AssetIdSchema.optional(),
    normalMap: AssetIdSchema.optional(),
    roughnessMap: AssetIdSchema.optional(),
    metalnessMap: AssetIdSchema.optional(),
    aoMap: AssetIdSchema.optional(),
    emissiveMap: AssetIdSchema.optional(),
  })
  .strict()
export type MaterialMaps = z.infer<typeof MaterialMapsSchema>

/** Which slots carry colour data. Read by the runtime, not by the user (MVP_V0 D3). */
export const SRGB_TEXTURE_SLOTS: readonly (keyof MaterialMaps)[] = ['map', 'emissiveMap']
export const LINEAR_TEXTURE_SLOTS: readonly (keyof MaterialMaps)[] = [
  'normalMap',
  'roughnessMap',
  'metalnessMap',
  'aoMap',
]

/**
 * v2 · one UV transform for ALL of the material's texture slots.
 *
 * Per-slot UV was considered and rejected (v0.5 灰区裁决): it multiplies the panel by six
 * for something under 5% of real materials need, and the case it serves — a detail normal
 * map tiling faster than the base colour — is better solved in the authoring tool.
 *
 * `rotationDeg` in degrees, like every other angle the user types; core converts.
 */
export const UvTransformSchema = z
  .object({
    repeat: Vec2Schema.default([1, 1]),
    offset: Vec2Schema.default([0, 0]),
    rotationDeg: z.number().min(-360).max(360).default(0),
  })
  .strict()
export type UvTransform = z.infer<typeof UvTransformSchema>

/**
 * Parameters that only `base: 'physical'` understands. Present on a standard material is
 * not an error — the value is simply ignored by the renderer — so integrity check I15
 * reports it at WARN level: it is a configuration mistake the user should see, not a
 * reason to block a publish.
 */
export const PHYSICAL_ONLY_PARAMS = ['transmission', 'ior', 'thickness', 'clearcoat', 'clearcoatRoughness'] as const
export type PhysicalOnlyParam = (typeof PHYSICAL_ONLY_PARAMS)[number]

export const MaterialParamsSchema = z
  .object({
    color: HexColorSchema.optional(),
    roughness: z.number().min(0).max(1).optional(),
    metalness: z.number().min(0).max(1).optional(),
    opacity: z.number().min(0).max(1).optional(),
    transparent: z.boolean().optional(),
    emissive: HexColorSchema.optional(),
    emissiveIntensity: z.number().min(0).optional(),
    side: MaterialSideSchema.optional(),
    maps: MaterialMapsSchema.default({}),

    // v2 · physical-only. Glass, coated paint, and the like.
    transmission: z.number().min(0).max(1).optional(),
    ior: z.number().min(1).max(2.5).optional(),
    thickness: z.number().min(0).optional(),
    clearcoat: z.number().min(0).max(1).optional(),
    clearcoatRoughness: z.number().min(0).max(1).optional(),

    // v2 · applies to every slot in `maps`.
    uv: UvTransformSchema.optional(),
  })
  .strict()
export type MaterialParams = z.infer<typeof MaterialParamsSchema>

export const MaterialSchema = z
  .object({
    id: MaterialIdSchema,
    name: z.string().min(1),
    base: MaterialBaseSchema.default('standard'),
    /** Built-in material template reference; v0 ships only 'custom'. */
    preset: z.string().default('custom'),
    // Zod 4 defaults are typed against the OUTPUT shape, and `maps` is required there.
    params: MaterialParamsSchema.default({ maps: {} }),
  })
  .strict()
export type Material = z.infer<typeof MaterialSchema>
