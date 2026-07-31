import {
  AmbientLight,
  Box3,
  Color,
  DirectionalLight,
  PerspectiveCamera,
  Scene,
  Sphere,
  Vector3,
  WebGLRenderer,
} from 'three'
import type { Object3D } from 'three'

/**
 * T-053 · client-side thumbnails.
 *
 * 技术方案 §1.5 rules out server-side headless WebGL, so this runs in the user's browser
 * at import time — the one moment the geometry is already parsed and in memory.
 *
 * The framing maths is split out and exported precisely because it is the part that can
 * be wrong in a way nobody notices: a thumbnail with the model half out of frame still
 * looks like a thumbnail. `computeThumbnailView` is pure and unit-tested in Node; only
 * the draw call needs a GPU.
 */

export const THUMBNAIL_SIZE = 256

export interface ThumbnailView {
  readonly position: readonly [number, number, number]
  readonly target: readonly [number, number, number]
  readonly near: number
  readonly far: number
  /** Radius of the bounding sphere. Zero when the object has no geometry. */
  readonly radius: number
}

export interface ThumbnailOptions {
  readonly size?: number
  /** Multiplier on the fitted distance. 1.0 exactly touches the frame edges. */
  readonly padding?: number
  readonly fov?: number
  /** CSS colour, or `null` for a transparent PNG. */
  readonly background?: string | null
  /** Injected in tests. */
  readonly createCanvas?: (size: number) => HTMLCanvasElement
}

/**
 * The camera placement that puts `object` fully in frame.
 *
 * Fits the bounding SPHERE rather than the box: the box's apparent size depends on the
 * viewing angle, so a box-fitted camera clips the model as soon as it is viewed from a
 * corner — which is exactly the three-quarter angle a thumbnail wants.
 *
 * The direction is a fixed three-quarter view rather than the document's current camera:
 * a thumbnail taken from wherever the user happened to be looking is not a thumbnail of
 * the model, and two imports of the same asset would produce different pictures.
 */
export function computeThumbnailView(object: Object3D, options: { padding?: number; fov?: number } = {}): ThumbnailView {
  const fov = options.fov ?? 35
  const padding = options.padding ?? 1.25

  const box = new Box3().setFromObject(object)
  if (box.isEmpty()) {
    return { position: [0, 0, 1], target: [0, 0, 0], near: 0.01, far: 10, radius: 0 }
  }

  const sphere = box.getBoundingSphere(new Sphere())
  const radius = Math.max(sphere.radius, 1e-4)
  const distance = (radius / Math.sin(((fov * Math.PI) / 180) / 2)) * padding

  // A three-quarter view from slightly above: the angle that reads as "an object" rather
  // than as a flat elevation, and the one every CAD viewer's default happens to be.
  const direction = new Vector3(1, 0.65, 1).normalize()
  const position = sphere.center.clone().addScaledVector(direction, distance)

  return {
    position: [position.x, position.y, position.z],
    target: [sphere.center.x, sphere.center.y, sphere.center.z],
    // Tied to the model's own size: fixed planes z-fight on a 10 m pump and clip a 5 cm
    // bolt, and an asset library contains both.
    near: Math.max(distance - radius * 2, radius * 0.01),
    far: distance + radius * 4,
    radius,
  }
}

/**
 * Renders `object` to a PNG blob.
 *
 * Its own renderer and its own canvas, disposed before returning: sharing the editor's
 * renderer would resize its drawing buffer and leave the viewport at 256×256 until the
 * next resize event.
 *
 * Returns `null` when no WebGL context can be had, rather than throwing — a missing
 * thumbnail must never be able to fail an import.
 */
export async function renderThumbnail(object: Object3D, options: ThumbnailOptions = {}): Promise<Blob | null> {
  const size = options.size ?? THUMBNAIL_SIZE
  const canvas = (options.createCanvas ?? defaultCanvas)(size)

  let renderer: WebGLRenderer | null = null
  try {
    renderer = new WebGLRenderer({ canvas, antialias: true, alpha: options.background === null, preserveDrawingBuffer: true })
    renderer.setSize(size, size, false)
    renderer.setPixelRatio(1)

    const view = computeThumbnailView(object, options)
    const camera = new PerspectiveCamera(options.fov ?? 35, 1, view.near, view.far)
    camera.position.set(...view.position)
    camera.lookAt(...view.target)

    const scene = new Scene()
    scene.background = options.background === null ? null : new Color(options.background ?? '#1c2126')

    // The same three-light rig SceneRuntime installs, so a thumbnail looks like what the
    // viewport will show rather than like a different product.
    scene.add(new AmbientLight(0xffffff, 0.6))
    const key = new DirectionalLight(0xfff6e4, 2.1)
    key.position.set(4, 6, 3)
    const fill = new DirectionalLight(0x7fa8c4, 0.55)
    fill.position.set(-5, 2.4, -3.6)
    scene.add(key, fill)

    // Cloned rather than moved: `object` belongs to the asset cache and may already be in
    // a live scene. Re-parenting it would silently remove it from the viewport.
    scene.add(object.clone(true))

    renderer.render(scene, camera)
    return await toBlob(canvas)
  } catch {
    return null
  } finally {
    renderer?.dispose()
    renderer?.forceContextLoss()
  }
}

function defaultCanvas(size: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  return canvas
}

function toBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => {
    // PNG, not JPEG: thumbnails of technical parts are mostly flat colour on a flat
    // background, where PNG is both smaller and free of ringing around the silhouette.
    canvas.toBlob((blob) => resolve(blob), 'image/png')
  })
}
