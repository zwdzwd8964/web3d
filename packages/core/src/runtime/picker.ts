import type { SceneDocument } from '@w3/schema'
import { Raycaster, Vector2 } from 'three'
import type { Camera, Object3D, Plane, Vector3 } from 'three'
import type { SceneGraph } from './scene-graph.js'

/**
 * T-035 · screen coordinates -> the document node under the pointer.
 *
 * Raycaster needs no GL context, so this is fully unit-testable in Node.
 *
 * Two exclusions that are easy to forget and annoying to debug: a `locked` node must
 * not be pickable (that is what locking is for), and an invisible one must not be
 * either — three's raycaster happily reports hits on `visible: false` objects, which
 * shows up as "I clicked empty space and something got selected".
 *
 * T-136 · it can also be given an AUXILIARY root. Lights have no geometry, so the ray goes
 * straight through them; the editor puts an invisible proxy sphere per light in a separate
 * layer and points the picker at it. Separate rather than inside the document graph because
 * 全览 fits a box around `graph.root`, and click targets are not scene content — putting
 * them in the graph would make adding a light change how the whole scene is framed.
 */

export interface PickResult {
  readonly nodeId: string
  readonly object: Object3D
  readonly distance: number
  readonly point: [number, number, number]
}

export interface PickOptions {
  /** Nodes that may not be picked, regardless of `locked`. */
  readonly exclude?: ReadonlySet<string>
  /** Ignore `locked`. The player has no locking concept. */
  readonly ignoreLocked?: boolean
}

/** 命中点贴着切面时的容差。见 `isClipped`。 */
const CLIP_EPSILON = 1e-6

export class Picker {
  private raycaster = new Raycaster()
  private pointer = new Vector2()
  private auxRoot: Object3D | null = null
  /**
   * T-250 · 当前生效的裁剪平面。
   *
   * **不做「点被剖掉的墙仍然选中墙」**：那是所有剖切功能里观感最差的一处——画面上那面墙
   * 明明被切开了，点它却选中它。渲染器把这些像素丢了，拾取也该丢。
   *
   * 由 `SceneRuntime` 每次 `syncSections` 之后推进来，与写给渲染器的是**同一个数组**。
   * 各自算一份的话，两边在浮点最后一位上分家，症状是「切口边缘点得中、点不中随机」。
   */
  private clipPlanes: readonly Plane[] = []

  constructor(private readonly graph: SceneGraph) {}

  /** T-250 · 换一批裁剪平面。空数组 = 不做剖切感知。 */
  setClipPlanes(planes: readonly Plane[]): void {
    this.clipPlanes = planes
  }

  /**
   * A second root to ray-cast, for objects that stand in for something unpickable.
   *
   * Whatever it holds must carry `w3NodeId` in its userData, so a hit still resolves to a
   * document node. Null removes it.
   */
  setAuxRoot(root: Object3D | null): void {
    this.auxRoot = root
  }

  /**
   * Both roots, with their world matrices brought up to date.
   *
   * `Raycaster` reads `matrixWorld` and never refreshes it — three's own documentation puts
   * that on the caller. Until now the only thing refreshing it was `renderer.render`, so a
   * pick that happened between a document change and the next frame ray-cast against where
   * objects USED to be. Rare in the editor (it renders continuously) and not rare at all
   * for the first click after a scene loads, which is the one this cost T-142 an hour on:
   * a box at y = 0.1 was hit as though it were at the origin.
   *
   * Cheap when nothing moved — three skips subtrees whose `matrixWorldNeedsUpdate` is clear.
   */
  private roots(): Object3D[] {
    this.graph.root.updateMatrixWorld(true)
    if (!this.auxRoot) return [this.graph.root]
    this.auxRoot.updateMatrixWorld(true)
    return [this.graph.root, this.auxRoot]
  }

  /**
   * v0.5 · where the pointer ray meets a horizontal plane (T-142 · D18).
   *
   * The fallback half of drop placement: with nothing under the cursor, an object lands on
   * the ground rather than at the world origin or at some distance the code picked. Lives
   * here because this class already owns the camera-to-ray conversion, and because the
   * editor is not allowed to `import 'three'` (C3) — a ray is a rendering concept.
   *
   * Returns null when the ray is parallel to the plane or points away from it. That is a
   * real case (the camera looking at the horizon), and answering it with a point a
   * kilometre away would put the object somewhere the user cannot find.
   */
  pickPlane(
    x: number,
    y: number,
    width: number,
    height: number,
    camera: Camera,
    planeY = 0,
  ): [number, number, number] | null {
    if (width <= 0 || height <= 0) return null
    this.pointer.set((x / width) * 2 - 1, -(y / height) * 2 + 1)
    this.raycaster.setFromCamera(this.pointer, camera)

    const origin = this.raycaster.ray.origin
    const direction = this.raycaster.ray.direction
    if (Math.abs(direction.y) < 1e-6) return null
    const distance = (planeY - origin.y) / direction.y
    if (distance <= 0) return null
    return [origin.x + direction.x * distance, planeY, origin.z + direction.z * distance]
  }

  /**
   * @param x,y     pointer position in CSS pixels, relative to the canvas
   * @param width,height  canvas size in CSS pixels
   */
  pick(
    x: number,
    y: number,
    width: number,
    height: number,
    camera: Camera,
    doc: SceneDocument,
    options: PickOptions = {},
  ): PickResult | null {
    if (width <= 0 || height <= 0) return null

    // Normalised device coordinates: [-1, 1] with y up.
    this.pointer.set((x / width) * 2 - 1, -(y / height) * 2 + 1)
    this.raycaster.setFromCamera(this.pointer, camera)

    const locked = new Set(doc.nodes.filter((n) => n.locked).map((n) => n.id))
    const hits = this.raycaster.intersectObjects(this.roots(), true)

    for (const hit of hits) {
      if (!isRenderable(hit.object)) continue
      if (this.isClipped(hit.point)) continue
      const nodeId = this.graph.nodeIdFor(hit.object)
      if (!nodeId) continue
      if (options.exclude?.has(nodeId)) continue
      if (!options.ignoreLocked && locked.has(nodeId)) continue
      return {
        nodeId,
        object: hit.object,
        distance: hit.distance,
        point: [hit.point.x, hit.point.y, hit.point.z],
      }
    }
    return null
  }

  /**
   * T-250 · 这个命中点被裁掉了吗。
   *
   * three 的约定：`plane.distanceToPoint(p) < 0` 的一侧被丢弃。这里用 **`< -CLIP_EPSILON`**
   * 而不是 `< 0`——命中点几乎总是落在几何体表面上，而射线求交本身带浮点误差。恰好贴着
   * 平面的那一刀，用 `< 0` 会随机地把「刚好在平面上」的点判成被裁掉，症状是沿切口的
   * 一条线上「点得中、点不中」交替出现。
   *
   * 判据在**任意一个**平面下成立就算被裁：three 的多平面裁剪是交集语义。
   */
  private isClipped(point: Vector3): boolean {
    for (const plane of this.clipPlanes) {
      if (plane.distanceToPoint(point) < -CLIP_EPSILON) return true
    }
    return false
  }

  /** Every node under the pointer, nearest first. Used by "select behind" affordances. */
  pickAll(
    x: number,
    y: number,
    width: number,
    height: number,
    camera: Camera,
    doc: SceneDocument,
    options: PickOptions = {},
  ): PickResult[] {
    if (width <= 0 || height <= 0) return []
    this.pointer.set((x / width) * 2 - 1, -(y / height) * 2 + 1)
    this.raycaster.setFromCamera(this.pointer, camera)

    const locked = new Set(doc.nodes.filter((n) => n.locked).map((n) => n.id))
    const seen = new Set<string>()
    const out: PickResult[] = []

    for (const hit of this.raycaster.intersectObjects(this.roots(), true)) {
      if (!isRenderable(hit.object)) continue
      if (this.isClipped(hit.point)) continue
      const nodeId = this.graph.nodeIdFor(hit.object)
      if (!nodeId || seen.has(nodeId)) continue
      if (options.exclude?.has(nodeId)) continue
      if (!options.ignoreLocked && locked.has(nodeId)) continue
      seen.add(nodeId)
      out.push({ nodeId, object: hit.object, distance: hit.distance, point: [hit.point.x, hit.point.y, hit.point.z] })
    }
    return out
  }
}

/** An object is only pickable when it and every ancestor are visible. */
function isRenderable(object: Object3D): boolean {
  for (let cursor: Object3D | null = object; cursor; cursor = cursor.parent) {
    if (!cursor.visible) return false
  }
  return true
}
