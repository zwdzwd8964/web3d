import type { Asset, SceneDocument } from '@w3/schema'
import { Texture } from 'three'
import type { LogLevel } from '../eca/types.js'
import type { AssetResolver } from './types.js'
// Runtime import in ONE direction only: material-registry's own import of this module is
// type-only (TextureSource), so no cycle exists at runtime. The key builder stays next to
// the slot semantics it encodes; this module owns the map the keys index.
import { samplerVariant } from './material-registry.js'
import type { TextureSlot } from './material-registry.js'

/**
 * T-151 · one Texture per texture ASSET, shared by every material that references it.
 *
 * The alternative — a Texture per material slot — uploads the same 4 MB image to the GPU
 * once per material that uses it. A scene where twelve materials share one tiling concrete
 * map would cost twelve uploads and twelve copies of VRAM for one image, and nothing in the
 * UI would explain why the scene got heavy.
 *
 * **Decoding is injected.** Turning bytes into something the GPU can sample needs
 * `createImageBitmap`, which is a browser API, and constitution C8 says the engine must be
 * testable without one. Production passes the browser decoder; tests pass a stub. The cache
 * itself — keying, ref counting, disposal, the colour-space handoff — is the part with the
 * bugs in it, and it runs in plain Node.
 *
 * Reference counting is by ASSET, not by slot: a material that drops its normal map does not
 * dispose a texture the material next to it is still drawing with.
 */

/** Bytes to something `Texture` can sample. Browser: `createImageBitmap`. */
export type TextureDecoder = (bytes: ArrayBuffer, mimeType: string) => Promise<TexImageSource>

export interface TextureCacheOptions {
  readonly resolver: AssetResolver
  /** Injected; absent means this build cannot decode images (headless parity runs). */
  readonly decode?: TextureDecoder
  readonly log?: (level: LogLevel, message: string, data?: unknown) => void
}

/**
 * What the registry sees: a synchronous look-up that never does I/O.
 *
 * `variant` asks for an INSTANCE of the asset that this caller may write sampler state onto.
 * One Texture per asset is what keeps VRAM bounded, but `colorSpace`, `repeat`, `offset` and
 * `rotation` all live ON the Texture — so a single shared instance means every material
 * writing them fights every other one. Two failures, both reproduced (T-176 审查所得):
 *
 *   - the same image in 「基础色」 and 「粗糙度」 ends up LINEAR, and the base colour is
 *     sampled wrong — the object renders washed out with nothing explaining it;
 *   - two materials using one image at different tilings: the last one applied wins, and
 *     the 「分离材质」 button the user just pressed does not separate this.
 *
 * So the cache hands out one instance per (asset, variant). Variants share the decoded
 * image — `clone()` copies the reference, not the pixels — so the CPU cost is one decode
 * however many variants exist.
 */
export interface TextureSource {
  get(assetId: string, variant?: string): Texture | undefined
}

interface Entry {
  readonly texture: Texture
  /** How many materials currently reference this asset. */
  count: number
}

export class TextureCache implements TextureSource {
  private entries = new Map<string, Entry>()
  /** In-flight loads, so two materials referencing one asset do not decode it twice. */
  private loading = new Map<string, Promise<Texture | null>>()
  /** Per-(asset, variant) instances, so sampler state cannot leak between materials. */
  private variants = new Map<string, Texture>()
  private readonly options: TextureCacheOptions

  constructor(options: TextureCacheOptions) {
    this.options = options
  }

  /** How many distinct texture assets are resident. For the benchmark and the tests. */
  get size(): number {
    return this.entries.size
  }

  /**
   * The Texture for an asset, if it is already resident.
   *
   * Synchronous by contract: `applyParams` runs inside the patch path, which D1 requires to
   * be synchronous. Loading is the host's job, before the patches are handed over — the
   * same division `AssetLoader` already uses for models.
   */
  get(assetId: string, variant = ''): Texture | undefined {
    const base = this.entries.get(assetId)
    if (!base) return undefined
    if (variant === '') return base.texture

    const key = `${assetId}::${variant}`
    const existing = this.variants.get(key)
    if (existing) return existing

    // Shares the decoded image; only the sampler state is per-variant.
    const clone = base.texture.clone()
    clone.needsUpdate = true
    this.variants.set(key, clone)
    return clone
  }

  /** How many variant instances exist. Bounded, and asserted to be — see the tests. */
  get variantCount(): number {
    return this.variants.size
  }

  has(assetId: string): boolean {
    return this.entries.has(assetId)
  }

  /** Loads and decodes one texture asset. Idempotent, and safe to call concurrently. */
  async load(asset: Asset): Promise<Texture | null> {
    const resident = this.entries.get(asset.id)
    if (resident) return resident.texture

    const inFlight = this.loading.get(asset.id)
    if (inFlight) return inFlight

    const promise = this.decodeInto(asset).finally(() => this.loading.delete(asset.id))
    this.loading.set(asset.id, promise)
    return promise
  }

  private async decodeInto(asset: Asset): Promise<Texture | null> {
    const decode = this.options.decode
    if (!decode) return null
    try {
      const bytes = await this.options.resolver.resolve(asset.url)
      const source = await decode(bytes, mimeOf(asset))
      const texture = new Texture(source)
      texture.name = asset.name
      // Without this the texture is uploaded as an empty black image: three only reads the
      // source on the frame after `needsUpdate` is set.
      texture.needsUpdate = true
      // Set per SLOT by the material registry (D3). Left at three's default here on
      // purpose: a texture is not sRGB or linear until something says what it is FOR.
      this.entries.set(asset.id, { texture, count: 0 })
      return texture
    } catch (error) {
      this.options.log?.('error', `贴图加载失败：${asset.name}`, error)
      return null
    }
  }

  /**
   * Loads every texture the document's materials actually reference.
   *
   * Referenced, not "every image asset in the project": a user who imported twenty textures
   * and used three should pay for three. An asset that is only sitting in the library costs
   * storage, not VRAM.
   */
  async ensure(doc: SceneDocument): Promise<void> {
    const wanted = referencedTextureIds(doc)
    const byId = new Map(doc.assets.map((a) => [a.id, a]))
    for (const assetId of wanted) {
      if (this.entries.has(assetId)) continue
      const asset = byId.get(assetId)
      if (!asset) continue
      await this.load(asset)
    }
    this.retainOnly(wanted, doc)
  }

  /**
   * Drops textures no material references any more.
   *
   * Called from `ensure`. M11 originally registered "clearing a slot never reclaims" —
   * that closed itself when the patch forwarder started routing EVERY maps patch
   * (including the remove of a clear) through `ensureAssets`, so a clear does reach this
   * sweep. What stayed leaked until T-186 was the VARIANT of a retained asset: the old
   * sweep only ran inside the dropped-asset branch, so clearing one slot while another
   * material kept the asset stranded that slot's per-(asset, sampler-state) clone — and
   * with a distinct colorSpace or wrap, that is a real extra GL texture. Variants are now
   * kept by (asset, sampler-state) demand. A uv tweak alone takes the fast patch path
   * (no ensure), so its orphaned variant lingers until the next ensure — bounded by the
   * number of distinct settings, and reclaimed instead of immortal.
   */
  private retainOnly(wanted: ReadonlySet<string>, doc: SceneDocument): void {
    const counts = new Map<string, number>()
    const wantedVariants = new Set<string>()
    for (const material of doc.materials) {
      for (const [slot, assetId] of Object.entries(material.params.maps)) {
        if (typeof assetId !== 'string') continue
        counts.set(assetId, (counts.get(assetId) ?? 0) + 1)
        wantedVariants.add(`${assetId}::${samplerVariant(slot as TextureSlot, material)}`)
      }
    }

    for (const [assetId, entry] of this.entries) {
      entry.count = counts.get(assetId) ?? 0
      if (wanted.has(assetId)) continue
      entry.texture.dispose()
      this.entries.delete(assetId)
    }
    for (const [key, variant] of [...this.variants]) {
      if (wantedVariants.has(key)) continue
      variant.dispose()
      this.variants.delete(key)
    }
  }

  /** How many materials reference this asset, as of the last `ensure`. */
  refCount(assetId: string): number {
    return this.entries.get(assetId)?.count ?? 0
  }

  dispose(): void {
    for (const entry of this.entries.values()) entry.texture.dispose()
    for (const variant of this.variants.values()) variant.dispose()
    this.entries.clear()
    this.variants.clear()
    this.loading.clear()
  }
}

/** Every texture asset id any material in the document points at. */
export function referencedTextureIds(doc: SceneDocument): Set<string> {
  const ids = new Set<string>()
  for (const material of doc.materials) {
    for (const assetId of Object.values(material.params.maps)) {
      if (typeof assetId === 'string') ids.add(assetId)
    }
  }
  return ids
}

/**
 * The MIME type a decoder needs.
 *
 * From the file NAME, not from the asset type: `type` says 'texture', which is what the
 * image is for, and tells a decoder nothing about how the bytes are encoded.
 */
function mimeOf(asset: Asset): string {
  const dot = asset.name.lastIndexOf('.')
  const extension = dot === -1 ? '' : asset.name.slice(dot + 1).toLowerCase()
  return MIME_BY_EXTENSION[extension] ?? 'application/octet-stream'
}

const MIME_BY_EXTENSION: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  ktx2: 'image/ktx2',
}

/**
 * The browser decoder. Absent outside a browser, which is why it is resolved lazily.
 *
 * `createImageBitmap` rather than an `<img>` element: it decodes off the main thread, and a
 * dropped texture should not stutter the viewport that is still being dragged.
 */
export function browserTextureDecoder(): TextureDecoder | undefined {
  if (typeof createImageBitmap !== 'function') return undefined
  return async (bytes, mimeType) => createImageBitmap(new Blob([bytes], { type: mimeType }))
}
