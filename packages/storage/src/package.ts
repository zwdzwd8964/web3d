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
 *   manifest.json   { schemaVersion, coreVersion, snapshotId, projectId, publishedAt, assetCount }
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
export function referencedHashes(document: SceneDocument): Set<BlobHash> {
  const used = new Set<string>()
  for (const node of document.nodes) {
    if (node.assetRef) used.add(node.assetRef.assetId)
  }
  for (const animation of document.animations) {
    if (animation.kind === 'imported') used.add(animation.assetId)
  }
  for (const media of document.media) used.add(media.assetId)

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
    ...(input.label === undefined ? {} : { label: input.label }),
  }

  const files: Record<string, Uint8Array> = {
    [MANIFEST_FILENAME]: encoder.encode(`${JSON.stringify(manifest, null, 2)}\n`),
    [SCENE_FILENAME]: encoder.encode(`${JSON.stringify(input.document, null, 2)}\n`),
  }

  for (const asset of input.document.assets) {
    if (!isBlobHash(asset.hash)) continue
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
  return { manifest, document: parsed.value.document, blobs, ...(thumbnail ? { thumbnail } : {}) }
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
