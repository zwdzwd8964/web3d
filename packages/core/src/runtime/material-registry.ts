import type { Material as MaterialDef, MaterialMaps, SceneDocument } from '@w3/schema'
import { MATERIAL_BASES } from '@w3/schema'
import {
  BackSide,
  ClampToEdgeWrapping,
  Color,
  DoubleSide,
  FrontSide,
  LinearSRGBColorSpace,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  RepeatWrapping,
  SRGBColorSpace,
} from 'three'
import type { Material, Mesh, Object3D, Texture } from 'three'
import type { SceneGraph } from './scene-graph.js'

/**
 * T-039 · MVP_V0 D3 · technical assessment R08.
 *
 * In glTF, several meshes sharing one Material instance is the norm, not an edge case.
 * Assigning to `mesh.material.roughness` therefore changes every mesh that shares it —
 * the user recolours one bolt and the whole pump turns. This is the first bug the
 * material feature hits, every time.
 *
 * The rule (D3):
 *   1. no override on this node          -> use the source material as-is;
 *   2. override, and the source material is referenced by more than one Object3D
 *                                        -> clone it, and hang the clone on this node only;
 *   3. reference count reaches zero       -> dispose.
 *
 * Case 2's condition matters: cloning unconditionally would multiply draw calls for a
 * scene where every part legitimately shares one steel material.
 */

// `TextureSource` moved to `texture-cache.ts` when the cache arrived (T-151): the thing
// that PRODUCES textures should own the shape of the handle it hands out.
import type { TextureSource } from './texture-cache.js'
export type { TextureSource }

/**
 * D3 · colour space is fixed per slot and is deliberately NOT a document field.
 *
 * Base-colour-ish maps carry sRGB; data maps carry linear. Getting this wrong tints the
 * whole scene and is reliably misdiagnosed as an art problem, so the runtime decides it
 * and the user cannot.
 */
export const TEXTURE_SLOT_COLOR_SPACE = {
  map: SRGBColorSpace,
  emissiveMap: SRGBColorSpace,
  normalMap: LinearSRGBColorSpace,
  roughnessMap: LinearSRGBColorSpace,
  metalnessMap: LinearSRGBColorSpace,
  aoMap: LinearSRGBColorSpace,
} as const satisfies Record<keyof MaterialMaps, typeof SRGBColorSpace | typeof LinearSRGBColorSpace>

export type TextureSlot = keyof typeof TEXTURE_SLOT_COLOR_SPACE

const SIDES = { front: FrontSide, back: BackSide, double: DoubleSide } as const

interface OwnedClone {
  readonly material: Material
  readonly clonedFrom: Material
  /**
   * The mesh this clone is attached to.
   *
   * Recorded because `SceneGraph.build` replaces every Object3D, so a node id is NOT a
   * stable handle on a mesh. Without this check the registry hands back a clone attached
   * to a mesh that is no longer in the scene, writes the user's material parameters into
   * it, and the mesh that IS in the scene keeps the asset's original — every material
   * override silently disappearing on any rebuild. See the regression test in
   * material-registry.test.ts.
   */
  readonly mesh: Mesh
  /**
   * The definition last applied to this clone.
   *
   * `applyParams` writes only the params a definition SPECIFIES; the ones it omits mean
   * "inherit the source material" (SCHEMA_SPEC §6.1). On a fresh clone not-writing equals
   * inheriting, but a REUSED clone still carries the previous definition's values — so
   * switching 默认材质 → 拉丝金属 left the grey behind wherever 拉丝金属 stayed silent,
   * and switching BACK to a definition that inherits its colour never brought the
   * source colour back (found by T-185's undo-parity extension, forward path included).
   * When the definition changes, the inherited params are re-seeded from `clonedFrom`
   * first; while it stays the same (slider drags, uv tweaks) the in-place merge remains.
   */
  lastDefId?: string
}

export interface MaterialRegistryOptions {
  readonly textures?: TextureSource
}

export class MaterialRegistry {
  private textures: TextureSource
  /** The material the asset originally gave a node, so an override can be undone. */
  private sources = new Map<string, { readonly mesh: Mesh; readonly material: Material | Material[] }>()
  /** Clones this registry owns and must dispose. */
  private owned = new Map<string, OwnedClone>()

  constructor(options: MaterialRegistryOptions = {}) {
    this.textures = options.textures ?? { get: () => undefined }
  }

  setTextureSource(source: TextureSource): void {
    this.textures = source
  }

  get cloneCount(): number {
    return this.owned.size
  }

  /** True when this node is rendering with a clone rather than the asset's material. */
  isCloned(nodeId: string): boolean {
    return this.owned.has(nodeId)
  }

  clonedFrom(nodeId: string): Material | undefined {
    return this.owned.get(nodeId)?.clonedFrom
  }

  /** Applies every node's material override in the document. */
  applyAll(doc: SceneDocument, graph: SceneGraph): void {
    const defs = new Map(doc.materials.map((m) => [m.id, m]))
    for (const node of doc.nodes) {
      this.applyToNode(node.id, node.overrides.materialId ?? null, defs, graph)
    }
  }

  /**
   * Points one node at a material definition, or back at its source material.
   *
   * `defs` is passed in rather than looked up from a document so the incremental patch
   * path can call this without rebuilding an index per patch.
   */
  applyToNode(
    nodeId: string,
    materialId: string | null,
    defs: ReadonlyMap<string, MaterialDef>,
    graph: SceneGraph,
  ): boolean {
    const object = graph.objectFor(nodeId)
    if (!object) return false
    const mesh = object as Mesh
    if (!mesh.isMesh) return false

    this.noteMesh(nodeId, mesh)

    if (materialId === null) {
      this.restore(nodeId, mesh)
      return true
    }

    const def = defs.get(materialId)
    if (!def) return false

    const target = this.rebaseIfNeeded(nodeId, this.ownedFor(nodeId, mesh, graph), def)
    const owned = this.owned.get(nodeId)!
    // A DIFFERENT definition inherits from the source, not from whatever the previous
    // definition left on the clone — see OwnedClone.lastDefId.
    if (owned.lastDefId !== def.id) resetInherited(target, owned.clonedFrom)
    applyParams(target, def, this.textures)
    owned.lastDefId = def.id
    return true
  }

  /**
   * T-153 · swaps the clone's CLASS when `base` changed, keeping the shared parameters.
   *
   * A `MeshStandardMaterial` silently accepts `transmission = 0.9` and renders no glass —
   * the property lands on the object and the shader never reads it, so changing `base` has
   * to build a different class.
   *
   * It takes an `OwnedClone` rather than a Material on purpose: the only instance the
   * registry may ever replace is a clone it owns. Writing a source material would reach
   * into the asset cache, which can back other scenes (ADR-0011) — and expressing that as a
   * runtime `if` produced a branch no test could reach, which is its own kind of lie. Here
   * it is the parameter type.
   */
  private rebaseIfNeeded(nodeId: string, owned: OwnedClone, def: MaterialDef): Material {
    const next = rebuildForBase(owned.material, def.base)
    if (next === owned.material) return owned.material

    owned.mesh.material = next
    this.owned.set(nodeId, { material: next, clonedFrom: owned.clonedFrom, mesh: owned.mesh })
    return next
  }

  /** Re-applies a definition whose params the user just edited. */
  updateDefinition(def: MaterialDef, doc: SceneDocument, graph: SceneGraph): void {
    const defs = new Map([[def.id, def]])
    for (const node of doc.nodes) {
      if (node.overrides.materialId === def.id) this.applyToNode(node.id, def.id, defs, graph)
    }
  }

  /**
   * A material this node may be written to without touching any other node.
   *
   * Public because highlighting (T-040) writes emissive on a per-node basis and must go
   * through the same clone-on-write path — otherwise highlighting one bolt would light
   * up every part sharing the steel material, which is R08 all over again.
   */
  acquireWritable(nodeId: string, graph: SceneGraph): Material | null {
    const object = graph.objectFor(nodeId)
    if (!object) return null
    const mesh = object as Mesh
    if (!mesh.isMesh) return null
    this.noteMesh(nodeId, mesh)
    return this.materialFor(nodeId, mesh, graph)
  }

  /**
   * Reconciles the registry's bookkeeping with the mesh currently in the graph.
   *
   * Called before every read or write. When the graph has been rebuilt under us the node
   * id still resolves, but to a different Object3D carrying a fresh copy of the asset's
   * material — so both the recorded source and any clone are stale and must be dropped.
   */
  private noteMesh(nodeId: string, mesh: Mesh): void {
    const recorded = this.sources.get(nodeId)
    if (recorded?.mesh === mesh) return

    const owned = this.owned.get(nodeId)
    if (owned) {
      this.owned.delete(nodeId)
      owned.material.dispose()
    }
    this.sources.set(nodeId, { mesh, material: mesh.material })
  }

  /**
   * The material this node may safely be written to. This single method is the whole of
   * R08's mitigation.
   *
   * D3 phrases case 2 as "clone *if* the source is referenced by more than one
   * Object3D". Implemented literally that is unsafe, and a test caught it: applying
   * overrides in sequence, the first node clones and the shared count drops from 2 to 1,
   * so the SECOND node sees an "unshared" material and writes the asset's own material
   * in place. The asset's materials belong to the asset cache and may back other scenes,
   * so that corruption escapes the document entirely.
   *
   * Therefore: a material owned by an asset is never written. Cloning is unconditional,
   * and per node — sharing one clone between nodes with the same override would be
   * cheaper, but then highlighting one of them would light up the others (T-040 goes
   * through this same path). See ADR-0011.
   */
  private materialFor(nodeId: string, mesh: Mesh, graph: SceneGraph): Material {
    return this.ownedFor(nodeId, mesh, graph).material
  }

  /** As `materialFor`, but hands back the whole record — see `rebaseIfNeeded`. */
  private ownedFor(nodeId: string, mesh: Mesh, graph: SceneGraph): OwnedClone {
    void graph
    const existing = this.owned.get(nodeId)
    // The mesh check is not belt and braces: see OwnedClone.mesh.
    if (existing && existing.mesh === mesh) return existing

    const current = mesh.material
    if (Array.isArray(current)) {
      // Multi-material meshes are out of scope for v0; overriding one would need a slot
      // index in the schema. Refuse rather than silently writing to slot 0.
      throw new Error(`节点 ${nodeId} 使用了多材质网格，v0 不支持对其应用材质覆盖`)
    }

    const clone = current.clone()
    clone.name = `${current.name || 'material'} (${nodeId})`
    mesh.material = clone
    const entry: OwnedClone = { material: clone, clonedFrom: current, mesh }
    this.owned.set(nodeId, entry)
    return entry
  }

  private restore(nodeId: string, mesh: Mesh): void {
    const source = this.sources.get(nodeId)
    const owned = this.owned.get(nodeId)
    if (owned) {
      this.owned.delete(nodeId)
      owned.material.dispose()
    }
    // Only restore a source recorded against THIS mesh; `noteMesh` guarantees it, but
    // assigning another mesh's material here would be a silent cross-wire.
    if (source && source.mesh === mesh) mesh.material = source.material
  }

  /** Drops every clone. Source materials belong to the asset cache, not to us. */
  dispose(): void {
    for (const { material } of this.owned.values()) material.dispose()
    this.owned.clear()
    this.sources.clear()
  }
}

/** How many Object3D under `root` currently reference this exact Material instance. */
export function countUsers(root: Object3D, material: Material): number {
  let count = 0
  root.traverse((child) => {
    const mesh = child as Mesh
    if (!mesh.isMesh) return
    if (mesh.material === material) count++
    else if (Array.isArray(mesh.material) && mesh.material.includes(material)) count++
  })
  return count
}

/**
 * Writes a document material definition onto a three material.
 *
 * A field absent from `params` means "inherit from the source material" (SCHEMA_SPEC
 * §6.1), so absent fields are skipped rather than reset to a default — resetting would
 * make the low-code "swap the asset, keep the look" behaviour impossible.
 */
export function applyParams(material: Material, def: MaterialDef, textures: TextureSource): void {
  const target = material as Material & Record<string, unknown>
  const p = def.params

  if (p.color !== undefined && target.color instanceof Color) target.color.set(p.color)
  if (p.roughness !== undefined) target.roughness = p.roughness
  if (p.metalness !== undefined) target.metalness = p.metalness
  if (p.opacity !== undefined) target.opacity = p.opacity
  if (p.transparent !== undefined) material.transparent = p.transparent
  if (p.emissive !== undefined && target.emissive instanceof Color) target.emissive.set(p.emissive)
  if (p.emissiveIntensity !== undefined) target.emissiveIntensity = p.emissiveIntensity
  if (p.side !== undefined) material.side = SIDES[p.side]

  applyPhysical(target, def)

  for (const slot of Object.keys(TEXTURE_SLOT_COLOR_SPACE) as TextureSlot[]) {
    const assetId = p.maps[slot]

    // Unsetting a slot has to CLEAR it. Skipping the undefined case leaves the previous
    // texture hanging on the material, so removing a normal map in the panel does nothing
    // visible and the user removes it again, and again.
    if (assetId === undefined) {
      if (target[slot] != null) target[slot] = null
      continue
    }

    const texture = textures.get(assetId, samplerVariant(slot, def))
    // Not yet resident: leave whatever is there rather than blanking the material while an
    // image decodes. The host calls `TextureCache.ensure` before handing patches over, so
    // this is the "still loading" window, not a missing asset.
    if (!texture) continue
    texture.colorSpace = TEXTURE_SLOT_COLOR_SPACE[slot]
    // The ao map's uv channel is a RUNTIME decision, like its colour space (D3) — the
    // document does not carry one and the user cannot mis-set it.
    //
    // Measured rather than assumed: `Texture.channel` defaults to 0 in three 0.185, which
    // is also where glTF ao maps almost always live, so this is a no-op for a texture the
    // cache just built. It is written down anyway because the value is NOT inherently
    // per-texture — three carries it on the Texture, so a texture that reached us with
    // channel 1 (a glTF that declared texCoord: 1, a future path that reuses a loaded
    // texture) would silently sample a uv set our meshes may not even have. Pinning it
    // here costs one assignment and removes a whole class of "the ao map does nothing".
    if (slot === 'aoMap') texture.channel = 0
    target[slot] = texture
  }

  applyUv(target, def)

  material.needsUpdate = true
}

/**
 * Re-seeds every param `applyParams` may leave untouched from the clone's SOURCE, so that
 * a param a definition omits means "the source material's value" (SCHEMA_SPEC §6.1) no
 * matter which definition was applied before — not-writing only equals inheriting while
 * the clone is fresh. Called when the definition BOUND to a node changes; slider drags on
 * the same definition keep the cheap in-place merge.
 *
 * Texture slots are exempt on purpose: for maps, absence means CLEAR (T-151), which
 * `applyParams` already enforces unconditionally. The physical five fall back to the
 * class defaults when the source is not physical — a standard-sourced glass definition
 * that omits `ior` should read as three's default, not as the previous definition's.
 */
function resetInherited(material: Material, source: Material): void {
  const target = material as Material & Record<string, unknown>
  const from = source as Material & Record<string, unknown>

  if (target.color instanceof Color) target.color.copy(from.color instanceof Color ? from.color : NEUTRAL_WHITE)
  if (target.roughness !== undefined) target.roughness = typeof from.roughness === 'number' ? from.roughness : 1
  if (target.metalness !== undefined) target.metalness = typeof from.metalness === 'number' ? from.metalness : 0
  material.opacity = typeof from.opacity === 'number' ? from.opacity : 1
  material.transparent = typeof from.transparent === 'boolean' ? from.transparent : false
  if (target.emissive instanceof Color) target.emissive.copy(from.emissive instanceof Color ? from.emissive : NEUTRAL_BLACK)
  if (target.emissiveIntensity !== undefined)
    target.emissiveIntensity = typeof from.emissiveIntensity === 'number' ? from.emissiveIntensity : 1
  material.side = typeof from.side === 'number' ? (from.side as Material['side']) : FrontSide

  if (isPhysical(target)) {
    target.transmission = typeof from.transmission === 'number' ? from.transmission : 0
    target.ior = typeof from.ior === 'number' ? from.ior : 1.5
    target.thickness = typeof from.thickness === 'number' ? from.thickness : 0
    target.clearcoat = typeof from.clearcoat === 'number' ? from.clearcoat : 0
    target.clearcoatRoughness = typeof from.clearcoatRoughness === 'number' ? from.clearcoatRoughness : 0
  }
}

const NEUTRAL_WHITE = new Color(0xffffff)
const NEUTRAL_BLACK = new Color(0x000000)

/**
 * T-153 · the physical-only parameters (glass, coated paint).
 *
 * Written only onto a material that understands them. Setting `transmission` on a
 * `MeshStandardMaterial` is not an error in JavaScript — the property simply lands on the
 * object and the renderer never reads it — so without this guard the panel would show a
 * glass slider that does exactly nothing, which is worse than not showing it. Integrity
 * check I15 is the other half: it tells the USER the parameter is being ignored.
 *
 * `transmission > 0` forces `transparent`. three's transmission path composites through
 * the transmission render target, and an opaque material never reaches it: the glass
 * renders as a solid lump, which reads as "transmission is broken" rather than as a
 * missing checkbox. The document is NOT rewritten for this — the runtime decides how to
 * draw what the document says, exactly as it does for texture colour space (D3).
 */
function applyPhysical(target: Material & Record<string, unknown>, def: MaterialDef): void {
  if (!isPhysical(target)) return
  const p = def.params

  if (p.transmission !== undefined) target.transmission = p.transmission
  if (p.ior !== undefined) target.ior = p.ior
  if (p.thickness !== undefined) target.thickness = p.thickness
  if (p.clearcoat !== undefined) target.clearcoat = p.clearcoat
  if (p.clearcoatRoughness !== undefined) target.clearcoatRoughness = p.clearcoatRoughness

  const transmission = typeof target.transmission === 'number' ? target.transmission : 0
  if (transmission > 0) (target as unknown as Material).transparent = true
}

const isPhysical = (material: unknown): material is MeshPhysicalMaterial =>
  (material as { isMeshPhysicalMaterial?: boolean }).isMeshPhysicalMaterial === true

/**
 * The three class a document `base` names, for the two bases v0.5 can build.
 *
 * `basic` and `lambert` are in the schema (they are what an unlit label or a cheap
 * background needs) but nothing creates them yet, so a document asking for one keeps the
 * class the asset gave it rather than being silently downgraded. That is a REGISTERED gap,
 * not a silent one: `canRebuildBase` says out loud which bases this build can honour.
 */
export const REBUILDABLE_BASES = ['standard', 'physical'] as const satisfies readonly (typeof MATERIAL_BASES)[number][]

export const canRebuildBase = (base: string): base is (typeof REBUILDABLE_BASES)[number] =>
  (REBUILDABLE_BASES as readonly string[]).includes(base)

/**
 * Parameters both classes share, migrated when `base` changes.
 *
 * Spelled out rather than done with `copy()`. `MeshPhysicalMaterial.copy(standardMaterial)`
 * reads `source.clearcoat`, `source.ior` and friends, which do not exist on a standard
 * material — the result is a material full of `undefined` and `NaN`, and three's shader
 * compiler reports it far away from the cause. This card's acceptance is literally
 * 「玻璃参数组合渲染路径无 NaN」.
 */
const SHARED_MATERIAL_FIELDS = [
  'name',
  'roughness',
  'metalness',
  'opacity',
  'transparent',
  'emissiveIntensity',
  'side',
  'visible',
  'depthTest',
  'depthWrite',
  'alphaTest',
  'map',
  'normalMap',
  'roughnessMap',
  'metalnessMap',
  'aoMap',
  'emissiveMap',
] as const

/**
 * Rebuilds a material as the class `base` names, carrying the shared parameters across.
 *
 * Returns the SAME instance when the class already matches — the caller must be able to
 * treat "no change" as free, because this runs on every apply.
 */
export function rebuildForBase(material: Material, base: string): Material {
  if (!canRebuildBase(base)) return material
  const wantsPhysical = base === 'physical'
  if (isPhysical(material) === wantsPhysical) return material

  const next = wantsPhysical ? new MeshPhysicalMaterial() : new MeshStandardMaterial()
  const from = material as unknown as Record<string, unknown>
  const to = next as unknown as Record<string, unknown>

  for (const field of SHARED_MATERIAL_FIELDS) {
    const value = from[field]
    if (value === undefined) continue
    to[field] = value
  }
  // Colours are objects: assigning the reference would tie the two materials together, so
  // the next colour edit on one would silently change the other.
  if (from['color'] instanceof Color && to['color'] instanceof Color) (to['color'] as Color).copy(from['color'])
  if (from['emissive'] instanceof Color && to['emissive'] instanceof Color) {
    ;(to['emissive'] as Color).copy(from['emissive'])
  }

  material.dispose()
  return next
}

/**
 * The UV transform, applied to EVERY slot the material has (v0.5 §4.2).
 *
 * three stores repeat/offset/rotation on the Texture, not on the material — and textures
 * are shared between materials by the cache. So the transform is written on every apply
 * rather than once: two materials using the same concrete map at different tilings must
 * each get their own, and the last one to apply wins for a shared instance. That is a
 * known limit of one-texture-per-asset, and it is registered rather than hidden: the
 * alternative (a Texture per material per slot) is the VRAM blow-up the cache exists to
 * prevent.
 *
 * `rotationDeg` in, radians out — every angle the user types in this product is degrees.
 */
/**
 * The sampler state this (slot, material) pair will write onto its texture.
 *
 * Everything below lives ON the three `Texture`, not on the material — so two uses that
 * disagree on any of it cannot share one instance. Asking the cache for a variant per
 * distinct combination is what stops them fighting. Uses that AGREE still share, so the
 * count stays bounded by the number of distinct settings, not by the number of materials.
 *
 * Two reproduced failures this keys off (T-176 审查所得):
 *   - colour space: the same image in 「基础色」 and 「粗糙度」 — the last slot written wins,
 *     so the base colour is sampled linear and the object renders washed out;
 *   - uv: two materials tiling one image differently — the last one applied wins, and
 *     「分离材质」 does not separate it, because the material was never what they shared.
 */
export function samplerVariant(slot: TextureSlot, def: MaterialDef): string {
  const uv = def.params.uv
  const tiling = uv === undefined ? '1,1|0,0|0' : `${uv.repeat.join(',')}|${uv.offset.join(',')}|${uv.rotationDeg}`
  return `${TEXTURE_SLOT_COLOR_SPACE[slot]}|${tiling}|${slot === 'aoMap' ? 'ao' : ''}`
}

function applyUv(target: Material & Record<string, unknown>, def: MaterialDef): void {
  const uv = def.params.uv
  for (const slot of Object.keys(TEXTURE_SLOT_COLOR_SPACE) as TextureSlot[]) {
    const texture = target[slot]
    if (!isTexture(texture)) continue

    if (uv === undefined) {
      // No uv block means the schema's identity, not "leave whatever was there": a texture
      // reused from another material would otherwise arrive pre-tiled.
      texture.repeat.set(1, 1)
      texture.offset.set(0, 0)
      texture.rotation = 0
    } else {
      texture.repeat.set(uv.repeat[0], uv.repeat[1])
      texture.offset.set(uv.offset[0], uv.offset[1])
      texture.rotation = (uv.rotationDeg * Math.PI) / 180
    }

    // Rotation is around the uv origin by default, which spins the texture off the surface.
    // The centre is what every authoring tool means by "rotate the texture".
    texture.center.set(0.5, 0.5)

    // Tiling below 1× is a crop; at or above it the texture must wrap or the surface shows
    // one copy and stretched edge pixels for the rest.
    const wrap = texture.repeat.x > 1 || texture.repeat.y > 1 ? RepeatWrapping : ClampToEdgeWrapping
    if (texture.wrapS === wrap && texture.wrapT === wrap) continue

    texture.wrapS = wrap
    texture.wrapT = wrap
    // `needsUpdate` ONLY here, and this is the whole point of the guard above.
    //
    // repeat / offset / rotation / center are UNIFORMS — three recomputes the uv matrix
    // every frame anyway (`matrixAutoUpdate`), and touching them costs nothing. The wrap
    // mode is a sampler parameter, which does need a re-bind.
    //
    // Setting it unconditionally re-uploaded the whole image instead: dragging the
    // roughness slider for one second on a material with six 2048² maps meant ~60 × 100 MB
    // of texImage2D plus mipmap rebuilds, and the frame rate fell to single digits. And
    // because the cache shares one Texture per asset, the re-upload hit every material
    // using it. Found by T-176's review.
    texture.needsUpdate = true
  }
}

const isTexture = (value: unknown): value is Texture =>
  typeof value === 'object' && value !== null && (value as { isTexture?: boolean }).isTexture === true
