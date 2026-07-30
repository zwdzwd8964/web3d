import { createGoldenPathDocument } from '@w3/schema'
import type { SceneDocument } from '@w3/schema'
import { buildSamplePumpGlb } from '@w3/core'
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
