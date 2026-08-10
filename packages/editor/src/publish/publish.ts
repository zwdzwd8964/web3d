// T-266 · `sanitiseFilename` 已上移到 `@w3/core/util/filename`。**全仓一份**：出图要产出
// 文件名、发布也要，两处各写一份的话「同一个场景名导出的图和发布的包不同名」会成为一个
// 没人能一眼看出成因的现象。这里 re-export 是为了不让既有调用点跟着改。
export { sanitiseFilename } from '@w3/core'
import { sanitiseFilename } from '@w3/core'
import { checkIntegrity, errorsOf, validate, warningsOf } from '@w3/schema'
import type { IntegrityIssue, SceneDocument } from '@w3/schema'
import { createActionRefResolver } from '@w3/core'
import { packScene, referencedHashes } from '@w3/storage'
import type { BlobHash, Snapshot, StorageProvider } from '@w3/storage'

/**
 * T-100 · publishing, MVP_V0 D8.
 *
 *   validate + checkIntegrity  ->  errors block, with a locatable list
 *                              ->  collect ONLY the referenced assets
 *                              ->  pack .w3p  ->  snapshot + download
 *
 * The blocking half is the point. A published package that is missing an asset or points
 * at a deleted node is the failure the customer discovers, not us — MVP_V0 §1.1 calls
 * that the acceptance disaster the whole architecture exists to prevent. So `error` is a
 * hard stop, never a warning, and the issue list has to be specific enough to click.
 *
 * `coreVersion` goes into the manifest because D8 says it is the only thread available
 * later for diagnosing "old package, new player".
 */

export interface PublishPrecheck {
  readonly ok: boolean
  readonly issues: readonly IntegrityIssue[]
  readonly errors: readonly IntegrityIssue[]
  readonly warnings: readonly IntegrityIssue[]
  /** Schema-level failures. Distinct from integrity: the document is not even well-formed. */
  readonly schemaErrors: readonly string[]
  /** Hashes the document references — exactly what goes in the package. */
  readonly referenced: ReadonlySet<BlobHash>
  /** Referenced but absent from storage. A blocking condition of its own. */
  readonly missingBlobs: readonly string[]
}

export interface PublishOptions {
  readonly doc: SceneDocument
  readonly storage: StorageProvider
  readonly coreVersion: string
  readonly label?: string
  /**
   * 现成的缩略图字节。给了它就直接用，不再出图。
   *
   * ⚠ **这个参数从 T-100 起就在，而全仓没有一个调用方传过它**——`publish.ts` 声明它、
   * `package.ts` 消费它、`manifest` 记录它，一条完整的路，走到头是空的。
   * 发布包里因此从来没有过缩略图。T-269 接通的就是这条路。
   */
  readonly thumbnail?: Uint8Array
  /**
   * T-269 · 发布前现出一张缩略图。**注入而不是让 `publish()` 自己去找运行时**。
   *
   * 理由是包边界：`publish()` 只认识文档与存储，让它 `import { getActiveRuntime }`
   * 会把「发布」与「当前有没有一个活着的视口」绑死——而发布在逻辑上不需要视口。
   * 注入之后，没有视口的调用方（脚本、测试、将来的批量发布）传 `undefined` 就是了。
   *
   * **失败不阻断发布**：拿不到图就发一个没有缩略图的包。一个能用的包 + 一句提示，
   * 好过因为一张预览图发不出去。
   */
  readonly captureThumbnail?: () => Promise<Uint8Array | null>
  readonly newSnapshotId?: () => string
  readonly now?: () => string
}

export interface PublishResult {
  readonly bytes: Uint8Array
  readonly snapshot: Snapshot
  readonly filename: string
  /** Assets actually written. Never more than the document references. */
  readonly assetCount: number
}

/**
 * Everything that must hold before a package may be written.
 *
 * Separate from `publish` so the dialog can show the verdict before the user commits to
 * it, and so the whole check is testable without producing a file.
 */
export async function precheck(doc: SceneDocument, storage: StorageProvider): Promise<PublishPrecheck> {
  const parsed = validate(doc)
  const schemaErrors = parsed.ok ? [] : parsed.error.map((e) => `${e.path}：${e.message}`)

  // The action-ref resolver is what lets the check see inside rule params. Without it a
  // rule pointing at a deleted node reads as valid, and the package ships broken.
  const issues = checkIntegrity(doc, { actionRefs: createActionRefResolver() })

  const referenced = referencedHashes(doc)
  const missingBlobs: string[] = []
  for (const hash of referenced) {
    if (!(await storage.hasBlob(hash))) {
      const asset = doc.assets.find((a) => a.hash === hash)
      missingBlobs.push(asset ? `${asset.name}（${hash.slice(0, 14)}…）` : hash)
    }
  }

  const errors = errorsOf(issues)
  return {
    ok: schemaErrors.length === 0 && errors.length === 0 && missingBlobs.length === 0,
    issues,
    errors,
    warnings: warningsOf(issues),
    schemaErrors,
    referenced,
    missingBlobs,
  }
}

/**
 * Produces the `.w3p` bytes and the snapshot record.
 *
 * Runs the precheck again rather than trusting a caller-supplied verdict: the document
 * can change between opening the dialog and pressing the button, and "the dialog said it
 * was fine" is not a guarantee anyone should be able to hand this function.
 */
export async function publish(options: PublishOptions): Promise<PublishResult> {
  const { doc, storage } = options
  const now = options.now ?? (() => new Date().toISOString())
  const mintId = options.newSnapshotId ?? newSnapshotId

  const check = await precheck(doc, storage)
  if (!check.ok) {
    throw new PublishBlocked(check)
  }

  // Only what the document references. An asset that was imported and then removed from
  // the scene must not ride along — D8 is explicit, and it is the difference between a
  // 2 MB package and a 40 MB one.
  const blobs = new Map<BlobHash, Uint8Array>()
  for (const hash of check.referenced) {
    const bytes = await storage.getBlob(hash)
    // precheck already established every one of these exists; this is the second line.
    if (bytes) blobs.set(hash, bytes)
  }

  const snapshotId = mintId()
  const publishedAt = now()

  // T-269 · 出图失败不阻断发布：拿不到图就发一个没有缩略图的包。
  const thumbnail = options.thumbnail ?? (await captureThumbnailSafely(options))

  const bytes = packScene({
    document: doc,
    snapshotId,
    publishedAt,
    coreVersion: options.coreVersion,
    blobs,
    ...(thumbnail ? { thumbnail } : {}),
    ...(options.label ? { label: options.label } : {}),
  })

  const snapshot: Snapshot = {
    meta: {
      snapshotId,
      projectId: doc.projectId,
      publishedAt,
      schemaVersion: doc.schemaVersion,
      coreVersion: options.coreVersion,
      assetCount: blobs.size,
      ...(options.label ? { label: options.label } : {}),
    },
    document: doc,
  }

  return {
    bytes,
    snapshot,
    assetCount: blobs.size,
    filename: `${sanitiseFilename(doc.name)}.w3p`,
  }
}

/**
 * 取一张缩略图，**任何失败都吞掉**。
 *
 * 三种失败各自的表现都一样（返回 null，发一个没有缩略图的包）：注入方没给、出图被拒、
 * 出图抛异常。三者不区分是有意的——调用方对这三种情况的处置完全相同，而区分它们只会
 * 让一个「发布」按钮长出三条错误分支。
 *
 * ⚠ **零字节也算失败。** `new Uint8Array(0)` 是 truthy，而 `packScene` 与 `publish`
 * 两处都是 truthy 判断——一次返回空 blob 的出图会让一个 0 字节的 `thumbnail.png` 进包，
 * 而那比没有缩略图更糟：解析它的一方会拿到一个「有图但打不开」的包。
 */
async function captureThumbnailSafely(options: PublishOptions): Promise<Uint8Array | undefined> {
  if (!options.captureThumbnail) return undefined
  try {
    const bytes = await options.captureThumbnail()
    return bytes && bytes.byteLength > 0 ? bytes : undefined
  } catch {
    return undefined
  }
}

/**
 * A snapshot id.
 *
 * Not `newId` from schema: snapshot ids are a storage concern and have no place in
 * SCHEMA_SPEC §2's prefix table — adding one there would be a schema change (铁律 4) for
 * something the document never contains.
 */
export function newSnapshotId(): string {
  const alphabet = '0123456789abcdefghijklmnopqrstuvwxyz'
  const bytes = new Uint8Array(8)
  crypto.getRandomValues(bytes)
  let out = 'snp_'
  for (const byte of bytes) out += alphabet[byte % alphabet.length]
  return out
}

/** Thrown instead of returning a failure, so a caller cannot ignore it by accident. */
export class PublishBlocked extends Error {
  constructor(readonly check: PublishPrecheck) {
    super(describeBlock(check))
    this.name = 'PublishBlocked'
  }
}

function describeBlock(check: PublishPrecheck): string {
  const parts: string[] = []
  if (check.schemaErrors.length > 0) parts.push(`${check.schemaErrors.length} 项结构错误`)
  if (check.errors.length > 0) parts.push(`${check.errors.length} 项阻断问题`)
  if (check.missingBlobs.length > 0) parts.push(`${check.missingBlobs.length} 个资产的文件不在存储中`)
  return `无法发布：${parts.join('，')}`
}


/**
 * Hands the bytes to the browser as a download.
 *
 * A blob URL, not a data URL: a data URL of a 40 MB package would be a 55 MB string and
 * some browsers refuse outright. Revoked on the next tick — revoking synchronously can
 * cancel the download before it starts.
 */
export function downloadPackage(bytes: Uint8Array, filename: string): void {
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  const url = URL.createObjectURL(new Blob([copy.buffer], { type: 'application/zip' }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}
