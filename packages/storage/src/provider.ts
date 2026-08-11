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

/* -------------------------------------------------------------------------- */
/* v1.0 · T-286 · provider v2                                                 */
/* -------------------------------------------------------------------------- */

/**
 * T-286 · **凡是不是所有 provider 都能实现的，一律 optional facet。**
 *
 * X-27：三份设计里有一份把「零改动既有实现」当作选 facet 方案的最强论据，而另两份要求
 * 既有实现补方法——加起来那条论据就不成立了。这里统一成一条纪律：接口本体只放**每一个
 * provider 都做得到**的东西；做不到的进 facet，而 facet 是**可选的**。
 *
 * 五个 facet 在 v1.0 **全是类型，没有任何实现**。它们现在就写下来，是因为 v1.5 的 HTTP
 * provider 要按它们分工，而等到那时再定形状，编辑器已经绕着今天的接口写了两个版本。
 */

/** 一份文档的修订号。**不透明**——比较用 `===`，不许拿它做算术。 */
export type DocumentRev = string

/** 谁在操作。v1.0 恒为本机匿名用户；v1.5 由后端填。 */
export interface Identity {
  readonly userId: string
  readonly displayName: string
}

/** 带修订号与元信息的一份文档。`readDocument` 返回它，`loadDocument` 只返回文档本身。 */
export interface DocumentRecord {
  readonly document: SceneDocument
  readonly rev: DocumentRev
  readonly updatedAt: string
  readonly updatedBy?: Identity
}

export interface SaveOptions {
  /**
   * 期望的当前修订号。给了它就是**乐观并发**：存储侧发现实际修订号不是它，抛
   * `conflict` 而不是覆盖。
   *
   * 不给 = 无条件覆盖，与 v1.0 之前的行为逐字相同——所以既有调用点一个字都不用改。
   */
  readonly expectedRev?: DocumentRev
}

export interface SaveReceipt {
  readonly rev: DocumentRev
  readonly updatedAt: string
}

export interface PutBlobOptions {
  /**
   * 调用方已经算好的内容地址。
   *
   * **给 HTTP provider 用的**：它要么把全部字节读进内存再算一遍哈希（一个 80 MB 的模型
   * 上不可行），要么信任调用方先算好再传。本地实现可以校验，也可以直接用——但**不许
   * 假装自己算过**：那样两种实现会对同一份字节给出两个地址。
   */
  readonly hash?: BlobHash
}

/** 一页结果。列表接口在 v1.5 会有成千上万条，游标式分页是那时唯一不改调用点的形状。 */
export interface Page<T> {
  readonly items: readonly T[]
  /** `null` = 没有下一页。 */
  readonly cursor: string | null
}

export type ProjectRole = 'owner' | 'editor' | 'viewer'

export interface ProjectMember {
  readonly identity: Identity
  readonly role: ProjectRole
}

/** 一把编辑锁。**不是会话租约**（那是 T-287 的 `SessionLease`，语义完全不同）。 */
export interface Lease {
  readonly projectId: string
  readonly heldBy: Identity
  readonly expiresAt: string
}

export interface AuditEntry {
  readonly at: string
  readonly by: Identity
  readonly what: string
  readonly projectId: string
}

/* --- 五个 facet：全是类型，v1.0 零实现 --------------------------------------- */

/** `locks` · 谁在编这份工程。单机没有并发编辑，所以本地实现不声明它。 */
export interface LocksFacet {
  acquire(projectId: string): Promise<Lease | null>
  release(projectId: string): Promise<void>
}

/** `members` · 谁能看、谁能改。 */
export interface MembersFacet {
  list(projectId: string): Promise<ProjectMember[]>
  setRole(projectId: string, userId: string, role: ProjectRole): Promise<void>
}

/** `audit` · 谁在什么时候动了什么。 */
export interface AuditFacet {
  append(entry: AuditEntry): Promise<void>
  list(projectId: string, cursor?: string): Promise<Page<AuditEntry>>
}

/** 一条历史修订的摘要。 */
export interface RevisionSummary {
  readonly rev: DocumentRev
  readonly at: string
  readonly by?: Identity
}

/** 一次直传的预签名。 */
export interface PresignedUpload {
  readonly url: string
  readonly headers: Record<string, string>
}

/** `revisions` · 历史修订。与「发布快照」不是一回事：快照是作者主动打的点。 */
export interface RevisionsFacet {
  list(projectId: string, cursor?: string): Promise<Page<RevisionSummary>>
  read(projectId: string, rev: DocumentRev): Promise<DocumentRecord | null>
}

/** `assets` · 大文件的直传与分发。本地实现直接走 `putBlob`，不需要它。 */
export interface AssetsFacet {
  presignUpload(hash: BlobHash, bytes: number): Promise<PresignedUpload>
  presignDownload(hash: BlobHash): Promise<string>
}

/** facet 的名字。**闭集**——声明一个不在这里的名字，契约套件会报。 */
export const FACET_NAMES = ['locks', 'members', 'audit', 'revisions', 'assets'] as const
export type FacetName = (typeof FACET_NAMES)[number]

/** 一个 provider 可能挂着的 facet。全部可选。 */
export interface ProviderFacets {
  readonly locks?: LocksFacet
  readonly members?: MembersFacet
  readonly audit?: AuditFacet
  readonly revisions?: RevisionsFacet
  readonly assets?: AssetsFacet
}

/**
 * Everything the editor and player are allowed to know about persistence.
 *
 * All methods are async even where a given implementation could answer synchronously —
 * a provider that is a network call in v1 must not force call sites to change shape.
 */
export interface StorageProvider {
  readonly kind: string

  /**
   * T-286 · 这个 provider 挂着哪些 facet。**显式声明，不靠 `in` 探测。**
   *
   * 探测（`'locks' in provider`）看起来更省事，代价是**「悄悄长出一个 facet」抓不到**：
   * 有人给 `MemoryProvider` 挂一个空的 `locks` 只为让某个调用点编译过，探测式的契约
   * 套件当场就开始跑 locks 子套件，而那些用例会以某种方式绿。显式声明让这件事变成
   * 一处必须有人写下来的改动——而契约套件会核对声明与实际挂着的东西一致。
   */
  readonly facets: readonly FacetName[]

  /* --- projects ---------------------------------------------------------- */
  listProjects(): Promise<ProjectSummary[]>
  loadDocument(projectId: string): Promise<SceneDocument | null>
  /**
   * T-286 · 带修订号地读一份文档。
   *
   * `loadDocument` 返回的是**文档本身**，调用方拿不到修订号，于是也就没法做乐观并发。
   * 这一个返回记录。两者并存而不是替换：`loadDocument` 的调用点一个都不用改。
   */
  readDocument(projectId: string): Promise<DocumentRecord | null>
  /**
   * 存一份文档。
   *
   * `options` 全可选，**不给就是无条件覆盖**——与 v1.0 之前逐字相同的行为，所以既有
   * 调用点一个字都不用改（本卡的验收里有一条 grep 断言盯着这件事）。
   */
  saveDocument(document: SceneDocument, options?: SaveOptions): Promise<SaveReceipt>
  deleteProject(projectId: string): Promise<void>

  /* --- content-addressed blobs ------------------------------------------- */
  /** Stores bytes and returns their content address. Storing the same bytes twice is a no-op. */
  putBlob(bytes: Uint8Array, options?: PutBlobOptions): Promise<BlobHash>
  getBlob(hash: BlobHash): Promise<Uint8Array | null>
  hasBlob(hash: BlobHash): Promise<boolean>

  /* --- published snapshots ------------------------------------------------ */
  listSnapshots(projectId: string): Promise<SnapshotSummary[]>
  saveSnapshot(snapshot: Snapshot): Promise<void>
  loadSnapshot(snapshotId: string): Promise<Snapshot | null>

  /** 挂着的 facet 实现。v1.0 两个实现都返回空对象。 */
  readonly ext: ProviderFacets

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

/**
 * T-286 · 四个新码。
 *
 * 加码而不是让调用方去读 message：**中文措辞会变，码不会**。`unauthenticated` 与
 * `forbidden` 分开，是因为它们对用户是两件事——前者「去登录」，后者「找管理员要权限」，
 * 而合成一个 `denied` 会让 UI 只能显示一句两头都不对的话。
 */
export const STORAGE_ERROR_CODES = [
  'not-found',
  'conflict',
  'unavailable',
  'corrupt',
  'quota-exceeded',
  'unauthenticated',
  'forbidden',
  'rate-limited',
  'unsupported',
] as const
export type StorageErrorCode = (typeof STORAGE_ERROR_CODES)[number]

/**
 * 哪些码值得重试。
 *
 * 写成一张表而不是让每个调用点自己判断：「这个错该不该重试」在三处各判一次，迟早
 * 有一处把 `conflict` 也重试了——而重试一次冲突只会再冲突一次，同时把用户的改动
 * 又覆盖一遍。
 */
const RETRYABLE: ReadonlySet<StorageErrorCode> = new Set(['unavailable', 'rate-limited'])

/** 每个码给用户看的那句中文。**不带技术名词**——它会原样出现在界面上。 */
const USER_MESSAGE: Record<StorageErrorCode, string> = {
  'not-found': '找不到这份数据，它可能已经被删除。',
  conflict: '这份工程在别处被改过了。请刷新后再保存，否则会覆盖别人的修改。',
  unavailable: '暂时连不上存储服务，请稍后重试。',
  corrupt: '这份数据读出来是坏的，已停止使用它以免继续损坏。',
  'quota-exceeded': '浏览器本地存储空间不足。请清理其他站点数据或删除不用的工程后重试。',
  unauthenticated: '登录状态已失效，请重新登录。',
  forbidden: '你没有操作这份工程的权限，请联系工程的所有者。',
  'rate-limited': '操作太频繁，请稍等一下再试。',
  unsupported: '当前的存储方式不支持这个操作。',
}

export class StorageError extends Error {
  readonly code: StorageErrorCode
  /** 值不值得重试。**读这张表，不要在调用点自己判断。** */
  readonly retryable: boolean
  /** 给用户看的中文。**按码分支，不要按 message 匹配**——措辞会变。 */
  readonly userMessage: string

  constructor(code: StorageErrorCode, message: string, options?: { cause?: unknown; userMessage?: string }) {
    super(message, options)
    this.name = 'StorageError'
    this.code = code
    this.retryable = RETRYABLE.has(code)
    this.userMessage = options?.userMessage ?? USER_MESSAGE[code]
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
