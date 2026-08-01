import type { Asset, AssetAudit, AssetStats, IdFactory, Node, SceneDocument } from '@w3/schema'
import { collectAllIds, defaultIdFactory, remapAssetRefs } from '@w3/schema'
import type { MigrationReport } from '@w3/schema'
import type { AuditResult } from '@w3/core'
import { AssetLoader, auditGlb, auditImage, computeNormalization, instantiate, renderThumbnail } from '@w3/core'
import type { LoadedAsset } from '@w3/core'
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

export type ImportStage =
  | 'hashing'
  | 'deduplicating'
  | 'auditing'
  | 'normalizing'
  | 'storing'
  | 'thumbnailing'
  | 'instantiating'
  | 'done'

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
  /**
   * Renders the asset's thumbnail. Injected so the flow stays testable in Node — the
   * real one needs a GPU, and a missing thumbnail must never be able to fail an import.
   */
  readonly renderThumbnail?: (scene: LoadedAsset['scene']) => Promise<Blob | null>
}

export interface ImportResult {
  readonly asset: Asset
  readonly audit: AuditResult
  /** Fresh nodes for a first import; empty when replacing (the remap moved the old ones). */
  readonly nodes: readonly Node[]
  /** Present only when replacing an existing asset. */
  readonly remap?: MigrationReport
  /**
   * The document with every assetRef moved onto the new asset.
   *
   * Carried alongside the report because the report alone is a description of work that
   * has not been done. `applyImport` used to fold in only the asset record and the (empty)
   * node list, so a second upload showed a perfect "已迁移 4 项" dialog and left every node
   * pointing at the OLD asset id — SCHEMA_SPEC §5.3 and G0-6 unimplemented at the editor
   * level, with the unit tests for `remapAssetRefs` all green because they test the
   * function, not its use.
   */
  readonly remapped?: SceneDocument
  /** True when the bytes were already in storage — a second upload of the same file. */
  readonly deduplicated: boolean
  readonly hash: BlobHash
}

/* -------------------------------------------------------------------------- */
/* v0.5 · what kind of file is this? (T-150)                                   */
/* -------------------------------------------------------------------------- */

/** The asset kinds the importer can produce. `media` arrives in T-160. */
export type ImportKind = 'model' | 'texture' | 'hdri'

/** Extension → kind. The extension is the user's declaration; the header check confirms it. */
const KIND_BY_EXTENSION: Record<string, ImportKind> = {
  '.glb': 'model',
  '.gltf': 'model',
  '.png': 'texture',
  '.jpg': 'texture',
  '.jpeg': 'texture',
  '.webp': 'texture',
  '.ktx2': 'texture',
  '.hdr': 'hdri',
}

/** What a file picker should accept today. Kept next to the table it is derived from. */
export const IMPORT_ACCEPT = Object.keys(KIND_BY_EXTENSION).join(',')

/**
 * Classifies a file by extension.
 *
 * Extension rather than content sniffing, deliberately: the user renaming `photo.png` to
 * `model.glb` should get "这不是一个有效的模型文件" from the parser, not a texture import
 * they did not ask for. The extension states intent; the format check in the audit is what
 * catches a mismatch.
 */
export function classifyImport(fileName: string): ImportKind | null {
  return KIND_BY_EXTENSION[extensionOf(fileName).toLowerCase()] ?? null
}

/**
 * Imports any supported file.
 *
 * The one entry point a caller should use. It answers "what is this" and hands off; the
 * model path is unchanged from v0, and the image path shares hashing, dedup, storage and
 * the asset record with it — the parts that must not diverge, because a second upload of
 * the same bytes has to produce the same url whatever the file is.
 */
export async function importAsset(options: ImportOptions): Promise<ImportResult> {
  const kind = classifyImport(options.file.name)
  if (kind === null) {
    throw new Error(`不支持的文件类型：${options.file.name}。当前支持 ${IMPORT_ACCEPT}`)
  }
  return kind === 'model' ? importModel(options) : importImage(options, kind === 'hdri' ? 'hdri' : 'texture')
}

/**
 * Imports a texture or an environment map.
 *
 * Deliberately NOT a branch inside `importModel`. The two flows share their first half and
 * diverge completely in the second: an image has no geometry to parse, no normalisation to
 * apply, no nodes to instantiate and no remap ladder — and every one of those steps in the
 * model path would need an `if` that means "skip this". Four skipped steps in a row is a
 * different function.
 *
 * **The image is its own thumbnail.** A separate downscaled blob would need a canvas (so:
 * browser-only, untestable in Node) and would double the stored bytes for a picture the
 * asset panel already displays at 64 px through CSS. The one case this is wrong for — a
 * 4 MB texture used as a 64 px thumbnail — is exactly the case the size audit is telling
 * the user to fix.
 */
export async function importImage(options: ImportOptions, kind: 'texture' | 'hdri'): Promise<ImportResult> {
  const { file, doc, storage } = options
  const newId = options.newId ?? defaultIdFactory
  const now = options.now ?? (() => new Date().toISOString())
  const report = (stage: ImportStage, message: string) => options.onProgress?.({ stage, message })

  report('hashing', '正在计算内容哈希…')
  const hash = await hashBytes(new Uint8Array(file.bytes))

  report('deduplicating', '正在查重…')
  const deduplicated = await storage.hasBlob(hash)
  const existing = doc.assets.find((a) => a.hash === hash)

  report('auditing', '正在体检…')
  const audit = auditImage(file.bytes, { now, scope: kind === 'hdri' ? 'hdri' : 'image' })

  if (existing) {
    // Same bytes, already recorded. Unlike a model, a second import produces no nodes —
    // an image is not placed in the scene, it is pointed at by a material or by
    // `meta.environment`. Returning the existing record is the whole result.
    report('done', '导入完成')
    return { asset: existing, audit, nodes: [], deduplicated: true, hash }
  }

  report('storing', '正在写入存储…')
  if (!deduplicated) await storage.putBlob(new Uint8Array(file.bytes))

  const assetId = newId('asset', collectAllIds(doc))
  const url = hashToPath(hash, extensionOf(file.name) || (kind === 'hdri' ? '.hdr' : '.png'))
  const asset: Asset = {
    id: assetId,
    type: kind,
    name: file.name,
    hash,
    url,
    version: 1,
    lineageId: assetId,
    stats: audit.stats satisfies AssetStats,
    audit: audit.audit satisfies AssetAudit,
    // An `<img>` can show a png/jpg/webp directly, so the asset IS its own preview. An
    // `.hdr` cannot be shown by any browser without tone-mapping it first, so it gets no
    // thumbnail and the panel falls back to its type icon — an honest blank rather than a
    // broken image.
    ...(kind === 'texture' && isBrowserDisplayable(file.name) ? { thumbnailUrl: url } : {}),
  }

  report('done', '导入完成')
  return { asset, audit, nodes: [], deduplicated, hash }
}

/** True for formats an `<img>` element can render. KTX2 is GPU-only, so: not that one. */
const isBrowserDisplayable = (fileName: string) => ['.png', '.jpg', '.jpeg', '.webp'].includes(extensionOf(fileName).toLowerCase())

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

  // T-053 · the thumbnail, which lived as an unreachable function until now. Generated
  // here because this is the one moment the geometry is already parsed and in memory
  // (技术方案 §1.5 rules out doing it server-side).
  //
  // Best-effort by construction: a failure or a missing renderer leaves `thumbnailUrl`
  // unset, and the asset panel falls back to text. An import must never fail because a
  // picture could not be drawn.
  let thumbnailUrl: string | undefined
  const render = options.renderThumbnail ?? defaultThumbnailRenderer
  try {
    report('thumbnailing', '正在生成缩略图…')
    const blob = await render(loaded.scene)
    if (blob) {
      const bytes = new Uint8Array(await blob.arrayBuffer())
      const thumbHash = await hashBytes(bytes)
      await storage.putBlob(bytes)
      thumbnailUrl = hashToPath(thumbHash, '.png')
    }
  } catch {
    thumbnailUrl = undefined
  }
  if (thumbnailUrl) Object.assign(asset, { thumbnailUrl })

  if (previous) {
    // §5.3 · move the existing configuration across rather than creating new nodes.
    const objects = [...loaded.objects.entries()].map(([path, object]) => ({ path, name: object.name }))
    const { doc: remapped, report: remap } = remapAssetRefs(doc, previous.id, asset, objects)
    report('done', '导入完成')
    return { asset, audit, nodes: [], remap, remapped, deduplicated, hash }
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

  // §5.3 · a re-upload moves existing configuration onto the new asset. The remapped
  // nodes are the whole point of the remap ladder; without this the dialog reports
  // "已迁移 N 项" and nothing has moved.
  if (result.remapped) {
    draft.nodes = result.remapped.nodes.map((n) => ({ ...n }))
    draft.animations = result.remapped.animations.map((a) => ({ ...a }))
    return
  }

  draft.nodes.push(...(result.nodes as Node[]))
}

/**
 * The browser thumbnail renderer, or nothing at all outside a browser.
 *
 * Resolved lazily so importing this module in Node — which the tests and the parity suite
 * do — never touches `document`.
 */
async function defaultThumbnailRenderer(scene: LoadedAsset['scene']): Promise<Blob | null> {
  if (typeof document === 'undefined') return null
  return renderThumbnail(scene)
}

/** The sentence R02 requires the remap dialog to lead with. */
export function summarizeImport(result: ImportResult): string {
  if (result.remap) {
    const migrated = result.remap.exact.length + result.remap.byName.length + result.remap.byPathScore.length
    return `已迁移 ${migrated} 项 / 需确认 ${result.remap.ambiguous.length} 项 / 失效 ${result.remap.orphaned.length} 项`
  }
  if (result.asset.type !== 'model') {
    // An image produces no nodes on purpose — it is pointed AT, not placed. Reporting
    // 「新增 0 个对象」 for a texture reads as a failed import.
    const what = result.asset.type === 'hdri' ? '环境贴图' : '纹理'
    return result.deduplicated ? `该${what}已在库中，复用已有资产未重复占用存储` : `已导入${what}「${result.asset.name}」`
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
