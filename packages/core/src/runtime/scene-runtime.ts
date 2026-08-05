import type { SceneDocument, TweenAnimation, VariableValue } from '@w3/schema'
import { needsDefaultLightRig } from '@w3/schema'
import { neverEnds } from '../eca/types.js'
import { AmbientLight, Box3, DirectionalLight, GridHelper, Object3D, PCFSoftShadowMap, Scene, Vector3 } from 'three'
import type { Texture, WebGLRenderer } from 'three'
import { createWebGLRenderer } from './renderer-like.js'
import { ChromeRegistry } from './chrome-registry.js'
import { RenderPipeline } from './render-pipeline.js'
import type { ComposerContext, PipelineMode, RenderPipelineOptions } from './render-pipeline.js'
import type { RendererLike } from './renderer-like.js'
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
import { LightHelperLayer } from './light-helpers.js'
import { primitiveFactory } from './primitive-factory.js'
import type { Bounds } from './primitive-factory.js'
import { AssetLoader } from './loader.js'
import { MaterialRegistry } from './material-registry.js'
import { TextureCache, browserTextureDecoder } from './texture-cache.js'
import { MediaBus, browserMediaElements } from './media-bus.js'
import { Picker } from './picker.js'
import { SceneGraph } from './scene-graph.js'
import type { LiveLight } from '../eca/headless.js'
import type { EnvMapCompiler } from './environment.js'
import type { TextureDecoder } from './texture-cache.js'
import type { MediaBusOptions } from './media-bus.js'
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
  /**
   * T-200 · injected in tests; production builds a real WebGLRenderer.
   *
   * Returns `RendererLike`, not `WebGLRenderer`: the point of the seam is that a hand-written
   * stub with zero GL calls satisfies it. Typed as the concrete class, every stub needed an
   * `as unknown as WebGLRenderer` cast, and a cast tells you nothing about what it forgot.
   */
  readonly createRenderer?: (canvas: HTMLCanvasElement) => RendererLike
  readonly hotspotRenderer?: HotspotRenderer
  /** T-133 · injected in tests; production prefilters through PMREM, which needs GL. */
  readonly compileEnvMap?: EnvMapCompiler
  /** T-151 · injected in tests; production uses `createImageBitmap`, which needs a browser. */
  readonly decodeTexture?: TextureDecoder
  /** T-163 · injected in tests; production creates real `<audio>` / `<video>` elements. */
  readonly createMediaElement?: MediaBusOptions['createElement']
  /**
   * T-214 · injected in tests; production reads `window.devicePixelRatio`.
   *
   * A function rather than a number because the value CHANGES at runtime — dragging a
   * window between a laptop screen and an external monitor changes it, and so does browser
   * zoom. Reading it once at construction would leave a 2× screen rendering at whatever the
   * 1× screen happened to report when the runtime was built.
   */
  readonly devicePixelRatio?: () => number
  /** Injected so parity runs are deterministic. Production uses performance.now(). */
  readonly now?: () => number
  readonly onLog?: (level: LogLevel, message: string, data?: unknown) => void
  /**
   * T-235 · 造后处理 composer 的工厂，透传给 {@link RenderPipeline}。
   *
   * 缺省不注入 = 永远走直连路径。生产宿主（编辑器 / 播放器）注入真实现，单测注入桩：
   * 真 `EffectComposer` 需要 WebGL 上下文，在 Node 里 new 一下就抛。
   */
  readonly createComposer?: RenderPipelineOptions['createComposer']
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
  /** T-151 · one Texture per texture asset, shared by every material that references it. */
  readonly textures: TextureCache
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
  /** T-136 · edit mode only; null in play, where there is nothing to author. */
  readonly lightHelpers: LightHelperLayer | null
  /** T-235 · 编辑期辅助物的登记处。 */
  private readonly chrome = new ChromeRegistry()
  private readonly pipeline: RenderPipeline
  /**
   * 出图进行中。
   *
   * 出图要临时改尺寸、像素比与可见性，然后逐帧画到离屏目标上。这期间 `tick()` 再往画布
   * 上画一帧，画出来的是**半改完的状态**；而一次窗口 resize 会把出图算了一半的尺寸冲掉。
   * 所以 tick 早退、resize 记下来等出图结束再补。
   */
  private capturing = false
  private pendingResize: [number, number] | null = null
  /** The edit-mode ground grid, kept so preview can take it away again. */
  private grid: GridHelper | null = null
  /** T-163 · the scene's audio: what rules started and what leaving preview silences. */
  readonly media: MediaBus

  private renderer: RendererLike | null = null
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

    // The REAL factories, not the placeholders. Without this line every `node.light` and
    // every `node.primitive` materialises as the empty Group `carrier-types.ts` hands out
    // when no factory is installed: the hierarchy tree shows the object, the gizmo moves
    // it, patches reach it — and nothing is drawn. That is not hypothetical; it is what
    // T-132 found for lights, after T-131 built the factory and T-130 built the dispatch
    // and nothing connected them. Neither card's tests could see it, because each was
    // testing its own half against a stand-in of the other. Both halves are asserted
    // wired in `scene-runtime.test.ts` and `primitive-factory.test.ts`.
    this.graph = new SceneGraph({ lights: lightFactory, primitives: primitiveFactory })
    // Injected so the whole cache — keying, ref counting, disposal — runs in plain Node
    // (C8). Absent outside a browser, where there is nothing to decode into.
    const decode = options.decodeTexture ?? browserTextureDecoder()
    this.textures = new TextureCache({
      resolver: options.resolver,
      ...(decode ? { decode } : {}),
      log: (level, message, data) => this.log(level, message, data),
      // T-219 · a stand-alone `.ktx2` texture goes through the transcoder, not through
      // `createImageBitmap`. Read lazily off the loader because the transcoder does not
      // exist until a renderer is attached — which is the whole ordering problem this card
      // is about. Returns a rejected promise (not null) when there is none, so
      // `decodeInto`'s catch prints WHICH thing was missing.
      decodeKtx2: (bytes) => this.transcodeKtx2(bytes),
    })
    this.materials.setTextureSource(this.textures)
    // Injected like every other browser-only capability, so the bus's own logic — pooling,
    // volume, loop, abort, the autoplay fallback — runs in plain Node (C8).
    const createElement = options.createMediaElement ?? browserMediaElements()
    this.media = new MediaBus({
      resolve: (url) => options.resolver.resolve(url),
      ...(createElement ? { createElement } : {}),
      log: (level, message, data) => this.log(level, message, data),
    })
    this.media.setDocument(document)
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
      // The one place `RendererLike` is narrowed back to the concrete class. `environment.ts`
      // types its renderer as `WebGLRenderer` because the default PMREM compiler genuinely
      // needs one, and that file belongs to T-239 — widening it here would be a second card's
      // change smuggled into this one. Safe in practice: the two members `EnvironmentController`
      // writes (`toneMapping`, `toneMappingExposure`) are both on `RendererLike`, and the
      // compiler is already injectable (`compileEnvMap`), which is how every Node test avoids
      // PMREM today.
      renderer: () => this.renderer as WebGLRenderer | null,
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
      // T-231 · 文档里的变量集合变了，运行时的当前值表要跟上。
      applyVariables: (doc) => this.syncVariables(doc),
      log: (level, message, data) => this.log(level, message, data),
    })

    this.scene.add(this.graph.root)
    // ECA_SPEC §7 · helpers belong to editing, exactly like the grid. A published scene
    // must contain no trace of them (and the picker must not offer them to a viewer).
    this.pipeline = new RenderPipeline({
      ...(options.createComposer === undefined ? {} : { createComposer: options.createComposer }),
      log: (level, message, data) => this.log(level, message, data),
    })

    // chrome 的容器进场景，同时当 picker 的 aux 槽（X-22 合成）。
    this.scene.add(this.chrome.root)
    this.picker.setAuxRoot(this.chrome.root)

    this.lightHelpers = options.mode === 'edit' ? new LightHelperLayer(this.graph) : null
    if (this.lightHelpers) this.chrome.register(this.lightHelpers.root)
    this.installLighting()
    this.syncDefaultRig(document)
    this.lightHelpers?.sync(document)
    this.applyBackground(document)
    this.syncShadows(document, true)

    if (options.canvas) this.attachRenderer(options.canvas)
  }

  /* --- lifecycle ---------------------------------------------------------- */

  private installLighting(): void {
    if (this.options.mode === 'edit') {
      const grid = new GridHelper(24, 48, 0x242b31, 0x1c2226)
      grid.name = 'w3:grid'
      this.grid = grid
      this.chrome.register(grid)
    }
  }

  /**
   * Shows or hides everything that exists only because someone is EDITING: the ground grid
   * and the light helpers.
   *
   * Preview is not a separate runtime — the editor keeps its `mode: 'edit'` one and turns
   * the ECA engine on. So the objects `mode === 'edit'` created stayed in the scene, and
   * 「预览」 rendered a grid and a set of light wireframes that the player will never draw.
   * Worse, the helpers stayed in the picker's aux root, so clicking one in preview hit a
   * helper instead of the object behind it and the rule under the viewer's cursor did not
   * fire. That is C3 divergence — the two views disagreeing about what the scene contains —
   * and it is the one thing preview exists to rule out (T-176 审查所得).
   *
   * Hiding rather than destroying: preview is toggled constantly, and rebuilding the helper
   * layer each time would drop the wireframes' warm state for no benefit.
   */
  setEditorChromeVisible(visible: boolean): void {
    // T-235 · 别名。**编辑器继续调这个名字**（Viewport.tsx:199），内部转给注册表。
    //
    // 保留别名而不是让编辑器改调新名字，是被死导出闸门逼出来的：两者只能有一个有生产
    // 调用者。这样一来 `setChromeVisible` 的调用者就是这一行，而它是真调用不是仪式——
    // 「编辑期辅助物」这个概念的对外名字一直是 `EditorChrome`，注册表只是它的实现。
    this.setChromeVisible(visible)
  }

  /**
   * 登记一个编辑期辅助物，返回反注册闭包。
   *
   * 宿主侧的辅助物（变换手柄）由宿主注册；core 内部的（网格、灯光线框、拾取代理球）
   * 在构造时就注册好了。**注册表是「哪些东西只在编辑时存在」的唯一真源**——
   * 漏注册的症状是预览里多出一个播放器没有的东西，而那是 C3 分叉。
   */
  registerChrome(object: Object3D): () => void {
    return this.chrome.register(object)
  }

  /**
   * 一次性显示 / 隐藏全部编辑期辅助物。
   *
   * 显示时**还原每个对象隐藏那一刻的值**，不是一律 true：变换手柄的可见性由选择集
   * 驱动（无选中时它自己是 false），一律 true 会在「退出预览且无选中」时把手柄画出来。
   */
  setChromeVisible(visible: boolean): void {
    if (this.options.mode !== 'edit') return
    this.chrome.setVisible(visible)
  }

  /** 当前渲染路径。`'composed'` 当且仅当后处理链真的建起来了。 */
  get pipelineMode(): PipelineMode {
    return this.pipeline.mode
  }

  /**
   * 强制开 / 关后处理链，`null` 交还给文档。**benchmark 页专用**。
   *
   * 它存在的理由是让「开描边 vs 关描边」的帧率对比不必改文档——改文档会连带触发
   * 一次补丁、一次 `sync`，测出来的是两件事混在一起的数。
   */
  setPostFxEnabled(enabled: boolean | null): void {
    this.pipeline.setForced(enabled)
    this.syncPipeline()
  }

  /**
   * 出图开始 / 结束。owner 是 **T-266**（它编排八步出图链路）。
   *
   * 期间 `tick()` 不画、`resize()` 只记不改——理由见 {@link capturing} 的注释。
   */
  beginCapture(): void {
    this.capturing = true
  }

  endCapture(): void {
    this.capturing = false
    const pending = this.pendingResize
    this.pendingResize = null
    if (pending) this.applyResize(pending[0], pending[1])
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
  /** 当前的 composer 上下文。没有渲染器时是 null——那时一律拆掉管线。 */
  private composerContext(): ComposerContext | null {
    if (this.renderer === null) return null
    return {
      renderer: this.renderer,
      scene: this.scene,
      camera: this.camera.camera,
      width: this.width,
      height: this.height,
      pixelRatio: this.pixelRatio(),
    }
  }

  /** 按当前文档与渲染器重算管线。文档变了、渲染器来了或走了，都要过这里。 */
  private syncPipeline(): void {
    this.pipeline.sync(this.document, this.composerContext())
  }

  private applyBackground(doc: SceneDocument): void {
    this.environment.syncScene(doc)
    // T-235 · `/meta/**` 的每一条补丁都从这里过（apply-patch 的 `case 'meta'` 是刻意
    // fallthrough 的），所以描边开关一变，管线在同一帧就跟上。
    this.syncPipeline()
  }

  /**
   * Installs the thing that draws. Public, and that is the whole point of T-200.
   *
   * It used to be `private attachRenderer(canvas)` with `new WebGLRenderer(...)` inside, so
   * the only way into this code path was a real browser. Five domains' no-GPU unit tests
   * (clipping planes, capture surface, composer passes, KTX2 decoder wiring, loader
   * before/after) are assertions about *what happens once a renderer is attached*, and none
   * of them could be written.
   *
   * Accepts either a canvas (production: build the default renderer for it) or an
   * already-built `RendererLike` (tests: a stub with zero GL calls). Two entry points rather
   * than a `__attachRendererForTest` escape hatch, because a test-only alias makes the tested
   * path different from the production path — the exact difference this project has been
   * bitten by four times (`lightFactory`, KTX2, the texture cache, the material registry).
   *
   * The name is `attachRenderer` and stays `attachRenderer`: `AssetLoader.attachRenderer`
   * (T-219) is its counterpart, and appendix A.1/C7 records that these two were once written
   * as two cards with two different names for the same fix.
   */
  attachRenderer(target: HTMLCanvasElement | RendererLike): void {
    const create = this.options.createRenderer ?? defaultCreateRenderer
    const renderer = isRendererLike(target) ? target : create(target)
    this.renderer = renderer
    renderer.setPixelRatio(this.pixelRatio())
    // T-219 · the line the KTX2 transcoder had been waiting two releases for. The loader is
    // built in the constructor, long before a canvas exists, so `AssetLoaderOptions.renderer`
    // could never be set at that point — which is why the decoder was never constructed.
    this.loader.attachRenderer(renderer)
    // T-235 · 渲染器通常**晚于**文档到达（canvas 挂载在文档加载之后）。
    // 只在 applyBackground 里建管线的话，一份开着描边的文档在 attach 那一刻还是直连。
    this.syncPipeline()
    const canvas = renderer.domElement
    this.resize(canvas.clientWidth || 1, canvas.clientHeight || 1)
    // Tone mapping and the prefilter both live on the renderer, so a document that was
    // loaded before the canvas existed has to be re-applied onto it now.
    void this.environment.apply(this.document)
    // The renderer usually arrives after the document, so the pipeline state has to be
    // pushed onto it rather than waiting for the next edit.
    this.syncShadows(this.document, true)
  }

  /**
   * Releases the renderer without tearing the runtime down.
   *
   * `dispose()` ends the runtime's life; this ends only the drawing half, so a canvas can be
   * unmounted and a new one attached (the editor does exactly this when the viewport pane is
   * hidden). T-219 hangs `loader.attachRenderer(null)` here: the KTX2 transcoder holds GPU
   * state belonging to the renderer that just went away.
   */
  detach(): void {
    if (!this.renderer) return
    // T-219 · the transcoder's worker pool and WASM belong to the renderer going away.
    this.loader.attachRenderer(null)
    // 渲染器走了，composer 持有的 target 也必须走 —— 否则它们连着一个已经 dispose
    // 的上下文，而挂卸 50 次之后 `renderer.info.memory.textures` 就回不到零了。
    this.pipeline.dispose()
    this.renderer.dispose()
    this.renderer = null
  }

  /**
   * Transcodes a stand-alone `.ktx2` texture, or rejects with a sentence a user can act on.
   *
   * `KTX2Loader.parse` is callback-shaped (`parse(buffer, onLoad, onError)`), so it is
   * wrapped here rather than at the call site — 铁律 10: anything that can take time returns
   * a Promise.
   */
  private transcodeKtx2(bytes: ArrayBuffer): Promise<Texture> {
    const ktx2 = this.loader.ktx2Loader
    if (!ktx2) {
      return Promise.reject(new Error('当前环境未启用 GPU 纹理解码，无法读取 KTX2 压缩贴图'))
    }
    return new Promise<Texture>((resolve, reject) => {
      ktx2.parse(bytes, resolve, reject)
    })
  }

  /** The renderer currently installed, or null when running head-less. Read-only on purpose. */
  get activeRenderer(): RendererLike | null {
    return this.renderer
  }

  resize(width: number, height: number): void {
    if (this.capturing) {
      // 出图期间尺寸是被临时改过的。这一下若照做，出图算了一半的分辨率会被冲掉，
      // 而用户拿到的是一张尺寸对不上的图。记下来，出图结束时补。
      this.pendingResize = [width, height]
      return
    }
    this.applyResize(width, height)
  }

  private applyResize(width: number, height: number): void {
    this.width = Math.max(1, width)
    this.height = Math.max(1, height)
    this.camera.setAspect(this.width / this.height)
    // Re-applied on every resize, not only on attach: moving a window to a screen with a
    // different DPI fires a resize and nothing else. Attach-only would leave the canvas on
    // the old screen's ratio for the rest of the session.
    this.renderer?.setPixelRatio(this.pixelRatio())
    // `updateStyle = false` — the canvas is sized by CSS and three must not write inline
    // width/height onto it. This is load-bearing next to `setPixelRatio`: with it true,
    // three writes the DEVICE pixel count into the CSS size and a 2× screen shows a canvas
    // twice the size of its container.
    this.renderer?.setSize(this.width, this.height, false)
    this.pipeline.setSize(this.width, this.height)
  }

  /**
   * The device pixel ratio actually used, capped at {@link MAX_PIXEL_RATIO}.
   *
   * `setPixelRatio` was called nowhere in this repository before T-214, which means every
   * high-DPI screen rendered at 1× and let the browser upscale — the usual root cause of
   * 「描边看起来毛糙」, and why a 3× phone screen could look worse than a 1× monitor.
   *
   * The cap is not timidity: cost is quadratic in the ratio, so 3× is 2.25× the pixels of
   * 2× for a difference almost nobody can see. **The number 2 is not measured** — G0.5-8's
   * target-machine benchmark is still open (ADR-0022), so it is a decision, not a finding,
   * until that closes.
   *
   * The floor of 1 matters as much as the ceiling: a browser at 50% zoom reports 0.5, and
   * rendering at half the CSS resolution is visibly blurry rather than merely cheap.
   */
  private pixelRatio(): number {
    const raw = this.options.devicePixelRatio?.() ?? globalThis.devicePixelRatio ?? 1
    return Math.min(Math.max(raw, 1), MAX_PIXEL_RATIO)
  }

  /** Builds the scene graph and loads every model asset the document references. */
  async load(doc: SceneDocument): Promise<void> {
    this.document = doc
    this.media.setDocument(doc)
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
    // T-151 · textures the document's materials reference. `applyParams` is synchronous by
    // D1's contract, so the bytes have to be resident BEFORE the patches that use them —
    // the same division of labour the model loader already uses.
    await this.textures.ensure(doc)
    this.materials.applyAll(doc, this.graph)
    return loaded
  }

  private rebuild(doc: SceneDocument): void {
    this.document = doc
    this.media.setDocument(doc)
    this.graph.build(doc)
    this.materials.applyAll(doc, this.graph)
    this.applyBackground(doc)
    this.syncDefaultRig(doc)
    this.lightHelpers?.sync(doc)
    // After the graph is rebuilt every Object3D is new and carries three's defaults, so
    // the flags have to be written again even if the on/off state did not move.
    this.syncShadows(doc, true)
    this.resetRuntimeState()
  }

  /** Applies editor patches incrementally (D1). */
  applyPatch(patches: readonly DocumentPatch[], next: SceneDocument, prev: SceneDocument): void {
    this.document = next
    // The bus resolves media ids against the document; a stale one means a clip added a
    // moment ago cannot be found by the rule that plays it.
    this.media.setDocument(next)
    this.patches.apply(patches, next, prev)
    // Both are a scan over nodes per batch, which is cheap, and both have to happen here
    // rather than in a patch consumer: adding the first light changes a scene-level fact
    // (does the rig stand down) that no per-path handler is responsible for.
    this.syncDefaultRig(next)
    this.lightHelpers?.sync(next)
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
  /**
   * T-235 · **全文件唯一一处 `renderer?.render(`。**
   *
   * 收口之前 `tick()` 与 `renderFrame()` 各写了一次，于是「加一条后处理链」这件事
   * 要在两个地方都记得改，而漏掉的那一处会在某个宿主上安静地画出没有描边的画面。
   * ADR-0025 已经预告了一条脚本化的「唯一渲染出口」检查（与出图同版本新建），
   * 本卡先把出口收成一个。
   */
  private drawScene(): void {
    if (this.pipeline.mode === 'composed') {
      this.pipeline.render()
      return
    }
    this.renderer?.render(this.scene, this.camera.camera)
  }

  tick(): void {
    // 出图进行中：画布上这一帧会是半改完的状态（尺寸、像素比、可见性都被临时改过）
    if (this.capturing) return
    const now = this.now()
    this.tweens.update(now)
    this.clips.update(now)
    this.camera.update(now)
    // After the camera and the tweens: a light being animated, or its parent being
    // dragged, has to move its helper in the SAME frame or the cone lags the light by one.
    this.lightHelpers?.update()
    this.hotspotRenderer.update(
      this.hotspots.update(this.document, this.camera.camera, this.width, this.height),
      this.document,
    )
    this.drawScene()
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
    this.textures.dispose()
    this.media.disposeAll()
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
    this.lightHelpers?.dispose()
    this.pipeline.dispose()
    this.chrome.dispose()
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

  /**
   * Turns the renderer's shadow map on or off directly.
   *
   * The DOCUMENT is the normal driver — `syncShadows` derives this from whether any light
   * asks for shadows, and that is the path the editor and player both take. This exists for
   * the BENCHMARK (T-174), which measures the same scene at shadows off / medium / high
   * without touching the document: those lights are measuring weights, not scene content
   * (C1), so they must not be committed anywhere.
   *
   * Calling it does not disturb the document's own state: the next `applyPatch` or `load`
   * re-derives the flag from the scene.
   */
  setShadowsEnabled(enabled: boolean): void {
    if (!this.renderer) return
    this.renderer.shadowMap.enabled = enabled
    this.renderer.shadowMap.type = PCFSoftShadowMap
  }

  /**
   * The world-space bounding box of one or more subtrees, or null when they enclose nothing.
   *
   * T-146 · what a dropped library model needs and could not have: a primitive's size is
   * known before it exists (`primitiveBounds` measures a throwaway geometry), but an
   * imported model's is only knowable once the asset has been loaded and built. Placement
   * therefore has to ask the live scene, and this is the only way for the editor to ask
   * without importing three (ADR-0009).
   *
   * Matrices are refreshed FROM THE ROOT first, and that is not the belt-and-braces it
   * looks like. `Box3.expandByObject` does call `updateWorldMatrix(false, true)` on what it
   * is given — note the `false`: it refreshes the object and its children, never its
   * ANCESTORS. So a node whose parent moved since the last rendered frame gets measured
   * through the parent's stale `matrixWorld`, and reports where it used to be. Measured, not
   * assumed: with the parent moved 50 m the child still reported ±1 around the origin.
   * (`Picker.roots()` had the same shape of bug in T-142.)
   */
  boundsOf(nodeIds: readonly string[]): Bounds | null {
    this.graph.root.updateMatrixWorld(true)
    const box = new Box3()
    for (const nodeId of nodeIds) {
      const object = this.graph.objectFor(nodeId)
      if (!object) continue
      box.expandByObject(object)
    }
    if (box.isEmpty()) return null
    return { min: [box.min.x, box.min.y, box.min.z], max: [box.max.x, box.max.y, box.max.z] }
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
    this.drawScene()
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

  /**
   * T-231 · 把文档的变量集合同步到运行时的当前值表。
   *
   * **已经存在的变量保留当前值，不回到 `default`。** 这是整个方法里唯一需要想清楚的一件事：
   * 用户在预览里把「当前步骤」推到第 3 步，然后去变量面板改了另一个变量的名字——
   * immer 会为此发一条 `/variables/1/name` 的补丁。若这里按 `default` 重建整张表，
   * 那一下会把第 3 步弹回第 1 步，而用户完全不知道自己碰了什么。
   *
   * 新变量取 `default`；文档里已经没有的变量删掉。删除记 `debug` 不记 `warn`——
   * 删一个变量是用户刚刚做的事，他不需要被告知；真正该说话的是**引用它的规则**，
   * 那是 checkIntegrity 的 I3。
   *
   * `scope` 在 v1.0 没有任何消费者（v1.5 的 project 级变量才通电），所以这里不看它。
   */
  private syncVariables(doc: SceneDocument): void {
    const declared = new Set<string>()
    for (const variable of doc.variables) {
      declared.add(variable.id)
      if (this.variables.has(variable.id)) continue
      this.variables.set(variable.id, variable.default as VariableValue)
    }
    for (const id of [...this.variables.keys()]) {
      if (declared.has(id)) continue
      this.variables.delete(id)
      this.log('debug', `变量「${id}」已从文档中移除，运行时值一并清除`)
    }
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
  /**
   * T-163 · starts a clip. Resolves once it has STARTED — awaiting the end is the action's
   * job (D19), and `MediaBus.waitForEnd` is what it awaits on.
   */
  async playMedia(id: string, opts: { loop?: boolean; volume?: number; signal?: AbortSignal } = {}): Promise<void> {
    const media = this.document.media.find((m) => m.id === id)
    if (!media) {
      this.log('error', `playMedia 引用了不存在的媒体：${id}`)
      return
    }
    await this.media.play(id, {
      ...(opts.loop === undefined ? {} : { loop: opts.loop }),
      ...(opts.volume === undefined ? {} : { volume: opts.volume }),
    })
  }

  stopMedia(id: string | 'all'): void {
    this.media.stop(id)
  }

  isMediaPlaying(id: string): boolean {
    return this.media.isPlaying(id)
  }

  /**
   * ADR-0019 · the real `ended` event, which is D19's other half.
   *
   * `MediaBus.waitForEnd` has existed since T-163 and had no caller until now — the action
   * only ever waited on `durationS`, so a clip whose real length differed from the recorded
   * one ended early or late with nothing to correct it.
   *
   * NOTHING PLAYING MEANS "no end to observe", NOT "already ended". `waitForEnd` answers
   * the second — correctly, for its own purposes — so bridging to it unconditionally made
   * `await: true` return instantly whenever playback had not started: autoplay refused
   * (V3), or any environment with no audio at all. The rule's next step then fired
   * immediately and the authored pacing collapsed, so a scene with blocked audio broke in
   * a second, less explicable way on top of being silent.
   *
   * Caught by the parity suite, whose own self-check noticed the awaited step had stopped
   * suspending. Neither side diverged — both were equally wrong — which is exactly the
   * failure a two-sided comparison cannot see and that self-check exists for.
   */
  /** Not playing → never resolves, so the clock decides. See `HeadlessRuntime` for why. */
  waitForMediaEnd(id: string, signal?: AbortSignal): Promise<void> {
    if (!this.media.isPlaying(id)) return neverEnds(signal)
    return this.media.waitForEnd(id, signal)
  }

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
    // B13 extended (T-163): leaving preview stops the audio too. A narration that keeps
    // playing after the user has left the scene it belongs to is the single most jarring
    // thing this feature can do.
    this.media.stop('all')
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
    // …and every light helper is holding a reference to a light that no longer exists.
    this.lightHelpers?.sync(this.document)
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
    setPanel(this.hotspotRenderer, hotspot, true, this.document)
  }

  closePanel(hotspotId: string | 'all'): void {
    if (hotspotId === 'all') {
      for (const id of this.openPanels) {
        const hotspot = this.document.hotspots.find((h) => h.id === id)
        if (hotspot) setPanel(this.hotspotRenderer, hotspot, false, this.document)
      }
      this.openPanels.clear()
      return
    }
    this.openPanels.delete(hotspotId)
    const hotspot = this.document.hotspots.find((h) => h.id === hotspotId)
    if (hotspot) setPanel(this.hotspotRenderer, hotspot, false, this.document)
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

  /* --- 接缝清单 · the seam list (T-200 ④) ---------------------------------
   *
   * Twelve methods that later cards will implement, declared here and now, all throwing
   * `SEAM_NOT_WIRED`. This is a deliberate 0.5-day prepayment: `scene-runtime.ts` is claimed
   * exclusively by thirteen cards, and without the signatures existing up front every one of
   * them has to wait for the previous one to land. Appendix A.3 measures the cost of not
   * doing it — the critical path goes from 16 waves to 25+, wall clock roughly doubles.
   *
   * Why `throw` rather than an empty body: an empty body is indistinguishable from a correct
   * implementation to every caller and every test. That is the failure mode this repository
   * has hit fourteen times ("finished, tested, zero production callers"), and a silent no-op
   * seam would be its fifteenth. `renderer-injection.test.ts` asserts each of these throws;
   * when a card implements one, it deletes that entry from the list in the test — which is
   * how the test doubles as the progress ledger.
   *
   * Every entry names the card that owns it. No owner, no seam (D36's rule, applied early).
   */

  /** T-241 · the editor's selection channel into the outline pass. */
  setSelectionOutline(_nodeIds: readonly string[]): void {
    throw new Error(SEAM_NOT_WIRED('setSelectionOutline', 'T-241'))
  }

  /** T-244 · drives one explode group to `factor`, optionally over `durationS`. */
  setExplode(_groupNodeId: string, _factor: number, _options?: { durationS?: number; signal?: AbortSignal }): Promise<void> {
    throw new Error(SEAM_NOT_WIRED('setExplode', 'T-244'))
  }

  /** T-266 · the eight-step capture: resize, freeze, draw, compose overlays, restore. */
  captureImage(_request: unknown): Promise<Blob | null> {
    throw new Error(SEAM_NOT_WIRED('captureImage', 'T-266'))
  }

  /** T-337（v1.2）· flies the camera through N viewpoints as one continuous path. */
  flyToView(_viewpointIds: readonly string[], _options?: { durationS?: number; signal?: AbortSignal }): Promise<void> {
    throw new Error(SEAM_NOT_WIRED('flyToView', 'T-337'))
  }

  /** T-307（v1.2）· shows one page's overlays. `exclusive` defaults to false (§1.3). */
  showPage(_pageId: string, _options?: { exclusive?: boolean }): void {
    throw new Error(SEAM_NOT_WIRED('showPage', 'T-307'))
  }

  /** T-307（v1.2）· hides one page, or every page when given `'all'`. */
  hidePage(_pageId: string): void {
    throw new Error(SEAM_NOT_WIRED('hidePage', 'T-307'))
  }

  /** T-307（v1.2）· the condition side of the same trio. */
  isPageVisible(_pageId: string): boolean {
    throw new Error(SEAM_NOT_WIRED('isPageVisible', 'T-307'))
  }

  /** T-429（v1.5）· swaps the whole document, clearing mixers/materials/textures in order. */
  swapDocument(_doc: SceneDocument): Promise<void> {
    throw new Error(SEAM_NOT_WIRED('swapDocument', 'T-429'))
  }

  /* --- end 接缝清单 -------------------------------------------------------- */

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

/**
 * T-200 · what an un-implemented seam says when someone calls it.
 *
 * Exported so the seam-list test asserts the same string the runtime throws, rather than a
 * copy of it that can drift. The card number is in the message on purpose: the person who
 * hits this needs to know who owes them the implementation, not just that it is missing.
 */
export function SEAM_NOT_WIRED(member: string, owner: string): string {
  return `SceneRuntime.${member} 未接线（由 ${owner} 交付）`
}

/**
 * T-214 · the ceiling on `setPixelRatio`.
 *
 * Exported because the capture clamp has to reason about the same number: a user on a 2×
 * screen choosing a 4× export is asking for 8× device pixels, which is the
 * `webglcontextlost` (a white page) that both the runtime and `planCapture` exist to stop.
 */
export const MAX_PIXEL_RATIO = 2

/** Production's renderer factory. The single default behind `options.createRenderer`. */
function defaultCreateRenderer(canvas: HTMLCanvasElement): RendererLike {
  return createWebGLRenderer({ canvas })
}

/**
 * Tells an already-built renderer from a canvas.
 *
 * Duck-typed on `render`, which a canvas does not have and every renderer must. An
 * `instanceof WebGLRenderer` check would defeat the entire seam — a hand-written stub is
 * never an instance of anything.
 */
function isRendererLike(target: HTMLCanvasElement | RendererLike): target is RendererLike {
  return typeof (target as RendererLike).render === 'function'
}

function setPanel(renderer: HotspotRenderer, hotspot: { id: string }, open: boolean, doc?: SceneDocument): void {
  const withPanels = renderer as HotspotRenderer & {
    setPanelOpen?: (h: unknown, open: boolean, doc?: SceneDocument) => void
  }
  // The document goes through so the panel can find its media record (T-162). Optional
  // because `NullHotspotRenderer` and the v0 tests neither have nor need one.
  withPanels.setPanelOpen?.(hotspot, open, doc)
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
