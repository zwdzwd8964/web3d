import type { SceneDocument } from '@w3/schema'
import { DEFAULT_FOG } from '@w3/schema'
import {
  ACESFilmicToneMapping,
  Color,
  DataTexture,
  EquirectangularReflectionMapping,
  NoToneMapping,
  PMREMGenerator,
  RGBAFormat,
  SRGBColorSpace,
  // `ThreeFog` 的别名是必须的：`@w3/schema` 也导出一个 `Fog`（文档字段的类型）。
  // 同名 import 会静默串味——一个是 three 的对象，一个是文档里的六个数字。
  Fog as ThreeFog,
  FogExp2,
} from 'three'
import type { Mesh, Object3D, Scene, Texture, WebGLRenderer } from 'three'
import type { Bounds } from './primitive-factory.js'
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js'
import type { LogLevel } from '../eca/types.js'

/**
 * T-133 · image-based lighting, the background, and tone mapping.
 *
 * One owner for everything that decides what the scene sits in front of and how bright it
 * comes out: `scene.environment`, `scene.environmentIntensity`, `scene.background`,
 * `renderer.toneMapping` and `renderer.toneMappingExposure`. They are five knobs that only
 * make sense together — an ACESFilmic curve with no environment map is v0's scene looking
 * washed out, and a background switched to `hdri` with nothing loaded is a black screen. A
 * split owner would let those combinations happen and nobody would be responsible.
 *
 * **`toneMapping` is not a document field** (SCHEMA_SPEC §1). It follows from whether an
 * HDRI is set: ACESFilmic when there is one, and exactly v0's `NoToneMapping` when there is
 * not — which is what makes gate G0.5-6 ("老文档观感逐参数不变") true rather than hoped for.
 * `exposure` IS a field, and is written unconditionally; with `NoToneMapping` three's shader
 * ignores it, so a v1 document's default of 1 changes nothing.
 *
 * The PMREM step is injected (`compile`) because it needs a live GL context: it renders the
 * equirectangular source through a cube camera. Everything around it — which asset, when to
 * re-resolve, what to dispose, what the scene reads — is document logic and runs in Node.
 */

/** A prefiltered environment map plus the way to free it. */
export interface CompiledEnvironment {
  readonly texture: Texture
  dispose(): void
}

/** Turns the parsed equirectangular HDR into a prefiltered cube map. Needs GL. */
export type EnvMapCompiler = (source: DataTexture, renderer: WebGLRenderer) => CompiledEnvironment

export interface EnvironmentTargets {
  readonly scene: Scene
  /** Null until a canvas is attached — the runtime is usable before that. */
  renderer(): WebGLRenderer | null
  /** Raw bytes for an asset url. The same resolver models load through. */
  resolve(url: string): Promise<ArrayBuffer>
  log(level: LogLevel, message: string, data?: unknown): void
  /** Injected by tests; production uses PMREM. */
  readonly compile?: EnvMapCompiler
}

/**
 * The default compiler: three's PMREM prefilter.
 *
 * The generator is disposed immediately — it holds a full-screen quad and a set of shaders
 * that are only needed during the prefilter — while the render target it produced is what
 * the caller keeps and frees later. Disposing them together is the classic mistake here: it
 * frees the texture the scene is about to read.
 */
const pmremCompiler: EnvMapCompiler = (source, renderer) => {
  const generator = new PMREMGenerator(renderer)
  const target = generator.fromEquirectangular(source)
  generator.dispose()
  return {
    texture: target.texture,
    dispose: () => target.dispose(),
  }
}

/**
 * Parses `.hdr` bytes into a texture.
 *
 * `HDRLoader`, not `RGBELoader`: same RGBE parser, and the latter is a deprecated alias in
 * three 0.185 that logs a warning on construction. No new dependency either way.
 *
 * Built by hand rather than through `loader.load(url)` because the bytes come from an
 * `AssetResolver` — a `.w3p` package, IndexedDB, or a server later — and never from a URL
 * the loader could fetch. Going through the loader's fetch path would put a network request
 * where constitution C6 forbids one.
 */
export function parseHdr(bytes: ArrayBuffer): DataTexture {
  const data = new HDRLoader().parse(bytes)
  const texture = new DataTexture(data.data, data.width, data.height, data.format ?? RGBAFormat, data.type)
  texture.colorSpace = data.colorSpace ?? texture.colorSpace
  if (data.minFilter) texture.minFilter = data.minFilter
  if (data.magFilter) texture.magFilter = data.magFilter
  texture.generateMipmaps = data.generateMipmaps ?? false
  texture.flipY = data.flipY ?? false
  // Without this the image is sampled as a flat rectangle behind the camera instead of
  // being wrapped around the scene, which reads as "the HDRI did not load".
  texture.mapping = EquirectangularReflectionMapping
  texture.needsUpdate = true
  return texture
}

export class EnvironmentController {
  private readonly targets: EnvironmentTargets
  private readonly compile: EnvMapCompiler

  /** Which asset the loaded texture came from, so an unchanged document re-resolves nothing. */
  private loadedAssetId: string | null = null
  private source: DataTexture | null = null
  private compiled: CompiledEnvironment | null = null

  /**
   * Bumped on every `apply`. A resolve that finishes after a newer one started is dropped:
   * the user can switch HDRIs faster than a multi-megabyte file decodes, and last-write-wins
   * by arrival order would leave the scene showing the one they did not pick.
   */
  private generation = 0
  private disposedCount = 0

  constructor(targets: EnvironmentTargets) {
    this.targets = targets
    this.compile = targets.compile ?? pmremCompiler
  }

  /** How many loaded environments have been freed. Read by the leak test. */
  get disposedEnvironments(): number {
    return this.disposedCount
  }

  /** True while a parsed HDRI is held. */
  get hasEnvironment(): boolean {
    return this.source !== null
  }

  /**
   * Writes everything that needs no bytes: intensity, background, tone mapping, and the
   * currently loaded map (if any). Cheap and synchronous, so the background colour can
   * follow a colour-picker drag without touching the asset pipeline.
   */
  syncScene(doc: SceneDocument): void {
    const { scene } = this.targets
    const env = doc.meta.environment
    const map = this.compiled?.texture ?? this.source

    scene.environment = env.hdriAssetId === null ? null : map
    scene.environmentIntensity = env.intensity

    scene.background =
      doc.meta.background.type === 'transparent'
        ? null
        : doc.meta.background.type === 'hdri'
          ? // Null while the bytes are still loading. Falling back to `background.color`
            // would flash the old colour for a frame and read as a bug in the switch.
            map
          : new Color(doc.meta.background.color)

    // T-239 · **写在 `if (!renderer) return` 之前。**
    //
    // 雾是场景的属性不是渲染器的，而这条早退是给「没有画布」的路径准备的——headless
    // 运行时、parity、单测全走那条。写在早退之后，雾在那些路径上永远是 null，而
    // parity 恰好是「编辑器预览与播放器一致」的唯一机器证明。
    this.applyFog(doc)

    const renderer = this.targets.renderer()
    if (!renderer) return
    renderer.toneMapping = env.hdriAssetId === null ? NoToneMapping : ACESFilmicToneMapping
    renderer.toneMappingExposure = env.exposure
    // T-236 · **把「输出是 sRGB」这个假设写出来，而不是靠 three 的默认值。**
    //
    // 今天它与 three 的默认一致，所以这一行是个 no-op——但整条后处理链都建立在它之上：
    // `OutputPass` 读它来决定要不要做线性→sRGB 转换（OutputPass.js:97）。three 改过一次
    // 这个 API 的名字与语义（`outputEncoding` → `outputColorSpace`），而那种变化的症状是
    // 画面整体偏灰、没有任何报错。假设写出来，下一次升级时它至少会以类型错误的形式出现。
    renderer.outputColorSpace = SRGBColorSpace
  }

  /**
   * 把文档里的雾写进 `scene.fog`。
   *
   * `enabled: false` 时**写 null**，不是留着上一次的对象——关掉雾之后画面还带着雾，
   * 而文档里那个开关明明是关的，这是最难自查的一类不一致。
   */
  private applyFog(doc: SceneDocument): void {
    const fog = doc.meta.fog
    if (!fog.enabled) {
      this.targets.scene.fog = null
      return
    }
    const colour = new Color(fog.color).getHex()
    this.targets.scene.fog =
      fog.type === 'linear' ? new ThreeFog(colour, fog.near, fog.far) : new FogExp2(colour, fog.density)
  }

  /**
   * Brings the loaded environment in line with the document, fetching and prefiltering the
   * `.hdr` when the referenced asset changed.
   *
   * Never rejects: a missing or malformed HDRI must not stop a scene from opening. It logs,
   * clears the environment, and the scene renders with whatever lights it has.
   */
  async apply(doc: SceneDocument): Promise<void> {
    const assetId = doc.meta.environment.hdriAssetId
    const token = ++this.generation

    if (assetId === null) {
      this.release()
      this.syncScene(doc)
      return
    }

    if (assetId !== this.loadedAssetId) {
      const asset = doc.assets.find((a) => a.id === assetId)
      if (!asset) {
        this.fail(doc, `环境贴图引用的资产不存在：${assetId}`)
        return
      }
      if (asset.type !== 'hdri') {
        this.fail(doc, `环境贴图必须是 hdri 资产：「${asset.name}」的类型是 ${asset.type}`)
        return
      }

      let bytes: ArrayBuffer
      try {
        bytes = await this.targets.resolve(asset.url)
      } catch (error) {
        this.fail(doc, `环境贴图加载失败：${asset.name}`, error)
        return
      }
      // Superseded while we were waiting — the newer call owns the scene now.
      if (token !== this.generation) return

      let texture: DataTexture
      try {
        texture = parseHdr(bytes)
      } catch (error) {
        this.fail(doc, `环境贴图解析失败：${asset.name}（需要 Radiance .hdr / RGBE 格式）`, error)
        return
      }

      const renderer = this.targets.renderer()
      // The raw equirectangular texture is a usable environment on its own; PMREM makes the
      // roughness response correct. Without a renderer yet, keep the source and prefilter
      // on the next apply rather than refusing to show anything.
      const compiled = renderer ? this.compile(texture, renderer) : null

      this.release()
      this.source = texture
      this.compiled = compiled
      this.loadedAssetId = assetId
    } else if (this.compiled === null && this.source !== null) {
      // Same asset, but a renderer has arrived since it was parsed.
      const renderer = this.targets.renderer()
      if (renderer) this.compiled = this.compile(this.source, renderer)
    }

    this.syncScene(doc)
  }

  /** Frees the GPU-side resources and detaches them from the scene. */
  dispose(): void {
    this.release()
    this.targets.scene.environment = null
    this.targets.scene.background = null
  }

  private fail(doc: SceneDocument, message: string, data?: unknown): void {
    this.targets.log('error', message, data)
    this.release()
    this.syncScene(doc)
  }

  private release(): void {
    if (this.source === null && this.compiled === null) return
    this.compiled?.dispose()
    this.source?.dispose()
    this.compiled = null
    this.source = null
    this.loadedAssetId = null
    this.disposedCount++
  }
}

/**
 * 按场景包围盒估一组 linear 雾的 near / far。
 *
 * **两个系数是拍的，不是测的**（与 `fog.ts` 对 10/100 的处置同一口径）：near 取对角线的
 * 一半——比这更近会让选中的零件自己就开始发灰；far 取 2.5 倍——比这更远雾就看不出来，
 * 用户会以为开关没生效。
 *
 * 包围盒退化（一个点）时返回 `DEFAULT_FOG` 的 10 / 100 而不是 0 / 0：后者会让
 * `near >= far`（I16 报 error），而「场景里只有一个点」不该让文档变得发布不了。
 *
 * @param bounds 场景包围盒
 * @returns 一组可直接写进 `meta.fog` 的 near / far
 */
export function suggestFogRange(bounds: Bounds): { near: number; far: number } {
  const dx = bounds.max[0] - bounds.min[0]
  const dy = bounds.max[1] - bounds.min[1]
  const dz = bounds.max[2] - bounds.min[2]
  const diagonal = Math.sqrt(dx * dx + dy * dy + dz * dz)
  if (!Number.isFinite(diagonal) || diagonal < 1e-6) return { near: DEFAULT_FOG.near, far: DEFAULT_FOG.far }
  return { near: diagonal * 0.5, far: diagonal * 2.5 }
}

/**
 * 让一棵子树不吃雾。
 *
 * 编辑期的辅助物（网格、灯光线框、变换手柄、拾取代理球）是**工具**不是场景内容——
 * 它们随距离褪成雾色，用户会以为自己的模型出问题了。而真正致命的是网格：它铺满整个
 * 地面，开雾之后远端整片糊掉，看起来像渲染坏了。
 *
 * `needsUpdate` 是必要的：注册可能发生在运行中（新建一盏灯），那时材质已经编译过，
 * 只改 JS 字段不会让 shader 重编。
 */
export function disableFogOn(root: Object3D): void {
  root.traverse((object) => {
    const material = (object as Mesh).material
    if (!material) return
    for (const one of Array.isArray(material) ? material : [material]) {
      if (!('fog' in one)) continue
      one.fog = false
      one.needsUpdate = true
    }
  })
}
