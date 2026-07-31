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

  it('materialises the sample so a cold start is never an empty viewport', async () => {
    const doc = await session.materialiseSample(createGoldenPathDocument())
    const loaded = await session.loader.load(doc.assets[0]!)
    expect(loaded.objects.size).toBeGreaterThan(0)
  })

  it('materialising the sample makes it publishable, which it was not before', async () => {
    const original = createGoldenPathDocument()
    // The fabricated hash from SCHEMA_SPEC §12 names a file that has never existed, so
    // the publish gate refused the default project on every fresh install.
    expect(await storage.hasBlob(original.assets[0]!.hash)).toBe(false)

    const doc = await session.materialiseSample(original)
    expect(await storage.hasBlob(doc.assets[0]!.hash), '样例资产的字节必须真的在存储里').toBe(true)
    expect(doc.assets[0]!.hash).not.toBe(original.assets[0]!.hash)
    expect(doc.assets[0]!.url).toContain(doc.assets[0]!.hash.slice('sha256:'.length, 'sha256:'.length + 4))
  })

  it('replaces the fabricated statistics with measured ones', async () => {
    const original = createGoldenPathDocument()
    const doc = await session.materialiseSample(original)
    // 8.4 MB / 128,400 triangles for a file of a few KB was misinformation in the asset
    // panel either way; measuring it is both honest and free.
    expect(doc.assets[0]!.stats.bytes).toBeLessThan(original.assets[0]!.stats.bytes)
    expect(doc.assets[0]!.stats.tris).toBeGreaterThan(0)
  })

  it('is idempotent — a second boot does not re-store or re-hash', async () => {
    const once = await session.materialiseSample(createGoldenPathDocument())
    const twice = await session.materialiseSample(once)
    expect(twice).toEqual(once)
  })

  it('leaves a non-sample project alone', async () => {
    const other = { ...createGoldenPathDocument(), projectId: 'prj_zzzzzzzz' }
    expect(await session.materialiseSample(other)).toBe(other)
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

describe('AutoSaver lifetime, as React StrictMode exercises it', () => {
  it('keeps working after a subscribe/unsubscribe/subscribe cycle', async () => {
    const doc = createGoldenPathDocument()
    const save = vi.fn(async () => {})
    const saver = new AutoSaver({ save, delayMs: 0 })

    // StrictMode mounts the effect, tears it down, and mounts it again against the SAME
    // memoised saver. Disposing on teardown killed autosave for the whole session — the
    // indicator stayed at idle and nothing was ever written.
    await saver.flush() // what the teardown does now
    saver.schedule(doc)
    await saver.flush()

    expect(save).toHaveBeenCalledTimes(1)
  })

  it('dispose is still final, for a real teardown', async () => {
    const save = vi.fn(async () => {})
    const saver = new AutoSaver({ save, delayMs: 0 })
    saver.dispose()
    saver.schedule(createGoldenPathDocument())
    await saver.flush()
    expect(save).not.toHaveBeenCalled()
  })
})
