import { checkIntegrity, createGoldenPathDocument, errorsOf } from '@w3/schema'
import type { SceneDocument } from '@w3/schema'
import { buildSamplePumpGlb } from '@w3/core'
import { Document, NodeIO } from '@gltf-transform/core'
import { MemoryProvider, hashBytes } from '@w3/storage'
import { produce } from 'immer'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { applyImport, classifyImport, importAsset, importModel, placeInstance, summarizeImport } from '../src/lib/import-flow.js'
import { ProjectSession } from '../src/project/session.js'

/**
 * T-054 / T-066 · the import flow.
 *
 * This path had no tests, and the independent evaluation found two defects in it that a
 * single test would have caught. Both are pinned below.
 */

let glb: ArrayBuffer
let session: ProjectSession
let storage: MemoryProvider

beforeAll(async () => {
  glb = await buildSamplePumpGlb()
})

beforeEach(() => {
  storage = new MemoryProvider()
  session = new ProjectSession({ storage })
})

const runImport = (doc: SceneDocument, name = 'pump-a.glb') =>
  importModel({ file: { name, bytes: glb }, doc, storage, loader: session.loader })

/**
 * A GLB with the given node-path structure and geometry that varies with `seed`.
 *
 * Two knobs on purpose: the PATHS drive which remap tier fires (§5.3 tier 1 is an exact
 * path match, and an unmatched path becomes an orphan), and the seed makes the bytes
 * differ so the content-hash dedup does not short-circuit the re-upload.
 */
async function buildGlbWithPaths(paths: readonly string[], seed: number): Promise<ArrayBuffer> {
  const doc = new Document()
  const buffer = doc.createBuffer()
  const scene = doc.createScene('Scene')
  const byPath = new Map<string, ReturnType<typeof doc.createNode>>()

  for (const path of paths) {
    const segments = path.split('/')
    const name = segments[segments.length - 1]!
    const positions = doc
      .createAccessor()
      .setType('VEC3')
      .setArray(new Float32Array([0, 0, 0, seed, 0, 0, 0, seed, 0]))
      .setBuffer(buffer)
    const primitive = doc.createPrimitive().setAttribute('POSITION', positions)
    const node = doc.createNode(name).setMesh(doc.createMesh(name).addPrimitive(primitive))
    byPath.set(path, node)

    const parent = segments.length > 1 ? byPath.get(segments.slice(0, -1).join('/')) : undefined
    if (parent) parent.addChild(node)
    else scene.addChild(node)
  }

  const bytes = await new NodeIO().writeBinary(doc)
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

const SAMPLE_PATHS = ['Root', 'Root/Pump', 'Root/Pump/Body', 'Root/Pump/ValveCover'] as const

/** The document with the sample asset removed, so only what we import is in play. */
const emptyDoc = (): SceneDocument => ({ ...createGoldenPathDocument(), assets: [], nodes: [] })

describe('first import', () => {
  it('stores the blob, records the asset and instantiates nodes', async () => {
    const doc = emptyDoc()
    const result = await runImport(doc)

    expect(result.deduplicated).toBe(false)
    expect(result.nodes.length).toBeGreaterThan(0)
    expect(await storage.hasBlob(result.hash)).toBe(true)
    expect(result.hash).toBe(await hashBytes(new Uint8Array(glb)))
    expect(summarizeImport(result)).toBe(`新增 ${result.nodes.length} 个对象`)
  })

  it('the nodes it produces reference the asset it recorded', async () => {
    const doc = emptyDoc()
    const result = await runImport(doc)
    const withGeometry = result.nodes.filter((n) => n.assetRef !== null)
    expect(withGeometry.length).toBeGreaterThan(0)
    for (const node of withGeometry) expect(node.assetRef!.assetId).toBe(result.asset.id)
  })
})

describe('P1-2 · importing the same bytes a second time', () => {
  it('reuses the asset record but still places a new instance', async () => {
    let doc = emptyDoc()
    const first = await runImport(doc)
    doc = produce(doc, (draft) => applyImport(draft, first))

    const second = await runImport(doc, 'pump-b.glb')

    // D4 holds: identical bytes are one asset, stored once.
    expect(second.deduplicated).toBe(true)
    expect(second.asset.id).toBe(first.asset.id)
    expect(doc.assets).toHaveLength(1)

    // But dragging the same file in twice must put a second copy in the scene. Returning
    // zero nodes here was read — correctly — as "this tool cannot place more than one
    // object", and it was the user-visible complaint that started this.
    expect(second.nodes).toHaveLength(first.nodes.length)
    expect(summarizeImport(second)).toContain(`新增 ${second.nodes.length} 个对象`)

    const after = produce(doc, (draft) => applyImport(draft, second))
    expect(after.nodes).toHaveLength(first.nodes.length * 2)
    expect(after.assets).toHaveLength(1)
  })

  it('gives the second instance fresh ids, never colliding with the first', async () => {
    let doc = emptyDoc()
    const first = await runImport(doc)
    doc = produce(doc, (draft) => applyImport(draft, first))
    const second = await runImport(doc)

    const firstIds = new Set(first.nodes.map((n) => n.id))
    for (const node of second.nodes) expect(firstIds.has(node.id)).toBe(false)
    expect(new Set(second.nodes.map((n) => n.id)).size).toBe(second.nodes.length)
  })
})

describe('placeInstance', () => {
  it('places another copy of an asset already in the document', async () => {
    let doc = emptyDoc()
    const first = await runImport(doc)
    doc = produce(doc, (draft) => applyImport(draft, first))

    const nodes = await placeInstance({ doc, assetId: first.asset.id, loader: session.loader })
    expect(nodes).toHaveLength(first.nodes.length)

    const existing = new Set(doc.nodes.map((n) => n.id))
    for (const node of nodes) expect(existing.has(node.id)).toBe(false)
  })

  it('refuses an asset the document does not have, by name', async () => {
    await expect(
      placeInstance({ doc: emptyDoc(), assetId: 'ast_zzzzzzzz', loader: session.loader }),
    ).rejects.toThrow(/ast_zzzzzzzz/)
  })
})

describe('applyImport', () => {
  it('is one commit for the whole import, not one per node', async () => {
    const doc = emptyDoc()
    const result = await runImport(doc)
    const next = produce(doc, (draft) => applyImport(draft, result))
    expect(next.assets).toHaveLength(1)
    expect(next.nodes).toHaveLength(result.nodes.length)
  })

  it('replaces rather than duplicates when the asset id is already present', async () => {
    const doc = emptyDoc()
    const result = await runImport(doc)
    const once = produce(doc, (draft) => applyImport(draft, result))
    const twice = produce(once, (draft) => applyImport(draft, { ...result, nodes: [] }))
    expect(twice.assets).toHaveLength(1)
  })
})

describe('§5.3 · 二次上传把已有配置迁到新资产上（G0-6）', () => {
  it('applyImport 真的把重映射结果折进文档，而不只是报告它', async () => {
    let doc = emptyDoc()
    const first = await runImport(doc, 'pump-v1.glb')
    doc = produce(doc, (draft) => applyImport(draft, first))
    const oldAssetId = first.asset.id
    expect(doc.nodes.every((n) => !n.assetRef || n.assetRef.assetId === oldAssetId)).toBe(true)

    // A different FILE with the SAME object paths — a new version of the same model,
    // which is what §5.3's tier 1 (exact path match) is for. Different bytes matter: the
    // content-hash dedup short-circuits an identical re-upload before any remap runs.
    const v2 = await buildGlbWithPaths(SAMPLE_PATHS, 2)
    const second = await importModel({
      file: { name: 'pump-v2.glb', bytes: v2 },
      doc,
      storage,
      loader: session.loader,
      replacesAssetId: oldAssetId,
    })
    expect(second.remap, '替换已有资产必须产出重映射报告').toBeDefined()

    const after = produce(doc, (draft) => applyImport(draft, second))

    // The regression: the report said 「已迁移 N 项」 and every node still pointed at the
    // old asset, because `applyImport` folded in the asset record and nothing else.
    const stillOnOldAsset = after.nodes.filter((n) => n.assetRef?.assetId === oldAssetId)
    expect(stillOnOldAsset, '仍有节点指向旧资产，重映射结果被丢弃了').toEqual([])
    expect(after.nodes.some((n) => n.assetRef?.assetId === second.asset.id)).toBe(true)
  })

  it('同字节重传不触发重映射——那是复用，不是新版本', async () => {
    let doc = emptyDoc()
    const first = await runImport(doc, 'pump-v1.glb')
    doc = produce(doc, (draft) => applyImport(draft, first))

    const same = await importModel({
      file: { name: 'pump-again.glb', bytes: glb },
      doc,
      storage,
      loader: session.loader,
      replacesAssetId: first.asset.id,
    })
    // Identical bytes are the same asset (D4); there is nothing to migrate to.
    expect(same.remap).toBeUndefined()
    expect(same.asset.id).toBe(first.asset.id)
  })

  it('D5 · 新资产里不存在的对象被标记为失效，而不是删除节点', async () => {
    let doc = emptyDoc()
    const first = await runImport(doc, 'pump-v1.glb')
    doc = produce(doc, (draft) => applyImport(draft, first))
    const nodeCount = doc.nodes.length

    // A GLB whose object names share nothing with the first — every ref becomes an orphan.
    const unrelated = await buildGlbWithPaths(['Widget', 'Widget/Gear'], 3)
    const second = await importModel({
      file: { name: 'unrelated.glb', bytes: unrelated },
      doc,
      storage,
      loader: session.loader,
      replacesAssetId: first.asset.id,
    })
    const after = produce(doc, (draft) => applyImport(draft, second))

    // 「标记，永不删除」: the count is unchanged and the broken ones are flagged.
    expect(after.nodes).toHaveLength(nodeCount)
    expect(after.nodes.some((n) => n.assetRef?.missing === true)).toBe(true)
  })
})

/**
 * T-150 · importing a texture or an environment map.
 *
 * The model path and the image path share the half that must never diverge — hash, dedup,
 * storage, asset record — and nothing else. These tests are mostly about the second half:
 * an image produces no nodes, is not parsed as geometry, and is graded against its own
 * metric set.
 */
describe('T-150 · image and environment imports', () => {
  /** A real PNG, so the header reader has something genuine to read. */
  function png(width: number, height: number): ArrayBuffer {
    const crcTable = Array.from({ length: 256 }, (_, n) => {
      let c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      return c >>> 0
    })
    const crc = (bytes: Uint8Array) => {
      let c = 0xffffffff
      for (const byte of bytes) c = crcTable[(c ^ byte) & 0xff]! ^ (c >>> 8)
      return (c ^ 0xffffffff) >>> 0
    }
    const chunk = (type: string, data: Uint8Array) => {
      const out = new Uint8Array(12 + data.length)
      const view = new DataView(out.buffer)
      view.setUint32(0, data.length)
      for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i)
      out.set(data, 8)
      view.setUint32(8 + data.length, crc(out.subarray(4, 8 + data.length)))
      return out
    }
    const ihdr = new Uint8Array(13)
    const ihdrView = new DataView(ihdr.buffer)
    ihdrView.setUint32(0, width)
    ihdrView.setUint32(4, height)
    ihdr[8] = 8
    ihdr[9] = 6
    // A stored (uncompressed) zlib stream: 0x78 0x01, then one final raw block.
    const raw = new Uint8Array(height * (1 + width * 4))
    const idat = new Uint8Array(2 + 5 + raw.length + 4)
    idat.set([0x78, 0x01, 0x01, raw.length & 0xff, (raw.length >> 8) & 0xff, ~raw.length & 0xff, (~raw.length >> 8) & 0xff])
    idat.set(raw, 7)
    const parts = [
      new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', ihdr),
      chunk('IDAT', idat),
      chunk('IEND', new Uint8Array(0)),
    ]
    const total = parts.reduce((n, p) => n + p.length, 0)
    const out = new Uint8Array(total)
    let at = 0
    for (const part of parts) {
      out.set(part, at)
      at += part.length
    }
    return out.buffer
  }

  const hdr = (width: number, height: number): ArrayBuffer => {
    const header = new TextEncoder().encode(`#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y ${height} +X ${width}\n`)
    const out = new Uint8Array(header.length + width * height * 4)
    out.set(header, 0)
    out.fill(0x40, header.length)
    return out.buffer
  }

  const importFile = (doc: SceneDocument, name: string, bytes: ArrayBuffer) =>
    importAsset({ file: { name, bytes }, doc, storage, loader: session.loader })

  it('classifies by extension, and refuses what it does not know', () => {
    expect(classifyImport('pump.glb')).toBe('model')
    expect(classifyImport('WARNING.PNG')).toBe('texture')
    expect(classifyImport('sky.hdr')).toBe('hdri')
    expect(classifyImport('notes.txt')).toBeNull()
  })

  it('imports a png as a texture asset with no nodes', () => {
    return importFile(createGoldenPathDocument(), 'warning.png', png(512, 512)).then((result) => {
      expect(result.asset.type).toBe('texture')
      expect(result.asset.name).toBe('warning.png')
      // An image is pointed AT by a material, never placed. Instantiating one would put an
      // empty node in the tree that the user then has to work out how to delete.
      expect(result.nodes).toEqual([])
      expect(result.asset.url.endsWith('.png')).toBe(true)
      expect(result.asset.stats.textures).toBe(1)
      expect(result.asset.stats.tris).toBe(0)
    })
  })

  it('imports an .hdr as an hdri asset, which I12 then accepts as an environment', async () => {
    const result = await importFile(createGoldenPathDocument(), 'sky.hdr', hdr(64, 32))
    expect(result.asset.type).toBe('hdri')
    expect(result.asset.url.endsWith('.hdr')).toBe(true)

    // The point of the type: `meta.environment.hdriAssetId` only accepts an hdri (I12), so
    // an import that produced `texture` here would fail integrity at publish time.
    const doc = produce(createGoldenPathDocument(), (draft) => {
      applyImport(draft, result)
      draft.meta.environment.hdriAssetId = result.asset.id
    })
    expect(errorsOf(checkIntegrity(doc))).toEqual([])
  })

  it('grades a texture against image metrics, not model metrics', async () => {
    const result = await importFile(createGoldenPathDocument(), 'noise.png', png(1000, 1000))
    const metrics = result.audit.audit.findings.map((f) => f.metric).sort()
    expect(metrics).toEqual(['imageBytes', 'imageSize', 'nonPowerOfTwo'])
    // 1000 is not a power of two → a warning, and specifically not a failure.
    expect(result.audit.verdict).toBe('warn')
  })

  it('gives an oversized texture advice with the numbers in it', async () => {
    const result = await importFile(createGoldenPathDocument(), 'huge.png', png(4096, 4096))
    const size = result.audit.audit.findings.find((f) => f.metric === 'imageSize')!
    expect(size.level).toBe('fail')
    expect(size.advice).toMatch(/4,096.*2,048/)
  })

  it('reuses the blob and the record when the same image is imported twice', async () => {
    // D4 · identical bytes are the same asset, whatever the file is called. The second
    // import must not double the stored bytes and must not add a second record.
    const bytes = png(256, 256)
    const first = await importFile(createGoldenPathDocument(), 'a.png', bytes)
    const doc = produce(createGoldenPathDocument(), (draft) => applyImport(draft, first))

    const second = await importFile(doc, 'a-copy.png', bytes)
    expect(second.deduplicated).toBe(true)
    expect(second.asset.id).toBe(first.asset.id)
    expect(second.asset.name, '复用的是已有记录，名字不会被第二次上传改掉').toBe('a.png')

    const after = produce(doc, (draft) => applyImport(draft, second))
    expect(after.assets.filter((a) => a.hash === first.hash)).toHaveLength(1)
    expect(await storage.hasBlob(first.hash)).toBe(true)
  })

  it('a png is its own thumbnail; an .hdr has none', async () => {
    // An `<img>` renders a png directly, so a second downscaled blob would be bytes spent
    // on a picture the browser already has. No browser can display an `.hdr` without
    // tone-mapping it, so it gets nothing rather than a broken image.
    const texture = await importFile(createGoldenPathDocument(), 'a.png', png(64, 64))
    expect(texture.asset.thumbnailUrl).toBe(texture.asset.url)
    const sky = await importFile(createGoldenPathDocument(), 'sky.hdr', hdr(32, 16))
    expect(sky.asset.thumbnailUrl).toBeUndefined()
  })

  it('summarises an image import without claiming it added objects', async () => {
    // 「新增 0 个对象」 on a successful texture import reads as a failure.
    const result = await importFile(createGoldenPathDocument(), 'a.png', png(64, 64))
    expect(summarizeImport(result)).not.toContain('0 个对象')
    expect(summarizeImport(result)).toContain('纹理')
  })

  it('refuses an unsupported extension by name, listing what it does take', async () => {
    await expect(
      importAsset({ file: { name: 'notes.txt', bytes: png(8, 8) }, doc: createGoldenPathDocument(), storage, loader: session.loader }),
    ).rejects.toThrow(/不支持的文件类型/)
  })

  it('refuses bytes whose header does not match the extension', async () => {
    // The extension states intent; the header check is what catches a mismatch. Without it
    // a renamed file would be recorded as a texture with dimensions read from nothing.
    await expect(
      importAsset({
        file: { name: 'fake.png', bytes: new TextEncoder().encode('definitely not a png at all, really not').buffer as ArrayBuffer },
        doc: createGoldenPathDocument(),
        storage,
        loader: session.loader,
      }),
    ).rejects.toThrow(/无法识别的图片格式/)
  })
})
