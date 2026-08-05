import type { Background, SceneDocument } from '@w3/schema'
import { DEFAULT_ENVIRONMENT } from '@w3/schema'

/**
 * T-155 · applying an HDRI, as one document change.
 *
 * Three fields move together and there is no useful state in which only some of them have:
 * the environment map, the background type, and (implicitly, via D14) whether the built-in
 * light rig stands down. Writing them in separate commits would mean an undo that leaves a
 * scene lit by an HDRI it is no longer showing.
 *
 * The card says 「一条 commit」 for exactly this reason, and 「撤销一步环境整体还原」 is the
 * observable form of it.
 */

/** Points the scene at an HDRI and shows it behind the model. One call, one commit. */
export function applyHdri(draft: SceneDocument, assetId: string): void {
  draft.meta.environment = { ...draft.meta.environment, hdriAssetId: assetId }
  // The map doubles as the backdrop. Leaving the background on `color` gives the strange
  // half-state where objects are lit by a sky nobody can see, which reads as "the HDRI did
  // not work" — the user then applies another one.
  draft.meta.background = { ...draft.meta.background, type: 'hdri' }
}

/**
 * Clears the environment and puts the backdrop back to a colour.
 *
 * Not the same as undo: this is the user saying "no environment", and it has to leave a
 * document that renders — a `background.type: 'hdri'` with no HDRI is a scene with no
 * backdrop at all.
 */
export function clearHdri(draft: SceneDocument): void {
  draft.meta.environment = { ...draft.meta.environment, hdriAssetId: null }
  draft.meta.background = { ...draft.meta.background, type: 'color' }
}

/** The environment a fresh project has — what 「清除」 is measured against. */
export const NO_ENVIRONMENT = DEFAULT_ENVIRONMENT

/** HDRI assets in the project. Surface textures are not environments. */
export const hdriAssets = (doc: SceneDocument) => doc.assets.filter((a) => a.type === 'hdri')

/**
 * Points a material's base-colour slot at a texture asset.
 *
 * The 「挂到 map 槽位」 shortcut the texture tab offers: importing a texture and then having
 * to find the material panel, open the picker and choose the thing you just imported is
 * three steps for something the user already said they wanted.
 *
 * Returns false when the node has no material of its own — the caller must say so rather
 * than silently importing an asset nobody can see.
 */
export function assignToBaseColour(draft: SceneDocument, nodeId: string, assetId: string): boolean {
  const node = draft.nodes.find((n) => n.id === nodeId)
  const materialId = node?.overrides.materialId
  if (materialId === undefined) return false
  const material = draft.materials.find((m) => m.id === materialId)
  if (!material) return false
  material.params.maps.map = assetId
  return true
}

/* --- 背景与曝光（T-242）--------------------------------------------------- */

/**
 * 换背景类型。**不清空 `color`**——在 color / transparent 之间来回切是调参时最常见的
 * 动作，清空的话切回来用户挑的那个颜色就没了（与 `setFogType` 逐字同一条纪律）。
 *
 * ⚠ `hdri` 这一档在面板里不给：把背景设成 hdri 而 `environment.hdriAssetId` 是 null，
 * 结果是一片纯黑而没有任何提示。资源库那条「设为环境」路径才是它的入口。
 */
export function setBackgroundType(draft: SceneDocument, type: Background['type']): void {
  draft.meta.background = { ...draft.meta.background, type }
}

/** 改背景色。 */
export function setBackgroundColor(draft: SceneDocument, color: string): void {
  draft.meta.background = { ...draft.meta.background, color }
}

/**
 * 改曝光。
 *
 * 它是**场景的艺术选择**，不是渲染器设置——`toneMapping` 曲线刻意不是字段
 * （`document.ts` 的注释逐字写着理由），而 `exposure` 是。
 */
export function setExposure(draft: SceneDocument, exposure: number): void {
  draft.meta.environment = { ...draft.meta.environment, exposure }
}

/** 改环境光强度。只有挂了 HDRI 时才有可见效果，面板据此禁用它。 */
export function setEnvIntensity(draft: SceneDocument, intensity: number): void {
  draft.meta.environment = { ...draft.meta.environment, intensity }
}
