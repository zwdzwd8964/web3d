import type { SceneDocument, TweenAnimation, VariableValue } from '@w3/schema'
import { needsDefaultLightRig } from '@w3/schema'
import { AmbientLight, Box3, DirectionalLight, GridHelper, Object3D, PCFSoftShadowMap, Scene, Vector3, WebGLRenderer } from 'three'
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
import { EnvironmentController } from './environment.js'
import { lightFactory } from './light-factory.js'
import { AssetLoader } from './loader.js'
import { MaterialRegistry } from './material-registry.js'
import { Picker } from './picker.js'
import { SceneGraph } from './scene-graph.js'
import type { LiveLight } from '../eca/headless.js'
import type { EnvMapCompiler } from './environment.js'
import type { AssetResolver, NodeUserData, RuntimeMode } from './types.js'

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
  /** T-133 · injected in tests; production prefilters through PMREM, which needs GL. */
  readonly compileEnvMap?: EnvMapCompiler
  /** Injected so parity runs are deterministic. Production uses performance.now(). */
  readonly now?: () => number
  readonly onLog?: (level: LogLevel, message: string, data?: unknown) => void
}

/** The shape every three light class shares. Duck-typed so no `instanceof` chain is needed. */
interface ThreeLightLike {
  isLight?: boolean
  intensity: number
  color: { set(value: string): void; getHexString(): string }
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
  /** T-133 · owns scene.environment / background / tone mapping. */
  readonly environment: EnvironmentController

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
  /** Whether any light in the document currently asks for shadows (T-132). */
  private shadowsOn = false
  /** v0's rig, attached only while the document has no lighting of its own (T-134 · D14). */
  private defaultRig: Object3D[] = []

  constructor(document: SceneDocument, options: SceneRuntimeOptions) {
    this.document = document
    this.options = options

    // The real light factory, not the placeholder. Without this line every `node.light`
    // materialises as the empty Group `carrier-types.ts` hands out when no factory is
    // installed: the hierarchy tree shows a light, the transform gizmo moves it, patches
    // reach it — and the scene stays exactly as dark as it was. T-131 built the factory
    // and T-130 built the dispatch; nothing connected them, and no test in either card
    // could see it, because both were testing their own half against a stand-in.
    // Primitives are wired the same way by T-140.
    this.graph = new SceneGraph({ lights: lightFactory })
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
    this.environment = new EnvironmentController({
      scene: this.scene,
      renderer: () => this.renderer,
      resolve: (url) => options.resolver.resolve(url),
      log: (level, message, data) => this.log(level, message, data),
      ...(options.compileEnvMap ? { compile: options.compileEnvMap } : {}),
    })
    this.patches = new PatchApplier({
      graph: this.graph,
      materials: this.materials,
      highlights: this.highlights,
      rebuild: (doc) => this.rebuild(doc),
      applyMeta: (doc) => this.applyBackground(doc),
      // T-133 · rebuilding a PMREM environment is expensive, so it gets its own consumer
      // and is NOT triggered by someone typing a background colour. Fire-and-forget with
      // logging inside: `applyPatch` is synchronous by contract (D1), and making it async
      // would put an await in every editor keystroke's path.
      applyEnvironment: (doc) => void this.environment.apply(doc),
      applyNodeShadow: (doc, nodeId) => this.syncNodeShadowFlags(doc, nodeId),
      log: (level, message, data) => this.log(level, message, data),
    })

    this.scene.add(this.graph.root)
    this.installLighting()
    this.syncDefaultRig(document)
    this.applyBackground(document)
    this.syncShadows(document, true)

    if (options.canvas) this.attachRenderer(options.canvas)
  }

  /* --- lifecycle ---------------------------------------------------------- */

  private installLighting(): void {
    if (this.options.mode === 'edit') {
      const grid = new GridHelper(24, 48, 0x242b31, 0x1c2226)
      grid.name = 'w3:grid'
      this.scene.add(grid)
    }
  }

  /* --- the default light rig (T-134 · D14) --------------------------------- */

  /**
   * v0's three-light rig, built once and attached only while the document has no lighting
   * of its own.
   *
   * D14 · this is a DISPLAY DEFAULT, the same kind of thing as the default background
   * colour — not scene content. It is not in the document, it is not in the hierarchy tree,
   * and the 1 → 2 migration deliberately does not write it in: an upgrade that made every
   * existing project sprout three nodes the user never created, cannot explain, and turns
   * the scene black by deleting is not an upgrade.
   *
   * The exact parameters are v0's, verbatim. Gate G0.5-6 asserts them one by one, because
   * "the old projects still look right" is a claim about numbers, not a feeling.
   *
   * Attached to `scene`, never to `graph.root`: the picker ray-casts the document graph, so
   * a rig outside it cannot be selected or highlighted, and no code has to remember to
   * exclude it.
   */
  private buildDefaultRig(): Object3D[] {
    const ambient = new AmbientLight(0xffffff, 0.6)
    ambient.name = 'w3:default-ambient'
    const key = new DirectionalLight(0xfff6e4, 2.1)
    key.position.set(4, 6, 3)
    key.name = 'w3:default-key'
    const fill = new DirectionalLight(0x7fa8c4, 0.55)
    fill.position.set(-5, 2.4, -3.6)
    fill.name = 'w3:default-fill'
    return [ambient, key, fill]
  }

  /**
   * Attaches or detaches the rig to match the document.
   *
   * Called wherever the answer could have changed — construction, rebuild, and every patch
   * batch. Adding the first light must make the rig leave in the same frame, or the user's
   * new light lands on top of three invisible ones and every intensity they pick is wrong.
   */
  private syncDefaultRig(doc: SceneDocument): void {
    const wanted = needsDefaultLightRig(doc)
    if (wanted === this.defaultRig.length > 0) return
    if (wanted) {
      this.defaultRig = this.buildDefaultRig()
      this.scene.add(...this.defaultRig)
      return
    }
    for (const light of this.defaultRig) this.scene.remove(light)
    // Nothing to dispose: an AmbientLight and two DirectionalLights own no GPU resources
    // until they cast a shadow, and the rig never does.
    this.defaultRig = []
  }

  /** The rig's lights while it is attached; empty when the document lights itself. */
  get defaultLightRig(): readonly Object3D[] {
    return this.defaultRig
  }

  /* --- shadows (T-132) ---------------------------------------------------- */

  /**
   * Turns the shadow pipeline on exactly when some light asks for it.
   *
   * Shadow maps are the single most expensive thing this renderer can be asked to do, and
   * a scene with no shadow-casting light must not pay for a depth pass it will never use.
   * So the switch is derived from the document rather than left on: the same reasoning
   * that keeps the default light rig conditional (D14).
   *
   * `force` re-applies the per-mesh flags even when the on/off state did not change —
   * needed after a rebuild, where every Object3D is new and carries three's defaults.
   */
  private syncShadows(doc: SceneDocument, force = false): void {
    const wanted = doc.nodes.some((node) => node.light !== null && 'shadow' in node.light && node.light.shadow.enabled)
    if (this.renderer) {
      this.renderer.shadowMap.enabled = wanted
      // PCFSoft rather than plain PCF: the hard-edged default reads as an artefact on the
      // large flat surfaces this product is mostly used on (equipment on a plinth).
      this.renderer.shadowMap.type = PCFSoftShadowMap
    }
    if (!force && wanted === this.shadowsOn) return
    this.shadowsOn = wanted
    for (const node of doc.nodes) this.syncNodeShadowFlags(doc, node.id)
  }

  /**
   * Writes one node's `castShadow` / `receiveShadow` onto its Object3D.
   *
   * With the pipeline on, a mesh casts and receives by DEFAULT — that is what makes a
   * scene look right without the user touching anything — and `node.overrides` turns an
   * individual node off. Those two fields were defined in v1 and did nothing until now;
   * their shape is unchanged (SCHEMA_SPEC §4.1-7).
   *
   * Light nodes are skipped: `castShadow` on a light means "this light casts", which is
   * the light factory's business and comes from `light.shadow.enabled`. Writing the node
   * override onto it would silently disable a light's shadow through an unrelated control.
   */
  private syncNodeShadowFlags(doc: SceneDocument, nodeId: string): void {
    const node = doc.nodes.find((n) => n.id === nodeId)
    const object = this.graph.objectFor(nodeId)
    if (!node || !object || node.light !== null) return
    const cast = this.shadowsOn && (node.overrides.castShadow ?? true)
    const receive = this.shadowsOn && (node.overrides.receiveShadow ?? true)
    writeShadowFlags(object, cast, receive)
  }

  /**
   * The backdrop, delegated in full to the environment controller (T-133).
   *
   * It used to write `scene.background` here. With `background.type: 'hdri'` in v2 the two
   * would fight: this one would paint `background.color` over the environment map the
   * moment any meta field changed, and the symptom — the HDRI backdrop reverting to grey
   * when you rename the project — would look like anything but a background-colour writer.
   */
  private applyBackground(doc: SceneDocument): void {
    this.environment.syncScene(doc)
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
    // Tone mapping and the prefilter both live on the renderer, so a document that was
    // loaded before the canvas existed has to be re-applied onto it now.
    void this.environment.apply(this.document)
    // The renderer usually arrives after the document, so the pipeline state has to be
    // pushed onto it rather than waiting for the next edit.
    this.syncShadows(this.document, true)
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
    // Awaited, unlike the patch path: `load` is the one moment a caller can wait for the
    // scene to be complete, and an environment that arrives three frames later is exactly
    // the flicker the publish thumbnail and the parity trace would capture.
    await this.environment.apply(doc)
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
    this.syncDefaultRig(doc)
    // After the graph is rebuilt every Object3D is new and carries three's defaults, so
    // the flags have to be written again even if the on/off state did not move.
    this.syncShadows(doc, true)
    this.resetRuntimeState()
  }

  /** Applies editor patches incrementally (D1). */
  applyPatch(patches: readonly DocumentPatch[], next: SceneDocument, prev: SceneDocument): void {
    this.document = next
    this.patches.apply(patches, next, prev)
    // Both are a scan over nodes per batch, which is cheap, and both have to happen here
    // rather than in a patch consumer: adding the first light changes a scene-level fact
    // (does the rig stand down) that no per-path handler is responsible for.
    this.syncDefaultRig(next)
    // Cheap enough to run per batch (a scan for one boolean) and the only way a light's
    // `shadow.enabled` reaches the renderer: that patch is dispatched to the scene graph,
    // which knows about the light but nothing about the render pipeline. Re-applying the
    // per-mesh flags is guarded inside, so a gizmo drag does not walk every node.
    this.syncShadows(next)
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
    // Before the graph: the environment holds a PMREM render target, which is VRAM nobody
    // else will ever free — scene.clear() only detaches it.
    this.environment.dispose()
    this.graph.dispose()
    this.loader.dispose()
    this.hotspotRenderer.dispose()
    this.scene.clear()
    this.renderer?.dispose()
    this.renderer = null
    this.listeners = []
  }

  /**
   * Renderer counters, for the benchmark page (T-110) and for diagnosing a slow scene.
   *
   * `render.*` is reset by three at the start of every frame, so this has to be read
   * AFTER a `tick()` or the numbers are all zero — the single most common way to
   * misread this API.
   *
   * Widened from `memory` alone to carry `triangles` and `calls`: those two are what
   * 技术方案 §3.2-5 asks the benchmark to report, and there is no other route to them.
   * Additive — no existing caller changes.
   */
  get info(): {
    geometries: number
    textures: number
    triangles: number
    calls: number
    programs: number
  } | null {
    if (!this.renderer) return null
    const { memory, render, programs } = this.renderer.info
    return {
      geometries: memory.geometries,
      textures: memory.textures,
      triangles: render.triangles,
      calls: render.calls,
      programs: programs?.length ?? 0,
    }
  }

  /**
   * Where a node's centre currently sits on screen, in CSS pixels from the canvas corner.
   *
   * Returns null when the node has no geometry, or is behind the camera, or is outside
   * the frustum — in all three cases there is nothing at that position to point at.
   *
   * A genuine runtime capability rather than test scaffolding: anything that wants to
   * put a label, a tooltip or a callout next to an object needs exactly this, and the
   * hotspot layer already does the same projection internally. It also happens to be the
   * only honest way for a browser test to click a specific object — guessing pixel
   * coordinates yields a test that survives one camera framing and silently stops
   * exercising anything under the next.
   */
  projectToScreen(nodeId: string): { x: number; y: number } | null {
    const object = this.graph.objectFor(nodeId)
    const canvas = this.renderer?.domElement
    if (!object || !canvas) return null

    const box = new Box3().setFromObject(object)
    if (box.isEmpty()) return null

    this.camera.camera.updateMatrixWorld()
    const projected = box.getCenter(new Vector3()).project(this.camera.camera)
    if (projected.z > 1 || Math.abs(projected.x) > 1 || Math.abs(projected.y) > 1) return null

    const rect = canvas.getBoundingClientRect()
    return { x: ((projected.x + 1) / 2) * rect.width, y: ((-projected.y + 1) / 2) * rect.height }
  }

  /** The canvas this runtime draws into, or null when running head-less. */
  get canvas(): HTMLCanvasElement | null {
    return this.renderer?.domElement ?? null
  }

  /**
   * Renders one frame without advancing animations.
   *
   * The benchmark drives its own loop so it can time each frame precisely; `start()`
   * would put three's own rAF loop in the way of that measurement.
   */
  renderFrame(): void {
    this.renderer?.render(this.scene, this.camera.camera)
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

  /**
   * v0.5 · writes live light parameters onto the three light (进化规划 §4.3).
   *
   * Runtime state, not document state: this is a rule reacting to an event, exactly like
   * `setVisible`. `resetScene` rebuilds the graph from the document, which is what puts the
   * light back where the author left it when preview ends (B13, extended to lights).
   *
   * Every light class three has exposes `color` and `intensity`, including
   * `HemisphereLight` — whose `color` IS its sky colour, which is why `liveLightOf` maps
   * the document's `skyColor` onto the same name. One reading of "the light's colour",
   * shared by both runtimes.
   */
  setLight(nodeId: string, patch: { intensity?: number; color?: string }): void {
    const node = this.document.nodes.find((n) => n.id === nodeId)
    if (!node) {
      this.log('error', `setLight 引用了不存在的对象：${nodeId}`)
      return
    }
    if (node.light === null) {
      // B9's semantics: skip and say so. A rule aimed at a node that has since been
      // retyped must not take the scene down, and must not silently look like it worked.
      this.log('error', `setLight 的目标「${node.name}」不是灯光对象，已跳过`)
      return
    }
    const light = this.graph.objectFor(nodeId) as unknown as ThreeLightLike | undefined
    if (light?.isLight !== true) {
      this.log('error', `setLight 的目标「${node.name}」在场景里不是灯光对象，已跳过`)
      return
    }
    if (patch.intensity !== undefined) light.intensity = patch.intensity
    if (patch.color !== undefined) light.color.set(patch.color)
  }

  /** The light's live parameters, or null when the node is not a light. Read by the contract suite. */
  lightOf(nodeId: string): LiveLight | null {
    const node = this.document.nodes.find((n) => n.id === nodeId)
    if (!node || node.light === null) return null
    const light = this.graph.objectFor(nodeId) as unknown as ThreeLightLike | undefined
    if (light?.isLight !== true) return null
    return { intensity: light.intensity, color: `#${light.color.getHexString()}` }
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
    // Rebuilding from the document is what undoes `setLight`: the lights are constructed
    // again from `node.light`, so whatever a rule moved goes back to what the author set
    // (B13, extended to lights in v0.5).
    this.graph.build(this.document)
    this.materials.applyAll(this.document, this.graph)
    // Every Object3D is new again, carrying three's defaults — the same reason `rebuild`
    // forces this. Without it, exiting preview silently turns every shadow off.
    this.syncShadows(this.document, true)
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

/**
 * Writes shadow flags onto a node's own object.
 *
 * Stops at any descendant that is itself a document node: each node materialises exactly
 * one Object3D, and a child in the three graph is another node with its own overrides.
 * Walking through it would let a parent's "don't cast" silently override the child's.
 */
function writeShadowFlags(root: Object3D, cast: boolean, receive: boolean): void {
  root.castShadow = cast
  root.receiveShadow = receive
  for (const child of root.children) {
    if (typeof (child.userData as NodeUserData).w3NodeId === 'string') continue
    writeShadowFlags(child, cast, receive)
  }
}
