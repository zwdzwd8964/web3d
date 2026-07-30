import { createGoldenPathDocument } from '@w3/schema'
import type { SceneDocument } from '@w3/schema'
import { expect, it } from 'vitest'
import { hashBytes } from '../src/hash.js'
import type { Snapshot, StorageProvider } from '../src/provider.js'

/**
 * T-022 · the shared StorageProvider contract.
 *
 * Every provider runs this exact suite. That is the mechanism that keeps v1's
 * HttpApiProvider a drop-in: if it passes here, nothing above it has to change. And it
 * is what stops MemoryProvider from quietly becoming the only implementation that
 * actually behaves the way the editor expects.
 */

const bytesOf = (text: string) => new TextEncoder().encode(text)

function docNamed(name: string, projectId: string, updatedAt: string): SceneDocument {
  const doc = createGoldenPathDocument()
  return { ...doc, projectId, name, meta: { ...doc.meta, updatedAt } }
}

export function describeProviderContract(label: string, makeProvider: () => Promise<StorageProvider> | StorageProvider) {
  const withProvider = async (body: (p: StorageProvider) => Promise<void>) => {
    const provider = await makeProvider()
    try {
      await body(provider)
    } finally {
      await provider.close()
    }
  }

  it(`${label}: starts empty`, async () => {
    await withProvider(async (p) => {
      expect(await p.listProjects()).toEqual([])
      expect(await p.loadDocument('prj_a1b2c3d4')).toBeNull()
    })
  })

  it(`${label}: round-trips a document unchanged`, async () => {
    await withProvider(async (p) => {
      const doc = createGoldenPathDocument()
      await p.saveDocument(doc)
      expect(await p.loadDocument(doc.projectId)).toEqual(doc)
    })
  })

  it(`${label}: saving twice updates rather than duplicates`, async () => {
    await withProvider(async (p) => {
      const doc = createGoldenPathDocument()
      await p.saveDocument(doc)
      await p.saveDocument({ ...doc, name: '改名后的项目' })
      expect(await p.listProjects()).toHaveLength(1)
      expect((await p.loadDocument(doc.projectId))?.name).toBe('改名后的项目')
    })
  })

  it(`${label}: does not alias its stored copy with the caller's object`, async () => {
    await withProvider(async (p) => {
      const doc = createGoldenPathDocument()
      await p.saveDocument(doc)
      doc.nodes[0]!.name = '被外部改掉了'
      expect((await p.loadDocument(doc.projectId))?.nodes[0]?.name).toBe('泵组')

      const loaded = (await p.loadDocument(doc.projectId))!
      loaded.nodes[0]!.name = '也不该影响存储'
      expect((await p.loadDocument(doc.projectId))?.nodes[0]?.name).toBe('泵组')
    })
  })

  it(`${label}: lists projects newest first`, async () => {
    await withProvider(async (p) => {
      await p.saveDocument(docNamed('旧', 'prj_00000001', '2026-01-01T00:00:00.000Z'))
      await p.saveDocument(docNamed('新', 'prj_00000002', '2026-06-01T00:00:00.000Z'))
      expect((await p.listProjects()).map((s) => s.name)).toEqual(['新', '旧'])
    })
  })

  it(`${label}: deleting a project removes its document and its snapshots`, async () => {
    await withProvider(async (p) => {
      const doc = createGoldenPathDocument()
      await p.saveDocument(doc)
      await p.saveSnapshot(snapshotOf(doc, 'snp_a1b2c3d4'))
      await p.deleteProject(doc.projectId)
      expect(await p.loadDocument(doc.projectId)).toBeNull()
      expect(await p.listProjects()).toEqual([])
      expect(await p.listSnapshots(doc.projectId)).toEqual([])
      expect(await p.loadSnapshot('snp_a1b2c3d4')).toBeNull()
    })
  })

  it(`${label}: stores blobs by content address`, async () => {
    await withProvider(async (p) => {
      const bytes = bytesOf('GLB payload')
      const hash = await p.putBlob(bytes)
      expect(hash).toBe(await hashBytes(bytes))
      expect(await p.hasBlob(hash)).toBe(true)
      expect(await p.getBlob(hash)).toEqual(bytes)
    })
  })

  it(`${label}: D4 · re-uploading identical bytes is a no-op, not a duplicate`, async () => {
    await withProvider(async (p) => {
      const bytes = bytesOf('same file')
      expect(await p.putBlob(bytes)).toBe(await p.putBlob(bytes.slice()))
    })
  })

  it(`${label}: different bytes get different addresses`, async () => {
    await withProvider(async (p) => {
      expect(await p.putBlob(bytesOf('a'))).not.toBe(await p.putBlob(bytesOf('b')))
    })
  })

  it(`${label}: reports a missing blob as null rather than throwing`, async () => {
    await withProvider(async (p) => {
      const absent = `sha256:${'0'.repeat(64)}`
      expect(await p.hasBlob(absent)).toBe(false)
      expect(await p.getBlob(absent)).toBeNull()
    })
  })

  it(`${label}: does not alias stored blob bytes`, async () => {
    await withProvider(async (p) => {
      const bytes = bytesOf('mutable')
      const hash = await p.putBlob(bytes)
      bytes[0] = 0
      const stored = (await p.getBlob(hash))!
      expect(stored[0]).toBe(bytesOf('mutable')[0])
      stored[0] = 0
      expect((await p.getBlob(hash))![0]).toBe(bytesOf('mutable')[0])
    })
  })

  it(`${label}: handles a blob larger than a typical structured-clone chunk`, async () => {
    await withProvider(async (p) => {
      const big = new Uint8Array(4 * 1024 * 1024)
      for (let i = 0; i < big.length; i += 4096) big[i] = i % 251
      const hash = await p.putBlob(big)
      const back = await p.getBlob(hash)
      expect(back?.byteLength).toBe(big.byteLength)
      expect(back?.[4096]).toBe(big[4096])
    })
  })

  it(`${label}: round-trips snapshots and scopes them to their project`, async () => {
    await withProvider(async (p) => {
      const doc = createGoldenPathDocument()
      const other = docNamed('别的项目', 'prj_00000009', '2026-02-02T00:00:00.000Z')
      await p.saveSnapshot(snapshotOf(doc, 'snp_00000001', '2026-05-01T00:00:00.000Z'))
      await p.saveSnapshot(snapshotOf(doc, 'snp_00000002', '2026-06-01T00:00:00.000Z'))
      await p.saveSnapshot(snapshotOf(other, 'snp_00000003'))

      const list = await p.listSnapshots(doc.projectId)
      expect(list.map((s) => s.snapshotId)).toEqual(['snp_00000002', 'snp_00000001'])
      expect((await p.loadSnapshot('snp_00000001'))?.document).toEqual(doc)
      expect(await p.loadSnapshot('snp_99999999')).toBeNull()
    })
  })

  it(`${label}: close() is idempotent`, async () => {
    const provider = await makeProvider()
    await provider.close()
    await expect(provider.close()).resolves.toBeUndefined()
  })
}

function snapshotOf(document: SceneDocument, snapshotId: string, publishedAt = '2026-05-01T00:00:00.000Z'): Snapshot {
  return {
    meta: {
      snapshotId,
      projectId: document.projectId,
      publishedAt,
      schemaVersion: document.schemaVersion,
      coreVersion: '0.0.0',
      assetCount: document.assets.length,
    },
    document,
  }
}
