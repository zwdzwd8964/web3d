import type { SceneDocument } from '@w3/schema'
import { hashBytes } from './hash.js'
import type { BlobHash, ProjectSummary, Snapshot, SnapshotSummary, StorageProvider } from './provider.js'

/**
 * T-022 · an in-memory StorageProvider.
 *
 * Its job is not convenience. It is the reference implementation the shared contract
 * suite runs against first, so that when IndexedDbProvider (or v1's HttpApiProvider)
 * fails the same suite, the failure is unambiguously in the adapter and not in the
 * contract's expectations.
 */
export class MemoryProvider implements StorageProvider {
  readonly kind = 'memory'

  private documents = new Map<string, SceneDocument>()
  private blobs = new Map<BlobHash, Uint8Array>()
  private snapshots = new Map<string, Snapshot>()
  private closed = false

  private assertOpen(): void {
    if (this.closed) throw new Error('MemoryProvider has been closed')
  }

  /** Everything in and out is cloned: callers must never share mutable state with the store. */
  private static clone<T>(value: T): T {
    return structuredClone(value)
  }

  async listProjects(): Promise<ProjectSummary[]> {
    this.assertOpen()
    return [...this.documents.values()]
      .map((doc) => ({ projectId: doc.projectId, name: doc.name, updatedAt: doc.meta.updatedAt }))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.projectId.localeCompare(b.projectId))
  }

  async loadDocument(projectId: string): Promise<SceneDocument | null> {
    this.assertOpen()
    const doc = this.documents.get(projectId)
    return doc ? MemoryProvider.clone(doc) : null
  }

  async saveDocument(document: SceneDocument): Promise<void> {
    this.assertOpen()
    this.documents.set(document.projectId, MemoryProvider.clone(document))
  }

  async deleteProject(projectId: string): Promise<void> {
    this.assertOpen()
    this.documents.delete(projectId)
    for (const [id, snapshot] of this.snapshots) {
      if (snapshot.meta.projectId === projectId) this.snapshots.delete(id)
    }
  }

  async putBlob(bytes: Uint8Array): Promise<BlobHash> {
    this.assertOpen()
    const hash = await hashBytes(bytes)
    // D4: identical bytes are the same asset. Re-storing is a no-op, not a duplicate.
    if (!this.blobs.has(hash)) this.blobs.set(hash, bytes.slice())
    return hash
  }

  async getBlob(hash: BlobHash): Promise<Uint8Array | null> {
    this.assertOpen()
    const bytes = this.blobs.get(hash)
    return bytes ? bytes.slice() : null
  }

  async hasBlob(hash: BlobHash): Promise<boolean> {
    this.assertOpen()
    return this.blobs.has(hash)
  }

  async listSnapshots(projectId: string): Promise<SnapshotSummary[]> {
    this.assertOpen()
    return [...this.snapshots.values()]
      .filter((s) => s.meta.projectId === projectId)
      .map((s) => MemoryProvider.clone(s.meta))
      .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt) || a.snapshotId.localeCompare(b.snapshotId))
  }

  async saveSnapshot(snapshot: Snapshot): Promise<void> {
    this.assertOpen()
    this.snapshots.set(snapshot.meta.snapshotId, MemoryProvider.clone(snapshot))
  }

  async loadSnapshot(snapshotId: string): Promise<Snapshot | null> {
    this.assertOpen()
    const snapshot = this.snapshots.get(snapshotId)
    return snapshot ? MemoryProvider.clone(snapshot) : null
  }

  async close(): Promise<void> {
    this.closed = true
    this.documents.clear()
    this.blobs.clear()
    this.snapshots.clear()
  }
}
