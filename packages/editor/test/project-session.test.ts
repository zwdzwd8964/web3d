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
    const doc = await session.materialise(createGoldenPathDocument(), buildSamplePumpGlb)
    const loaded = await session.loader.load(doc.assets[0]!)
    expect(loaded.objects.size).toBeGreaterThan(0)
  })

  it('materialising the sample makes it publishable, which it was not before', async () => {
    const original = createGoldenPathDocument()
    // The fabricated hash from SCHEMA_SPEC §12 names a file that has never existed, so
    // the publish gate refused the default project on every fresh install.
    expect(await storage.hasBlob(original.assets[0]!.hash)).toBe(false)

    const doc = await session.materialise(original, buildSamplePumpGlb)
    expect(await storage.hasBlob(doc.assets[0]!.hash), '样例资产的字节必须真的在存储里').toBe(true)
    expect(doc.assets[0]!.hash).not.toBe(original.assets[0]!.hash)
    expect(doc.assets[0]!.url).toContain(doc.assets[0]!.hash.slice('sha256:'.length, 'sha256:'.length + 4))
  })

  it('replaces the fabricated statistics with measured ones', async () => {
    const original = createGoldenPathDocument()
    const doc = await session.materialise(original, buildSamplePumpGlb)
    // 8.4 MB / 128,400 triangles for a file of a few KB was misinformation in the asset
    // panel either way; measuring it is both honest and free.
    expect(doc.assets[0]!.stats.bytes).toBeLessThan(original.assets[0]!.stats.bytes)
    expect(doc.assets[0]!.stats.tris).toBeGreaterThan(0)
  })

  it('is idempotent — a second boot does not re-store or re-hash', async () => {
    const once = await session.materialise(createGoldenPathDocument(), buildSamplePumpGlb)
    const twice = await session.materialise(once, buildSamplePumpGlb)
    expect(twice).toEqual(once)
  })

  it('**判据不在这一层了** —— 谁该被物化由 BUILTIN_DOCUMENTS 决定（T-283）', async () => {
    // 这个方法原本自带一个 `projectId !== SAMPLE_PROJECT_ID` 的硬编码闸门。第二份内置
    // 文档（泵组样板，另一个 GLB 生成器）一来，那条闸门与写死的 `buildSamplePumpGlb`
    // 都得再挂一条 `||`。判据因此搬进了 `BUILTIN_DOCUMENTS` 表，生成器由调用方传进来。
    //
    // **闸门本身一条都没松**：调用方只对内置文档调它——这一条现在由
    // `project-lifecycle.test.ts` 的「用户工程不物化」看着。这里只钉住这一层的新契约：
    // 传什么生成器就用什么，不再自己判断。
    const other = { ...createGoldenPathDocument(), projectId: 'prj_zzzzzzzz' }
    const out = await session.materialise(other, buildSamplePumpGlb)
    expect(out).not.toBe(other)
    expect(await storage.hasBlob(out.assets[0]!.hash)).toBe(true)
  })

  it('round-trips a document through storage', async () => {
    const doc = createGoldenPathDocument()
    await session.save(doc)
    // T-286 ⑤ · `save` 现在先 `touch`，所以存进去的那份的 `updatedAt` 比手上这份新。
    // **除了它以外一个字节都不该变**——这条断言因此比原来的 `toEqual(doc)` 更紧。
    const stored = await session.load(doc.projectId)
    expect(stored).not.toBeNull()
    // **严格大于**，不是 >=。写成 >= 的话，删掉 `touch()` 这条变异是绿的——
    // 而 `touch` 零调用者正是本卡要修的那件事。
    expect(stored!.meta.updatedAt > doc.meta.updatedAt, `写进去的时间戳要前进：${stored!.meta.updatedAt} vs ${doc.meta.updatedAt}`).toBe(true)
    expect({ ...stored!, meta: { ...stored!.meta, updatedAt: doc.meta.updatedAt } }).toEqual(doc)
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
