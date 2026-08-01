import type { Asset, Material, MaterialBase, MaterialMaps, SceneDocument, UvTransform } from '@w3/schema'
import { PHYSICAL_ONLY_PARAMS } from '@w3/schema'

/**
 * T-152 · what the material panel actually does to the document.
 *
 * Separated from the JSX for the reason M10's review made expensive: the editor's tests run
 * in plain Node, so a rule living inside an `onChange` handler can be described in a test
 * and never executed. Two features shipped that way and neither was wired up.
 *
 * Every function here mutates a DRAFT — call inside `commit` or `preview`, never on a live
 * document (铁律 2).
 */

/** The six slots, in the order the panel lists them, with the label the user reads. */
export const TEXTURE_SLOTS: readonly { readonly slot: keyof MaterialMaps; readonly label: string }[] = [
  { slot: 'map', label: '基础色' },
  { slot: 'normalMap', label: '法线' },
  { slot: 'roughnessMap', label: '粗糙度' },
  { slot: 'metalnessMap', label: '金属度' },
  { slot: 'aoMap', label: '环境光遮蔽' },
  { slot: 'emissiveMap', label: '自发光' },
]

/** The physical-only parameters, with the label and the range the schema allows. */
export const PHYSICAL_FIELDS: readonly {
  readonly key: (typeof PHYSICAL_ONLY_PARAMS)[number]
  readonly label: string
  readonly min: number
  readonly max: number
  readonly step: number
}[] = [
  { key: 'transmission', label: '透射', min: 0, max: 1, step: 0.01 },
  { key: 'ior', label: '折射率', min: 1, max: 2.5, step: 0.01 },
  { key: 'thickness', label: '厚度', min: 0, max: 1, step: 0.001 },
  { key: 'clearcoat', label: '清漆', min: 0, max: 1, step: 0.01 },
  { key: 'clearcoatRoughness', label: '清漆粗糙度', min: 0, max: 1, step: 0.01 },
]

/** The schema's identity transform, written out — what an untouched material behaves as. */
export const IDENTITY_UV: UvTransform = { repeat: [1, 1], offset: [0, 0], rotationDeg: 0 }

/** Texture assets a slot can be pointed at. HDRIs are environment maps, not surface maps. */
export const textureAssets = (doc: SceneDocument): readonly Asset[] => doc.assets.filter((a) => a.type === 'texture')

/** Finds a material in a draft. Returns undefined rather than throwing — the panel may lag a delete. */
const find = (draft: SceneDocument, materialId: string): Material | undefined =>
  draft.materials.find((m) => m.id === materialId)

/**
 * Points one texture slot at an asset, or clears it.
 *
 * Clearing DELETES the key rather than writing `undefined`: `maps` is a strict object and an
 * explicit undefined survives a JSON round-trip as a key with no value, which then fails
 * validation on reload — a document that saves fine and cannot be opened.
 */
export function setMap(draft: SceneDocument, materialId: string, slot: keyof MaterialMaps, assetId: string | null): void {
  const material = find(draft, materialId)
  if (!material) return
  if (assetId === null) delete material.params.maps[slot]
  else material.params.maps[slot] = assetId
}

/**
 * Writes the UV transform.
 *
 * Materialises the whole block from the identity rather than patching one field into a
 * possibly-absent object: `uv` is optional, and `draft.params.uv.repeat = …` on a material
 * that has never had one throws.
 */
export function setUv(draft: SceneDocument, materialId: string, patch: Partial<UvTransform>): void {
  const material = find(draft, materialId)
  if (!material) return
  const current = material.params.uv ?? IDENTITY_UV
  material.params.uv = {
    repeat: patch.repeat ? [...patch.repeat] : [...current.repeat],
    offset: patch.offset ? [...patch.offset] : [...current.offset],
    rotationDeg: patch.rotationDeg ?? current.rotationDeg,
  }
}

/** Drops the UV block entirely — the panel's 「重置」. Absent and identity render the same. */
export function clearUv(draft: SceneDocument, materialId: string): void {
  const material = find(draft, materialId)
  if (material) delete material.params.uv
}

/**
 * Changes the material's base.
 *
 * Leaving `standard` DISCARDS the physical-only parameters. The alternative — keep them so
 * they come back if the user switches to glass again — leaves a document that integrity
 * check I15 warns about for as long as it exists, describing a state the user cannot see in
 * the panel (the fields are hidden) and did not ask for. Undo is how you get them back.
 */
export function setBase(draft: SceneDocument, materialId: string, base: MaterialBase): void {
  const material = find(draft, materialId)
  if (!material) return
  material.base = base
  if (base === 'physical') return
  for (const key of PHYSICAL_ONLY_PARAMS) delete material.params[key]
}

/** Writes one physical-only parameter. */
export function setPhysical(
  draft: SceneDocument,
  materialId: string,
  key: (typeof PHYSICAL_ONLY_PARAMS)[number],
  value: number,
): void {
  const material = find(draft, materialId)
  if (material) material.params[key] = value
}

/**
 * How many nodes render with this material.
 *
 * The panel shows it next to every edit, because 「改一个螺栓、整台泵都变了」 is the first
 * thing a material feature does to someone. The runtime's clone-on-write means it does NOT
 * happen (铁律 9), but the count is what tells the user which case they are in BEFORE they
 * drag a slider — the registry can only make the behaviour correct, not obvious.
 */
export const usersOfMaterial = (doc: SceneDocument, materialId: string): number =>
  doc.nodes.filter((n) => n.overrides.materialId === materialId).length
