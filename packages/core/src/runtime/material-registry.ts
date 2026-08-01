import type { Material as MaterialDef, MaterialMaps, SceneDocument } from '@w3/schema'
import {
  BackSide,
  ClampToEdgeWrapping,
  Color,
  DoubleSide,
  FrontSide,
  LinearSRGBColorSpace,
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

    const target = this.materialFor(nodeId, mesh, graph)
    applyParams(target, def, this.textures)
    return true
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
    void graph
    const existing = this.owned.get(nodeId)
    // The mesh check is not belt and braces: see OwnedClone.mesh.
    if (existing && existing.mesh === mesh) return existing.material

    const current = mesh.material
    if (Array.isArray(current)) {
      // Multi-material meshes are out of scope for v0; overriding one would need a slot
      // index in the schema. Refuse rather than silently writing to slot 0.
      throw new Error(`节点 ${nodeId} 使用了多材质网格，v0 不支持对其应用材质覆盖`)
    }

    const clone = current.clone()
    clone.name = `${current.name || 'material'} (${nodeId})`
    mesh.material = clone
    this.owned.set(nodeId, { material: clone, clonedFrom: current, mesh })
    return clone
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

  for (const slot of Object.keys(TEXTURE_SLOT_COLOR_SPACE) as TextureSlot[]) {
    const assetId = p.maps[slot]

    // Unsetting a slot has to CLEAR it. Skipping the undefined case leaves the previous
    // texture hanging on the material, so removing a normal map in the panel does nothing
    // visible and the user removes it again, and again.
    if (assetId === undefined) {
      if (target[slot] != null) target[slot] = null
      continue
    }

    const texture = textures.get(assetId)
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

    // Tiling below 1× is a crop; at or above it the texture must wrap or the surface shows
    // one copy and stretched edge pixels for the rest.
    const wrap = texture.repeat.x > 1 || texture.repeat.y > 1 ? RepeatWrapping : ClampToEdgeWrapping
    texture.wrapS = wrap
    texture.wrapT = wrap
    // Rotation is around the uv origin by default, which spins the texture off the surface.
    // The centre is what every authoring tool means by "rotate the texture".
    texture.center.set(0.5, 0.5)
    texture.needsUpdate = true
  }
}

const isTexture = (value: unknown): value is Texture =>
  typeof value === 'object' && value !== null && (value as { isTexture?: boolean }).isTexture === true
