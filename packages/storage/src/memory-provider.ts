import type { SceneDocument } from '@w3/schema'
import { hashBytes } from './hash.js'
import type { BlobHash, ProjectSummary, Snapshot, SnapshotSummary, StorageProvider, DocumentRecord, DocumentRev, DraftRecord, DraftsFacet, FacetName, LeaseAcquisition, LeaseRequest, ProviderFacets, PutBlobOptions, SaveOptions, SaveReceipt, SessionLease } from './provider.js'
import { StorageError, classifyLease } from './provider.js'

/**
 * Everything in and out is cloned: callers must never share mutable state with the store.
 *
 * T-287 · 从 `MemoryProvider` 的私有静态方法提到模块级——`MemoryDrafts` 也要克隆，
 * 而它拿不到那个 private。行为一个字没变。
 */
function clone<T>(value: T): T {
  return structuredClone(value)
}

/**
 * T-287 · `drafts` facet 的内存实现。
 *
 * 不导出：它是 `MemoryProvider` 的一部分，调用方只该通过 `provider.ext.drafts` 拿到它。
 */
class MemoryDrafts implements DraftsFacet {
  private readonly drafts = new Map<string, DraftRecord>()
  private readonly leases = new Map<string, SessionLease>()

  async saveDraft(draft: DraftRecord): Promise<void> {
    this.drafts.set(draft.projectId, { ...draft, document: clone(draft.document) })
  }

  /**
   * 读回草稿。**没有就是 `null`。**
   *
   * `Map.get` 的 miss 是 `undefined`，直接返回它会让一条写成 `not.toBeNull()` 的断言
   * 也绿——而那正是卡面点名的假绿写法。这里把它收成 `null`，契约套件那边断 `toBeNull()`。
   */
  async loadDraft(projectId: string): Promise<DraftRecord | null> {
    const draft = this.drafts.get(projectId)
    if (!draft) return null
    return { ...draft, document: clone(draft.document) }
  }

  async clearDraft(projectId: string): Promise<void> {
    this.drafts.delete(projectId)
  }

  async acquireLease(projectId: string, request: LeaseRequest): Promise<LeaseAcquisition> {
    const existing = this.leases.get(projectId) ?? null
    const previous = classifyLease(existing, request)
    if (existing && previous === 'live-elsewhere') return { ok: false, heldBy: existing }
    const lease: SessionLease = {
      projectId,
      sessionId: request.sessionId,
      heartbeatAt: request.nowMs,
      closedCleanly: false,
    }
    this.leases.set(projectId, lease)
    return { ok: true, lease, previous }
  }

  async heartbeatLease(projectId: string, request: LeaseRequest): Promise<boolean> {
    const existing = this.leases.get(projectId)
    // 不是我的就**不要续**：续了等于把别人的租约按在我名下，而那个别人还活着。
    if (!existing || existing.sessionId !== request.sessionId) return false
    this.leases.set(projectId, { ...existing, heartbeatAt: request.nowMs, closedCleanly: false })
    return true
  }

  /**
   * 干净退出。**记一笔 `closedCleanly`，不是删掉。**
   *
   * 删掉也能让下一次开机判成 `closed`（`classifyLease(null)` 就是 `closed`），但那样
   * 「干净退出」与「从来没开过」在库里长得一模一样，出问题时没法区分是关的还是丢的。
   */
  async releaseLease(projectId: string, sessionId: string): Promise<void> {
    const existing = this.leases.get(projectId)
    if (!existing || existing.sessionId !== sessionId) return
    this.leases.set(projectId, { ...existing, closedCleanly: true })
  }
}

/**
 * T-202 · options, existing so far only to make the quota path testable.
 *
 * `quota-exceeded` is a condition `IndexedDbProvider` can produce and `MemoryProvider`
 * cannot — a Map does not run out of room. Without an injectable ceiling the contract suite
 * could only assert the behaviour on one side, which means the two providers would be held
 * to different promises about the one storage failure a user can act on. This is the only
 * way to run the same assertion on both.
 */
export interface MemoryProviderOptions {
  /** Ceiling on total stored bytes. Absent = unlimited, which is every non-test caller. */
  readonly maxBytes?: number
}

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

  /**
   * T-286 · **只声明做得到的那些。**
   *
   * 单机内存实现没有并发编辑、没有成员、没有审计、没有历史修订、没有直传——那五个 facet
   * 一个都不适用。声明成显式数组而不是「让契约套件自己探测」：探测式的套件在有人给这个
   * 类挂一个空的 `locks` 时会当场开始跑 locks 子套件，而那些用例会以某种方式绿。
   *
   * T-287 加了 `drafts`：草稿与会话租约一个 Map 就能做。
   */
  readonly facets: readonly FacetName[] = ['drafts']

  /** 挂着的东西与上面那行**必须一致**，契约套件核对它们。 */
  readonly ext: ProviderFacets = { drafts: new MemoryDrafts() }

  private documents = new Map<string, SceneDocument>()
  private blobs = new Map<BlobHash, Uint8Array>()
  private snapshots = new Map<string, Snapshot>()
  private closed = false
  /** T-286 · 每份文档的当前修订号。乐观并发比的就是它。 */
  private readonly revs = new Map<string, DocumentRev>()
  private revCounter = 0
  private readonly maxBytes: number
  private storedBytes = 0

  constructor(options: MemoryProviderOptions = {}) {
    this.maxBytes = options.maxBytes ?? Number.POSITIVE_INFINITY
  }

  /**
   * Refuses a write that would take the store past its ceiling.
   *
   * Charged on blob bytes only. Documents are kilobytes and assets are megabytes, so a
   * byte-accurate accounting of both would add machinery for a rounding error — and the
   * ceiling exists to reproduce a failure, not to model a browser's storage manager.
   */
  private reserve(bytes: number, what: string): void {
    if (this.storedBytes + bytes <= this.maxBytes) {
      this.storedBytes += bytes
      return
    }
    throw new StorageError('quota-exceeded', `浏览器本地存储空间不足，${what}失败。请清理其他站点数据或删除不用的项目后重试。`)
  }

  private assertOpen(): void {
    if (this.closed) throw new Error('MemoryProvider has been closed')
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
    return doc ? clone(doc) : null
  }

  /**
   * T-286 · 存一份文档，返回回执。
   *
   * `options` 不给就是无条件覆盖——与 v1.0 之前逐字相同的行为。给了 `expectedRev` 才是
   * 乐观并发：修订号对不上抛 `conflict`，**而不是覆盖**。
   */
  async saveDocument(document: SceneDocument, options?: SaveOptions): Promise<SaveReceipt> {
    this.assertOpen()
    if (options?.expectedRev !== undefined) {
      const current = this.revs.get(document.projectId)
      // `current === undefined` 时也算冲突：调用方说「我是基于某一版改的」，而这里
      // 根本没有那一版——那多半是它读到的和它要写的不是同一份工程。
      if (current !== options.expectedRev) {
        throw new StorageError(
          'conflict',
          `保存失败：期望修订号 ${options.expectedRev}，实际 ${current ?? '（不存在）'}`,
        )
      }
    }
    const bytes = JSON.stringify(document).length
    this.reserve(bytes, '保存工程')
    this.documents.set(document.projectId, clone(document))
    const rev = `r${(this.revCounter += 1)}`
    this.revs.set(document.projectId, rev)
    return { rev, updatedAt: document.meta.updatedAt }
  }

  /**
   * T-286 · 带修订号地读。
   *
   * `loadDocument` 返回文档本身，拿不到修订号，于是也就做不了乐观并发。两者并存
   * 而不是替换——`loadDocument` 的调用点一个都不用改。
   */
  async readDocument(projectId: string): Promise<DocumentRecord | null> {
    this.assertOpen()
    const document = this.documents.get(projectId)
    if (!document) return null
    return {
      document: clone(document),
      rev: this.revs.get(projectId) ?? 'r0',
      updatedAt: document.meta.updatedAt,
    }
  }

  async deleteProject(projectId: string): Promise<void> {
    this.assertOpen()
    this.documents.delete(projectId)
    for (const [id, snapshot] of this.snapshots) {
      if (snapshot.meta.projectId === projectId) this.snapshots.delete(id)
    }
  }

  async putBlob(bytes: Uint8Array, options?: PutBlobOptions): Promise<BlobHash> {
    this.assertOpen()
    // T-286 · 调用方算好的地址可以直接用，但**本地实现仍然自己算一遍并核对**：
    // 内存里算一次哈希是微秒级的，而一个算错的地址会让这份字节永远取不回来。
    // HTTP 实现没有这个余裕（80 MB 的模型读进内存不可行），那里才是真的信任调用方。
    const hash = await hashBytes(bytes)
    if (options?.hash !== undefined && options.hash !== hash) {
      throw new StorageError('corrupt', `调用方给的内容地址与字节对不上：${options.hash} ≠ ${hash}`)
    }
    // D4: identical bytes are the same asset. Re-storing is a no-op, not a duplicate —
    // and therefore costs no quota either.
    if (!this.blobs.has(hash)) {
      this.reserve(bytes.byteLength, '保存资产')
      this.blobs.set(hash, bytes.slice())
    }
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
      .map((s) => clone(s.meta))
      .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt) || a.snapshotId.localeCompare(b.snapshotId))
  }

  async saveSnapshot(snapshot: Snapshot): Promise<void> {
    this.assertOpen()
    this.snapshots.set(snapshot.meta.snapshotId, clone(snapshot))
  }

  async loadSnapshot(snapshotId: string): Promise<Snapshot | null> {
    this.assertOpen()
    const snapshot = this.snapshots.get(snapshotId)
    return snapshot ? clone(snapshot) : null
  }

  async close(): Promise<void> {
    this.closed = true
    this.documents.clear()
    this.blobs.clear()
    this.snapshots.clear()
    this.storedBytes = 0
  }
}
