import type { SceneDocument } from '@w3/schema'
import type { DBSchema, IDBPDatabase } from 'idb'
import { openDB } from 'idb'
import { hashBytes } from './hash.js'
import type { BlobHash, ProjectSummary, Snapshot, SnapshotSummary, StorageProvider } from './provider.js'
import { StorageError, mapWriteError } from './provider.js'

/**
 * T-023 · the v0 storage backend.
 *
 * This file is the ONLY place in the whole workspace allowed to know that IndexedDB
 * exists (C7) — `scripts/check-storage-abstraction.mjs` enforces that for core, editor
 * and player. It runs the same contract suite as MemoryProvider, so a behavioural drift
 * between them shows up as a test failure rather than as a bug that only reproduces
 * after a page reload.
 */

/**
 * The database every editor session opens.
 *
 * Exported because six E2E specs used to hard-code the string in a `deleteDatabase` call.
 * That is fine right up until the provider changes — and v1.5 swaps in `HttpApiProvider`,
 * at which point the pre-test cleanup silently becomes a no-op that clears something the
 * system under test no longer uses, while every test stays green. v0.5's teaching (d),
 * about to repeat verbatim.
 */
export const DB_NAME = 'w3-editor'

/**
 * T-202 · **v1 has exactly one owner for this number, and it is this file.**
 *
 * Three separate v1 designs each planned to take it from 1 to 2 — backend for `revs`,
 * multi-scene for `scenes`, debt-ops for `drafts` + `leases`. IndexedDB's upgrade callback
 * only fires when the version actually RISES: whichever landed first would take every user's
 * database to 2, and the second one's upgrade would never run on those users. Their database
 * would be missing two object stores forever.
 *
 * The part that makes it a blocker rather than a scheduling problem is that all three had
 * written a "v1 库 → v2 provider" regression test, and **all three would have passed**,
 * because each runs against its own freshly-created fixture. Nothing in the repository
 * observes the case that breaks: a database already at 2.
 *
 * So all four stores are created in one step, here, now — empty, structure only. The rule
 * (ADR-0027) is that T-286 / T-287 / v1.5's T-427 add CONTENT inside the existing upgrade,
 * and nobody else touches this constant. A card that genuinely needs version 3 goes back to
 * ADR-0027 and appends a line first.
 *
 * This is a second forward-compatibility chain, independent of `schemaVersion`. 铁律 4's
 * three-piece rule does not cover it and the DoD checklist has no item for it.
 */
const DB_VERSION = 2

interface W3DB extends DBSchema {
  projects: { key: string; value: ProjectSummary }
  documents: { key: string; value: SceneDocument }
  blobs: { key: string; value: Uint8Array }
  snapshots: { key: string; value: Snapshot; indexes: { byProject: string } }
  /** v1.0 · crash-recovery draft slots, one per project (T-286). */
  drafts: { key: string; value: unknown }
  /** v1.0 · cross-tab edit leases with a heartbeat (T-287). */
  leases: { key: string; value: unknown }
  /** v1.5 · one document per scene inside a project (T-427). */
  scenes: { key: string; value: unknown; indexes: { byProject: string } }
  /** v1.5 · document revisions, for the conflict dialog's three-way choice (T-406). */
  revs: { key: string; value: unknown; indexes: { byProject: string } }
}

/** Every object store the current version defines. The upgrade path is asserted against it. */
export const OBJECT_STORES = [
  'projects',
  'documents',
  'blobs',
  'snapshots',
  'drafts',
  'leases',
  'scenes',
  'revs',
] as const

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
      /**
       * Additive only, and guarded store by store rather than branched on `oldVersion`.
       *
       * `if (oldVersion < 2) { … }` is the textbook shape and it is the wrong one here: it
       * describes a path through history, so it is only correct if every historical path was
       * also correct. Asking "does this store exist" describes the DESTINATION, which makes
       * the function idempotent and makes a user who arrived at version 2 by some route
       * nobody anticipated end up with the same database as everyone else.
       *
       * Nothing is ever dropped or re-shaped in here. That is not caution, it is C4's
       * reasoning applied to the second compatibility chain: a user's local database is the
       * only copy of work that has not been published yet.
       */
      upgrade(db) {
        if (!db.objectStoreNames.contains('projects')) db.createObjectStore('projects', { keyPath: 'projectId' })
        if (!db.objectStoreNames.contains('documents')) db.createObjectStore('documents', { keyPath: 'projectId' })
        // Blobs are content-addressed, so the hash is the key and writes are idempotent.
        if (!db.objectStoreNames.contains('blobs')) db.createObjectStore('blobs')
        if (!db.objectStoreNames.contains('snapshots')) {
          const store = db.createObjectStore('snapshots', { keyPath: 'meta.snapshotId' })
          store.createIndex('byProject', 'meta.projectId')
        }
        // v1 · created together, deliberately empty. Structure now, content later — see the
        // note on DB_VERSION for why "later" cannot mean "in another version bump".
        if (!db.objectStoreNames.contains('drafts')) db.createObjectStore('drafts')
        if (!db.objectStoreNames.contains('leases')) db.createObjectStore('leases')
        if (!db.objectStoreNames.contains('scenes')) {
          db.createObjectStore('scenes').createIndex('byProject', 'projectId')
        }
        if (!db.objectStoreNames.contains('revs')) {
          db.createObjectStore('revs').createIndex('byProject', 'projectId')
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
    return mapWriteError('保存工程', async () => {
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
    })
  }

  async deleteProject(projectId: string): Promise<void> {
    const db = await this.open()
    const snapshotIds = (await db.getAllKeysFromIndex('snapshots', 'byProject', projectId)) as string[]
    return mapWriteError('删除工程', async () => {
      const tx = db.transaction(['documents', 'projects', 'snapshots'], 'readwrite')
      const snapshots = tx.objectStore('snapshots')
      await Promise.all([
        tx.objectStore('documents').delete(projectId),
        tx.objectStore('projects').delete(projectId),
        ...snapshotIds.map((id) => snapshots.delete(id)),
        tx.done,
      ])
    })
  }

  async putBlob(bytes: Uint8Array): Promise<BlobHash> {
    const db = await this.open()
    const hash = await hashBytes(bytes)
    if (await db.getKey('blobs', hash)) return hash
    // The most likely write to hit the quota by a wide margin: a 4K texture or a video is
    // three orders of magnitude larger than a document.
    return mapWriteError('保存资产', async () => {
      await db.put('blobs', bytes.slice(), hash)
      return hash
    })
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
    return mapWriteError('发布快照', async () => {
      await db.put('snapshots', structuredClone(snapshot))
    })
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
