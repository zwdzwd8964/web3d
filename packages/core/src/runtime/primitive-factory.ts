import type { Primitive, PrimitiveKind } from '@w3/schema'
import {
  BoxGeometry,
  CapsuleGeometry,
  ConeGeometry,
  CylinderGeometry,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  SphereGeometry,
  TorusGeometry,
} from 'three'
import type { BufferGeometry, Object3D } from 'three'
import type { CarrierUserData, PrimitiveFactory } from './carrier-types.js'

/**
 * T-140 · the seven primitives, built from `node.primitive`.
 *
 * The document stores SEMANTIC SIZE only — a box is 2 × 0.2 × 2 metres, not "a box with 1
 * width segment". How finely each one is tessellated is fixed here (ADR-0017): putting it
 * in the document would give the user a knob whose only effect is to make things slower,
 * and would let the same document look different across core versions. Same reasoning as
 * texture colour space (MVP_V0 D3).
 *
 * **Orientation is three's own** (ADR-0017): a plane stands in XY facing +Z, cylinders and
 * cones run along Y, everything is centred on its origin. A user who wants a floor rotates
 * the plane — and that rotation lands in `transform.r`, where it is visible, undoable and
 * published. Baking a hidden 90° into the geometry would leave the properties panel showing
 * rotation 0 next to an object that is clearly not.
 *
 * The sizes are the FULL extent, so `size: [2, 0.2, 2]` produces a bounding box exactly
 * 2 × 0.2 × 2. T-142's drop placement aligns bounding-box bottoms to the surface under the
 * cursor, so a primitive whose box does not match its numbers puts models through the floor.
 */

/**
 * Tessellation, per kind. Chosen to look round at the scale a display stand is viewed
 * from, not to be a quality setting.
 */
const SEGMENTS = {
  sphereWidth: 32,
  sphereHeight: 16,
  radial: 32,
  torusTubular: 48,
  torusRadial: 16,
  capsuleCap: 8,
  capsuleRadial: 16,
} as const

/** Neutral grey, matching `ensureDefaultMaterial`'s params so the two paths look identical. */
const FALLBACK_COLOUR = 0xb8bec4

function buildGeometry(primitive: Primitive): BufferGeometry {
  switch (primitive.kind) {
    case 'box':
      return new BoxGeometry(primitive.size[0], primitive.size[1], primitive.size[2])
    case 'sphere':
      return new SphereGeometry(primitive.radius, SEGMENTS.sphereWidth, SEGMENTS.sphereHeight)
    case 'cylinder':
      return new CylinderGeometry(primitive.radiusTop, primitive.radiusBottom, primitive.height, SEGMENTS.radial)
    case 'cone':
      return new ConeGeometry(primitive.radius, primitive.height, SEGMENTS.radial)
    case 'torus':
      return new TorusGeometry(primitive.radius, primitive.tube, SEGMENTS.torusRadial, SEGMENTS.torusTubular)
    case 'plane':
      return new PlaneGeometry(primitive.width, primitive.height)
    case 'capsule':
      // three's `length` is the cylindrical middle, matching the document's field exactly:
      // total height is `length + 2 * radius`.
      return new CapsuleGeometry(primitive.radius, primitive.length, SEGMENTS.capsuleCap, SEGMENTS.capsuleRadial)
  }
}

/** The kind an existing mesh was built for, or null when it was not built here. */
function kindOf(object: Object3D): PrimitiveKind | null {
  const kind = (object.userData as PrimitiveUserData).w3PrimitiveKind
  return typeof kind === 'string' ? (kind as PrimitiveKind) : null
}

interface PrimitiveUserData extends CarrierUserData {
  w3PrimitiveKind?: PrimitiveKind
}

/**
 * The real PrimitiveFactory. Installed by SceneRuntime; `carrier-types.ts` holds the
 * placeholder used when a host wants no primitives at all.
 */
export const primitiveFactory: PrimitiveFactory = {
  create(primitive) {
    // Its own material instance per primitive, never a shared module-level one: the
    // material registry clones on write (铁律 9 / ADR-0011), and a shared fallback would
    // be the one material in the scene that does not follow that rule.
    const mesh = new Mesh(buildGeometry(primitive), new MeshStandardMaterial({ color: FALLBACK_COLOUR, roughness: 0.8, metalness: 0 }))
    const data = mesh.userData as PrimitiveUserData
    // The graph frees geometry it owns and leaves asset geometry alone — a primitive's
    // geometry has exactly one owner and nobody else will ever free it.
    data.w3OwnedGeometry = true
    data.w3PrimitiveKind = primitive.kind
    return mesh
  },

  update(object, primitive) {
    // A different kind is a different geometry class AND a different parameter set; the
    // caller replaces the object so the old one's resources go through `dispose`.
    if (kindOf(object) !== primitive.kind) return false
    const mesh = object as Mesh
    const previous = mesh.geometry
    mesh.geometry = buildGeometry(primitive)
    // Disposed AFTER the swap: a geometry freed while still attached is a mesh that
    // renders nothing for one frame in the best case and warns in the console in the worst.
    previous.dispose()
    return true
  },

  dispose(object) {
    // Called on whole detached subtrees, so it looks for owned geometry rather than
    // assuming the root is a primitive.
    object.traverse((child) => {
      const data = child.userData as PrimitiveUserData
      if (data.w3OwnedGeometry !== true) return
      const mesh = child as Mesh
      mesh.geometry.dispose()
      // The material may have been replaced by the registry's clone; either way this mesh
      // is the only thing pointing at it.
      const material = mesh.material
      for (const m of Array.isArray(material) ? material : [material]) m?.dispose()
    })
  },
}

/** Exposed for tests and for the benchmark page: what the document does NOT store. */
export const primitiveSegments = SEGMENTS
