import type { Camera as CameraDef, Viewpoint } from '@w3/schema'
import { Box3, PerspectiveCamera, Sphere, Vector3 } from 'three'
import type { Object3D } from 'three'
import { AbortError } from '../eca/types.js'
import { ease } from './easing.js'
import type { SceneGraph } from './scene-graph.js'

/**
 * T-036 · orbit control, viewpoint capture, and flight.
 *
 * All of it is camera maths, so none of it needs a GL context. The controller owns
 * spherical orbit state rather than reading it back off the camera matrix each frame:
 * round-tripping through a matrix loses the distinction between "pointing straight down"
 * and "rolled 180°", which shows up as the camera flipping at the poles.
 */

export interface OrbitState {
  target: Vector3
  /** Azimuth, radians. */
  theta: number
  /** Polar angle from +Y, radians, clamped away from the poles. */
  phi: number
  distance: number
}

const MIN_PHI = 0.02
const MAX_PHI = Math.PI - 0.02

interface Flight {
  readonly from: OrbitState
  readonly to: OrbitState
  readonly startedAt: number
  readonly durationMs: number
  readonly resolve: () => void
  readonly reject: (error: unknown) => void
  signal?: AbortSignal
  onAbort?: () => void
}

export class CameraController {
  readonly camera: PerspectiveCamera
  readonly orbit: OrbitState = { target: new Vector3(0, 0, 0), theta: 0.8, phi: 1.1, distance: 6 }

  private flight: Flight | null = null

  constructor(
    private readonly graph: SceneGraph,
    options: { fov?: number; near?: number; far?: number; aspect?: number } = {},
  ) {
    this.camera = new PerspectiveCamera(options.fov ?? 50, options.aspect ?? 1, options.near ?? 0.1, options.far ?? 1000)
    this.apply()
  }

  get isFlying(): boolean {
    return this.flight !== null
  }

  setAspect(aspect: number): void {
    if (!Number.isFinite(aspect) || aspect <= 0) return
    this.camera.aspect = aspect
    this.camera.updateProjectionMatrix()
  }

  /** Writes the orbit state onto the camera. Called after any change. */
  apply(): void {
    this.orbit.phi = Math.min(MAX_PHI, Math.max(MIN_PHI, this.orbit.phi))
    this.orbit.distance = Math.max(0.01, this.orbit.distance)
    const { target, theta, phi, distance } = this.orbit
    this.camera.position.set(
      target.x + distance * Math.sin(phi) * Math.cos(theta),
      target.y + distance * Math.cos(phi),
      target.z + distance * Math.sin(phi) * Math.sin(theta),
    )
    this.camera.lookAt(target)
    this.camera.updateMatrixWorld()
  }

  /* --- user input -------------------------------------------------------- */

  rotate(deltaX: number, deltaY: number): void {
    this.cancelFlight()
    this.orbit.theta += deltaX
    this.orbit.phi -= deltaY
    this.apply()
  }

  pan(deltaX: number, deltaY: number): void {
    this.cancelFlight()
    const scale = this.orbit.distance * 0.0016
    const right = new Vector3().setFromMatrixColumn(this.camera.matrix, 0)
    const up = new Vector3().setFromMatrixColumn(this.camera.matrix, 1)
    this.orbit.target.addScaledVector(right, -deltaX * scale).addScaledVector(up, deltaY * scale)
    this.apply()
  }

  dolly(factor: number): void {
    this.cancelFlight()
    this.orbit.distance *= factor
    this.apply()
  }

  /* --- viewpoints --------------------------------------------------------- */

  /** Freezes the current view as a document camera (T-069's "save this angle"). */
  captureViewpoint(): CameraDef {
    const position = this.camera.position
    const target = this.orbit.target
    return {
      kind: 'perspective',
      position: [round(position.x), round(position.y), round(position.z)],
      target: [round(target.x), round(target.y), round(target.z)],
      up: [0, 1, 0],
      fov: this.camera.fov,
      zoom: 1,
      near: this.camera.near,
      far: this.camera.far,
    }
  }

  /** Snaps to a stored viewpoint without animating. */
  jumpTo(viewpoint: Viewpoint): void {
    this.cancelFlight()
    Object.assign(this.orbit, orbitFrom(viewpoint.camera))
    this.camera.fov = viewpoint.camera.fov
    this.camera.near = viewpoint.camera.near
    this.camera.far = viewpoint.camera.far
    this.camera.updateProjectionMatrix()
    this.apply()
  }

  /**
   * Flies to a viewpoint. Resolves on arrival; rejects with AbortError if interrupted,
   * leaving the camera where it stopped rather than snapping (ECA_SPEC §5.3).
   */
  flyTo(viewpoint: Viewpoint, nowMs: number, options: { duration?: number; signal?: AbortSignal } = {}): Promise<void> {
    if (options.signal?.aborted) return Promise.reject(new AbortError())

    const durationMs = (options.duration ?? 0) * 1000
    if (durationMs <= 0) {
      this.jumpTo(viewpoint)
      return Promise.resolve()
    }

    this.cancelFlight()

    return new Promise<void>((resolve, reject) => {
      const flight: Flight = {
        from: { target: this.orbit.target.clone(), theta: this.orbit.theta, phi: this.orbit.phi, distance: this.orbit.distance },
        to: orbitFrom(viewpoint.camera),
        startedAt: nowMs,
        durationMs,
        resolve,
        reject,
      }
      // Take the short way round the azimuth; without this a flight from 350° to 10°
      // spins the camera almost all the way back the other way.
      flight.to.theta = flight.from.theta + shortestAngle(flight.to.theta - flight.from.theta)

      if (options.signal) {
        const onAbort = () => this.cancelFlight()
        flight.signal = options.signal
        flight.onAbort = onAbort
        options.signal.addEventListener('abort', onAbort, { once: true })
      }
      this.flight = flight
    })
  }

  /** Advances an in-progress flight. Called once per frame. */
  update(nowMs: number): void {
    const flight = this.flight
    if (!flight) return

    const t = Math.min(1, (nowMs - flight.startedAt) / flight.durationMs)
    const k = ease('easeInOutCubic', t)

    this.orbit.target.lerpVectors(flight.from.target, flight.to.target, k)
    this.orbit.theta = flight.from.theta + (flight.to.theta - flight.from.theta) * k
    this.orbit.phi = flight.from.phi + (flight.to.phi - flight.from.phi) * k
    this.orbit.distance = flight.from.distance + (flight.to.distance - flight.from.distance) * k
    this.apply()

    if (t >= 1) {
      this.flight = null
      this.detach(flight)
      flight.resolve()
    }
  }

  /** Stops any flight and rejects its promise. Used by input and by dispose. */
  cancelFlight(): void {
    const flight = this.flight
    if (!flight) return
    this.flight = null
    this.detach(flight)
    flight.reject(new AbortError())
  }

  private detach(flight: Flight): void {
    if (flight.signal && flight.onAbort) flight.signal.removeEventListener('abort', flight.onAbort)
  }

  /** Frames a node so it fills a comfortable portion of the view (double-click focus). */
  frameNode(nodeId: string, options: { padding?: number } = {}): boolean {
    const object = this.graph.objectFor(nodeId)
    if (!object) return false
    const box = new Box3().setFromObject(object)
    if (box.isEmpty()) return false

    const sphere = box.getBoundingSphere(new Sphere())
    this.cancelFlight()
    this.orbit.target.copy(sphere.center)
    const fovRadians = (this.camera.fov * Math.PI) / 180
    this.orbit.distance = (sphere.radius / Math.sin(fovRadians / 2)) * (options.padding ?? 1.4)
    this.apply()
    return true
  }

  /** Frames the whole document. Used on first load so the model is never off-screen. */
  frameAll(options: { padding?: number } = {}): boolean {
    return this.frameObject(this.graph.root, options)
  }

  private frameObject(object: Object3D, options: { padding?: number }): boolean {
    const box = new Box3().setFromObject(object)
    if (box.isEmpty()) return false
    const sphere = box.getBoundingSphere(new Sphere())
    this.orbit.target.copy(sphere.center)
    const fovRadians = (this.camera.fov * Math.PI) / 180
    this.orbit.distance = (Math.max(sphere.radius, 0.001) / Math.sin(fovRadians / 2)) * (options.padding ?? 1.4)
    this.apply()
    return true
  }

  dispose(): void {
    this.cancelFlight()
  }
}

function orbitFrom(camera: CameraDef): OrbitState {
  const target = new Vector3(...camera.target)
  const offset = new Vector3(...camera.position).sub(target)
  const distance = Math.max(0.01, offset.length())
  return {
    target,
    // atan2(z, x) matches `apply()`'s position formula; swapping the arguments here is
    // the classic way to get a camera that orbits the wrong axis.
    theta: Math.atan2(offset.z, offset.x),
    phi: Math.acos(Math.min(1, Math.max(-1, offset.y / distance))),
    distance,
  }
}

/** Maps any angle delta into (-PI, PI]. */
export function shortestAngle(delta: number): number {
  let d = delta % (Math.PI * 2)
  if (d > Math.PI) d -= Math.PI * 2
  if (d <= -Math.PI) d += Math.PI * 2
  return d
}

const round = (n: number) => Math.round(n * 1e4) / 1e4
