import type { SceneDocument } from '@w3/schema'

/**
 * T-020 · constitution C7. The seam, and nothing but the seam.
 *
 * Not one word in this file names a storage technology. That is the whole test: v0
 * ships an IndexedDB implementation, v1 adds an HTTP one, and the amount of business
 * code that changes between them must be zero. MVP_V0 §0 makes that "zero" an explicit
 * v1 acceptance item, so any leak here is a bill that comes due later.
 */

/** Content address, `sha256:<64 hex>`. Assets are immutable and addressed by content (D4). */
export type BlobHash = string

export interface ProjectSummary {
  readonly projectId: string
  readonly name: string
  readonly updatedAt: string
  readonly thumbnailUrl?: string
}

export interface SnapshotSummary {
  readonly snapshotId: string
  readonly projectId: string
  readonly publishedAt: string
  readonly schemaVersion: number
  readonly coreVersion: string
  readonly assetCount: number
  readonly label?: string
}

export interface Snapshot {
  readonly meta: SnapshotSummary
  readonly document: SceneDocument
}

/**
 * Everything the editor and player are allowed to know about persistence.
 *
 * All methods are async even where a given implementation could answer synchronously —
 * a provider that is a network call in v1 must not force call sites to change shape.
 */
export interface StorageProvider {
  readonly kind: string

  /* --- projects ---------------------------------------------------------- */
  listProjects(): Promise<ProjectSummary[]>
  loadDocument(projectId: string): Promise<SceneDocument | null>
  saveDocument(document: SceneDocument): Promise<void>
  deleteProject(projectId: string): Promise<void>

  /* --- content-addressed blobs ------------------------------------------- */
  /** Stores bytes and returns their content address. Storing the same bytes twice is a no-op. */
  putBlob(bytes: Uint8Array): Promise<BlobHash>
  getBlob(hash: BlobHash): Promise<Uint8Array | null>
  hasBlob(hash: BlobHash): Promise<boolean>

  /* --- published snapshots ------------------------------------------------ */
  listSnapshots(projectId: string): Promise<SnapshotSummary[]>
  saveSnapshot(snapshot: Snapshot): Promise<void>
  loadSnapshot(snapshotId: string): Promise<Snapshot | null>

  /** Releases handles. Safe to call more than once. */
  close(): Promise<void>
}

/**
 * Resolves a document's relative asset `url` to bytes.
 *
 * @w3/core takes one of these and never learns where the bytes came from — that is what
 * lets the runtime be exercised in Node against a fake resolver with no WebGL (C8), and
 * why core is allowed to sit beside storage rather than above it (MVP_V0 §3).
 */
export interface AssetResolver {
  resolve(url: string): Promise<ArrayBuffer>
}

export class StorageError extends Error {
  readonly code: 'not-found' | 'conflict' | 'unavailable' | 'corrupt' | 'quota-exceeded'
  constructor(code: StorageError['code'], message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'StorageError'
    this.code = code
  }
}

/**
 * T-202 · turns a provider-specific write failure into `quota-exceeded`.
 *
 * Running out of space is the one storage failure a user can actually do something about,
 * and it is the one this product will hit first: a scene with a handful of 4K textures and
 * a video is tens of megabytes, and the browser's default quota is a fraction of the disk.
 * Before this, IndexedDB's `QuotaExceededError` reached the editor as a raw DOMException
 * with an English message, through a catch that said 「保存失败」.
 *
 * Every write path in every provider goes through here, so the contract suite can assert one
 * behaviour on both — which is the only way `MemoryProvider` and `IndexedDbProvider` can be
 * held to the same promise about a condition only one of them can naturally produce.
 */
export async function mapWriteError<T>(what: string, body: () => Promise<T>): Promise<T> {
  try {
    return await body()
  } catch (cause) {
    if (cause instanceof StorageError) throw cause
    if (isQuotaError(cause)) {
      throw new StorageError('quota-exceeded', `浏览器本地存储空间不足，${what}失败。请清理其他站点数据或删除不用的项目后重试。`, {
        cause,
      })
    }
    throw cause
  }
}

/**
 * Whether `cause` is the browser saying "no more room".
 *
 * Matched by name rather than by `instanceof DOMException`: the name is what the spec fixes,
 * and `fake-indexeddb` (which is how this path is tested at all) raises its own error class.
 * `QUOTA_EXCEEDED_ERR` is the legacy code some engines still set.
 */
function isQuotaError(cause: unknown): boolean {
  if (typeof cause !== 'object' || cause === null) return false
  const { name, code } = cause as { name?: unknown; code?: unknown }
  return name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED' || code === 22
}
