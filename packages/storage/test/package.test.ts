import { CURRENT_VERSION, createGoldenPathDocument } from '@w3/schema'
import type { SceneDocument } from '@w3/schema'
import { unzipSync, zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { hashToPath } from '../src/hash.js'
import {
  MANIFEST_FILENAME,
  SCENE_FILENAME,
  THUMBNAIL_FILENAME,
  assertPackageCompatible,
  createPackageResolver,
  packScene,
  referencedHashes,
  unpackScene,
} from '../src/package.js'
import type { PackageManifest } from '../src/package.js'
import type { BlobHash } from '../src/provider.js'
import { StorageError } from '../src/provider.js'

/** T-024 · MVP_V0 D8. */

const GLB_BYTES = new TextEncoder().encode('glTF binary payload — pretend this is 8.4 MB')

function blobsFor(doc: SceneDocument): Map<BlobHash, Uint8Array> {
  const map = new Map<BlobHash, Uint8Array>()
  for (const asset of doc.assets) map.set(asset.hash, GLB_BYTES)
  return map
}

function pack(overrides: Partial<Parameters<typeof packScene>[0]> = {}) {
  const document = createGoldenPathDocument()
  return packScene({
    document,
    snapshotId: 'snp_a1b2c3d4',
    publishedAt: '2026-08-01T04:00:00.000Z',
    coreVersion: '0.0.0',
    blobs: blobsFor(document),
    ...overrides,
  })
}

describe('referencedHashes()', () => {
  it('reports exactly the asset hashes the document names', () => {
    const doc = createGoldenPathDocument()
    expect([...referencedHashes(doc)]).toEqual([doc.assets[0]!.hash])
    expect(referencedHashes({ ...doc, assets: [] }).size).toBe(0)
  })
})

describe('packScene()', () => {
  it('writes the four documented members', () => {
    const entries = unzipSync(pack({ thumbnail: new Uint8Array([137, 80, 78, 71]) }))
    const doc = createGoldenPathDocument()
    expect(Object.keys(entries).sort()).toEqual([MANIFEST_FILENAME, SCENE_FILENAME, THUMBNAIL_FILENAME, doc.assets[0]!.url].sort())
  })

  it('stores the asset under the document’s own url, so the player needs no lookup table', () => {
    const doc = createGoldenPathDocument()
    const entries = unzipSync(pack())
    expect(entries[doc.assets[0]!.url]).toEqual(GLB_BYTES)
    expect(doc.assets[0]!.url).toBe(hashToPath(doc.assets[0]!.hash, '.glb'))
  })

  it('records coreVersion — the only thread to pull on "old package, new player"', () => {
    const { manifest } = unpackScene(pack({ coreVersion: '1.4.2' }))
    expect(manifest).toMatchObject({
      coreVersion: '1.4.2',
      schemaVersion: CURRENT_VERSION,
      snapshotId: 'snp_a1b2c3d4',
      projectId: createGoldenPathDocument().projectId,
      assetCount: 1,
    })
  })

  it('carries an optional label and omits the key when absent', () => {
    expect(unpackScene(pack({ label: '验收版' })).manifest.label).toBe('验收版')
    expect('label' in unpackScene(pack()).manifest).toBe(false)
  })

  it('refuses to publish when a referenced blob is missing, naming how many', () => {
    expect(() => pack({ blobs: new Map() })).toThrow(StorageError)
    expect(() => pack({ blobs: new Map() })).toThrow(/1 referenced asset blob\(s\) are missing/)
  })

  it('ships only what the scene references, ignoring extra blobs', () => {
    const doc = createGoldenPathDocument()
    const blobs = blobsFor(doc)
    blobs.set(`sha256:${'f'.repeat(64)}`, new TextEncoder().encode('unused'))
    const entries = unzipSync(packScene({
      document: doc,
      snapshotId: 'snp_a1b2c3d4',
      publishedAt: '2026-08-01T04:00:00.000Z',
      coreVersion: '0.0.0',
      blobs,
    }))
    expect(Object.keys(entries)).toHaveLength(3)
  })

  it('produces a package with no assets when the document has none', () => {
    const empty = { ...createGoldenPathDocument(), assets: [], nodes: [], animations: [], materials: [], hotspots: [], rules: [] }
    const entries = unzipSync(packScene({
      document: empty as SceneDocument,
      snapshotId: 'snp_a1b2c3d4',
      publishedAt: '2026-08-01T04:00:00.000Z',
      coreVersion: '0.0.0',
      blobs: new Map(),
    }))
    expect(Object.keys(entries).sort()).toEqual([MANIFEST_FILENAME, SCENE_FILENAME])
  })
})

describe('unpackScene()', () => {
  it('round-trips the document exactly', () => {
    expect(unpackScene(pack()).document).toEqual(createGoldenPathDocument())
  })

  it('round-trips asset bytes keyed by content hash', () => {
    const doc = createGoldenPathDocument()
    expect(unpackScene(pack()).blobs.get(doc.assets[0]!.hash)).toEqual(GLB_BYTES)
  })

  it('round-trips a thumbnail and omits it when absent', () => {
    const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])
    expect(unpackScene(pack({ thumbnail: png })).thumbnail).toEqual(png)
    expect(unpackScene(pack()).thumbnail).toBeUndefined()
  })

  it('rejects a file that is not a zip', () => {
    expect(() => unpackScene(new TextEncoder().encode('definitely not a zip'))).toThrow(/not a readable/)
  })

  it('names which member is missing', () => {
    expect(() => unpackScene(zipSync({ 'scene.json': new Uint8Array([123, 125]) }))).toThrow(/missing manifest\.json/)
    expect(() => unpackScene(zipSync({ 'manifest.json': new Uint8Array([123, 125]) }))).toThrow(/missing scene\.json/)
  })

  it('validates the scene it unpacks rather than trusting the producer', () => {
    const encoder = new TextEncoder()
    const bad = zipSync({
      'manifest.json': encoder.encode('{}'),
      'scene.json': encoder.encode(JSON.stringify({ schemaVersion: CURRENT_VERSION })),
    })
    expect(() => unpackScene(bad)).toThrow(/failed validation/)
  })
})

/**
 * T-116 · the version gate, which used to be unreachable.
 *
 * `assertCompatible` in the player carried this message and could never produce it:
 * `unpackScene` refused a future package first, blaming scene.json. "It throws either
 * way" is not good enough — the whole reason T-101 specified a message was so the person
 * holding the package learns that their player is out of date.
 */
describe('the from-the-future gate', () => {
  const encoder = new TextEncoder()

  /** A package whose manifest AND scene both claim a version the reader has never heard of. */
  const futurePackage = (version: number) => {
    const document = createGoldenPathDocument()
    const manifest: PackageManifest = {
      schemaVersion: version,
      coreVersion: '9.9.9',
      snapshotId: 'snp_a1b2c3d4',
      projectId: document.projectId,
      publishedAt: '2027-01-01T00:00:00.000Z',
      assetCount: 0,
    }
    return zipSync({
      [MANIFEST_FILENAME]: encoder.encode(JSON.stringify(manifest)),
      [SCENE_FILENAME]: encoder.encode(JSON.stringify({ ...document, schemaVersion: version })),
    })
  }

  it('refuses a newer package with a message about the reader, not about scene.json', () => {
    const bytes = futurePackage(CURRENT_VERSION + 1)
    expect(() => unpackScene(bytes)).toThrow(StorageError)
    // Both numbers, so the mismatch is diagnosable without opening the zip, and an
    // instruction — the previous message named a filename and stopped there.
    expect(() => unpackScene(bytes)).toThrow(new RegExp(`文档格式 v${CURRENT_VERSION + 1}`))
    expect(() => unpackScene(bytes)).toThrow(new RegExp(`只支持到 v${CURRENT_VERSION}`))
    expect(() => unpackScene(bytes)).toThrow(/请升级后重试/)
    expect(() => unpackScene(bytes)).not.toThrow(/scene\.json/)
  })

  it('reports it as a conflict, not as corruption — the file is fine, the reader is old', () => {
    try {
      unpackScene(futurePackage(CURRENT_VERSION + 5))
      expect.unreachable('a package from the future must not open')
    } catch (error) {
      expect(error).toBeInstanceOf(StorageError)
      expect((error as StorageError).code).toBe('conflict')
    }
  })

  it('still opens a package at the current version, and would open an older one (C4)', () => {
    expect(() => unpackScene(pack())).not.toThrow()
    expect(() =>
      assertPackageCompatible({
        schemaVersion: CURRENT_VERSION - 1,
        coreVersion: '0.0.0',
        snapshotId: 'snp_a1b2c3d4',
        projectId: 'prj_x',
        publishedAt: '2026-01-01T00:00:00.000Z',
        assetCount: 0,
      }),
    ).not.toThrow()
  })

  it('lets a manifest with no version through to the scene-side check', () => {
    // A hand-made or truncated manifest must not be silently read as "from the future";
    // the document itself is still the authority on what it is.
    const bad = zipSync({
      [MANIFEST_FILENAME]: encoder.encode('{}'),
      [SCENE_FILENAME]: encoder.encode(JSON.stringify({ ...createGoldenPathDocument(), schemaVersion: 999 })),
    })
    expect(() => unpackScene(bad)).toThrow(/from-the-future/)
  })
})

describe('createPackageResolver()', () => {
  it('resolves every asset url out of the package, with no request of any kind (C6)', async () => {
    const pkg = unpackScene(pack())
    const resolver = createPackageResolver(pkg)
    const buffer = await resolver.resolve(pkg.document.assets[0]!.url)
    expect(new Uint8Array(buffer)).toEqual(GLB_BYTES)
  })

  it('hands out a copy, so a consumer cannot corrupt the package in memory', async () => {
    const pkg = unpackScene(pack())
    const resolver = createPackageResolver(pkg)
    const url = pkg.document.assets[0]!.url
    const first = new Uint8Array(await resolver.resolve(url))
    first[0] = 0
    expect(new Uint8Array(await resolver.resolve(url))[0]).toBe(GLB_BYTES[0])
  })

  it('reports an unknown url as not-found rather than resolving empty bytes', async () => {
    const resolver = createPackageResolver(unpackScene(pack()))
    await expect(resolver.resolve('assets/zz/zz/nope.glb')).rejects.toThrow(StorageError)
  })
})

describe('v0.5 资产也要进包（T-176 审查所得）', () => {
  /** The golden path plus a texture on a material and an HDRI as the environment. */
  const withV05Assets = () => {
    const base = createGoldenPathDocument()
    const asset = (id: string, type: string, hash: string) => ({
      ...base.assets[0]!,
      id,
      type,
      hash,
      name: `${id}.bin`,
    })
    return {
      ...base,
      assets: [
        ...base.assets,
        asset('ast_tex00001', 'texture', `sha256:${'b'.repeat(64)}`),
        asset('ast_hdr00001', 'hdri', `sha256:${'c'.repeat(64)}`),
      ],
      materials: base.materials.map((m) => ({ ...m, params: { ...m.params, maps: { map: 'ast_tex00001' } } })),
      meta: { ...base.meta, environment: { ...base.meta.environment, hdriAssetId: 'ast_hdr00001' } },
    } as ReturnType<typeof createGoldenPathDocument>
  }

  it('包含材质贴图与环境贴图的字节', () => {
    // 症状有多糟：包能打出来、播放器能打开、场景**没有贴图也没有环境**——v0.5 的招牌功能
    // 在任何发布出去的东西里静默消失。没人发现是因为贴图的引用方式和模型不一样：
    // 没有节点指向它，只有材质槽位指向它，而 meta.environment 根本不是谁在遍历的集合。
    const hashes = referencedHashes(withV05Assets())
    expect(hashes.has(`sha256:${'b'.repeat(64)}`), '材质贴图的字节必须进包').toBe(true)
    expect(hashes.has(`sha256:${'c'.repeat(64)}`), '环境贴图的字节必须进包').toBe(true)
  })

  it('仍然不收没人引用的资产', () => {
    // 这条守着上一条的窄度：包大小是发布体验的一部分，全收等于把废弃资产也发出去。
    const doc = withV05Assets()
    const unused = { ...doc, materials: doc.materials.map((m) => ({ ...m, params: { ...m.params, maps: {} } })) }
    expect(referencedHashes(unused).has(`sha256:${'b'.repeat(64)}`)).toBe(false)
  })
})

/* ========================================================================== */
/* T-232 · prefab body 与视点缩略图引用的资产也要进包                          */
/* ========================================================================== */

describe('T-232 · referencedHashes 走到 prefab body 与视点缩略图', () => {
  /**
   * **两条断言必须用同一份文档。**
   *
   * 分成两份的话，「prefab-only 资产进了包」和「无人引用的资产没进包」会互相掩护：
   * 一个把所有资产都收进来的实现在前一条下是绿的，而后一条用的是另一份没有 prefab
   * 的文档，也绿。同一份文档里同时有这两种资产，才分得开。
   */
  function docWithPrefabAssets() {
    const base = createGoldenPathDocument()
    const asset = (id: string, type: string, hash: string) => ({
      ...base.assets[0]!,
      id,
      type: type as (typeof base.assets)[number]['type'],
      name: id,
      hash,
      url: `blob:${id}`,
      lineageId: id,
    })
    return {
      ...base,
      assets: [
        ...base.assets,
        asset('ast_inpfb001', 'model', 'sha256:' + '1'.repeat(64)), // 只被 prefab 的节点引用
        asset('ast_pfbtex01', 'texture', 'sha256:' + '2'.repeat(64)), // 只被 prefab 的材质引用
        asset('ast_thumb001', 'image', 'sha256:' + '3'.repeat(64)), // 只被视点缩略图引用
        asset('ast_orphan01', 'model', 'sha256:' + '4'.repeat(64)), // **谁都不引用** —— 对照组
      ],
      prefabs: [
        {
          id: 'pfb_11111111',
          name: '标准泵组',
          note: '',
          version: 1,
          nodes: [
            {
              ...base.nodes[1]!,
              id: 'nd_inpfb001',
              parent: null,
              assetRef: { assetId: 'ast_inpfb001', objectPath: 'Root', objectName: 'Root', missing: false },
            },
          ],
          materials: [
            {
              ...base.materials[0]!,
              id: 'mat_inpfb01',
              params: { ...base.materials[0]!.params, maps: { ...base.materials[0]!.params.maps, map: 'ast_pfbtex01' } },
            },
          ],
        },
      ],
      viewpoints: base.viewpoints.map((v, i) => (i === 0 ? { ...v, thumbnailAssetId: 'ast_thumb001' } : v)),
    } as unknown as Parameters<typeof referencedHashes>[0]
  }

  it('只被 prefab body 引用的模型与贴图进包；无人引用的仍不进', () => {
    const hashes = referencedHashes(docWithPrefabAssets())
    expect([...hashes], 'prefab 里的模型').toContain('sha256:' + '1'.repeat(64))
    expect([...hashes], 'prefab 材质的贴图').toContain('sha256:' + '2'.repeat(64))
    // 对照组：同一份文档里那个谁都不引用的资产
    expect([...hashes], '无人引用的资产不该被打进包').not.toContain('sha256:' + '4'.repeat(64))
  })

  it('视点缩略图引用的资产也进包', () => {
    // v3 把 thumbnailUrl 换成了 thumbnailAssetId，**没有任何一张卡认领这条入边**。
    // 漏了它，发布出去的包里视点缩略图是空的。
    expect([...referencedHashes(docWithPrefabAssets())]).toContain('sha256:' + '3'.repeat(64))
  })
})
