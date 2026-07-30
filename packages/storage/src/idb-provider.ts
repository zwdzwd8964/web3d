import type { SceneDocument } from '@w3/schema'
import type { DBSchema, IDBPDatabase } from 'idb'
import { openDB } from 'idb'
import { hashBytes } from './hash.js'
import type { BlobHash, ProjectSummary, Snapshot, SnapshotSummary, StorageProvider } from './provider.js'
import { StorageError } from './provider.js'

/**
 * T-023 · the v0 storage backend.
 *
 * This file is the ONLY place in the whole workspace allowed to know that IndexedDB
 * exists (C7) — `scripts/check-storage-abstraction.mjs` enforces that for core, editor
 * and player. It runs the same contract suite as MemoryProvider, so a behavioural drift
 * between them shows up as a test failure rather than as a bug that only reproduces
 * after a page reload.
 */

const DB_NAME = 'w3-editor'
const DB_VERSION = 1

interface W3DB extends DBSchema {
  projects: { key: string; value: ProjectSummary }
  documents: { key: string; value: SceneDocument }
  blobs: { key: string; value: Uint8Array }
  snapshots: { key: string; value: Snapshot; indexes: { byProject: string } }
}

export interface IndexedDbProviderOptions {
  readonly databaseName?: string
}

export class IndexedDbProvider implements StorageProvider {
  readonly kind = 'indexeddb'

  private db: IDBPDatabase<W3DB> | null = null
  private opening: Promise<IDBPDatabase<W3DB>> | null = null
  private readonly databaseName: string

  constructor(options: IndexedDbProviderOptions = {}) {
    this.databaseName = options.databaseName ?? DB_NAME
  }

  /** True when this environment can host the provider at all (browser, or a shim). */
  static isSupported(): boolean {
    return typeof globalThis !== 'undefined' && 'indexedDB' in globalThis && globalThis.indexedDB != null
  }

  private async open(): Promise<IDBPDatabase<W3DB>> {
    if (this.db) return this.db
    if (!IndexedDbProvider.isSupported()) {
      throw new StorageError('unavailable', 'IndexedDB is not available in this environment')
    }
    this.opening ??= openDB<W3DB>(this.databaseName, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('projects')) db.createObjectStore('projects', { keyPath: 'projectId' })
        if (!db.objectStoreNames.contains('documents')) db.createObjectStore('documents', { keyPath: 'projectId' })
        // Blobs are content-addressed, so the hash is the key and writes are idempotent.
        if (!db.objectStoreNames.contains('blobs')) db.createObjectStore('blobs')
        if (!db.objectStoreNames.contains('snapshots')) {
          const store = db.createObjectStore('snapshots', { keyPath: 'meta.snapshotId' })
          store.createIndex('byProject', 'meta.projectId')
        }
      },
    })
    this.db = await this.opening
    return this.db
  }

  async listProjects(): Promise<ProjectSummary[]> {
    const db = await this.open()
    const all = await db.getAll('projects')
    return all.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.projectId.localeCompare(b.projectId))
  }

  async loadDocument(projectId: string): Promise<SceneDocument | null> {
    const db = await this.open()
    return (await db.get('documents', projectId)) ?? null
  }

  async saveDocument(document: SceneDocument): Promise<void> {
    const db = await this.open()
    // One transaction across both stores: a summary that disagrees with its document is
    // worse than no summary, and a reload is exactly when it would be discovered.
    const tx = db.transaction(['documents', 'projects'], 'readwrite')
    await Promise.all([
      tx.objectStore('documents').put(structuredClone(document)),
      tx.objectStore('projects').put({
        projectId: document.projectId,
        name: document.name,
        updatedAt: document.meta.updatedAt,
      }),
      tx.done,
    ])
  }

  async deleteProject(projectId: string): Promise<void> {
    const db = await this.open()
    const snapshotIds = (await db.getAllKeysFromIndex('snapshots', 'byProject', projectId)) as string[]
    const tx = db.transaction(['documents', 'projects', 'snapshots'], 'readwrite')
    const snapshots = tx.objectStore('snapshots')
    await Promise.all([
      tx.objectStore('documents').delete(projectId),
      tx.objectStore('projects').delete(projectId),
      ...snapshotIds.map((id) => snapshots.delete(id)),
      tx.done,
    ])
  }

  async putBlob(bytes: Uint8Array): Promise<BlobHash> {
    const db = await this.open()
    const hash = await hashBytes(bytes)
    if (await db.getKey('blobs', hash)) return hash
    await db.put('blobs', bytes.slice(), hash)
    return hash
  }

  async getBlob(hash: BlobHash): Promise<Uint8Array | null> {
    const db = await this.open()
    const bytes = await db.get('blobs', hash)
    return bytes ? new Uint8Array(bytes) : null
  }

  async hasBlob(hash: BlobHash): Promise<boolean> {
    const db = await this.open()
    return (await db.getKey('blobs', hash)) !== undefined
  }

  async listSnapshots(projectId: string): Promise<SnapshotSummary[]> {
    const db = await this.open()
    const all = await db.getAllFromIndex('snapshots', 'byProject', projectId)
    return all
      .map((s) => s.meta)
      .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt) || a.snapshotId.localeCompare(b.snapshotId))
  }

  async saveSnapshot(snapshot: Snapshot): Promise<void> {
    const db = await this.open()
    await db.put('snapshots', structuredClone(snapshot))
  }

  async loadSnapshot(snapshotId: string): Promise<Snapshot | null> {
    const db = await this.open()
    return (await db.get('snapshots', snapshotId)) ?? null
  }

  async close(): Promise<void> {
    const db = this.db
    this.db = null
    this.opening = null
    db?.close()
  }

  /** Drops the whole database. Used by tests and by "reset local data" in the editor. */
  async destroy(): Promise<void> {
    await this.close()
    if (!IndexedDbProvider.isSupported()) return
    await new Promise<void>((resolve, reject) => {
      const request = globalThis.indexedDB.deleteDatabase(this.databaseName)
      request.onsuccess = () => resolve()
      request.onblocked = () => resolve()
      // `request.error` is DOMException | null. Rejecting with null produces a rejection
      // nobody can inspect or report — the caller sees "something failed" and nothing else.
      request.onerror = () =>
        reject(new StorageError('unavailable', `删除本地数据库失败：${this.databaseName}`, { cause: request.error }))
    })
  }
}
