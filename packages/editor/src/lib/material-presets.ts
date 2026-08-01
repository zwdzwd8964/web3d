import type { MaterialBase, MaterialParams, SceneDocument } from '@w3/schema'
import { collectAllIds, createMaterial, defaultFactoryContext } from '@w3/schema'
import type { FactoryContext } from '@w3/schema'

/**
 * T-154 · D16 · material presets, which are FILLERS and not references.
 *
 * Applying a preset commits its full parameter set into the document's material record and
 * notes `preset` for provenance. The document is then self-contained: delete the whole
 * library directory and a published `.w3p` still renders exactly as it did. This is C6
 * mirrored at the data layer.
 *
 * The tempting alternative — store `preset: 'brushed-metal'` and look the parameters up at
 * runtime — fails twice. A package deployed without the library renders wrong, and editing
 * the preset library retroactively changes every project that ever used it.
 *
 * `preset` is therefore a LABEL, never a link: nothing reads it back to resolve parameters.
 * It exists so the panel can say 「基于 拉丝金属」 and so a future 「更新到新版预设」 knows
 * where a material came from.
 */

export interface MaterialPreset {
  /** Stable key, written into `material.preset`. Never resolved back into parameters. */
  readonly id: string
  readonly label: string
  readonly base: MaterialBase
  /** The FULL parameter set. Applying one leaves nothing inherited to be surprised by. */
  readonly params: MaterialParams
}

/** A neutral starting point every preset overrides in full, so none of them is half-specified. */
const blank = (): MaterialParams => ({ maps: {} })

/**
 * Ten presets covering the materials a mechanical or architectural scene is actually made
 * of. Values are plausible physical ones rather than pretty ones: a preset that looks good
 * on a sphere and wrong on a machine is worse than no preset.
 */
export const MATERIAL_PRESETS: readonly MaterialPreset[] = [
  {
    id: 'brushed-metal',
    label: '拉丝金属',
    base: 'standard',
    params: { ...blank(), color: '#b6bcc2', roughness: 0.45, metalness: 1, opacity: 1, transparent: false },
  },
  {
    id: 'polished-metal',
    label: '抛光金属',
    base: 'standard',
    params: { ...blank(), color: '#d8dde2', roughness: 0.08, metalness: 1, opacity: 1, transparent: false },
  },
  {
    id: 'matte-plastic',
    label: '哑光塑料',
    base: 'standard',
    params: { ...blank(), color: '#4a5560', roughness: 0.85, metalness: 0, opacity: 1, transparent: false },
  },
  {
    id: 'glossy-plastic',
    label: '亮面塑料',
    base: 'standard',
    params: { ...blank(), color: '#2f6fb5', roughness: 0.2, metalness: 0, opacity: 1, transparent: false },
  },
  {
    id: 'rubber',
    label: '橡胶',
    base: 'standard',
    params: { ...blank(), color: '#1b1e21', roughness: 0.95, metalness: 0, opacity: 1, transparent: false },
  },
  {
    id: 'glass',
    label: '玻璃',
    base: 'physical',
    params: {
      ...blank(),
      color: '#ffffff',
      roughness: 0.02,
      metalness: 0,
      opacity: 1,
      transparent: true,
      transmission: 1,
      ior: 1.52,
      thickness: 0.01,
    },
  },
  {
    id: 'frosted-glass',
    label: '磨砂玻璃',
    base: 'physical',
    params: {
      ...blank(),
      color: '#ffffff',
      roughness: 0.45,
      metalness: 0,
      opacity: 1,
      transparent: true,
      transmission: 0.9,
      ior: 1.5,
      thickness: 0.02,
    },
  },
  {
    id: 'wood',
    label: '木',
    base: 'standard',
    params: { ...blank(), color: '#8a5a33', roughness: 0.7, metalness: 0, opacity: 1, transparent: false },
  },
  {
    id: 'ceramic',
    label: '陶瓷',
    base: 'physical',
    params: {
      ...blank(),
      color: '#f2efe9',
      roughness: 0.15,
      metalness: 0,
      opacity: 1,
      transparent: false,
      clearcoat: 0.8,
      clearcoatRoughness: 0.05,
    },
  },
  {
    id: 'acrylic',
    label: '亚克力',
    base: 'physical',
    params: {
      ...blank(),
      color: '#eaf4ff',
      roughness: 0.05,
      metalness: 0,
      opacity: 1,
      transparent: true,
      transmission: 0.85,
      ior: 1.49,
      thickness: 0.005,
    },
  },
]

export const presetById = (id: string): MaterialPreset | undefined => MATERIAL_PRESETS.find((p) => p.id === id)

/**
 * Writes a preset's parameters into a material record.
 *
 * The texture slots are KEPT. A preset describes a surface's response to light, not what is
 * printed on it: someone who set a wood grain map and then picks 「木」 wants the roughness,
 * not an empty slot. Presets carry no maps of their own, so there is nothing to overwrite
 * them with either.
 */
export function applyPreset(draft: SceneDocument, materialId: string, preset: MaterialPreset): void {
  const material = draft.materials.find((m) => m.id === materialId)
  if (!material) return
  const maps = { ...material.params.maps }
  const uv = material.params.uv

  material.base = preset.base
  material.preset = preset.id
  material.params = { ...preset.params, maps, ...(uv ? { uv } : {}) }
}

/** Nodes rendering with this material. `>1` is what makes the 分离 question worth asking. */
export const nodesUsing = (doc: SceneDocument, materialId: string): readonly string[] =>
  doc.nodes.filter((n) => n.overrides.materialId === materialId).map((n) => n.id)

/**
 * Gives `nodeId` its own copy of the material and points it there.
 *
 * The document-level twin of 铁律 9. The runtime already clones the three material per node,
 * so an edit never leaks between meshes — but the DOCUMENT still has one record, and editing
 * it changes every node that points at it. Separating is how the user says "this one is
 * different from now on".
 *
 * Returns the new material's id, or null when there was nothing to separate.
 */
export function separateMaterial(
  draft: SceneDocument,
  nodeId: string,
  options: { ctx?: FactoryContext } = {},
): string | null {
  const node = draft.nodes.find((n) => n.id === nodeId)
  const sourceId = node?.overrides.materialId
  if (!node || sourceId === undefined) return null
  const source = draft.materials.find((m) => m.id === sourceId)
  if (!source) return null
  const factory = options.ctx ?? defaultFactoryContext

  const copy = createMaterial({
    // Numbered, because the material dropdown is the ONLY way to pick one and three records
    // all called 「拉丝不锈钢 副本」 are indistinguishable in it (M11 审查所得).
    name: uniqueName(draft, `${source.name} 副本`),
    base: source.base,
    preset: source.preset,
    // Deep enough: `maps` and `uv` are the only nested objects, and sharing either would
    // reintroduce exactly the coupling this function exists to break.
    params: { ...source.params, maps: { ...source.params.maps }, ...(source.params.uv ? { uv: { ...source.params.uv } } : {}) },
    // Minted against the ids already in the document. `createMaterial` does not do this
    // for you, and a separate that collides with an existing material id would silently
    // repoint some other node.
    ctx: { newId: (kind) => factory.newId(kind, collectAllIds(draft)), now: factory.now },
  })

  draft.materials.push(copy)
  node.overrides.materialId = copy.id
  return copy.id
}

/** `X 副本`, `X 副本 2`, `X 副本 3`… — the first name that is not already taken. */
function uniqueName(draft: SceneDocument, wanted: string): string {
  const taken = new Set(draft.materials.map((m) => m.name))
  if (!taken.has(wanted)) return wanted
  for (let n = 2; ; n++) {
    const candidate = `${wanted} ${n}`
    if (!taken.has(candidate)) return candidate
  }
}
