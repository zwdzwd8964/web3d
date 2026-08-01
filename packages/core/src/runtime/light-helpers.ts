import type { LightKind, SceneDocument } from '@w3/schema'
import {
  DirectionalLightHelper,
  Group,
  HemisphereLightHelper,
  Mesh,
  MeshBasicMaterial,
  PointLightHelper,
  SphereGeometry,
  SpotLightHelper,
} from 'three'
import type { Object3D } from 'three'
import type { SceneGraph } from './scene-graph.js'
import type { NodeUserData } from './types.js'

/**
 * T-136 · what a light looks like while you are editing it.
 *
 * Two problems, one layer:
 *
 * **You cannot see a light.** three's own helpers draw the cone, the direction and the
 * falloff, which is the difference between "rotate the gizmo and guess" and aiming a spot
 * light at something.
 *
 * **You cannot click a light.** A light has no geometry, so the picker's ray passes
 * straight through it and the only way to select one would be the hierarchy tree. Each
 * light therefore gets an invisible proxy sphere: `material.visible = false` keeps it out
 * of the picture while `object.visible` stays true, which is exactly what the raycaster
 * needs — it tests objects, not materials.
 *
 * **The layer hangs off the scene, not off the document graph.** Putting the proxies inside
 * `graph.root` would be simpler for picking, and it would silently break framing: 全览
 * fits `Box3.setFromObject(graph.root)`, and a light currently contributes nothing to that
 * box because it has no geometry. Proxies inside the graph would make adding a light change
 * how the whole scene is framed. So the picker learns about a second root instead.
 *
 * Nothing here is in the document, and nothing here exists in play mode (C1 · this is
 * editing furniture, like the grid).
 */

/** Radius of the click target, in world units. Big enough to hit, small enough not to block. */
const PROXY_RADIUS = 0.18

/** One geometry for every proxy in the scene — they are all the same sphere. */
const proxyGeometry = new SphereGeometry(PROXY_RADIUS, 12, 8)

interface HelperEntry {
  readonly nodeId: string
  readonly kind: LightKind
  /**
   * The three light this entry was built against.
   *
   * Kept because three's helpers hold a REFERENCE to their light and read its matrix on
   * every update. A graph rebuild replaces that object, and a helper pointing at the
   * discarded one silently freezes: it keeps drawing where the light used to be. Comparing
   * identity here is what turns that into a rebuild instead of a ghost.
   */
  readonly light: Object3D
  /** three's own helper, or null for `ambient` — which has no position or direction to draw. */
  readonly helper: (Object3D & { update?: () => void }) | null
  readonly proxy: Mesh
}

/** True when this Object3D is one of three's light classes. */
const isLight = (object: Object3D | undefined): object is Object3D & { isLight: true } =>
  (object as { isLight?: boolean } | undefined)?.isLight === true

function buildHelper(light: Object3D): (Object3D & { update?: () => void }) | null {
  const type = light.type
  // Constructed against three's concrete classes; the cast is the price of dispatching on
  // `type` instead of five `instanceof` checks, and it is checked one line above by `isLight`.
  const l = light as never
  switch (type) {
    case 'DirectionalLight':
      return new DirectionalLightHelper(l, 0.6)
    case 'PointLight':
      return new PointLightHelper(l, 0.25)
    case 'SpotLight':
      return new SpotLightHelper(l)
    case 'HemisphereLight':
      return new HemisphereLightHelper(l, 0.4)
    default:
      // AmbientLight has no position and no direction — a helper would draw a shape that
      // means nothing. The proxy sphere still gives it somewhere to be clicked.
      return null
  }
}

export class LightHelperLayer {
  /** Attach this to the scene. Empty until `sync` runs. */
  readonly root = new Group()

  private readonly graph: SceneGraph
  private entries = new Map<string, HelperEntry>()

  constructor(graph: SceneGraph) {
    this.graph = graph
    this.root.name = 'w3:light-helpers'
  }

  /** How many light nodes currently have helpers. Zero in play mode, where the layer is never built. */
  get size(): number {
    return this.entries.size
  }

  /** The helper objects, for tests and for anything that needs to exclude them. */
  get objects(): readonly Object3D[] {
    return [...this.entries.values()].flatMap((e) => (e.helper ? [e.helper, e.proxy] : [e.proxy]))
  }

  /**
   * Brings the layer in line with the document: one helper per light node, none for
   * anything else.
   *
   * Rebuilds an entry when the light's `kind` changed — a spot helper drawing a point
   * light's falloff is worse than no helper, because it looks authoritative.
   */
  sync(doc: SceneDocument): void {
    const lights = new Map(doc.nodes.filter((n) => n.light !== null).map((n) => [n.id, n.light!] as const))

    for (const [nodeId, entry] of [...this.entries]) {
      const spec = lights.get(nodeId)
      // Gone, retyped, or rebuilt into a different Object3D — all three mean this entry is
      // pointing at something that no longer exists.
      if (!spec || spec.kind !== entry.kind || this.graph.objectFor(nodeId) !== entry.light) this.remove(nodeId)
    }

    for (const [nodeId, spec] of lights) {
      if (this.entries.has(nodeId)) continue
      const light = this.graph.objectFor(nodeId)
      // The graph may not have materialised it yet (a patch arrives before the rebuild).
      // The next `sync` picks it up; a missing helper is not worth a warning.
      if (!isLight(light)) continue

      const proxy = new Mesh(proxyGeometry, new MeshBasicMaterial({ visible: false }))
      proxy.name = `w3:light-proxy:${nodeId}`
      // Tagged so `nodeIdFor` resolves it even though it lives outside the document graph.
      ;(proxy.userData as NodeUserData).w3NodeId = nodeId

      const helper = buildHelper(light)
      if (helper) helper.name = `w3:light-helper:${nodeId}`

      this.root.add(proxy)
      if (helper) this.root.add(helper)
      this.entries.set(nodeId, { nodeId, kind: spec.kind, light, helper, proxy })
    }

    this.update()
  }

  /**
   * Moves the proxies onto their lights and lets three's helpers re-read theirs.
   *
   * Called every frame: a light's world position changes when it, or any ancestor, is
   * dragged, and neither the helper nor the proxy is parented to it. Cheap — one matrix
   * read per light, and scenes have a handful.
   */
  update(): void {
    for (const [nodeId, entry] of this.entries) {
      const light = this.graph.objectFor(nodeId)
      if (!light) continue
      light.updateWorldMatrix(true, false)
      entry.proxy.position.setFromMatrixPosition(light.matrixWorld)
      // Mirrors the node's own visibility, so hiding a light hides its click target too —
      // otherwise an invisible light stays selectable and nothing on screen explains why.
      entry.proxy.visible = worldVisible(light)
      if (entry.helper) {
        entry.helper.visible = entry.proxy.visible
        entry.helper.update?.()
      }
    }
    // The picker ray-casts against `matrixWorld`, and nothing else updates this layer's:
    // `renderer.render` refreshes the scene graph's matrices, but the picker can run before
    // the first frame — and does, the moment a user clicks on a freshly opened project.
    // Without this the proxies are all still at the origin and every light picks as if it
    // were at 0,0,0.
    this.root.updateMatrixWorld(true)
  }

  dispose(): void {
    for (const nodeId of [...this.entries.keys()]) this.remove(nodeId)
    this.root.removeFromParent()
  }

  private remove(nodeId: string): void {
    const entry = this.entries.get(nodeId)
    if (!entry) return
    this.entries.delete(nodeId)

    entry.proxy.removeFromParent()
    // The geometry is shared by every proxy and outlives them all; the material is not.
    ;(entry.proxy.material as { dispose(): void }).dispose()

    if (!entry.helper) return
    entry.helper.removeFromParent()
    ;(entry.helper as unknown as { dispose?: () => void }).dispose?.()
  }
}

/** True when the object and every ancestor are visible — the same rule the picker applies. */
function worldVisible(object: Object3D): boolean {
  for (let cursor: Object3D | null = object; cursor; cursor = cursor.parent) {
    if (!cursor.visible) return false
  }
  return true
}
