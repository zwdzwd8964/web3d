import type { SceneDocument } from '@w3/schema'
import { createGoldenPathDocument } from '@w3/schema'
import type { AssetResolver } from '@w3/storage'
import { AssetLoader, buildSamplePumpGlb } from '@w3/core'
import type { StorageProvider } from '@w3/storage'
import { IndexedDbProvider, MemoryProvider, pathToHash } from '@w3/storage'

/**
 * The project session — one storage provider, one resolver, one loader, for the whole
 * editor.
 *
 * This file exists because of a bug, and the bug is worth recording. The viewport used to
 * build its runtime with `createMemoryResolver(new Map())` while the asset panel kept its
 * own module-level `MemoryProvider` and `AssetLoader`. Both halves worked. Importing a GLB
 * ran a full health check, grew the hierarchy tree, grew the asset list, and advanced the
 * object count in the status bar — and the viewport never showed a single triangle,
 * because the bytes went into one loader and the renderer read from the other. Every
 * signal said success; only the picture disagreed.
 *
 * So: exactly one owner of asset bytes, handed to everything that needs them (C7 — the
 * rest of the editor sees `StorageProvider` and never IndexedDB).
 */

export interface ProjectSessionOptions {
  /** Injected by tests. Defaults to IndexedDB, falling back to memory. */
  readonly storage?: StorageProvider
}

export class ProjectSession {
  readonly storage: StorageProvider
  readonly resolver: AssetResolver
  readonly loader: AssetLoader

  /**
   * Bytes for assets whose url is not content-addressed.
   *
   * The sample document is transcribed from SCHEMA_SPEC §12 and names its model
   * `pump.glb` — not a `assets/ab/cd/…` path. Rewriting the sample to match our storage
   * layout would be editing a spec artifact to fit the implementation, so the bytes are
   * served from here instead and everything downstream stays unaware.
   */
  private readonly overlay = new Map<string, ArrayBuffer>()

  constructor(options: ProjectSessionOptions = {}) {
    this.storage = options.storage ?? defaultStorage()
    this.resolver = {
      resolve: (url) => this.resolve(url),
    }
    this.loader = new AssetLoader({ resolver: this.resolver })
  }

  private async resolve(url: string): Promise<ArrayBuffer> {
    const overlaid = this.overlay.get(url)
    if (overlaid) return overlaid

    const hash = pathToHash(url)
    if (!hash) throw new Error(`无法解析资产地址（既不是内容寻址路径，也不在会话缓存中）：${url}`)

    const bytes = await this.storage.getBlob(hash)
    if (!bytes) throw new Error(`存储中找不到该资产的字节：${url}`)
    // Copy onto a standalone buffer: the view IndexedDB hands back may be a window onto a
    // larger one, and GLTFLoader reads the whole buffer.
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
  }

  /** Serves bytes for a url the storage layer cannot address. */
  provide(url: string, bytes: ArrayBuffer): void {
    this.overlay.set(url, bytes)
  }

  /**
   * Gives the sample document's placeholder asset real geometry.
   *
   * Generated rather than committed: a binary in the repo would be invisible to review,
   * and the object paths have to stay in lockstep with the sample document's assetRefs —
   * `buildSamplePumpGlb` and `createGoldenPathDocument` are edited together or not at all.
   *
   * Gated on the project id rather than on "we could not resolve it". An imported asset
   * whose blob has gone missing must fail loudly; quietly substituting a pump for it would
   * turn data loss into a wrong picture, which is strictly worse.
   */
  async seedSampleAsset(doc: SceneDocument): Promise<void> {
    if (doc.projectId !== SAMPLE_PROJECT_ID) return
    const sample = doc.assets.find((a) => a.type === 'model')
    if (!sample || this.overlay.has(sample.url)) return
    this.provide(sample.url, await buildSamplePumpGlb())
  }

  async save(doc: SceneDocument): Promise<void> {
    await this.storage.saveDocument(doc)
  }

  async load(projectId: string): Promise<SceneDocument | null> {
    return this.storage.loadDocument(projectId)
  }

  async dispose(): Promise<void> {
    this.loader.dispose()
    this.overlay.clear()
    await this.storage.close()
  }
}

/** SCHEMA_SPEC §12's sample. Read once rather than rebuilt on every boot. */
const SAMPLE_PROJECT_ID = createGoldenPathDocument().projectId

function defaultStorage(): StorageProvider {
  // The feature detection lives inside @w3/storage, and the C7 guard is right to insist:
  // the editor naming a browser API directly is exactly the coupling that makes the v1
  // swap to an HTTP provider a rewrite instead of a constructor change.
  //
  // Memory is a working editor that forgets on refresh; a crash on boot is not.
  return IndexedDbProvider.isSupported() ? new IndexedDbProvider() : new MemoryProvider()
}
