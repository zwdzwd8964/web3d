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
  readonly code: 'not-found' | 'conflict' | 'unavailable' | 'corrupt'
  constructor(code: StorageError['code'], message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'StorageError'
    this.code = code
  }
}
