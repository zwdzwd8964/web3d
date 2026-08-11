import { createGoldenPathDocument } from '@w3/schema'
import type { SceneDocument } from '@w3/schema'
import { LEASE_STALE_MS, MemoryProvider, StorageError } from '@w3/storage'
import type { DraftRecord, LeaseAcquisition, LeaseVerdict } from '@w3/storage'
import { beforeEach, describe, expect, it } from 'vitest'
import { AutoSaver } from '../src/project/autosave.js'
import type { SaveState } from '../src/project/autosave.js'
import { bannerFor, claimSession, runBoot, startHeartbeat } from '../src/project/project-lifecycle.js'
import { ProjectSession } from '../src/project/session.js'

/**
 * T-288 · 崩溃恢复的编辑器侧。
 *
 * **整份跑在纯 Node 里**，时钟与定时器全部注入。这不是洁癖：这条通道要断言的东西是
 * 「三个调用的次序」「失败时哪一个没被调」「N 毫秒里跳了几次心跳」，而这三样在真实
 * 定时器下只能靠 sleep 去逼近，于是测试要么慢要么飘。
 */

const doc = createGoldenPathDocument()

/** 一个可以手动推进的定时器。`AutoSaver` 与 `startHeartbeat` 都接受注入。 */
class FakeTimers {
  private seq = 0
  private readonly timers = new Map<number, { fn: () => void; ms: number; repeat: boolean }>()

  readonly setTimeout = (fn: () => void, ms: number): unknown => {
    const id = (this.seq += 1)
    this.timers.set(id, { fn, ms, repeat: false })
    return id
  }

  readonly clearTimeout = (handle: unknown): void => {
    this.timers.delete(handle as number)
  }

  readonly setInterval = (fn: () => void, ms: number): unknown => {
    // 间隔非正数会让下面的 `advance` 变成死循环。**在这里就抛**，而不是让测试挂住：
    // 一个挂住的测试和一个慢的测试在 CI 上分辨不出来。
    if (!(ms > 0)) throw new Error(`FakeTimers: 间隔必须是正数，实际是 ${ms}`)
    const id = (this.seq += 1)
    this.timers.set(id, { fn, ms, repeat: true })
    return id
  }

  readonly clearInterval = (handle: unknown): void => {
    this.timers.delete(handle as number)
  }

  /** 跑掉所有到期的一次性定时器。 */
  runAll(): void {
    for (const [id, timer] of [...this.timers]) {
      if (timer.repeat) continue
      this.timers.delete(id)
      timer.fn()
    }
  }

  /** 推进 `ms` 毫秒，按周期触发重复定时器。 */
  advance(ms: number): void {
    for (const timer of [...this.timers.values()]) {
      if (!timer.repeat) continue
      for (let elapsed = timer.ms; elapsed <= ms; elapsed += timer.ms) timer.fn()
    }
  }
}

/** 一台记录调用次序的 saver。 */
function recordingSaver(overrides: { save?: (doc: SceneDocument) => Promise<void> } = {}) {
  const calls: string[] = []
  const states: Array<[SaveState, string | undefined, string | undefined]> = []
  const timers = new FakeTimers()
  const drafts: DraftRecord[] = []
  const saver = new AutoSaver({
    delayMs: 10,
    setTimer: timers.setTimeout,
    clearTimer: timers.clearTimeout,
    saveDraft: async (document, edits) => {
      calls.push('saveDraft')
      drafts.push({ projectId: document.projectId, document, edits, savedAt: '', sessionId: 'ses_a' })
    },
    save:
      overrides.save ??
      (async () => {
        calls.push('save')
      }),
    clearDraft: async () => {
      calls.push('clearDraft')
    },
    onStateChange: (state, message, code) => states.push([state, message, code]),
  })
  return { saver, calls, states, timers, drafts }
}

describe('T-288 · 草稿通道的次序', () => {
  /**
   * 卡面的第一条验收。
   *
   * **次序不是风格问题**：草稿是在 `save` 失败或来不及时兜底的那一份，写在 `save`
   * 之后就恰好在唯一需要它的那个窗口里不存在。
   */
  it('一次 flush 的三个调用次序是 saveDraft → save → clearDraft', async () => {
    const { saver, calls } = recordingSaver()
    saver.schedule(doc)
    await saver.flush()
    expect(calls).toEqual(['saveDraft', 'save', 'clearDraft'])
  })

  /**
   * 卡面的第二条验收，也是这条通道存在的全部理由。
   *
   * 断言写成两句：**`clearDraft` 没被调**（反向），**而且状态是 error**（正向）。
   * 只写反向的话，把整个 flush 删掉也绿。
   */
  it('save 抛错时 clearDraft 没被调用，状态是 error', async () => {
    const { saver, calls, states } = recordingSaver({
      save: async () => {
        throw new Error('写不进去')
      },
    })
    saver.schedule(doc)
    await saver.flush()
    expect(calls).toEqual(['saveDraft'])
    expect(calls).not.toContain('clearDraft')
    expect(states.at(-1)?.[0]).toBe('error')
  })

  /**
   * 配额写满是唯一一种用户能自己解决的保存失败，所以它的文案必须是那句中文。
   *
   * 浏览器抛的是 `QuotaExceededError: Failed to execute 'put' on 'IDBObjectStore'`——
   * 把那句话贴到界面上等于没说。
   */
  it('quota-exceeded 时显示的是中文文案与错误码，不是 DOMException 的英文', async () => {
    const { saver, states } = recordingSaver({
      save: async () => {
        throw new StorageError('quota-exceeded', "Failed to execute 'put' on 'IDBObjectStore'")
      },
    })
    saver.schedule(doc)
    await saver.flush()
    const [state, message, code] = states.at(-1) ?? []
    expect(state).toBe('error')
    expect(code).toBe('quota-exceeded')
    expect(message).toContain('浏览器本地存储空间不足')
    expect(message).not.toContain('IDBObjectStore')
  })

  /**
   * 写入中又变脏了：**草稿也要被重写**，不能只重写文档。
   *
   * 只重写文档的话，从第一轮写完到第二轮写完之间，那批新编辑没有任何地方存着——
   * 而那正是崩溃最可能发生的时刻（一次大保存正在进行）。
   */
  it('写入中再变脏 → 草稿跟着被重写，而且中间那次不清草稿', async () => {
    const { saver, calls } = recordingSaver({
      save: async () => {
        calls.push('save')
        // 第一次写入进行中，用户又改了一笔。
        if (calls.filter((c) => c === 'save').length === 1) saver.schedule(doc)
      },
    })
    saver.schedule(doc)
    await saver.flush()
    expect(calls).toEqual(['saveDraft', 'save', 'saveDraft', 'save', 'clearDraft'])
  })

  it('编辑次数是编辑次数，不是保存次数', async () => {
    const { saver, drafts } = recordingSaver()
    saver.schedule(doc)
    saver.schedule(doc)
    saver.schedule(doc)
    await saver.flush()
    // 防抖的存在意义就是把很多次编辑合并成一次保存；用保存次数去数，横幅上那个 N 恒为 1。
    expect(drafts[0]?.edits).toBe(3)
    expect(saver.unsavedEdits).toBe(0)
  })

  it('防抖到期时也走同一条通道，不是只有手动 flush 才写草稿', async () => {
    const { saver, calls, timers } = recordingSaver()
    saver.schedule(doc)
    expect(calls).toEqual([])
    timers.runAll()
    await Promise.resolve()
    await Promise.resolve()
    expect(calls.slice(0, 2)).toEqual(['saveDraft', 'save'])
  })
})

describe('T-288 · 心跳', () => {
  /**
   * 卡面点名的那条断言：**N 毫秒里跳了 N / 间隔 次**。
   *
   * 只断言「跳过至少一次」的话，把间隔改成 1 毫秒也绿——而那是一个忙等循环，
   * 在功能上看起来完全正常（租约确实一直新鲜），只有电池知道。
   */
  it('N 毫秒里跳的次数等于 N / 间隔', () => {
    const timers = new FakeTimers()
    let beats = 0
    const stop = startHeartbeat({
      beat: () => (beats += 1),
      intervalMs: 1_000,
      setTimer: timers.setInterval,
      clearTimer: timers.clearInterval,
    })
    timers.advance(10_000)
    expect(beats).toBe(10)
    stop()
    timers.advance(10_000)
    expect(beats, '停了之后不该再跳').toBe(10)
  })

  it('间隔非正数直接抛，不是悄悄变成每帧一次', () => {
    expect(() => startHeartbeat({ beat: () => {}, intervalMs: 0 })).toThrow(/心跳间隔/)
  })
})

describe('T-288 · 横幅判定', () => {
  const lease = { projectId: 'prj_00000001', sessionId: 'ses_b', heartbeatAt: 0, closedCleanly: false }
  const draft = (edits: number): DraftRecord => ({
    projectId: 'prj_00000001',
    document: doc,
    edits,
    savedAt: '2026-08-11T00:00:00.000Z',
    sessionId: 'ses_b',
  })
  const ok = (previous: LeaseVerdict): LeaseAcquisition => ({ ok: true, lease, previous })

  it('崩了且有草稿 → 带真实数字的崩溃横幅', () => {
    const banner = bannerFor(ok('crashed'), draft(7))
    expect(banner).toMatchObject({ kind: 'crashed', edits: 7 })
  })

  it('干净退出 → 什么都不问', () => {
    expect(bannerFor(ok('closed'), draft(7))).toEqual({ kind: 'none' })
  })

  /**
   * 崩了**但没有草稿** → 也不问。
   *
   * 崩溃本身不值得打扰用户，没保存的东西才值得。没有草稿说明崩之前所有东西都落盘了。
   */
  it('崩了但没有草稿 → 也不问', () => {
    expect(bannerFor(ok('crashed'), null)).toEqual({ kind: 'none' })
    expect(bannerFor(ok('crashed'), draft(0))).toEqual({ kind: 'none' })
  })

  /**
   * 拿不到租约 → 黄横幅，**而且这一条压过崩溃**。
   *
   * 另一个标签页正拿着这份工程时把草稿恢复进来，会让两边同时编同一份。
   */
  it('另一个标签页占着 → 黄横幅，且压过崩溃判定', () => {
    expect(bannerFor({ ok: false, heldBy: lease }, draft(7))).toEqual({ kind: 'other-tab', heldBy: 'ses_b' })
  })
})

describe('T-288 · claimSession 打通到真的 provider', () => {
  let session: ProjectSession
  let storage: MemoryProvider

  beforeEach(() => {
    storage = new MemoryProvider()
    session = new ProjectSession({ storage })
  })

  it('第一次开机 → none；同一个会话再开一次 → 还是 none', async () => {
    const first = await claimSession(session, doc.projectId, { sessionId: 'ses_a', nowMs: 1_000 })
    expect(first.banner).toEqual({ kind: 'none' })
    const again = await claimSession(session, doc.projectId, { sessionId: 'ses_a', nowMs: 2_000 })
    expect(again.banner).toEqual({ kind: 'none' })
  })

  it('上一个会话崩了 + 有草稿 → 崩溃横幅带真实数字', async () => {
    const drafts = storage.ext.drafts
    if (!drafts) throw new Error('MemoryProvider 应当声明 drafts facet')
    await claimSession(session, doc.projectId, { sessionId: 'ses_a', nowMs: 1_000 })
    await drafts.saveDraft({
      projectId: doc.projectId,
      document: doc,
      edits: 4,
      savedAt: '2026-08-11T00:00:00.000Z',
      sessionId: 'ses_a',
    })
    const next = await claimSession(session, doc.projectId, {
      sessionId: 'ses_b',
      nowMs: 1_000 + LEASE_STALE_MS,
    })
    expect(next.banner).toMatchObject({ kind: 'crashed', edits: 4 })
  })

  /**
   * 干净退出之后**不该问**——哪怕草稿还躺在库里。
   *
   * 这一条与上一条只差一个 `releaseLease`，而它是「每次开机都弹恢复横幅」这个失效
   * 形状的唯一守卫。
   */
  it('上一个会话干净退出 → 不问，哪怕草稿还在', async () => {
    const drafts = storage.ext.drafts
    if (!drafts) throw new Error('MemoryProvider 应当声明 drafts facet')
    await claimSession(session, doc.projectId, { sessionId: 'ses_a', nowMs: 1_000 })
    await drafts.saveDraft({
      projectId: doc.projectId,
      document: doc,
      edits: 4,
      savedAt: '2026-08-11T00:00:00.000Z',
      sessionId: 'ses_a',
    })
    await drafts.releaseLease(doc.projectId, 'ses_a')
    const next = await claimSession(session, doc.projectId, {
      sessionId: 'ses_b',
      nowMs: 1_000 + LEASE_STALE_MS * 10,
    })
    expect(next.banner).toEqual({ kind: 'none' })
  })

  /**
   * 心跳带的是**当次**时刻，不是开机那一刻。
   *
   * 这一条**必须走 `runBoot` 交出来的那个闭包**，不能直接调 `heartbeatLease`：把
   * `nowMs` 冻在开机那一刻的写法，在 facet 那一层完全正确，错的是冷启动那一步怎么
   * 包它。直接调 facet 的测试对这个错误无感——实测过，它绿。
   */
  it('心跳之后另一个标签页仍然拿不到 —— 走的是冷启动交出来的那个闭包', async () => {
    const { doc: booted, heartbeat } = await runBoot(session, { sessionId: 'ses_a', nowMs: 1_000 })
    if (!heartbeat) throw new Error('冷启动应当交出一个心跳')

    // 活着的标签页一路续到很久以后。
    const last = 1_000 + LEASE_STALE_MS * 3
    for (let t = 1_000; t <= last; t += 1_000) heartbeat(t)
    await new Promise((resolve) => setTimeout(resolve, 0))

    const other = await claimSession(session, booted.projectId, { sessionId: 'ses_b', nowMs: last + 1 })
    // 复用开机那一刻的 nowMs 去续约的实现，会让这份租约在标签页活得好好的时候过期，
    // 然后被另一个标签页接管——而那正是这套机制唯一要防的事。
    expect(other.banner).toMatchObject({ kind: 'other-tab' })
  })
})
