import type { Hotspot, SceneDocument } from '@w3/schema'
import { Frustum, Matrix4, Raycaster, Vector3 } from 'three'
import type { Camera } from 'three'
import type { SceneGraph } from './scene-graph.js'
import { HOTSPOT_PANEL_SPEC, estimatePanelHeight, hotspotDrawOrder, markerGeometry, panelLayout } from './hotspot-visual.js'

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

  /**
   * @param options T-264 · `forceOcclusion` 绕过每 N 帧的节流，**这一帧一定 raycast**。
   *   出图要用：导出发生在某一个任意的帧上，而遮挡状态最多可能是 N-1 帧之前的——
   *   那意味着导出图上某个热点的明暗与用户按下按钮时看到的不一样，且不可复现。
   */
  update(
    doc: SceneDocument,
    camera: Camera,
    width: number,
    height: number,
    options?: { readonly forceOcclusion?: boolean },
  ): HotspotPlacement[] {
    this.frame++
    this.lastRaycastCount = 0
    const testOcclusion = options?.forceOcclusion === true || this.frame % this.interval === 1 || this.interval === 1

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
  /**
   * T-162 · resolves a media asset's bytes, so a panel can show an image or play a video.
   *
   * Injected rather than reached for, because this class is the one place the editor's
   * preview and the player SHARE (C3) and neither may reach into the other's storage. Absent
   * means this renderer shows text only — which is what the v0 tests and the parity harness
   * see, and it is a legitimate configuration rather than a broken one.
   */
  readonly resolveMedia?: (assetId: string) => Promise<ArrayBuffer>
  /**
   * Told when a panel's media could not be loaded.
   *
   * A hotspot whose image silently never appears is a bug report with no information in it.
   * The panel still shows its text — the warning is for whoever has to explain why the
   * picture is missing.
   */
  readonly onWarn?: (message: string) => void
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
    const ordinalOf = new Map(doc.hotspots.map((h, i) => [h.id, i]))
    const seen = new Set<string>()

    // T-264 · 与 sprite 层共用同一个排序函数。**两边各写一个比较器就是 C3 分叉的一种**，
    // 而 parity 看不见它——两侧都「有热点」，只是叠的顺序不同。
    for (const placement of hotspotDrawOrder(placements)) {
      const hotspot = byId.get(placement.hotspotId)
      if (!hotspot) continue
      seen.add(hotspot.id)

      const marker = this.markerFor(hotspot)
      if (!placement.onScreen) {
        marker.style.display = 'none'
        continue
      }

      const geometry = markerGeometry(hotspot, placement, ordinalOf.get(hotspot.id) ?? 0)
      marker.style.display = ''
      // T-264 · 编号在这里写，不在 markerFor 里：`markerFor` 只建一次，而序号会随文档变
      // （删掉前面一个热点，后面的缺省编号全要往前挪）。
      marker.textContent = geometry.label
      marker.style.width = `${geometry.radius * 2}px`
      marker.style.height = `${geometry.radius * 2}px`
      marker.style.fontSize = geometry.fontSize === 0 ? '' : `${geometry.fontSize}px`
      marker.style.borderWidth = `${geometry.strokeWidth}px`
      // translate3d, not left/top: layout per marker per frame is what makes a hotspot
      // layer feel heavy.
      marker.style.transform = `translate3d(${geometry.x.toFixed(1)}px, ${geometry.y.toFixed(1)}px, 0) translate(-50%, -50%)`
      marker.style.opacity = String(this.options.occludedOpacity !== undefined && placement.occluded ? this.options.occludedOpacity : geometry.alpha)
      marker.style.pointerEvents = placement.occluded ? 'none' : 'auto'
      marker.style.zIndex = String(Math.max(0, 100000 - Math.round(placement.distance * 100)))

      // T-264 · 面板跟着标记走，而且**放不下就翻到左边**。在此之前面板一行定位代码都没有
      // （`w3-hotspot-panel` 这个类名指向一份不存在的样式表），所以靠近右边界的热点，
      // 它的面板有一半在画布外——用户看到半句话，而面板位置不是可编辑的东西。
      this.positionPanel(hotspot.id, placement)
    }

    for (const [id, element] of this.markers) {
      if (!seen.has(id)) {
        element.remove()
        this.markers.delete(id)
      }
    }
  }

  /**
   * 把一个打开着的面板摆到它该在的位置。没打开就什么都不做。
   *
   * 画布尺寸取自容器：面板要夹在**看得见的那块区域**里，而不是文档坐标系里。
   */
  private positionPanel(hotspotId: string, placement: HotspotPlacement): void {
    const panel = this.panels.get(hotspotId)
    if (!panel) return
    const container = this.options.container
    const canvas = { width: container.clientWidth, height: container.clientHeight }
    const layout = panelLayout(placement, canvas, estimatePanelHeight({ title: panel.querySelector('h3')?.textContent ?? '', text: panel.querySelector('p')?.textContent ?? '' }))
    panel.style.position = 'absolute'
    panel.style.left = `${layout.x.toFixed(1)}px`
    panel.style.top = `${layout.y.toFixed(1)}px`
    panel.style.width = `${layout.width}px`
    panel.style.padding = `${HOTSPOT_PANEL_SPEC.padding}px`
    panel.dataset.flipped = String(layout.flipped)
  }

  private markerFor(hotspot: Hotspot): HTMLElement {
    const existing = this.markers.get(hotspot.id)
    if (existing) return existing

    const marker = this.options.container.ownerDocument.createElement('button')
    marker.type = 'button'
    marker.className = `w3-hotspot w3-hotspot--${hotspot.style.marker}`
    marker.dataset.hotspotId = hotspot.id
    // T-264 · 这里原来是 `hotspot.style.marker === 'number' ? '' : ''` —— **两个分支都是
    // 空串**，于是 number 标记从来没有显示过编号。文字改由 `update()` 每帧按
    // `markerGeometry` 写（序号会随文档变），这里只负责建元素。
    marker.style.position = 'absolute'
    marker.style.display = 'grid'
    marker.style.placeItems = 'center'
    marker.style.borderStyle = 'solid'
    marker.style.borderRadius = '50%'
    marker.style.borderColor = hotspot.style.color
    marker.style.background = hotspot.style.color
    marker.style.color = '#12171a'
    marker.style.padding = '0'
    marker.style.lineHeight = '1'
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
  setPanelOpen(hotspot: Hotspot, open: boolean, doc?: SceneDocument): void {
    if (!open) {
      this.panels.get(hotspot.id)?.remove()
      this.panels.delete(hotspot.id)
      this.open.delete(hotspot.id)
      this.releaseMedia(hotspot.id)
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

    // T-162 · the media, if this panel has any. Attached asynchronously — the panel appears
    // immediately with its text and the media fills in, rather than the whole panel waiting
    // on a video's first bytes.
    // `doc` is optional so v0 callers keep compiling; without it there is no media to find.
    if (hotspot.content.mediaId !== undefined && doc) void this.attachMedia(hotspot, panel, doc)
  }

  /**
   * Loads a panel's media and hangs it in.
   *
   * **Every object URL is revoked**, and the count is public so a test can assert it reaches
   * zero. The leak this prevents is the expensive kind: an object URL pins the entire file
   * in memory for the life of the tab, so a viewer who opens twelve video hotspots while
   * walking through a machine is holding twelve videos until they reload the page.
   */
  private async attachMedia(hotspot: Hotspot, panel: HTMLElement, doc: SceneDocument): Promise<void> {
    const resolve = this.options.resolveMedia
    const media = doc.media.find((m) => m.id === hotspot.content.mediaId)
    const asset = media ? doc.assets.find((a) => a.id === media.assetId) : undefined
    if (!resolve || !media || !asset) return

    let bytes: ArrayBuffer
    try {
      bytes = await resolve(asset.url)
    } catch (error) {
      // A missing file must not take the panel down: the text is still worth showing. But
      // it must not vanish silently either — a picture that never appears, with nothing in
      // the console, is a bug report with no information in it.
      this.options.onWarn?.(
        `热点「${hotspot.content.title || hotspot.id}」的媒体读取失败：${asset.name}（${
          error instanceof Error ? error.message : String(error)
        }）`,
      )
      return
    }
    // Closed while the bytes were in flight. Creating the URL now would leak it, because
    // nothing is left to revoke it.
    if (this.panels.get(hotspot.id) !== panel) return

    const url = URL.createObjectURL(new Blob([bytes]))
    this.objectUrls.set(hotspot.id, url)

    // Branch on the DOCUMENT's media type, not on `instanceof`: the constructor names are
    // globals a headless test environment does not have, and the type is already known.
    const isVideo = media.type === 'video'
    const element = this.options.container.ownerDocument.createElement(isVideo ? 'video' : 'img')
    element.className = 'w3-hotspot-media'
    // Inline, like the marker's own layout: these classes have no stylesheet anywhere (the
    // panel is created by core and lives in whichever host embeds it), so 「自适应展示」 has
    // to be stated here or a 4000 px photo blows the panel off the screen.
    element.style.display = 'block'
    element.style.maxWidth = '100%'
    element.style.height = 'auto'
    if (isVideo) {
      const video = element as HTMLVideoElement
      // Native controls: a bespoke transport bar is a v1 feature, and the browser's own is
      // keyboard-accessible and familiar in a way a hand-rolled one would not be.
      video.controls = true
      video.preload = 'metadata'
    }
    ;(element as HTMLImageElement).src = url
    panel.appendChild(element)
  }

  /** Object URLs currently held, by hotspot. Asserted to reach zero (T-162 验收). */
  private objectUrls = new Map<string, string>()

  /** How many object URLs this renderer is holding. Zero after every panel is closed. */
  get liveObjectUrls(): number {
    return this.objectUrls.size
  }

  private releaseMedia(hotspotId: string): void {
    const url = this.objectUrls.get(hotspotId)
    if (url === undefined) return
    URL.revokeObjectURL(url)
    this.objectUrls.delete(hotspotId)
  }

  isPanelOpen(hotspotId: string): boolean {
    return this.open.has(hotspotId)
  }

  closeAllPanels(): void {
    for (const panel of this.panels.values()) panel.remove()
    this.panels.clear()
    this.open.clear()
    for (const id of [...this.objectUrls.keys()]) this.releaseMedia(id)
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
