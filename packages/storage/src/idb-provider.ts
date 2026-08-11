import type { SceneDocument } from '@w3/schema'
import type { DBSchema, IDBPDatabase } from 'idb'
import { openDB } from 'idb'
import { hashBytes } from './hash.js'
import type { BlobHash, ProjectSummary, Snapshot, SnapshotSummary, StorageProvider, DocumentRecord, DraftRecord, DraftsFacet, FacetName, LeaseAcquisition, LeaseRequest, ProviderFacets, PutBlobOptions, SaveOptions, SaveReceipt, SessionLease } from './provider.js'
import { StorageError, classifyLease, mapWriteError } from './provider.js'

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
  /** v1.0 · crash-recovery draft slots, one per project (T-287). */
  drafts: { key: string; value: DraftRecord }
  /** v1.0 · cross-tab edit leases with a heartbeat (T-287). */
  leases: { key: string; value: SessionLease }
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

  /**
   * T-286 · 五个远端 facet 一个都不声明。理由与 `MemoryProvider` 相同：单机没有并发
   * 编辑、没有成员、没有审计、没有历史修订、没有直传。
   *
   * T-287 加了 `drafts`。它用的 `drafts` 与 `leases` 两个 objectStore **在 T-202 就
   * 已经建好了**，所以这张卡一个字都没动 `DB_VERSION`——ADR-0027 的规矩是往既有 upgrade
   * 里加内容，不是再 bump 一次。
   */
  readonly facets: readonly FacetName[] = ['drafts']

  /**
   * 挂着的是同一个对象，而不是每次 get 新建一个：`ext.drafts !== ext.drafts` 会让
   * 「同一个 provider 的两次调用看到同一份租约」这件事变得依赖实现细节。
   */
  readonly ext: ProviderFacets

  private db: IDBPDatabase<W3DB> | null = null
  private opening: Promise<IDBPDatabase<W3DB>> | null = null
  private readonly databaseName: string

  constructor(options: IndexedDbProviderOptions = {}) {
    this.databaseName = options.databaseName ?? DB_NAME
    this.ext = { drafts: new IdbDrafts(() => this.open()) }
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

  async saveDocument(document: SceneDocument, options?: SaveOptions): Promise<SaveReceipt> {
    if (options?.expectedRev !== undefined) {
      const stored = await this.loadDocument(document.projectId)
      const current = stored ? revOf(stored) : undefined
      if (current !== options.expectedRev) {
        throw new StorageError('conflict', `保存失败：期望修订号 ${options.expectedRev}，实际 ${current ?? '（不存在）'}`)
      }
    }
    const db = await this.open()
    await mapWriteError('保存工程', async () => {
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
    // 回执在写**成功之后**才算数：写失败时 `mapWriteError` 抛出去，这一行根本到不了。
    return { rev: revOf(document), updatedAt: document.meta.updatedAt }
  }

  /** T-286 · 带修订号地读。修订号由文档自己派生，见 `revOf`。 */
  async readDocument(projectId: string): Promise<DocumentRecord | null> {
    const document = await this.loadDocument(projectId)
    if (!document) return null
    return { document, rev: revOf(document), updatedAt: document.meta.updatedAt }
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

  async putBlob(bytes: Uint8Array, options?: PutBlobOptions): Promise<BlobHash> {
    const db = await this.open()
    const hash = await hashBytes(bytes)
    if (options?.hash !== undefined && options.hash !== hash) {
      throw new StorageError('corrupt', `调用方给的内容地址与字节对不上：${options.hash} ≠ ${hash}`)
    }
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

/**
 * T-286 · 一份文档的修订号。
 *
 * IndexedDB 侧没有服务端自增序列，所以修订号从**文档自己**派生：`updatedAt` 加内容长度。
 * 它不需要全局唯一，只需要「同一份文档改过之后不同」——而乐观并发比的正是这一件事。
 *
 * 用 `updatedAt` 单独一项不够：同一毫秒内的两次保存会得到同一个号，而
 * `AutoSaver` 的批量 flush 恰好会那样（T-288 要在这上面加草稿通道）。
 */
function revOf(document: SceneDocument): string {
  return `${document.meta.updatedAt}#${JSON.stringify(document).length}`
}

/**
 * T-287 · `drafts` facet 的 IndexedDB 实现。
 *
 * 不导出，理由与 `MemoryDrafts` 相同：它是 provider 的一部分，调用方经
 * `provider.ext.drafts` 拿到它。
 *
 * 拿库的方式是构造时注入的一个 thunk 而不是一个 `IDBPDatabase`：provider 的库是
 * **懒开**的，构造函数里还没有库可传。
 */
class IdbDrafts implements DraftsFacet {
  constructor(private readonly db: () => Promise<IDBPDatabase<W3DB>>) {}

  async saveDraft(draft: DraftRecord): Promise<void> {
    const db = await this.db()
    await mapWriteError('保存草稿', async () => {
      await db.put('drafts', draft, draft.projectId)
    })
  }

  /** 读回草稿。**没有就是 `null`**——IndexedDB 的 miss 是 `undefined`，理由见 `MemoryDrafts`。 */
  async loadDraft(projectId: string): Promise<DraftRecord | null> {
    const db = await this.db()
    return (await db.get('drafts', projectId)) ?? null
  }

  async clearDraft(projectId: string): Promise<void> {
    const db = await this.db()
    await db.delete('drafts', projectId)
  }

  /**
   * 申请占用。**读判写在同一个 readwrite 事务里。**
   *
   * 分成两个事务的话，两个标签页在同一毫秒开机会双双读到「没人占」，然后双双写进去，
   * 于是两边都以为自己拿到了——而这正是这套机制唯一要防的那件事。
   */
  async acquireLease(projectId: string, request: LeaseRequest): Promise<LeaseAcquisition> {
    const db = await this.db()
    const tx = db.transaction('leases', 'readwrite')
    const existing = (await tx.store.get(projectId)) ?? null
    const previous = classifyLease(existing, request)
    if (existing && previous === 'live-elsewhere') {
      await tx.done
      return { ok: false, heldBy: existing }
    }
    const lease: SessionLease = {
      projectId,
      sessionId: request.sessionId,
      heartbeatAt: request.nowMs,
      closedCleanly: false,
    }
    await tx.store.put(lease, projectId)
    await tx.done
    return { ok: true, lease, previous }
  }

  async heartbeatLease(projectId: string, request: LeaseRequest): Promise<boolean> {
    const db = await this.db()
    const tx = db.transaction('leases', 'readwrite')
    const existing = await tx.store.get(projectId)
    if (!existing || existing.sessionId !== request.sessionId) {
      await tx.done
      return false
    }
    await tx.store.put({ ...existing, heartbeatAt: request.nowMs, closedCleanly: false }, projectId)
    await tx.done
    return true
  }

  async releaseLease(projectId: string, sessionId: string): Promise<void> {
    const db = await this.db()
    const tx = db.transaction('leases', 'readwrite')
    const existing = await tx.store.get(projectId)
    if (existing && existing.sessionId === sessionId) {
      await tx.store.put({ ...existing, closedCleanly: true }, projectId)
    }
    await tx.done
  }
}
