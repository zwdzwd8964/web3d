import { createGoldenPathDocument } from '@w3/schema'
import type { SceneDocument } from '@w3/schema'
import { expect, it } from 'vitest'
import { hashBytes } from '../src/hash.js'
import { FACET_NAMES, LEASE_STALE_MS, StorageError } from '../src/provider.js'
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

/** Per-provider hooks for the parts of the contract only that provider can set up. */
export interface ProviderContractOptions {
  /**
   * Builds a provider that will reject the NEXT blob write with `quota-exceeded`.
   *
   * Running out of space is the one storage failure a user can act on, and it is the one
   * this product hits first — but only `IndexedDbProvider` can produce it naturally, and a
   * Map never can. Without this hook the promise could only be asserted on one side, which
   * is how two implementations of one interface end up meaning different things by the same
   * error. `done()` undoes whatever the factory did to arrange it.
   */
  readonly makeFull?: () => Promise<{ provider: StorageProvider; done: () => void }>
}

export function describeProviderContract(
  label: string,
  makeProvider: () => Promise<StorageProvider> | StorageProvider,
  options: ProviderContractOptions = {},
) {
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

  /**
   * T-202 · a 64 MB asset survives the round trip byte for byte.
   *
   * The size is the point: one 4K PBR texture set or a short video lands here, and this is
   * the first test in the repository that stores anything above a few kilobytes. Structured
   * cloning, `slice()`, and IndexedDB's own value serialisation all get exercised at a size
   * where a copy that quietly truncates or re-allocates actually shows up.
   *
   * Verified through the content hash, not through `toHaveLength`. That is deliberate:
   * `toHaveLength` is also satisfied by 64 MB of zeroes, which is precisely the failure a
   * broken copy produces.
   */
  it(`${label}: round-trips a 64 MB blob byte for byte`, async () => {
    await withProvider(async (p) => {
      const bytes = patternedBytes(64 * 1024 * 1024)
      const hash = await p.putBlob(bytes)
      const got = await p.getBlob(hash)

      expect(got).not.toBeUndefined()
      expect(got?.byteLength).toBe(bytes.byteLength)
      // Bit equality. A hash mismatch is the only thing that distinguishes "the same bytes"
      // from "the right number of bytes".
      expect(await hashBytes(got!)).toBe(hash)
      // Both ends of the buffer, so a truncation that happens to hash-collide is still caught
      // by something a human can read in the failure output.
      expect(got![0]).toBe(bytes[0])
      expect(got![bytes.byteLength - 1]).toBe(bytes[bytes.byteLength - 1])
    })
  })

  if (options.makeFull) {
    const makeFull = options.makeFull
    it(`${label}: reports a full store as quota-exceeded, in Chinese`, async () => {
      const { provider, done } = await makeFull()
      try {
        const error = await provider.putBlob(patternedBytes(4096)).then(
          () => null,
          (cause: unknown) => cause,
        )
        expect(error).toBeInstanceOf(StorageError)
        expect((error as StorageError).code).toBe('quota-exceeded')
        // Asserted to the wording, not to "it threw". Two guards reporting the same failure
        // with different messages is how one of them silently stops mattering (E18 教训 1).
        expect((error as StorageError).message).toContain('存储空间不足')
      } finally {
        done()
        await provider.close()
      }
    })
  }

  /* --- T-286 · provider v2 ------------------------------------------------ */

  /**
   * facet 的声明与实际挂着的东西必须一致。
   *
   * **这一条是显式声明机制存在的全部理由。** 探测式（`'locks' in provider.ext`）看起来
   * 更省事，代价是「悄悄长出一个 facet」抓不到：有人给 `MemoryProvider` 挂一个空的
   * `locks` 只为让某个调用点编译过，探测式的套件当场开始跑 locks 子套件，而那些用例
   * 会以某种方式绿。
   *
   * 卡面把这条写成了验收：给 `MemoryProvider` 挂一个空的 `locks` 但不改 `facets`，
   * 契约套件**必须 fail**。
   */
  it(`${label} · 声明的 facet 与实际挂着的一致`, async () => {
    await withProvider(async (provider) => {
      const declared = [...provider.facets].sort()
      const attached = FACET_NAMES.filter((name) => provider.ext[name] !== undefined).sort()
      expect(attached, `声明了 ${declared.join(',') || '（无）'}，实际挂着 ${attached.join(',') || '（无）'}`).toEqual(
        declared,
      )
    })
  })

  it(`${label} · 声明的 facet 名字都在闭集里`, async () => {
    await withProvider(async (provider) => {
      const unknown = provider.facets.filter((name) => !FACET_NAMES.includes(name))
      expect(unknown, `这些不是合法的 facet 名：${unknown.join(', ')}`).toEqual([])
    })
  })

  /**
   * `readDocument` 与 `loadDocument` 看到的是同一份文档，而且**都是副本**。
   *
   * 返回内部对象本身的实现，会让调用方一次无心的 mutate 改掉库里的东西——而症状是
   * 「我什么都没保存，它自己变了」。
   */
  it(`${label} · readDocument 与 loadDocument 一致，且都返回副本`, async () => {
    await withProvider(async (provider) => {
      const doc = docNamed('修订', 'prj_rev00001', '2026-08-11T00:00:00.000Z')
      await provider.saveDocument(doc)

      const record = await provider.readDocument(doc.projectId)
      expect(record).not.toBeNull()
      expect(record!.document).toEqual(await provider.loadDocument(doc.projectId))
      expect(record!.rev.length).toBeGreaterThan(0)

      // 拿到手就改，再读一次——库里那份不该跟着变。
      ;(record!.document as { name: string }).name = '被改过了'
      expect((await provider.loadDocument(doc.projectId))!.name).toBe('修订')
    })
  })

  it(`${label} · readDocument 对不存在的工程返回 null`, async () => {
    await withProvider(async (provider) => {
      expect(await provider.readDocument('prj_nothere1')).toBeNull()
    })
  })

  /**
   * 乐观并发：**不给 `expectedRev` 就是无条件覆盖**（v1.0 之前的行为，逐字不变）；
   * 给了就必须匹配，不匹配抛 `conflict` 而**不是覆盖**。
   */
  it(`${label} · 不给 expectedRev 时无条件覆盖`, async () => {
    await withProvider(async (provider) => {
      const doc = docNamed('原名', 'prj_ovr00001', '2026-08-11T00:00:00.000Z')
      await provider.saveDocument(doc)
      await provider.saveDocument({ ...doc, name: '新名' })
      expect((await provider.loadDocument(doc.projectId))!.name).toBe('新名')
    })
  })

  it(`${label} · expectedRev 对得上就放行，对不上抛 conflict 且**不覆盖**`, async () => {
    await withProvider(async (provider) => {
      const doc = docNamed('原名', 'prj_cfl00001', '2026-08-11T00:00:00.000Z')
      const first = await provider.saveDocument(doc)

      // 对得上：放行。
      const second = await provider.saveDocument(
        { ...doc, name: '第二版', meta: { ...doc.meta, updatedAt: '2026-08-11T00:00:01.000Z' } },
        { expectedRev: first.rev },
      )
      expect((await provider.loadDocument(doc.projectId))!.name).toBe('第二版')

      // 对不上：抛 conflict。**而且库里那份一个字都不该变**——只断言「抛了」的话，
      // 一个「先写再抛」的实现照样绿，而它已经把别人的改动盖掉了。
      await expect(
        provider.saveDocument({ ...doc, name: '不该落地' }, { expectedRev: 'r-not-a-real-rev' }),
      ).rejects.toMatchObject({ code: 'conflict' })
      expect((await provider.loadDocument(doc.projectId))!.name).toBe('第二版')
      expect(second.rev).not.toBe(first.rev)
    })
  })

  it(`${label} · putBlob 的 hash 对不上时抛 corrupt，不落盘`, async () => {
    await withProvider(async (provider) => {
      const bytes = bytesOf('T-286 · 调用方算错了地址')
      const wrong = `sha256:${'0'.repeat(64)}`
      await expect(provider.putBlob(bytes, { hash: wrong })).rejects.toMatchObject({ code: 'corrupt' })
      expect(await provider.hasBlob(wrong)).toBe(false)
    })
  })

  it(`${label} · putBlob 的 hash 对得上时与不给它逐字等价`, async () => {
    await withProvider(async (provider) => {
      const bytes = bytesOf('T-286 · 调用方算对了地址')
      const hash = await hashBytes(bytes)
      expect(await provider.putBlob(bytes, { hash })).toBe(hash)
      expect(await provider.hasBlob(hash)).toBe(true)
    })
  })

  /* --- T-287 · drafts facet ----------------------------------------------- */

  /**
   * 两个实现都必须真的声明并挂上 `drafts`。
   *
   * 这条看着像重复了「声明与实际一致」那条，其实不是：那条只保证两边**互相**对得上，
   * 一个两边都是空的实现照样绿。T-287 之后 drafts 有真实实现了，**这里断的是它在**。
   */
  it(`${label} · 声明并挂上了 drafts facet`, async () => {
    await withProvider(async (provider) => {
      expect(provider.facets).toContain('drafts')
      expect(provider.ext.drafts).toBeDefined()
    })
  })

  /**
   * 草稿三方法。
   *
   * ⚠ **前置断言断的是形状，不是「不是 null」。** 一个 `loadDraft` 返回 `undefined` 的
   * 实现，会让 `expect(draft).not.toBeNull()` 绿——而清除之后那条 `toBeNull()` 会红，
   * 于是红灯出现在**清除**上，真正坏掉的却是**读取**。卡面点名了这个假绿。
   */
  it(`${label} · 草稿：写 → 读回同一份 → 清掉之后是 null`, async () => {
    await withProvider(async (provider) => {
      const drafts = provider.ext.drafts
      expect(drafts).toBeDefined()
      if (!drafts) return

      expect(await drafts.loadDraft('prj_dft00001')).toBeNull()

      const document = docNamed('草稿里的名字', 'prj_dft00001', '2026-08-11T00:00:00.000Z')
      await drafts.saveDraft({
        projectId: 'prj_dft00001',
        document,
        edits: 7,
        savedAt: '2026-08-11T00:00:03.000Z',
        sessionId: 'ses_a',
      })

      const loaded = await drafts.loadDraft('prj_dft00001')
      expect(loaded).toMatchObject({ projectId: 'prj_dft00001', edits: 7, sessionId: 'ses_a' })
      expect(loaded?.document.name).toBe('草稿里的名字')

      await drafts.clearDraft('prj_dft00001')
      expect(await drafts.loadDraft('prj_dft00001')).toBeNull()
    })
  })

  it(`${label} · 草稿：再写一次是覆盖，不是并存`, async () => {
    await withProvider(async (provider) => {
      const drafts = provider.ext.drafts
      if (!drafts) throw new Error('drafts facet 缺失')
      const base = {
        projectId: 'prj_dft00002',
        document: docNamed('第一版', 'prj_dft00002', '2026-08-11T00:00:00.000Z'),
        savedAt: '2026-08-11T00:00:01.000Z',
        sessionId: 'ses_a',
      }
      await drafts.saveDraft({ ...base, edits: 1 })
      await drafts.saveDraft({ ...base, edits: 4, document: docNamed('第二版', 'prj_dft00002', '2026-08-11T00:00:02.000Z') })
      const loaded = await drafts.loadDraft('prj_dft00002')
      expect(loaded?.edits).toBe(4)
      expect(loaded?.document.name).toBe('第二版')
    })
  })

  it(`${label} · 草稿是按工程分槽的，清一个不影响另一个`, async () => {
    await withProvider(async (provider) => {
      const drafts = provider.ext.drafts
      if (!drafts) throw new Error('drafts facet 缺失')
      for (const id of ['prj_dft00003', 'prj_dft00004']) {
        await drafts.saveDraft({
          projectId: id,
          document: docNamed(id, id, '2026-08-11T00:00:00.000Z'),
          edits: 2,
          savedAt: '2026-08-11T00:00:01.000Z',
          sessionId: 'ses_a',
        })
      }
      await drafts.clearDraft('prj_dft00003')
      expect(await drafts.loadDraft('prj_dft00003')).toBeNull()
      expect(await drafts.loadDraft('prj_dft00004')).toMatchObject({ projectId: 'prj_dft00004' })
    })
  })

  /**
   * 租约四条，一条一个判定。
   *
   * 时间全部注入（`nowMs`）——存储层里出现 `Date.now()` 会让这四条变成靠 sleep 的测试。
   */
  it(`${label} · 租约：没人占时拿得到，previous 是 closed`, async () => {
    await withProvider(async (provider) => {
      const drafts = provider.ext.drafts
      if (!drafts) throw new Error('drafts facet 缺失')
      const got = await drafts.acquireLease('prj_lse00001', { sessionId: 'ses_a', nowMs: 1_000 })
      expect(got).toMatchObject({ ok: true, previous: 'closed' })
      expect(got.ok && got.lease).toMatchObject({ sessionId: 'ses_a', heartbeatAt: 1_000, closedCleanly: false })
    })
  })

  it(`${label} · 租约：另一个会话还活着时拿不到，而且不是抛异常`, async () => {
    await withProvider(async (provider) => {
      const drafts = provider.ext.drafts
      if (!drafts) throw new Error('drafts facet 缺失')
      await drafts.acquireLease('prj_lse00002', { sessionId: 'ses_a', nowMs: 1_000 })
      // 心跳还新鲜（差 1 秒 < LEASE_STALE_MS）。
      const denied = await drafts.acquireLease('prj_lse00002', { sessionId: 'ses_b', nowMs: 2_000 })
      expect(denied.ok).toBe(false)
      expect(!denied.ok && denied.heldBy.sessionId).toBe('ses_a')

      // 而且 ses_a 的租约**没被改**：拿不到的那一方不该留下任何痕迹。
      expect(await drafts.heartbeatLease('prj_lse00002', { sessionId: 'ses_a', nowMs: 3_000 })).toBe(true)
    })
  })

  it(`${label} · 租约：上一个会话崩了（心跳过期）时接管，previous 是 crashed`, async () => {
    await withProvider(async (provider) => {
      const drafts = provider.ext.drafts
      if (!drafts) throw new Error('drafts facet 缺失')
      await drafts.acquireLease('prj_lse00003', { sessionId: 'ses_a', nowMs: 1_000 })
      const taken = await drafts.acquireLease('prj_lse00003', { sessionId: 'ses_b', nowMs: 1_000 + LEASE_STALE_MS })
      expect(taken).toMatchObject({ ok: true, previous: 'crashed' })
      // 接管之后 ses_a 续不上了——它已经不是持有者。
      expect(await drafts.heartbeatLease('prj_lse00003', { sessionId: 'ses_a', nowMs: 99_000 })).toBe(false)
    })
  })

  it(`${label} · 租约：上一个会话干净退出时 previous 是 closed，不是 crashed`, async () => {
    await withProvider(async (provider) => {
      const drafts = provider.ext.drafts
      if (!drafts) throw new Error('drafts facet 缺失')
      await drafts.acquireLease('prj_lse00004', { sessionId: 'ses_a', nowMs: 1_000 })
      await drafts.releaseLease('prj_lse00004', 'ses_a')
      // 心跳一定是旧的（干净退出之后没人再续），所以只看 stale 的实现会报 crashed。
      const taken = await drafts.acquireLease('prj_lse00004', { sessionId: 'ses_b', nowMs: 1_000 + LEASE_STALE_MS * 10 })
      expect(taken).toMatchObject({ ok: true, previous: 'closed' })
    })
  })

}

/**
 * `size` bytes whose value depends on their index.
 *
 * Not `new Uint8Array(size)`: an all-zero buffer is indistinguishable from a copy that
 * allocated the right length and never filled it, and that is exactly the bug worth
 * catching at 64 MB.
 */
function patternedBytes(size: number): Uint8Array {
  const bytes = new Uint8Array(size)
  for (let i = 0; i < size; i++) bytes[i] = (i * 31 + (i >> 13)) & 0xff
  return bytes
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
