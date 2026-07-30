import type { SceneDocument } from '@w3/schema'
import { Raycaster, Vector2 } from 'three'
import type { Camera, Object3D } from 'three'
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

export class Picker {
  private raycaster = new Raycaster()
  private pointer = new Vector2()

  constructor(private readonly graph: SceneGraph) {}

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
    const hits = this.raycaster.intersectObject(this.graph.root, true)

    for (const hit of hits) {
      if (!isRenderable(hit.object)) continue
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

    for (const hit of this.raycaster.intersectObject(this.graph.root, true)) {
      if (!isRenderable(hit.object)) continue
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
