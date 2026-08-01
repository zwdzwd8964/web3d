import type { Bounds, SceneRuntime } from '@w3/core'
import { primitiveBounds } from '@w3/core'
import type { Primitive, SceneDocument, Vec3 } from '@w3/schema'

/**
 * T-142 · MVP v0.5 D18 · where a dropped object lands.
 *
 * Two rules, in order:
 *
 *   1. the ray under the cursor hits something in the scene → the new object's bounding-box
 *      BOTTOM is placed at the hit point;
 *   2. it hits nothing → the object lands on the ground plane, y = 0.
 *
 * Bounding-box bottom, not origin. An exporter can put a model's origin anywhere — inside
 * the mesh, at a corner, five metres away — and "put the origin at the hit point" produces
 * an object half through the table for exactly the models that need placing most. This is
 * also why `primitive-factory` measures its bounds from the real geometry instead of
 * re-deriving them: two formulas for the same box drift, and the symptom is objects sunk
 * slightly into the floor.
 *
 * **No surface-normal alignment** (v0.5 灰区裁决): a cabinet dropped on a sloped surface
 * should arguably stand up, and arguably lie against it, and there is no reading of "贴面"
 * that settles it. Vertical placement is the one that is never surprising.
 *
 * The maths here is pure and unit-tested; the ray-casting half is the runtime's.
 */

/** Where a drop resolved to, and what it landed on. */
export interface DropPoint {
  readonly point: Vec3
  /** The node under the cursor, or null when the drop landed on the ground plane. */
  readonly onNodeId: string | null
}

/**
 * Positions an object so its bounding box sits ON `hit`.
 *
 * Centred horizontally, resting vertically: the box's X/Z centre goes over the hit point
 * and its lowest Y touches it. For a primitive centred on its origin this is simply
 * `hit + (0, height/2, 0)`; for an imported model with an off-centre origin it is not, and
 * that is the entire reason this function exists.
 */
export function restOnPoint(hit: Vec3, bounds: Bounds): Vec3 {
  const centreX = (bounds.min[0] + bounds.max[0]) / 2
  const centreZ = (bounds.min[2] + bounds.max[2]) / 2
  return [hit[0] - centreX, hit[1] - bounds.min[1], hit[2] - centreZ]
}

/**
 * Resolves a pointer position in the viewport to a drop point.
 *
 * `exclude` is for the drag preview: the ghost object is in the scene while the pointer is
 * moving over it, and without this the object would hit ITSELF and climb into the air one
 * bounding box per frame.
 */
export function resolveDropPoint(
  runtime: SceneRuntime,
  doc: SceneDocument,
  pointer: { x: number; y: number; width: number; height: number },
  options: { exclude?: ReadonlySet<string> } = {},
): DropPoint {
  const camera = runtime.camera.camera
  const hit = runtime.picker.pick(pointer.x, pointer.y, pointer.width, pointer.height, camera, doc, {
    ...(options.exclude ? { exclude: options.exclude } : {}),
    // A locked node is not selectable, but it is still a surface. Refusing to drop onto a
    // locked floor would be a puzzle, not a safeguard.
    ignoreLocked: true,
  })
  if (hit) return { point: hit.point, onNodeId: hit.nodeId }

  const ground = runtime.picker.pickPlane(pointer.x, pointer.y, pointer.width, pointer.height, camera, 0)
  // Nothing under the cursor and the ray never meets the ground — the camera is looking at
  // or above the horizon. The origin is the one place the user can always find again.
  return { point: ground ?? [0, 0, 0], onNodeId: null }
}

/** The bounds of what is about to be placed. */
export function boundsOfPrimitive(primitive: Primitive): Bounds {
  return primitiveBounds(primitive)
}

/**
 * Where the middle of the current view meets the ground plane — the landing point for a
 * double-click, which has no cursor position of its own.
 *
 * The world origin is the fallback, not the rule (T-146). It was the rule until M10's review:
 * a constant lands the object off screen the moment the user has orbited away from the
 * origin, and 「双击没反应」 is how that reads from the outside.
 */
export function viewCentre(runtime: SceneRuntime | null): Vec3 {
  if (!runtime) return [0, 0, 0]
  const canvas = runtime.canvas
  const width = canvas?.clientWidth ?? 0
  const height = canvas?.clientHeight ?? 0
  if (width <= 0 || height <= 0) return [0, 0, 0]
  // Looking at or above the horizon: the ray never meets the ground, and the origin is the
  // one place the user can always find again.
  return runtime.picker.pickPlane(width / 2, height / 2, width, height, runtime.camera.camera, 0) ?? [0, 0, 0]
}

/**
 * Where a primitive dropped at `pointer` should be created.
 *
 * The whole placement decision in one call, so the drop handler is three lines and this is
 * what the tests exercise.
 */
export function placePrimitiveAt(
  runtime: SceneRuntime,
  doc: SceneDocument,
  primitive: Primitive,
  pointer: { x: number; y: number; width: number; height: number },
): { position: Vec3; onNodeId: string | null } {
  const drop = resolveDropPoint(runtime, doc, pointer)
  return { position: restOnPoint(drop.point, boundsOfPrimitive(primitive)), onNodeId: drop.onNodeId }
}

/**
 * The delta to move an already-built subtree by, so that it rests on `hit`.
 *
 * For library models. A primitive's size is known before it exists, but an imported model's
 * is not: it has to be built and MEASURED (`SceneRuntime.boundsOf`), and only then can the
 * drop know how far to move it. So this takes the subtree's **world** bounds and returns a
 * delta, rather than taking local bounds and returning a position — the root arrives from
 * the import pipeline with a transform this has no business overwriting.
 *
 * The root's current position does not appear because it cancels: the measurement already
 * includes it. T-146 changed the signature for exactly that reason — the old one took local
 * bounds plus the root position, and had no caller to hold it honest.
 */
export function offsetToRestOn(hit: Vec3, worldBounds: Bounds): Vec3 {
  return restOnPoint(hit, worldBounds)
}
