import type { SceneDocument } from '@w3/schema'
import { CURRENT_VERSION, migrate } from '@w3/schema'
import { unzipSync, zipSync } from 'fflate'
import { hashToPath, isBlobHash, pathToHash } from './hash.js'
import type { BlobHash } from './provider.js'
import { StorageError } from './provider.js'

/**
 * T-024 · MVP_V0 D8 · the `.w3p` published snapshot.
 *
 * A zip holding everything needed to play the scene with no network and no server:
 *
 *   manifest.json   { schemaVersion, coreVersion, snapshotId, projectId, publishedAt, assetCount,
 *                     projectName?, entrySceneId?, scenes? }
 *   scene.json      the full SceneDocument, already past validate + checkIntegrity
 *   assets/ab/12/…  only the blobs the document actually references
 *   thumbnail.png   optional
 *
 * `coreVersion` in the manifest is not decoration. From v1 onward it is the only thread
 * to pull when someone reports "the old package behaves differently in the new player".
 */

export const MANIFEST_FILENAME = 'manifest.json'
export const SCENE_FILENAME = 'scene.json'
export const THUMBNAIL_FILENAME = 'thumbnail.png'

export interface PackageManifest {
  readonly schemaVersion: number
  readonly coreVersion: string
  readonly snapshotId: string
  readonly projectId: string
  readonly publishedAt: string
  readonly assetCount: number
  readonly label?: string
  /**
   * 下面三个是 **v1.5 才消费、v1.0 就写**的字段（多场景包）。
   *
   * 现在就写进去的理由只有一个：**它们是老包与新包的分界线**。v1.5 拿到一个包时要能
   * 回答「入口场景是哪个」，而对 v1.0 及更早打的包，manifest 里根本没有这三个键——
   * 那时候只能回退到 `document` 侧。这个分界线越早划下，需要兜底的包就越少。
   *
   * 全部 optional：老包解出来它们是 `undefined`，这**不是缺陷**，是判据（见
   * `resolveEntryScene`）。
   */
  readonly projectName?: string
  readonly entrySceneId?: string
  /**
   * 包里每个场景一条。v1.0 恒为长度 1。
   *
   * `file` 是包内路径而不是场景 id 派生出来的名字——v1.5 允许一个包里放多份
   * `scenes/xxx.json`，而路径与 id 的映射必须由 manifest 说了算，不能靠约定。
   */
  readonly scenes?: readonly { readonly sceneId: string; readonly name: string; readonly file: string }[]
}

export interface PackageInput {
  readonly document: SceneDocument
  readonly snapshotId: string
  readonly publishedAt: string
  readonly coreVersion: string
  /** Bytes for every asset the document references, keyed by content hash. */
  readonly blobs: ReadonlyMap<BlobHash, Uint8Array>
  readonly thumbnail?: Uint8Array
  readonly label?: string
}

export interface UnpackedPackage {
  readonly manifest: PackageManifest
  /**
   * 入口场景，已经把 manifest 与 document 两侧合过一次（`resolveEntryScene`）。
   *
   * 调用方要「这个包该打开哪个场景」的确定答案时读它；要判断「这个包是什么年代打的」
   * 时读 `manifest`。两个问题分开，是因为老包在前一个问题上有答案、在后一个问题上
   * 恰恰要那个 `undefined`。
   */
  readonly entry: { readonly sceneId: string; readonly name: string; readonly file: string }
  readonly document: SceneDocument
  readonly blobs: Map<BlobHash, Uint8Array>
  readonly thumbnail?: Uint8Array
}

const encoder = new TextEncoder()
const decoder = new TextDecoder()

/**
 * Which content hashes a document actually needs.
 *
 * "Needs" means **reachable from a node, an animation or a media record** — not "appears
 * in `document.assets`". Those are different sets, and the difference is the whole point:
 * an asset imported, evaluated and then deleted from the scene keeps its record (D4 makes
 * asset records immutable) while nothing references it any more. Iterating `assets`
 * shipped those bytes anyway, so T-100's "产出包只含被引用的资产" did not hold and a package
 * could be many times larger than the scene inside it.
 *
 * Derived from the document rather than from the caller's blob map, so an over-supplied
 * map cannot bloat the package and an under-supplied one is caught at pack time rather
 * than by the player.
 */
/**
 * 从一批节点收资产引用。
 *
 * 抽出来是因为 v3 之后有**两处**节点数组：文档主集合与每个 prefab 的 body。两处各写
 * 一遍，就是这条入边下一次漂移的方式——而漂移的症状是「发布出去的包少了字节」，
 * 要到客户打开时才发现（T-176 那次是贴图，整个 v0.5 的表现力全部静默缺席）。
 */
function collectNodeAssetIds(nodes: SceneDocument['nodes'], used: Set<string>): void {
  for (const node of nodes) {
    if (node.assetRef) used.add(node.assetRef.assetId)
  }
}

/** 同上，材质那一侧。 */
function collectMaterialAssetIds(materials: SceneDocument['materials'], used: Set<string>): void {
  for (const material of materials) {
    for (const assetId of Object.values(material.params.maps)) {
      if (typeof assetId === 'string') used.add(assetId)
    }
  }
}

export function referencedHashes(document: SceneDocument): Set<BlobHash> {
  const used = new Set<string>()
  collectNodeAssetIds(document.nodes, used)
  for (const animation of document.animations) {
    if (animation.kind === 'imported') used.add(animation.assetId)
  }
  for (const media of document.media) used.add(media.assetId)

  // v0.5 · textures and the environment map (T-176 审查所得).
  //
  // These two were missing, and the symptom is as bad as it gets: the package builds, the
  // player opens it, and the scene renders UNTEXTURED with no environment — every v0.5
  // headline feature silently absent from anything ever published. Nothing caught it
  // because a texture is not referenced the way a model is: no node points at it, only a
  // material slot does, and `meta.environment` is not a collection anybody was walking.
  collectMaterialAssetIds(document.materials, used)
  if (document.meta.environment.hdriAssetId !== null) used.add(document.meta.environment.hdriAssetId)

  // v3 · prefab 的 body 里有自己的一套 nodes 与 materials（T-232）。
  //
  // 它们与文档主集合**同一命名空间**（I42），但**不在 `document.nodes` / `document.materials`
  // 里**——所以一份只被 prefab body 引用的模型或贴图，在这一行之前完全不会被打进包。
  // 症状与 T-176 那次逐字相同：包建得出来、播放器打得开、东西不在。
  for (const prefab of document.prefabs) {
    collectNodeAssetIds(prefab.nodes, used)
    collectMaterialAssetIds(prefab.materials, used)
  }

  // v3 · 视点缩略图（T-225 把 `thumbnailUrl` 换成了 `thumbnailAssetId`）。
  //
  // **没有任何一张卡认领它。** T-232 与 T-233 是仅有的两张动本文件的卡，两张的卡面都没
  // 提到它。在这里补上并登记，比留给「以后」强——漏了它，发布出去的包里视点缩略图是空的。
  for (const viewpoint of document.viewpoints) {
    if (viewpoint.thumbnailAssetId !== undefined) used.add(viewpoint.thumbnailAssetId)
  }

  const out = new Set<BlobHash>()
  for (const asset of document.assets) {
    if (used.has(asset.id) && isBlobHash(asset.hash)) out.add(asset.hash)
  }
  return out
}

export function packScene(input: PackageInput): Uint8Array {
  const needed = referencedHashes(input.document)
  const missing = [...needed].filter((hash) => !input.blobs.has(hash))
  if (missing.length > 0) {
    throw new StorageError(
      'not-found',
      `cannot publish: ${missing.length} referenced asset blob(s) are missing (${missing[0]}…)`,
    )
  }

  const manifest: PackageManifest = {
    schemaVersion: input.document.schemaVersion,
    coreVersion: input.coreVersion,
    snapshotId: input.snapshotId,
    projectId: input.document.projectId,
    publishedAt: input.publishedAt,
    assetCount: needed.size,
    // v1.5 才消费，v1.0 就写 —— 见上面的字段注释。单场景时 `scenes` 也照写一条，
    // 这样 v1.5 的读取代码不需要为「长度 1」写一条特例分支。
    projectName: input.document.name,
    entrySceneId: input.document.sceneId,
    scenes: [{ sceneId: input.document.sceneId, name: input.document.name, file: SCENE_FILENAME }],
    ...(input.label === undefined ? {} : { label: input.label }),
  }

  const files: Record<string, Uint8Array> = {
    [MANIFEST_FILENAME]: encoder.encode(`${JSON.stringify(manifest, null, 2)}\n`),
    [SCENE_FILENAME]: encoder.encode(`${JSON.stringify(input.document, null, 2)}\n`),
  }

  for (const asset of input.document.assets) {
    if (!isBlobHash(asset.hash)) continue
    // **只写被引用的。** 一份留在 `document.assets` 里但谁都不指的资产（导入后又删掉了
    // 节点，记录还在）此前照样进包——包白白胖一圈，而 `manifest.assetCount` 说的是
    // `needed.size`，两个数从此对不上。
    //
    // 裁剪写在这里、而不是改成 `for (const hash of needed)`：一个 hash 可以对应**多条**
    // `assets` 记录（同一份字节以两个扩展名导入过），遍历 hash 会只写出其中一条的 url，
    // 另一条在播放器里解析不到。
    if (!needed.has(asset.hash)) continue
    const bytes = input.blobs.get(asset.hash)
    if (!bytes) continue
    // Keyed by the document's own url so the player resolves without a lookup table.
    files[asset.url] = bytes
  }

  if (input.thumbnail) files[THUMBNAIL_FILENAME] = input.thumbnail

  // level 6: the payload is already-compressed GLB/KTX2; maximum effort buys little.
  return zipSync(files, { level: 6 })
}

/**
 * The version gate, on the manifest, before anything is parsed from the package.
 *
 * It has to run HERE rather than only in the reader that consumes the result. The player
 * owned an `assertCompatible` with exactly this message and it was dead code: by the time
 * `createPlayerSession` called it, `unpackScene` had already refused the same package with
 * a generic「scene.json 无法读取（from-the-future）」— technically a refusal, but it names
 * a file instead of the actual problem, which is that the reader is out of date.
 *
 * The scene-side `from-the-future` check below stays as the backstop for the one case this
 * cannot see: a manifest that disagrees with the document it ships.
 *
 * OLDER packages are never refused — SCHEMA_SPEC's migration chain is what makes C4
 * ("老文件永远能打开") true, and a gate in the other direction would undo it.
 */
export function assertPackageCompatible(manifest: PackageManifest): void {
  const { schemaVersion, coreVersion } = manifest
  if (typeof schemaVersion !== 'number' || schemaVersion <= CURRENT_VERSION) return
  throw new StorageError(
    'conflict',
    `这个包由更新版本的编辑器发布（文档格式 v${schemaVersion}），当前程序只支持到 v${CURRENT_VERSION}。` +
      `请升级后重试。（发布时的 core 版本：${coreVersion}）`,
  )
}

export function unpackScene(bytes: Uint8Array): UnpackedPackage {
  let entries: Record<string, Uint8Array>
  try {
    entries = unzipSync(bytes)
  } catch (cause) {
    throw new StorageError('corrupt', 'not a readable .w3p package', { cause })
  }

  const manifestBytes = entries[MANIFEST_FILENAME]
  if (!manifestBytes) throw new StorageError('corrupt', `.w3p is missing ${MANIFEST_FILENAME}`)
  const sceneBytes = entries[SCENE_FILENAME]
  if (!sceneBytes) throw new StorageError('corrupt', `.w3p is missing ${SCENE_FILENAME}`)

  let manifest: PackageManifest
  try {
    manifest = JSON.parse(decoder.decode(manifestBytes)) as PackageManifest
  } catch (cause) {
    throw new StorageError('corrupt', `${MANIFEST_FILENAME} is not valid JSON`, { cause })
  }

  // Before the document is touched: a package from a newer build gets the message that
  // says what to do about it, not one that says its scene.json is unreadable.
  assertPackageCompatible(manifest)

  // `migrate`, not `validate`. `schemaVersion` is a `z.literal(CURRENT_VERSION)`, so a
  // package written by an older build fails validation outright — while constitution C4
  // says "任何历史版本的已发布快照，必须永远能被当前代码打开". Reading it through the
  // migration chain is what makes that true rather than accidentally true because v1 is
  // currently the only version in existence.
  //
  // It also fixes the version gate at the other end: a package from the FUTURE now comes
  // back as `from-the-future` with both version numbers, instead of a generic validation
  // failure listing fields the reader has never heard of.
  const parsed = migrate(JSON.parse(decoder.decode(sceneBytes)))
  if (!parsed.ok) {
    throw new StorageError(
      parsed.error.kind === 'from-the-future' ? 'conflict' : 'corrupt',
      `${SCENE_FILENAME} 无法读取（${parsed.error.kind}）：${parsed.error.message}`,
    )
  }

  const blobs = new Map<BlobHash, Uint8Array>()
  for (const [path, content] of Object.entries(entries)) {
    const hash = pathToHash(path)
    if (hash) blobs.set(hash, content)
  }

  const thumbnail = entries[THUMBNAIL_FILENAME]
  const document = parsed.value.document
  return {
    manifest,
    document,
    // manifest 与 document 两侧在这里合一次，结果对调用方是确定的（见 resolveEntryScene）
    entry: resolveEntryScene(manifest, document),
    blobs,
    ...(thumbnail ? { thumbnail } : {}),
  }
}

/**
 * An AssetResolver backed by an unpacked package.
 *
 * This is how the player stays offline-complete: every `asset.url` in the document
 * resolves out of the zip it arrived in, with no request of any kind (C6).
 */
export function createPackageResolver(pkg: UnpackedPackage) {
  const byUrl = new Map<string, Uint8Array>()
  for (const asset of pkg.document.assets) {
    const bytes = pkg.blobs.get(asset.hash)
    if (bytes) byUrl.set(asset.url, bytes)
  }
  return {
    async resolve(url: string): Promise<ArrayBuffer> {
      const bytes = byUrl.get(url) ?? (pathToHash(url) ? pkg.blobs.get(pathToHash(url)!) : undefined)
      if (!bytes) throw new StorageError('not-found', `asset not present in package: ${url}`)
      const copy = new Uint8Array(bytes.byteLength)
      copy.set(bytes)
      return copy.buffer
    },
  }
}

/** The storage path an asset's bytes take inside a package, given its hash and filename. */
export { hashToPath }

/**
 * 包的入口场景：manifest 说了算，老包回落到 `document`。
 *
 * **由 `unpackScene` 调用**，结果放在 `UnpackedPackage.entry` 上。这不是为了给测试留
 * 一个抓手——三个 manifest 新字段（`entrySceneId` / `projectName` / `scenes`）如果没有
 * 任何人读，它们就只是 JSON 里三个多出来的键，写与不写在行为上完全一样。
 *
 * `manifest` 本身**不做回填**：老包解出来 `entrySceneId` 仍是 `undefined`。那不是缺陷，
 * 是判据——「这个包是 v1.0 之前打的」这件事只有那个键的有无能说明，回填会把它抹掉。
 * 需要一个确定答案的调用方读 `entry`，需要判断包龄的读 `manifest`。
 *
 * `file` 是入口场景在包内的路径。v1.0 恒为 `scene.json`；v1.5 允许一个包里放多份
 * `scenes/xxx.json`，那时这个映射必须由 manifest 说了算，不能靠约定。
 */
export function resolveEntryScene(
  manifest: PackageManifest,
  document: SceneDocument,
): { sceneId: string; name: string; file: string } {
  const sceneId = manifest.entrySceneId ?? document.sceneId
  return {
    sceneId,
    name: manifest.projectName ?? document.name,
    file: manifest.scenes?.find((scene) => scene.sceneId === sceneId)?.file ?? SCENE_FILENAME,
  }
}
