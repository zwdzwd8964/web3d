import { createGoldenPathDocument } from '@w3/schema'
import { buildSamplePumpGlb } from '@w3/core'
import { MemoryProvider, hashBytes, hashToPath } from '@w3/storage'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AutoSaver } from '../src/project/autosave.js'
import { ProjectSession } from '../src/project/session.js'

/**
 * P0-1 / P0-2 · the two wires that were never connected.
 *
 * The evaluation report's finding was that importing a GLB grew the tree, the asset list
 * and the object count while the viewport stayed empty — the bytes went into the asset
 * panel's loader and the renderer read from the viewport's. The check that matters is not
 * "does the loader work" but "does the loader the RENDERER uses have the bytes the
 * IMPORTER wrote", so that is what these assert.
 */

let session: ProjectSession
let storage: MemoryProvider

beforeEach(() => {
  storage = new MemoryProvider()
  session = new ProjectSession({ storage })
})

describe('ProjectSession · one owner of asset bytes', () => {
  it('resolves a content-addressed url straight out of storage', async () => {
    const bytes = await buildSamplePumpGlb()
    const hash = await hashBytes(new Uint8Array(bytes))
    await storage.putBlob(new Uint8Array(bytes))

    const resolved = await session.resolver.resolve(hashToPath(hash, '.glb'))
    expect(resolved.byteLength).toBe(bytes.byteLength)
  })

  it('the loader and the resolver are the same wire — bytes written by the importer are visible to the renderer', async () => {
    const bytes = await buildSamplePumpGlb()
    const hash = await hashBytes(new Uint8Array(bytes))
    await storage.putBlob(new Uint8Array(bytes))

    const asset = {
      ...createGoldenPathDocument().assets[0]!,
      hash,
      url: hashToPath(hash, '.glb'),
    }
    const loaded = await session.loader.load(asset)
    // The golden path document addresses these exact paths; if the loader could not see
    // the bytes the scene would be all placeholders, which is the bug being pinned here.
    expect([...loaded.objects.keys()]).toContain('Root/Pump/ValveCover')
  })

  it('says which url it could not resolve instead of failing silently', async () => {
    await expect(session.resolver.resolve('nonsense.glb')).rejects.toThrow(/无法解析资产地址/)
    await expect(session.resolver.resolve(hashToPath(`sha256:${'0'.repeat(64)}`, '.glb'))).rejects.toThrow(
      /存储中找不到/,
    )
  })

  it('seeds the sample document so a cold start is never an empty viewport', async () => {
    const doc = createGoldenPathDocument()
    await session.seedSampleAsset(doc)
    const loaded = await session.loader.load(doc.assets[0]!)
    expect(loaded.objects.size).toBeGreaterThan(0)
  })

  it('round-trips a document through storage', async () => {
    const doc = createGoldenPathDocument()
    await session.save(doc)
    expect(await session.load(doc.projectId)).toEqual(doc)
  })
})

describe('AutoSaver', () => {
  const doc = createGoldenPathDocument()

  it('coalesces a burst of edits into one write', async () => {
    vi.useFakeTimers()
    const save = vi.fn(async () => {})
    const saver = new AutoSaver({ save, delayMs: 50 })
    for (let i = 0; i < 60; i++) saver.schedule(doc)
    await vi.advanceTimersByTimeAsync(60)
    expect(save).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })

  it('re-saves when the document changes mid-write, and claims 已保存 only once — for the newer one', async () => {
    const states: string[] = []
    const written: string[] = []
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const saver = new AutoSaver({
      save: async (d) => {
        written.push(d.name)
        if (written.length === 1) await gate
      },
      delayMs: 0,
      onStateChange: (state) => states.push(state),
    })

    saver.schedule(doc)
    const first = saver.flush()
    saver.schedule({ ...doc, name: '改过了' })
    release()
    await first

    // The stale write must not be reported as success, and the newer one must actually
    // happen — otherwise the last edit before a tab close is silently dropped.
    expect(written).toEqual([doc.name, '改过了'])
    expect(states.filter((s) => s === 'saved')).toHaveLength(1)
    expect(states.at(-1)).toBe('saved')
  })

  it('reports the failure rather than swallowing it', async () => {
    const states: [string, string | undefined][] = []
    const saver = new AutoSaver({
      save: async () => {
        throw new Error('配额已满')
      },
      delayMs: 0,
      onStateChange: (state, error) => states.push([state, error]),
    })
    saver.schedule(doc)
    await saver.flush()
    expect(states.at(-1)).toEqual(['error', '配额已满'])
  })

  it('stops writing after dispose', async () => {
    vi.useFakeTimers()
    const save = vi.fn(async () => {})
    const saver = new AutoSaver({ save, delayMs: 50 })
    saver.schedule(doc)
    saver.dispose()
    await vi.advanceTimersByTimeAsync(200)
    expect(save).not.toHaveBeenCalled()
    vi.useRealTimers()
  })
})
