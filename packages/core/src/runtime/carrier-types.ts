import type { Light, Primitive } from '@w3/schema'
import { Group, Object3D } from 'three'

/**
 * T-130 · v0.5 · the two carrier factories the scene graph delegates to.
 *
 * A document node carries at most one of `assetRef` / `primitive` / `light`
 * (SCHEMA_SPEC §4.1-6). Asset instances are the scene graph's own business — it already
 * owns the asset source and the instancing rules. The other two are not: building a
 * cylinder's geometry and building a spot light are separate concerns with separate
 * lifetimes, and inlining them would put a switch over twelve `kind` values inside the
 * one function that has to stay readable.
 *
 * So the graph asks an interface, and T-140 / T-131 supply the real implementations. The
 * placeholders below exist so this card is testable on its own: the dispatch is what is
 * being proven here, not the geometry.
 *
 * **`update` returns false to mean "I cannot do this in place; replace me."** Changing a
 * box's size is an in-place geometry swap; changing a box into a sphere, or a spot light
 * into an ambient one, is a different object. Making the factory answer that question is
 * what keeps `SceneGraph` from having to know which parameters are structural.
 */

/** Marks an Object3D whose GPU resources were created by a carrier factory. */
export interface CarrierUserData {
  /**
   * True when this object's geometry belongs to the factory that made it, and must be
   * disposed when the object goes away.
   *
   * Asset instances share their geometry with the asset cache — disposing it there would
   * blank every other instance of the same part and force a re-upload on the next frame.
   * A primitive's geometry has exactly one owner, and nobody else will ever free it. One
   * flag, because "dispose everything" and "dispose nothing" are both wrong.
   */
  w3OwnedGeometry?: boolean
}

export interface PrimitiveFactory {
  /** Builds the Object3D for a primitive carrier. Never returns null — a broken spec still needs a node. */
  create(primitive: Primitive): Object3D
  /** Updates in place. `false` = structural change, the caller must replace the object. */
  update(object: Object3D, primitive: Primitive): boolean
  /** Frees what `create` allocated. Called before the object is dropped. */
  dispose(object: Object3D): void
}

export interface LightFactory {
  create(light: Light): Object3D
  update(object: Object3D, light: Light): boolean
  dispose(object: Object3D): void
}

/**
 * Stand-ins used until T-140 / T-131 land, and afterwards by any host that does not want
 * primitives or lights at all.
 *
 * They build an empty Group rather than nothing: a carrier node must still exist in the
 * graph, keep its transform, be findable by id and be re-parentable. A node that vanished
 * because its factory was not installed would look exactly like a bug in the document.
 *
 * `update` returns true — an empty group has nothing that could fail to update — so a host
 * without factories never triggers the replace path and never touches `fullRebuildCount`.
 */
export const PLACEHOLDER_PRIMITIVE_FACTORY: PrimitiveFactory = {
  create: () => new Group(),
  update: () => true,
  dispose: () => undefined,
}

export const PLACEHOLDER_LIGHT_FACTORY: LightFactory = {
  create: () => new Group(),
  update: () => true,
  dispose: () => undefined,
}
