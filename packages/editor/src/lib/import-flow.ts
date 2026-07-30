import type { Asset, AssetAudit, AssetStats, IdFactory, Node, SceneDocument } from '@w3/schema'
import { collectAllIds, defaultIdFactory, remapAssetRefs } from '@w3/schema'
import type { MigrationReport } from '@w3/schema'
import type { AuditResult } from '@w3/core'
import { AssetLoader, auditGlb, computeNormalization, instantiate } from '@w3/core'
import type { BlobHash, StorageProvider } from '@w3/storage'
import { extensionOf, hashBytes, hashToPath } from '@w3/storage'

/**
 * T-054 · T-066 · the import flow, SCHEMA_SPEC §5.1.
 *
 *   file -> SHA-256 -> already known? -> audit -> normalise -> store -> asset record
 *                          |                                              |
 *                     reuse record                                  instantiate nodes
 *
 * Written as a plain async function rather than inside a React component so the whole
 * flow is testable and so the "second upload of the same model" path — the one R02 is
 * about — can be exercised without a browser.
 */

export type ImportStage = 'hashing' | 'deduplicating' | 'auditing' | 'normalizing' | 'storing' | 'instantiating' | 'done'

export interface ImportProgress {
  readonly stage: ImportStage
  readonly message: string
}

export interface ImportOptions {
  readonly file: { name: string; bytes: ArrayBuffer }
  readonly doc: SceneDocument
  readonly storage: StorageProvider
  readonly loader: AssetLoader
  /** Declared by the user in the import dialog; `suggestUnit` pre-fills it. */
  readonly sourceUnit?: 'm' | 'cm' | 'mm'
  readonly sourceUpAxis?: 'Y' | 'Z'
  /** Re-importing an existing logical asset: triggers the remap ladder (§5.3). */
  readonly replacesAssetId?: string
  readonly newId?: IdFactory
  readonly now?: () => string
  readonly onProgress?: (progress: ImportProgress) => void
}

export interface ImportResult {
  readonly asset: Asset
  readonly audit: AuditResult
  /** Fresh nodes for a first import; empty when replacing (the remap moved the old ones). */
  readonly nodes: readonly Node[]
  /** Present only when replacing an existing asset. */
  readonly remap?: MigrationReport
  /** True when the bytes were already in storage — a second upload of the same file. */
  readonly deduplicated: boolean
  readonly hash: BlobHash
}

export async function importModel(options: ImportOptions): Promise<ImportResult> {
  const { file, doc, storage, loader } = options
  const newId = options.newId ?? defaultIdFactory
  const now = options.now ?? (() => new Date().toISOString())
  const report = (stage: ImportStage, message: string) => options.onProgress?.({ stage, message })

  report('hashing', '正在计算内容哈希…')
  const hash = await hashBytes(new Uint8Array(file.bytes))

  report('deduplicating', '正在查重…')
  // D4 · identical bytes are the same asset. A second upload costs nothing and, more
  // importantly, produces the SAME url, so existing references keep resolving.
  const deduplicated = await storage.hasBlob(hash)
  const existing = doc.assets.find((a) => a.hash === hash)

  report('auditing', '正在体检…')
  const audit = await auditGlb(file.bytes, { now })

  report('normalizing', '正在归一化…')
  const normalization = computeNormalization({
    ...(options.sourceUnit ? { sourceUnit: options.sourceUnit } : {}),
    ...(options.sourceUpAxis ? { sourceUpAxis: options.sourceUpAxis } : {}),
    targetUnit: doc.meta.unit,
    targetUpAxis: doc.meta.upAxis,
  })

  if (existing) {
    // Same bytes, already recorded. D4's deduplication is about STORAGE, not about
    // instances: the user who drags the same file in twice wants a second copy in the
    // scene, and returning zero nodes here was read — correctly — as "the tool cannot
    // place more than one object". The blob is reused; the nodes are new.
    report('instantiating', '正在建立场景节点…')
    const reused = await loader.parse(existing.id, file.bytes)
    const { nodes } = instantiate(reused.scene, {
      assetId: existing.id,
      rootMatrix: normalization.matrix,
      newId,
      existingIds: collectAllIds(doc),
    })
    report('done', '导入完成')
    return { asset: existing, audit, nodes, deduplicated: true, hash }
  }

  report('storing', '正在写入存储…')
  if (!deduplicated) await storage.putBlob(new Uint8Array(file.bytes))

  const previous = options.replacesAssetId
    ? doc.assets.find((a) => a.id === options.replacesAssetId)
    : undefined

  const assetId = newId('asset', collectAllIds(doc))
  const asset: Asset = {
    id: assetId,
    type: 'model',
    name: file.name,
    hash,
    url: hashToPath(hash, extensionOf(file.name) || '.glb'),
    version: previous ? previous.version + 1 : 1,
    // The lineage is what makes "update the model" a new record rather than an edit (§3.2).
    lineageId: previous ? previous.lineageId : assetId,
    stats: audit.stats satisfies AssetStats,
    audit: audit.audit satisfies AssetAudit,
    normalized: normalization.record,
  }

  report('instantiating', '正在建立场景节点…')
  const loaded = await loader.parse(assetId, file.bytes)

  if (previous) {
    // §5.3 · move the existing configuration across rather than creating new nodes.
    const objects = [...loaded.objects.entries()].map(([path, object]) => ({ path, name: object.name }))
    const { report: remap } = remapAssetRefs(doc, previous.id, asset, objects)
    report('done', '导入完成')
    return { asset, audit, nodes: [], remap, deduplicated, hash }
  }

  const { nodes } = instantiate(loaded.scene, {
    assetId,
    rootMatrix: normalization.matrix,
    newId,
    existingIds: collectAllIds(doc),
  })

  report('done', '导入完成')
  return { asset, audit, nodes, deduplicated, hash }
}

/**
 * Folds an import into the document.
 *
 * Separate from `importModel` so the caller wraps it in one `commit` — the whole import
 * is a single undo entry, not one per node.
 */
export function applyImport(draft: SceneDocument, result: ImportResult): void {
  const index = draft.assets.findIndex((a) => a.id === result.asset.id)
  if (index === -1) draft.assets.push(result.asset)
  else draft.assets[index] = result.asset
  draft.nodes.push(...(result.nodes as Node[]))
}

/** The sentence R02 requires the remap dialog to lead with. */
export function summarizeImport(result: ImportResult): string {
  if (result.remap) {
    const migrated = result.remap.exact.length + result.remap.byName.length + result.remap.byPathScore.length
    return `已迁移 ${migrated} 项 / 需确认 ${result.remap.ambiguous.length} 项 / 失效 ${result.remap.orphaned.length} 项`
  }
  if (result.deduplicated) {
    return `该文件已在库中，复用已有资产未重复占用存储；新增 ${result.nodes.length} 个对象`
  }
  return `新增 ${result.nodes.length} 个对象`
}

/**
 * Places another instance of an asset already in the document.
 *
 * The same work an import does after the health check, without the file: this is the
 * explicit form of "put another one of those in the scene", which previously had no entry
 * point at all.
 */
export async function placeInstance(options: {
  readonly doc: SceneDocument
  readonly assetId: string
  readonly loader: AssetLoader
  readonly newId?: IdFactory
}): Promise<readonly Node[]> {
  const { doc, assetId, loader } = options
  const asset = doc.assets.find((a) => a.id === assetId)
  if (!asset) throw new Error(`文档中没有这个资产：${assetId}`)

  const loaded = loader.get(assetId) ?? (await loader.load(asset))
  // No rootMatrix: the asset was normalised when it was first imported, and applying the
  // conversion a second time would place the copy at a different scale from the original.
  const { nodes } = instantiate(loaded.scene, {
    assetId,
    newId: options.newId ?? defaultIdFactory,
    existingIds: collectAllIds(doc),
  })
  return nodes
}
