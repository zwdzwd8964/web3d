import { Box3, BoxGeometry, Group, Mesh, MeshStandardMaterial, Object3D, Sphere, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { THUMBNAIL_SIZE, computeThumbnailView } from '../../src/assets/thumbnail.js'

/**
 * T-053 · the half that can be wrong without anyone noticing.
 *
 * "模型完整入画" is the acceptance line, and a thumbnail with the model clipped still
 * looks like a thumbnail — nobody reviews 200 of them. So the framing is checked
 * numerically: project the bounding sphere back through the camera and assert it fits.
 *
 * The draw call itself needs a GPU and is covered by the browser E2E.
 */

const boxAt = (x: number, y: number, z: number, size: number): Object3D => {
  const mesh = new Mesh(new BoxGeometry(size, size, size), new MeshStandardMaterial())
  mesh.position.set(x, y, z)
  mesh.updateMatrixWorld(true)
  return mesh
}

/** Half-angle of the cone the camera can see, in radians. */
const halfFov = (fov: number) => ((fov * Math.PI) / 180) / 2

/**
 * How much of the vertical half-FOV the object's bounding sphere occupies.
 *
 * < 1 means it fits with room to spare; exactly 1 is tangent to the frustum edge; > 1 is
 * clipped. Returned as a ratio rather than a boolean so the tangent case can be asserted
 * for what it is — at padding 1.0 the fit is exact, and a strict `<` there would be
 * testing which side of the last floating-point bit the multiply happened to land on.
 */
function frameFill(object: Object3D, fov = 35, padding?: number): number {
  const view = computeThumbnailView(object, padding === undefined ? { fov } : { fov, padding })
  const sphere = new Box3().setFromObject(object).getBoundingSphere(new Sphere())
  const position = new Vector3(...view.position)
  const distance = position.distanceTo(sphere.center)

  // The sphere fits when the angle it subtends is within the vertical half-FOV. Square
  // aspect, so vertical is the binding constraint.
  const subtended = Math.asin(Math.min(1, sphere.radius / distance))

  // Depth is a hard requirement at every padding: a near plane inside the model slices it
  // open and a short far plane cuts its back off, and neither shows up as an error.
  if (view.near > distance - sphere.radius) return Number.POSITIVE_INFINITY
  if (view.far < distance + sphere.radius) return Number.POSITIVE_INFINITY

  return subtended / halfFov(fov)
}

const fitsInFrame = (object: Object3D, fov = 35, padding?: number) => frameFill(object, fov, padding) <= 1 + 1e-9

describe('computeThumbnailView', () => {
  it('fits a unit cube at the origin', () => {
    expect(fitsInFrame(boxAt(0, 0, 0, 1))).toBe(true)
  })

  it('fits an object that is nowhere near the origin', () => {
    // Exporters put origins in surprising places; a view that assumed the model was
    // centred would frame empty space.
    expect(fitsInFrame(boxAt(120, -40, 300, 2))).toBe(true)
  })

  it.each([0.01, 0.1, 1, 25, 1000])('fits a %s-unit object', (size) => {
    // An asset library holds 5 cm bolts and 10 m pumps. Near/far planes derived from a
    // constant would clip one end of that range.
    expect(fitsInFrame(boxAt(0, 0, 0, size))).toBe(true)
  })

  it('fits a group whose children are spread out', () => {
    const group = new Group()
    group.add(boxAt(-6, 0, 0, 1), boxAt(6, 0, 0, 1), boxAt(0, 5, 0, 1))
    group.updateMatrixWorld(true)
    expect(fitsInFrame(group)).toBe(true)
  })

  it('padding 1.0 is exactly tangent to the frame, and anything above it has room', () => {
    // The definition of the padding parameter, pinned: 1.0 touches the edges, 1.25 (the
    // default) leaves a visible margin. If the fitting formula is ever "simplified" into
    // fitting the bounding BOX instead of the sphere, this is what catches it — a
    // box-fitted camera clips as soon as the model is viewed from a corner, which is
    // precisely the three-quarter angle a thumbnail uses.
    expect(frameFill(boxAt(0, 0, 0, 3), 35, 1.0)).toBeCloseTo(1, 9)
    expect(frameFill(boxAt(0, 0, 0, 3), 35, 1.25)).toBeLessThan(0.85)
    expect(frameFill(boxAt(0, 0, 0, 3), 35)).toBeLessThan(1)
  })

  it('looks at the object, not at the world origin', () => {
    const view = computeThumbnailView(boxAt(50, 0, 0, 2))
    expect(view.target[0]).toBeCloseTo(50, 3)
  })

  it('produces a usable view for an empty object rather than NaN', () => {
    // A grouping node with no geometry. Dividing by a zero radius would give Infinity and
    // three would render nothing, with no error.
    const view = computeThumbnailView(new Group())
    for (const n of [...view.position, ...view.target, view.near, view.far]) {
      expect(Number.isFinite(n)).toBe(true)
    }
    expect(view.radius).toBe(0)
  })

  it('near stays positive for a very large model', () => {
    // A negative or zero near plane makes the projection matrix degenerate; three logs
    // nothing and the image comes out blank.
    const view = computeThumbnailView(boxAt(0, 0, 0, 5000))
    expect(view.near).toBeGreaterThan(0)
    expect(view.far).toBeGreaterThan(view.near)
  })

  it('is deterministic — the same asset always gets the same picture', () => {
    const a = computeThumbnailView(boxAt(1, 2, 3, 4))
    const b = computeThumbnailView(boxAt(1, 2, 3, 4))
    expect(a).toEqual(b)
  })

  it('THUMBNAIL_SIZE is the 256 the card asks for', () => {
    expect(THUMBNAIL_SIZE).toBe(256)
  })
})
