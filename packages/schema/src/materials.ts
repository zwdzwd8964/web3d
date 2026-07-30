import { z } from 'zod'
import { AssetId, MaterialId } from './ids.js'
import { HexColor, Unit01 } from './primitives.js'

/**
 * D3 · colour space is part of the contract, not a rendering detail.
 *
 * Base-colour-ish maps carry sRGB data; data maps (normal / roughness / metalness /
 * AO) carry linear data. Getting this wrong tints the whole scene and is reliably
 * misdiagnosed as "the artist's textures are off". The runtime reads this table
 * instead of guessing from the slot name.
 */
export const TEXTURE_SLOTS = {
  map: { colorSpace: 'srgb', label: '基础色贴图' },
  emissiveMap: { colorSpace: 'srgb', label: '自发光贴图' },
  normalMap: { colorSpace: 'linear', label: '法线贴图' },
  roughnessMap: { colorSpace: 'linear', label: '粗糙度贴图' },
  metalnessMap: { colorSpace: 'linear', label: '金属度贴图' },
  aoMap: { colorSpace: 'linear', label: '环境光遮蔽贴图' },
} as const

export type TextureSlot = keyof typeof TEXTURE_SLOTS
export const TEXTURE_SLOT_NAMES = Object.keys(TEXTURE_SLOTS) as TextureSlot[]

export const MaterialMaps = z
  .object({
    map: AssetId.nullable().optional(),
    emissiveMap: AssetId.nullable().optional(),
    normalMap: AssetId.nullable().optional(),
    roughnessMap: AssetId.nullable().optional(),
    metalnessMap: AssetId.nullable().optional(),
    aoMap: AssetId.nullable().optional(),
  })
  .strict()
export type MaterialMaps = z.infer<typeof MaterialMaps>

export const MaterialParams = z
  .object({
    color: HexColor,
    roughness: Unit01,
    metalness: Unit01,
    opacity: Unit01,
    transparent: z.boolean(),
    emissive: HexColor,
    emissiveIntensity: z.number().min(0).max(10),
    doubleSided: z.boolean(),
  })
  .strict()
export type MaterialParams = z.infer<typeof MaterialParams>

export const DEFAULT_MATERIAL_PARAMS: MaterialParams = {
  color: '#b8bec4',
  roughness: 0.6,
  metalness: 0.1,
  opacity: 1,
  transparent: false,
  emissive: '#000000',
  emissiveIntensity: 0,
  doubleSided: false,
}

export const Material = z
  .object({
    id: MaterialId,
    name: z.string(),
    /**
     * Reserved for the v1 material library ("lib/steel"). v0 has no library, so this
     * is always null — but defining it now means adding the library is a data change,
     * not a schemaVersion bump.
     */
    base: z.string().nullable(),
    params: MaterialParams,
    maps: MaterialMaps,
  })
  .strict()
export type Material = z.infer<typeof Material>
