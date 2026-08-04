import type { Asset } from '@w3/schema'
import type { AnimationClip, Object3D, WebGLRenderer } from 'three'
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js'
import type { RendererLike } from './renderer-like.js'
import type { AssetResolver, AssetSource, LoadedAsset } from './types.js'

/**
 * T-032 · GLB loading.
 *
 * Two things here are load-bearing for the constitution:
 *
 * **C6** — Draco and KTX2 decoders are WASM blobs the loaders fetch at runtime, and
 * the classic failure is fetching them from a CDN: a white screen on a customer
 * intranet, found on go-live day (anti-pattern A7).
 *
 * three 0.185 resolves them with `new URL('../libs/…', import.meta.url)`, so a bundler
 * emits them alongside the app and they load SAME-ORIGIN with no configuration. That
 * is why no decoder path is set by default: overriding it would replace a path the
 * bundler already resolved correctly with one the host then has to remember to serve.
 *
 * `vendor/` and `scripts/sync-vendor.mjs` remain for the deployment that does need an
 * explicit path — a non-bundled build, or decoders served from a shared location.
 * See ADR-0012.
 *
 * **C7** — bytes arrive through the injected `AssetResolver`. This loader never learns
 * whether they came from IndexedDB, a `.w3p` zip or an HTTP endpoint, which is what
 * lets it run in Node against a resolver backed by an in-memory Map.
 */

/**
 * Where `vendor/` is served from, for hosts that opt into an explicit decoder path.
 *
 * **Who uses these** (T-220 · the question ADR-0012 left open and nobody answered for two
 * releases): nothing in this repository does, on purpose. The bundler resolves three's own
 * decoders through `import.meta.url` and emits them same-origin into `dist/assets/` with a
 * content hash — measured, 7 files in each of the editor's and player's `dist`. **`/vendor/`
 * receives zero requests in every deployment shape this repository builds.**
 *
 * They exist for the **non-bundled** deployment: two `dist` folders dropped onto an arbitrary
 * static server, or decoders served from a shared location. That host passes one of these to
 * `AssetLoaderOptions.dracoPath` / `ktx2Path`. `docs/DEPLOY.md` §5 is that shape.
 *
 * ⚠ **That path has no test pointing at it.** ADR-0037 accepts this as its weakest link and
 * writes the undo condition accordingly — hence the expiry below rather than a bare comment.
 */
// CONSTITUTION-EXCEPTION: C5 · ADR-0037 · 到期 v1.2
export const VENDOR_DRACO_PATH = '/vendor/draco/gltf/'
// CONSTITUTION-EXCEPTION: C5 · ADR-0037 · 到期 v1.2
export const VENDOR_KTX2_PATH = '/vendor/basis/'

export interface AssetLoaderOptions {
  readonly resolver: AssetResolver
  /** Leave unset to use three's bundler-resolved, same-origin decoders. */
  readonly dracoPath?: string
  readonly ktx2Path?: string
  /**
   * Required only for KTX2: the transcoder picks a GPU texture format from the
   * renderer's capabilities. Without one, KTX2 support is simply not registered, and a
   * GLB that needs it fails with a clear message rather than a corrupt texture.
   *
   * T-219 · typed `RendererLike`, not `WebGLRenderer`, so a stub with no GL satisfies it —
   * and **preferably left unset**: `attachRenderer` is the wiring production uses, because
   * the renderer usually does not exist yet when the loader is constructed. That ordering
   * is exactly why this option was dead for two releases.
   */
  readonly renderer?: RendererLike
  readonly onWarn?: (message: string, data?: unknown) => void
}

export class AssetLoader implements AssetSource {
  private gltf = new GLTFLoader()
  private draco: DRACOLoader | null = null
  private ktx2: KTX2Loader | null = null
  private cache = new Map<string, LoadedAsset>()
  private inflight = new Map<string, Promise<LoadedAsset>>()
  private readonly options: AssetLoaderOptions

  constructor(options: AssetLoaderOptions) {
    this.options = options

    this.draco = new DRACOLoader()
    // Only override when the host asks: three's own default is already same-origin.
    if (options.dracoPath) this.draco.setDecoderPath(options.dracoPath)
    this.gltf.setDRACOLoader(this.draco)

    // Kept so existing callers behave identically; the real path is `attachRenderer`.
    if (options.renderer) this.attachRenderer(options.renderer)
  }

  /**
   * Installs (or removes) the renderer the KTX2 transcoder needs. Idempotent.
   *
   * **The KTX2 decoder had never been constructed — not once, in any build.** The old code
   * created it inside `if (options.renderer)` in the constructor, and **neither production
   * construction site passed a renderer** (`scene-runtime.ts` and the editor's
   * `ProjectSession` both build the loader before a canvas exists). Every reference to KTX2
   * in this repository, including the promise in 附件A that customers may ship `.ktx2`
   * textures, rested on a branch whose condition was always false. That is 债 · U-16.
   *
   * The name matches `SceneRuntime.attachRenderer` deliberately: two designs originally
   * wrote this as two cards with two different names for the same fix, and each estimated it
   * separately (台账 C7).
   *
   * Passing `null` disposes the transcoder — its worker pool and WASM belong to the renderer
   * that just went away.
   */
  attachRenderer(renderer: RendererLike | null): void {
    if (renderer === null) {
      this.ktx2?.dispose()
      this.ktx2 = null
      this.gltf.setKTX2Loader(null)
      return
    }

    // A capability probe, not a formality: `WebGPURenderer` and every head-less stub reach
    // this line without an `extensions` registry, and `detectSupport` would throw reading it.
    // Refusing here means a KTX2 texture reports 「未启用」 instead of crashing the import.
    if (typeof renderer.extensions?.has !== 'function') {
      this.options.onWarn?.('渲染器没有提供 WebGL 扩展信息，KTX2 压缩贴图将无法解码')
      return
    }

    if (!this.ktx2) {
      this.ktx2 = new KTX2Loader()
      if (this.options.ktx2Path) this.ktx2.setTranscoderPath(this.options.ktx2Path)
    }
    // Re-probed on every attach: a new renderer can have different capabilities, and this is
    // cheap — `detectSupport` reads flags and issues no request (the fetch is in `init()`,
    // which only runs when a KTX2 file is actually parsed).
    this.ktx2.detectSupport(renderer as unknown as WebGLRenderer)
    this.gltf.setKTX2Loader(this.ktx2)
  }

  /** The transcoder currently installed, or null. Read by the wiring assertions (T-219). */
  get ktx2Loader(): KTX2Loader | null {
    return this.ktx2
  }

  get(assetId: string): LoadedAsset | undefined {
    return this.cache.get(assetId)
  }

  has(assetId: string): boolean {
    return this.cache.has(assetId)
  }

  get size(): number {
    return this.cache.size
  }

  /**
   * Loads a model asset, or returns the cached one.
   *
   * Concurrent calls for the same asset share one in-flight promise: a document with
   * thirty nodes pointing at one GLB must download and parse it once, not thirty times.
   */
  async load(asset: Asset): Promise<LoadedAsset> {
    const cached = this.cache.get(asset.id)
    if (cached) return cached

    const existing = this.inflight.get(asset.id)
    if (existing) return existing

    const promise = this.loadUncached(asset)
      .then((loaded) => {
        this.cache.set(asset.id, loaded)
        return loaded
      })
      .finally(() => {
        this.inflight.delete(asset.id)
      })

    this.inflight.set(asset.id, promise)
    return promise
  }

  private async loadUncached(asset: Asset): Promise<LoadedAsset> {
    if (asset.type !== 'model') {
      throw new Error(`AssetLoader 只加载 model 类型资产，收到 type=${asset.type}（${asset.name}）`)
    }
    const bytes = await this.options.resolver.resolve(asset.url)
    return this.parse(asset.id, bytes)
  }

  /** Parses GLB bytes that are already in hand. Split out so tests need no resolver. */
  async parse(assetId: string, bytes: ArrayBuffer): Promise<LoadedAsset> {
    const gltf = await this.gltf.parseAsync(bytes, '')
    const objects = indexObjects(gltf.scene, (message) => this.options.onWarn?.(message))
    return { assetId, scene: gltf.scene, clips: gltf.animations as AnimationClip[], objects }
  }

  /** Drops a single asset from the cache, freeing its geometry and textures. */
  evict(assetId: string): boolean {
    const loaded = this.cache.get(assetId)
    if (!loaded) return false
    this.cache.delete(assetId)
    disposeAsset(loaded)
    return true
  }

  dispose(): void {
    for (const loaded of this.cache.values()) disposeAsset(loaded)
    this.cache.clear()
    this.inflight.clear()
    this.draco?.dispose()
    this.ktx2?.dispose()
    this.draco = null
    this.ktx2 = null
  }
}

/**
 * Builds the `objectPath -> Object3D` index that `assetRef` addresses.
 *
 * The path is the name chain from the glTF scene's children downward — the scene
 * wrapper itself is not part of it, because exporters name it inconsistently
 * ("Scene", "Sketchfab_Scene", "") and `objectPath` has to survive a re-export.
 *
 * glTF permits duplicate sibling names, so a collision is possible. First one wins and
 * the caller is told; silently overwriting would make the remap ladder's tier 1 point at
 * the wrong object, which is worse than an unmatched reference.
 */
export function indexObjects(scene: Object3D, onWarn?: (message: string) => void): Map<string, Object3D> {
  const objects = new Map<string, Object3D>()

  const walk = (object: Object3D, prefix: string) => {
    const name = object.name === '' ? object.type : object.name
    const path = prefix === '' ? name : `${prefix}/${name}`
    if (objects.has(path)) {
      onWarn?.(`资产中存在重名路径「${path}」，重映射将只认第一个。建议在导出前重命名。`)
    } else {
      objects.set(path, object)
    }
    for (const child of object.children) walk(child, path)
  }

  for (const child of scene.children) walk(child, '')
  return objects
}

/** Frees everything a loaded asset owns. Instances share this geometry, so evict late. */
export function disposeAsset(loaded: LoadedAsset): void {
  loaded.scene.traverse((child) => {
    const mesh = child as Object3D & {
      geometry?: { dispose(): void }
      material?: { dispose(): void } | { dispose(): void }[]
    }
    mesh.geometry?.dispose()
    if (Array.isArray(mesh.material)) for (const m of mesh.material) m.dispose()
    else mesh.material?.dispose()
  })
}

/** An AssetResolver over an in-memory map. Used by tests and by the `.w3p` player path. */
export function createMemoryResolver(files: ReadonlyMap<string, ArrayBuffer>): AssetResolver {
  return {
    async resolve(url: string): Promise<ArrayBuffer> {
      const bytes = files.get(url)
      if (!bytes) throw new Error(`资产未找到：${url}`)
      return bytes
    },
  }
}
