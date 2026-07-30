import type { SceneDocument, TweenAnimation, VariableValue } from '@w3/schema'
import { AmbientLight, Color, DirectionalLight, GridHelper, Scene, WebGLRenderer } from 'three'
import { AbortError } from '../eca/types.js'
import type { LogLevel, RuntimeContext, RuntimeEvent, SubtreeOption, VarValue } from '../eca/types.js'
import { ClipPlayer } from './animator/clip.js'
import { TweenPlayer } from './animator/tween.js'
import { PatchApplier } from './apply-patch.js'
import type { DocumentPatch } from './apply-patch.js'
import { CameraController } from './camera-controller.js'
import { HighlightLayer } from './highlight.js'
import type { HotspotRenderer } from './hotspot-layer.js'
import { HotspotProjector, NullHotspotRenderer } from './hotspot-layer.js'
import { AssetLoader } from './loader.js'
import { MaterialRegistry } from './material-registry.js'
import { Picker } from './picker.js'
import { SceneGraph } from './scene-graph.js'
import type { AssetResolver, RuntimeMode } from './types.js'

/**
 * T-031 · the composition root, and the production `RuntimeContext`.
 *
 * This is where constitution C3 becomes real: the editor's preview and the player both
 * construct one of these, and the ECA engine drives it through the exact interface
 * `HeadlessRuntime` implements. There is no second rendering path to drift.
 *
 * `createRenderer` is injectable so the composition — graph, materials, highlights,
 * animation, camera, hotspots, patch application — can be assembled and exercised in
 * Node. Only the WebGL calls themselves need a browser.
 */

export interface SceneRuntimeOptions {
  readonly canvas?: HTMLCanvasElement
  readonly resolver: AssetResolver
  readonly mode: RuntimeMode
  /** Injected in tests; production builds a real WebGLRenderer. */
  readonly createRenderer?: (canvas: HTMLCanvasElement) => WebGLRenderer
  readonly hotspotRenderer?: HotspotRenderer
  /** Injected so parity runs are deterministic. Production uses performance.now(). */
  readonly now?: () => number
  readonly onLog?: (level: LogLevel, message: string, data?: unknown) => void
}

interface PendingWait {
  readonly timer: ReturnType<typeof setTimeout>
  readonly reject: (error: unknown) => void
}

export class SceneRuntime implements RuntimeContext {
  readonly scene = new Scene()
  readonly graph: SceneGraph
  readonly materials = new MaterialRegistry()
  readonly highlights: HighlightLayer
  readonly camera: CameraController
  readonly picker: Picker
  readonly tweens: TweenPlayer
  readonly clips: ClipPlayer
  readonly hotspots: HotspotProjector
  readonly loader: AssetLoader
  readonly patches: PatchApplier

  private renderer: WebGLRenderer | null = null
  private hotspotRenderer: HotspotRenderer
  private document: SceneDocument
  private variables = new Map<string, VarValue>()
  private listeners: ((event: RuntimeEvent) => void)[] = []
  private event: RuntimeEvent | null = null
  private waits = new Set<PendingWait>()
  private frameHandle: number | null = null
  private disposed = false
  private readonly options: SceneRuntimeOptions
  private width = 1
  private height = 1

  constructor(document: SceneDocument, options: SceneRuntimeOptions) {
    this.document = document
    this.options = options

    this.graph = new SceneGraph()
    this.highlights = new HighlightLayer(this.graph, this.materials)
    this.camera = new CameraController(this.graph)
    this.picker = new Picker(this.graph)
    this.hotspots = new HotspotProjector(this.graph)
    this.hotspotRenderer = options.hotspotRenderer ?? new NullHotspotRenderer()
    this.loader = new AssetLoader({
      resolver: options.resolver,
      onWarn: (message, data) => this.log('warn', message, data),
    })
    this.tweens = new TweenPlayer(this.graph, {
      onAnimationEnd: (animationId, completed) => this.emit({ event: 'animationEnd', animationId, completed }),
    })
    this.clips = new ClipPlayer(this.graph, this.loader, {
      onAnimationEnd: (animationId, completed) => this.emit({ event: 'animationEnd', animationId, completed }),
      onWarn: (message) => this.log('warn', message),
    })
    this.patches = new PatchApplier({
      graph: this.graph,
      materials: this.materials,
      highlights: this.highlights,
      rebuild: (doc) => this.rebuild(doc),
      applyMeta: (doc) => this.applyBackground(doc),
      log: (level, message, data) => this.log(level, message, data),
    })

    this.scene.add(this.graph.root)
    this.installLighting()
    this.applyBackground(document)

    if (options.canvas) this.attachRenderer(options.canvas)
  }

  /* --- lifecycle ---------------------------------------------------------- */

  private installLighting(): void {
    // A three-light rig, not IBL: an HDR environment would need an asset pipeline of its
    // own and pushes the player well past its size budget.
    const ambient = new AmbientLight(0xffffff, 0.6)
    const key = new DirectionalLight(0xfff6e4, 2.1)
    key.position.set(4, 6, 3)
    const fill = new DirectionalLight(0x7fa8c4, 0.55)
    fill.position.set(-5, 2.4, -3.6)
    this.scene.add(ambient, key, fill)

    if (this.options.mode === 'edit') {
      const grid = new GridHelper(24, 48, 0x242b31, 0x1c2226)
      grid.name = 'w3:grid'
      this.scene.add(grid)
    }
  }

  private applyBackground(doc: SceneDocument): void {
    const background = doc.meta.background
    this.scene.background = background.type === 'transparent' ? null : new Color(background.color)
  }

  private attachRenderer(canvas: HTMLCanvasElement): void {
    const create =
      this.options.createRenderer ??
      ((c: HTMLCanvasElement) =>
        new WebGLRenderer({
          canvas: c,
          antialias: true,
          alpha: true,
          // Required for T-053's thumbnail and v1's image export: without it the
          // drawing buffer is undefined by the time toDataURL runs.
          preserveDrawingBuffer: true,
        }))
    this.renderer = create(canvas)
    this.resize(canvas.clientWidth || 1, canvas.clientHeight || 1)
  }

  resize(width: number, height: number): void {
    this.width = Math.max(1, width)
    this.height = Math.max(1, height)
    this.camera.setAspect(this.width / this.height)
    this.renderer?.setSize(this.width, this.height, false)
  }

  /** Builds the scene graph and loads every model asset the document references. */
  async load(doc: SceneDocument): Promise<void> {
    this.document = doc
    await this.ensureAssets(doc)
    this.graph.setAssetSource(this.loader)
    this.rebuild(doc)
    this.camera.frameAll()
  }

  /**
   * Loads any model asset the document names that the loader does not already hold.
   *
   * Split out of `load` because an import adds an asset to a document that is otherwise
   * unchanged: the nodes it brings can be added incrementally (D1), but only once their
   * bytes are in hand — and getting them is async while `applyPatch` is not. The host
   * awaits this first; `createPatchForwarder` does that automatically.
   *
   * @returns the ids that were newly loaded, so a caller can tell whether anything moved.
   */
  async ensureAssets(doc: SceneDocument): Promise<string[]> {
    const loaded: string[] = []
    for (const asset of doc.assets) {
      if (asset.type !== 'model' || this.loader.has(asset.id)) continue
      try {
        await this.loader.load(asset)
        loaded.push(asset.id)
      } catch (error) {
        this.log('error', `资产加载失败：${asset.name}`, error)
      }
    }
    // Idempotent, and required on the first call: the graph materialises geometry through
    // this source, and a graph built before it was set holds only placeholders.
    this.graph.setAssetSource(this.loader)
    return loaded
  }

  private rebuild(doc: SceneDocument): void {
    this.document = doc
    this.graph.build(doc)
    this.materials.applyAll(doc, this.graph)
    this.applyBackground(doc)
    this.resetRuntimeState()
  }

  /** Applies editor patches incrementally (D1). */
  applyPatch(patches: readonly DocumentPatch[], next: SceneDocument, prev: SceneDocument): void {
    this.document = next
    this.patches.apply(patches, next, prev)
  }

  get fullRebuildCount(): number {
    return this.patches.fullRebuildCount
  }

  /** Starts the render loop. Safe to call twice. */
  start(): void {
    if (this.frameHandle !== null || this.disposed) return
    const loop = () => {
      this.frameHandle = requestAnimationFrame(loop)
      this.tick()
    }
    this.frameHandle = requestAnimationFrame(loop)
  }

  stop(): void {
    if (this.frameHandle === null) return
    cancelAnimationFrame(this.frameHandle)
    this.frameHandle = null
  }

  /** One frame. Exposed so tests and the parity harness can step it by hand. */
  tick(): void {
    const now = this.now()
    this.tweens.update(now)
    this.clips.update(now)
    this.camera.update(now)
    this.hotspotRenderer.update(
      this.hotspots.update(this.document, this.camera.camera, this.width, this.height),
      this.document,
    )
    this.renderer?.render(this.scene, this.camera.camera)
  }

  /**
   * Releases everything. T-031's acceptance bar is that mounting and unmounting a
   * hundred times leaves `renderer.info.memory` at zero — a leak here is invisible until
   * a long editing session runs the tab out of GPU memory.
   */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.stop()
    for (const wait of this.waits) {
      clearTimeout(wait.timer)
      wait.reject(new AbortError())
    }
    this.waits.clear()
    this.tweens.stopAll()
    this.clips.dispose()
    this.camera.dispose()
    this.highlights.clearAll()
    this.materials.dispose()
    this.graph.dispose()
    this.loader.dispose()
    this.hotspotRenderer.dispose()
    this.scene.clear()
    this.renderer?.dispose()
    this.renderer = null
    this.listeners = []
  }

  get info(): { geometries: number; textures: number } | null {
    return this.renderer ? { ...this.renderer.info.memory } : null
  }

  /* --- RuntimeContext ------------------------------------------------------ */

  get doc(): SceneDocument {
    return this.document
  }

  onEvent(listener: (event: RuntimeEvent) => void): () => void {
    this.listeners.push(listener)
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener)
    }
  }

  setCurrentEvent(event: RuntimeEvent | null): void {
    this.event = event
  }

  currentEvent(): RuntimeEvent | null {
    return this.event
  }

  getVar(id: string): VarValue {
    const value = this.variables.get(id)
    if (value === undefined) {
      this.log('warn', `读取了未声明的变量「${id}」`)
      return 0
    }
    return value
  }

  setVar(id: string, value: VarValue): void {
    const from = this.variables.get(id)
    if (from === undefined) {
      this.log('error', `写入了未声明的变量「${id}」，忽略`)
      return
    }
    // Writing the same value is not a change: firing the event anyway is how a
    // variableChange rule that writes its own variable becomes an infinite loop.
    if (from === value) return
    this.variables.set(id, value)
    this.emit({ event: 'variableChange', variableId: id, from, to: value })
  }

  isVisible(nodeId: string): boolean {
    return this.graph.objectFor(nodeId)?.visible ?? false
  }

  setVisible(nodeId: string, value: boolean, options?: SubtreeOption): void {
    for (const id of this.subtree(nodeId, options?.includeDescendants)) this.graph.setVisible(id, value)
  }

  setMaterial(nodeId: string, materialId: string | null): void {
    const defs = new Map(this.document.materials.map((m) => [m.id, m]))
    this.materials.applyToNode(nodeId, materialId, defs, this.graph)
  }

  highlight(nodeId: string, preset: string | null, options?: SubtreeOption): void {
    const applied = this.highlights.set(nodeId, preset, options ?? {})
    if (!applied && preset !== null) {
      // Almost always: the node has no renderable geometry — a grouping node, or a
      // placeholder whose asset is missing or still loading (D5). Emissive highlighting
      // has nothing to write to. Say so; a rule step that reports success while the user
      // sees nothing is the worst of both.
      const placeholder = this.graph.isPlaceholder(nodeId)
      this.log(
        'warn',
        placeholder
          ? `无法高亮对象「${nodeId}」：其资产尚未加载或映射已失效，当前是占位节点`
          : `无法高亮对象「${nodeId}」：该节点没有可着色的几何体（分组节点或未知预设「${preset}」）`,
      )
    }
  }

  getNodeProp(nodeId: string, key: string): VarValue {
    const object = this.graph.objectFor(nodeId)
    if (!object) {
      this.log('error', `读取了不存在的对象属性：${nodeId}.${key}`)
      return 0
    }
    switch (key) {
      case 'visible':
        return object.visible
      case 'positionY':
        return object.position.y
      case 'materialId':
        return this.document.nodes.find((n) => n.id === nodeId)?.overrides.materialId ?? ''
      default:
        this.log('warn', `未知的对象属性 ${key}`)
        return 0
    }
  }

  resetScene(): void {
    this.tweens.stopAll()
    this.clips.stopAll()
    this.highlights.clearAll()
    this.resetRuntimeState()
    this.graph.build(this.document)
    this.materials.applyAll(this.document, this.graph)
  }

  private resetRuntimeState(): void {
    this.variables.clear()
    for (const variable of this.document.variables) this.variables.set(variable.id, variable.default as VariableValue)
    this.hotspots.reset()
    if (this.hotspotRenderer instanceof Object && 'closeAllPanels' in this.hotspotRenderer) {
      ;(this.hotspotRenderer as { closeAllPanels(): void }).closeAllPanels()
    }
    this.openPanels.clear()
  }

  playAnimation(id: string, options: { signal?: AbortSignal }): Promise<void> {
    const animation = this.document.animations.find((a) => a.id === id)
    if (!animation) {
      this.log('error', `播放了不存在的动画「${id}」`)
      return Promise.resolve()
    }
    if (animation.kind === 'tween') {
      return this.tweens.play(animation as TweenAnimation, this.now(), options)
    }
    return this.clips.play(animation, this.document, this.now(), options)
  }

  stopAnimation(id: string, options?: { reset?: boolean }): void {
    this.tweens.stop(id, options)
    this.clips.stop(id, options)
  }

  seekAnimation(id: string, time: number): void {
    const animation = this.document.animations.find((a) => a.id === id)
    if (!animation) return
    if (animation.kind === 'tween') this.tweens.seek(animation as TweenAnimation, time)
    else this.clips.seek(animation, this.document, time)
  }

  isAnimationPlaying(id: string): boolean {
    return this.tweens.isPlaying(id) || this.clips.isPlaying(id)
  }

  moveCamera(viewpointId: string, options: { duration?: number; signal?: AbortSignal }): Promise<void> {
    const viewpoint = this.document.viewpoints.find((v) => v.id === viewpointId)
    if (!viewpoint) {
      this.log('error', `飞向了不存在的视点「${viewpointId}」`)
      return Promise.resolve()
    }
    return this.camera.flyTo(viewpoint, this.now(), options)
  }

  private openPanels = new Set<string>()

  openPanel(hotspotId: string): void {
    const hotspot = this.document.hotspots.find((h) => h.id === hotspotId)
    if (!hotspot) return
    this.openPanels.add(hotspotId)
    setPanel(this.hotspotRenderer, hotspot, true)
  }

  closePanel(hotspotId: string | 'all'): void {
    if (hotspotId === 'all') {
      for (const id of this.openPanels) {
        const hotspot = this.document.hotspots.find((h) => h.id === id)
        if (hotspot) setPanel(this.hotspotRenderer, hotspot, false)
      }
      this.openPanels.clear()
      return
    }
    this.openPanels.delete(hotspotId)
    const hotspot = this.document.hotspots.find((h) => h.id === hotspotId)
    if (hotspot) setPanel(this.hotspotRenderer, hotspot, false)
  }

  isPanelOpen(hotspotId: string): boolean {
    return this.openPanels.has(hotspotId)
  }

  openLink(url: string, target: '_blank' | '_self'): void {
    if (typeof globalThis.open !== 'function') {
      this.log('warn', `无头环境下不打开链接：${url}`)
      return
    }
    globalThis.open(url, target, 'noopener,noreferrer')
  }

  now(): number {
    if (this.options.now) return this.options.now()
    return typeof performance !== 'undefined' ? performance.now() : Date.now()
  }

  wait(ms: number, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) return Promise.reject(new AbortError())
    return new Promise<void>((resolve, reject) => {
      const entry: PendingWait = {
        timer: setTimeout(() => {
          this.waits.delete(entry)
          signal?.removeEventListener('abort', onAbort)
          resolve()
        }, ms),
        reject,
      }
      const onAbort = () => {
        clearTimeout(entry.timer)
        this.waits.delete(entry)
        reject(new AbortError())
      }
      signal?.addEventListener('abort', onAbort, { once: true })
      this.waits.add(entry)
    })
  }

  emit(event: RuntimeEvent): void {
    for (const listener of [...this.listeners]) listener(event)
  }

  log(level: LogLevel, message: string, data?: unknown): void {
    this.options.onLog?.(level, message, data)
  }

  private subtree(nodeId: string, includeDescendants: boolean | undefined): string[] {
    if (!includeDescendants) return [nodeId]
    const object = this.graph.objectFor(nodeId)
    if (!object) return [nodeId]
    const out: string[] = []
    object.traverse((child) => {
      const id = this.graph.nodeIdFor(child)
      if (id && !out.includes(id)) out.push(id)
    })
    return out.length > 0 ? out : [nodeId]
  }
}

function setPanel(renderer: HotspotRenderer, hotspot: { id: string }, open: boolean): void {
  const withPanels = renderer as HotspotRenderer & { setPanelOpen?: (h: unknown, open: boolean) => void }
  withPanels.setPanelOpen?.(hotspot, open)
}
