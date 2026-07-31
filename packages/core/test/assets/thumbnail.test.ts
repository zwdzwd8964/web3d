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
 *
 * Both halves of the view are read, distance AND aim. An earlier version measured only
 * `view.position` against the sphere, which meant `view.target` was never read by any
 * assertion in this file: a camera standing at the right distance and looking at the
 * world origin — the exact bug the "looks at the object" test below names — framed empty
 * space and every fit assertion here still passed.
 */
function frameFill(object: Object3D, fov = 35, padding?: number): number {
  const view = computeThumbnailView(object, padding === undefined ? { fov } : { fov, padding })
  const sphere = new Box3().setFromObject(object).getBoundingSphere(new Sphere())
  const position = new Vector3(...view.position)
  const toCentre = sphere.center.clone().sub(position)
  const distance = toCentre.length()

  // Where the camera is pointed. `renderThumbnail` feeds this straight to `camera.lookAt`,
  // so it is the optical axis, and anything off that axis eats into the half-FOV budget.
  const forward = new Vector3(...view.target).sub(position)
  if (forward.lengthSq() === 0 || distance === 0) return Number.POSITIVE_INFINITY
  const offAxis = forward.angleTo(toCentre)

  // The sphere fits when the angle it subtends, offset by how far off-axis its centre
  // sits, is within the vertical half-FOV. Square aspect, so vertical is the binding
  // constraint.
  const subtended = Math.asin(Math.min(1, sphere.radius / distance))

  // Depth is a hard requirement at every padding: a near plane inside the model slices it
  // open and a short far plane cuts its back off, and neither shows up as an error.
  if (view.near > distance - sphere.radius) return Number.POSITIVE_INFINITY
  if (view.far < distance + sphere.radius) return Number.POSITIVE_INFINITY

  return (offAxis + subtended) / halfFov(fov)
}

const fitsInFrame = (object: Object3D, fov = 35, padding?: number) => frameFill(object, fov, padding) <= 1 + 1e-9

describe('computeThumbnailView', () => {
  it('fits a unit cube at the origin', () => {
    expect(fitsInFrame(boxAt(0, 0, 0, 1))).toBe(true)
  })

  it.each([
    [120, -40, 300],
    [0, 85, -60],
    [-15, -220, 4],
  ])('fits an object at (%s, %s, %s), nowhere near the origin', (x, y, z) => {
    // Exporters put origins in surprising places; a view that assumed the model was
    // centred would frame empty space. Every sample has a non-zero y AND z offset: with
    // an all-zero sample, a view that only ever got the x component right — or that
    // aimed at the origin outright — would read as correctly framed.
    expect(fitsInFrame(boxAt(x, y, z, 2))).toBe(true)
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
    // Off-origin on all three axes on purpose. The previous sample sat at (50, 0, 0),
    // where a target of [x, 0, 0] — or of [50, 0, 0] hard-coded from the box's own
    // position while y and z were dropped — is indistinguishable from a correct one.
    const view = computeThumbnailView(boxAt(50, -12, 7, 2))
    expect(view.target[0]).toBeCloseTo(50, 3)
    expect(view.target[1]).toBeCloseTo(-12, 3)
    expect(view.target[2]).toBeCloseTo(7, 3)
  })

  it('aims the camera at the model even when the model is far off-axis', () => {
    // The pairing that makes the fit assertions load-bearing: the optical axis has to
    // run through the model, not merely past it at the right distance.
    const view = computeThumbnailView(boxAt(-300, 90, 40, 6))
    const position = new Vector3(...view.position)
    const target = new Vector3(...view.target)
    const centre = new Vector3(-300, 90, 40)
    expect(target.clone().sub(position).angleTo(centre.clone().sub(position))).toBeCloseTo(0, 9)
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
