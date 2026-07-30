import type { Hotspot, SceneDocument } from '@w3/schema'
import { Frustum, Matrix4, Raycaster, Vector3 } from 'three'
import type { Camera } from 'three'
import type { SceneGraph } from './scene-graph.js'

/**
 * T-041 · MVP_V0 D7 · hotspot anchoring and occlusion.
 *
 * Split into a projector (pure maths, testable in Node) and a renderer (touches the DOM).
 *
 * The `HotspotRenderer` seam is not speculative generality — it is R06's mitigation.
 * HTML markers live outside the canvas, so `renderer.domElement.toDataURL()` will not
 * contain them, and v1's "render to image" feature has to swap in a sprite renderer that
 * draws inside the canvas. Discovering that in week five, with the DOM implementation
 * hard-wired, is the expensive version of this.
 *
 * Three performance rules from D7, all of which matter at a thousand hotspots:
 *   - frustum-cull first, and never raycast for something off screen;
 *   - throttle occlusion to every Nth frame — geometry does not move between frames as
 *     often as the camera does;
 *   - position with `translate3d`, never `left`/`top`, so the browser does not run
 *     layout for every marker every frame.
 */

export interface HotspotPlacement {
  readonly hotspotId: string
  /** Inside the frustum and the document says it is visible. */
  readonly onScreen: boolean
  /** Geometry is in front of the anchor. Stale by up to `occlusionInterval` frames. */
  readonly occluded: boolean
  /** CSS pixels from the canvas's top-left. */
  readonly x: number
  readonly y: number
  /** Distance from the camera, for depth sorting the markers. */
  readonly distance: number
}

/** R06's seam: v0 ships the DOM implementation, v1 adds a sprite one for image export. */
export interface HotspotRenderer {
  update(placements: readonly HotspotPlacement[], doc: SceneDocument): void
  dispose(): void
}

export interface HotspotProjectorOptions {
  /** Raycast every Nth frame. 1 = every frame. Default 3, per D7. */
  readonly occlusionInterval?: number
  /** Tolerance in world units when comparing hit distance to anchor distance. */
  readonly epsilon?: number
}

export class HotspotProjector {
  private raycaster = new Raycaster()
  private frustum = new Frustum()
  private projScreen = new Matrix4()
  private anchor = new Vector3()
  private direction = new Vector3()
  private lastOcclusion = new Map<string, boolean>()
  private frame = 0

  private readonly interval: number
  private readonly epsilon: number

  /** Raycasts performed on the last update. Asserted to be 0 when everything is culled. */
  lastRaycastCount = 0

  constructor(
    private readonly graph: SceneGraph,
    options: HotspotProjectorOptions = {},
  ) {
    this.interval = Math.max(1, options.occlusionInterval ?? 3)
    this.epsilon = options.epsilon ?? 0.02
  }

  reset(): void {
    this.lastOcclusion.clear()
    this.frame = 0
  }

  /** World position of a hotspot's anchor, or null when its node is gone. */
  anchorPosition(hotspot: Hotspot, target = new Vector3()): Vector3 | null {
    const object = this.graph.objectFor(hotspot.anchor.nodeId)
    if (!object) return null
    object.updateWorldMatrix(true, false)
    return target.set(...hotspot.anchor.offset).applyMatrix4(object.matrixWorld)
  }

  update(doc: SceneDocument, camera: Camera, width: number, height: number): HotspotPlacement[] {
    this.frame++
    this.lastRaycastCount = 0
    const testOcclusion = this.frame % this.interval === 1 || this.interval === 1

    camera.updateMatrixWorld()
    this.projScreen.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
    this.frustum.setFromProjectionMatrix(this.projScreen)

    const cameraPosition = new Vector3().setFromMatrixPosition(camera.matrixWorld)
    const placements: HotspotPlacement[] = []

    for (const hotspot of doc.hotspots) {
      const world = this.anchorPosition(hotspot, this.anchor)
      if (!world) continue

      const distance = world.distanceTo(cameraPosition)
      const inFrustum = this.frustum.containsPoint(world)
      const onScreen = hotspot.visible && inFrustum

      if (!onScreen) {
        // D7 · off-screen means zero raycasts. This is the whole reason a thousand
        // hotspots stay affordable.
        placements.push({ hotspotId: hotspot.id, onScreen: false, occluded: false, x: 0, y: 0, distance })
        continue
      }

      const projected = world.clone().project(camera)
      const x = ((projected.x + 1) / 2) * width
      const y = ((1 - projected.y) / 2) * height

      let occluded = this.lastOcclusion.get(hotspot.id) ?? false
      if (hotspot.occlude && testOcclusion) {
        occluded = this.testOccluded(cameraPosition, world, distance)
        this.lastOcclusion.set(hotspot.id, occluded)
      } else if (!hotspot.occlude) {
        occluded = false
      }

      placements.push({ hotspotId: hotspot.id, onScreen: true, occluded, x, y, distance })
    }

    return placements
  }

  private testOccluded(from: Vector3, to: Vector3, distance: number): boolean {
    this.direction.copy(to).sub(from).normalize()
    this.raycaster.set(from, this.direction)
    this.raycaster.far = distance
    this.lastRaycastCount++

    for (const hit of this.raycaster.intersectObject(this.graph.root, true)) {
      // Something solid sits between the camera and the anchor. The epsilon keeps the
      // anchor's own surface from occluding its marker.
      if (hit.distance < distance - this.epsilon) return true
    }
    return false
  }
}

/* -------------------------------------------------------------------------- */
/* DOM renderer                                                               */
/* -------------------------------------------------------------------------- */

export interface DomHotspotRendererOptions {
  /** The positioned element markers are appended to. Must overlay the canvas. */
  readonly container: HTMLElement
  /** Called when a marker is clicked, so the host can dispatch `hotspotClick`. */
  readonly onActivate?: (hotspotId: string) => void
  /** Opacity applied to an occluded marker. 0 hides it entirely. */
  readonly occludedOpacity?: number
}

export class DomHotspotRenderer implements HotspotRenderer {
  private markers = new Map<string, HTMLElement>()
  private panels = new Map<string, HTMLElement>()
  private open = new Set<string>()

  constructor(private readonly options: DomHotspotRendererOptions) {}

  update(placements: readonly HotspotPlacement[], doc: SceneDocument): void {
    const byId = new Map(doc.hotspots.map((h) => [h.id, h]))
    const seen = new Set<string>()

    for (const placement of placements) {
      const hotspot = byId.get(placement.hotspotId)
      if (!hotspot) continue
      seen.add(hotspot.id)

      const marker = this.markerFor(hotspot)
      if (!placement.onScreen) {
        marker.style.display = 'none'
        continue
      }
      marker.style.display = ''
      // translate3d, not left/top: layout per marker per frame is what makes a hotspot
      // layer feel heavy.
      marker.style.transform = `translate3d(${placement.x.toFixed(1)}px, ${placement.y.toFixed(1)}px, 0) translate(-50%, -50%)`
      marker.style.opacity = placement.occluded ? String(this.options.occludedOpacity ?? 0.25) : '1'
      marker.style.pointerEvents = placement.occluded ? 'none' : 'auto'
      marker.style.zIndex = String(Math.max(0, 100000 - Math.round(placement.distance * 100)))
    }

    for (const [id, element] of this.markers) {
      if (!seen.has(id)) {
        element.remove()
        this.markers.delete(id)
      }
    }
  }

  private markerFor(hotspot: Hotspot): HTMLElement {
    const existing = this.markers.get(hotspot.id)
    if (existing) return existing

    const marker = this.options.container.ownerDocument.createElement('button')
    marker.type = 'button'
    marker.className = `w3-hotspot w3-hotspot--${hotspot.style.marker}`
    marker.dataset.hotspotId = hotspot.id
    marker.textContent = hotspot.style.marker === 'number' ? '' : ''
    marker.style.position = 'absolute'
    marker.style.left = '0'
    marker.style.top = '0'
    marker.style.setProperty('--w3-hotspot-color', hotspot.style.color)
    marker.addEventListener('click', (event) => {
      event.stopPropagation()
      this.options.onActivate?.(hotspot.id)
    })
    this.options.container.appendChild(marker)
    this.markers.set(hotspot.id, marker)
    return marker
  }

  /** Panel open/close is driven by the ECA actions, not by clicking the marker. */
  setPanelOpen(hotspot: Hotspot, open: boolean): void {
    if (!open) {
      this.panels.get(hotspot.id)?.remove()
      this.panels.delete(hotspot.id)
      this.open.delete(hotspot.id)
      return
    }
    if (this.panels.has(hotspot.id)) return

    const panel = this.options.container.ownerDocument.createElement('div')
    panel.className = 'w3-hotspot-panel'
    panel.dataset.hotspotId = hotspot.id

    const title = this.options.container.ownerDocument.createElement('h3')
    title.textContent = hotspot.content.title
    const body = this.options.container.ownerDocument.createElement('p')
    body.textContent = hotspot.content.text

    panel.append(title, body)
    this.options.container.appendChild(panel)
    this.panels.set(hotspot.id, panel)
    this.open.add(hotspot.id)
  }

  isPanelOpen(hotspotId: string): boolean {
    return this.open.has(hotspotId)
  }

  closeAllPanels(): void {
    for (const panel of this.panels.values()) panel.remove()
    this.panels.clear()
    this.open.clear()
  }

  dispose(): void {
    for (const marker of this.markers.values()) marker.remove()
    this.markers.clear()
    this.closeAllPanels()
  }
}

/**
 * A renderer that records instead of drawing.
 *
 * Used by the parity harness and by tests — and it is also the proof that the seam is
 * real: if `HotspotRenderer` had leaked a DOM detail, this could not exist, and neither
 * could v1's sprite renderer for image export (R06).
 */
export class NullHotspotRenderer implements HotspotRenderer {
  placements: readonly HotspotPlacement[] = []
  openPanels = new Set<string>()

  update(placements: readonly HotspotPlacement[], _doc?: SceneDocument): void {
    void _doc
    this.placements = placements
  }

  setPanelOpen(hotspot: Hotspot, open: boolean): void {
    if (open) this.openPanels.add(hotspot.id)
    else this.openPanels.delete(hotspot.id)
  }

  closeAllPanels(): void {
    this.openPanels.clear()
  }

  dispose(): void {
    this.placements = []
    this.openPanels.clear()
  }
}
