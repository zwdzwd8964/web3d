import { createGoldenPathDocument } from '@w3/schema'
import type { SceneDocument } from '@w3/schema'
import { buildSamplePumpGlb } from '@w3/core'
import { Document, NodeIO } from '@gltf-transform/core'
import { MemoryProvider, hashBytes } from '@w3/storage'
import { produce } from 'immer'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { applyImport, importModel, placeInstance, summarizeImport } from '../src/lib/import-flow.js'
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
