import { describe, expect, it } from 'vitest'
import { HEARTBEAT_MS, LEASE_STALE_MS, classifyLease } from '../src/provider.js'
import type { LeaseVerdict, SessionLease } from '../src/provider.js'

/**
 * T-287 · `classifyLease` 的穷举。
 *
 * 判定是崩溃恢复的全部大脑：横幅弹不弹、弹哪一条、能不能打开这份工程，三件事都只看它
 * 返回哪个词。它是纯函数，所以这一整份跑在纯 Node 里，没有库、没有 DOM、没有真实时间。
 */

const lease = (patch: Partial<SessionLease> = {}): SessionLease => ({
  projectId: 'prj_00000001',
  sessionId: 'ses_previous',
  heartbeatAt: 100_000,
  closedCleanly: false,
  ...patch,
})

describe('classifyLease · 四种判定各一条', () => {
  it('没有租约 → closed', () => {
    expect(classifyLease(null, { sessionId: 'ses_me', nowMs: 100_000 })).toBe<LeaseVerdict>('closed')
  })

  it('是我自己的 → self', () => {
    const verdict = classifyLease(lease({ sessionId: 'ses_me' }), { sessionId: 'ses_me', nowMs: 100_000 })
    expect(verdict).toBe<LeaseVerdict>('self')
  })

  /**
   * **心跳同样是过期的**，所以这一条同时钉死了「self 判定在 stale 判定之前」。
   *
   * 顺序反过来的实现会把「我自己那个刚从后台被浏览器冻了半分钟的标签页」报成崩溃，
   * 然后给用户弹一条恢复横幅——恢复的还是他自己正在编的那份。
   */
  it('是我自己的，哪怕心跳早就过期了 → 还是 self', () => {
    const verdict = classifyLease(lease({ sessionId: 'ses_me', heartbeatAt: 0 }), {
      sessionId: 'ses_me',
      nowMs: 10 * LEASE_STALE_MS,
    })
    expect(verdict).toBe<LeaseVerdict>('self')
  })

  it('别人的，心跳还新鲜 → live-elsewhere', () => {
    const verdict = classifyLease(lease(), { sessionId: 'ses_me', nowMs: 100_000 + HEARTBEAT_MS })
    expect(verdict).toBe<LeaseVerdict>('live-elsewhere')
  })

  it('别人的，心跳早过期了 → crashed', () => {
    const verdict = classifyLease(lease(), { sessionId: 'ses_me', nowMs: 100_000 + LEASE_STALE_MS * 4 })
    expect(verdict).toBe<LeaseVerdict>('crashed')
  })

  /**
   * 干净退出的租约，心跳**必然**是旧的——`releaseLease` 之后没人再续。
   *
   * 所以这一条是唯一能把「先判 closedCleanly」和「先判 stale」区分开的用例：
   * 顺序反过来的实现会把每一次正常关闭浏览器都报成崩溃。
   */
  it('干净退出的，心跳再旧也 → closed', () => {
    const verdict = classifyLease(lease({ closedCleanly: true, heartbeatAt: 0 }), {
      sessionId: 'ses_me',
      nowMs: 10 * LEASE_STALE_MS,
    })
    expect(verdict).toBe<LeaseVerdict>('closed')
  })

  it('干净退出的，心跳还新鲜也 → closed', () => {
    const verdict = classifyLease(lease({ closedCleanly: true }), { sessionId: 'ses_me', nowMs: 100_001 })
    expect(verdict).toBe<LeaseVerdict>('closed')
  })
})

describe('classifyLease · 边界', () => {
  /**
   * 卡面要求把 `nowMs − heartbeatAt === staleMs` 明确断言归哪一类。
   *
   * 归 `crashed`（判定用的是 `>=`）。理由：`staleMs` 已经是三个心跳周期，「正好三个周期
   * 都没动静」不该再给它半格宽限——而两边各自拍一半的实现会在这一格上分叉，
   * 且只在整毫秒对齐时才复现。
   */
  it('差值正好等于 staleMs → crashed（用的是 >=）', () => {
    expect(classifyLease(lease({ heartbeatAt: 0 }), { sessionId: 'ses_me', nowMs: LEASE_STALE_MS })).toBe<LeaseVerdict>(
      'crashed',
    )
  })

  it('差值比 staleMs 少 1 毫秒 → live-elsewhere', () => {
    const verdict = classifyLease(lease({ heartbeatAt: 0 }), { sessionId: 'ses_me', nowMs: LEASE_STALE_MS - 1 })
    expect(verdict).toBe<LeaseVerdict>('live-elsewhere')
  })

  it('staleMs 可以按次覆盖（E2E 的 ?w3LeaseStaleMs= 走这条路）', () => {
    const existing = lease({ heartbeatAt: 0 })
    expect(classifyLease(existing, { sessionId: 'ses_me', nowMs: 200 })).toBe<LeaseVerdict>('live-elsewhere')
    expect(classifyLease(existing, { sessionId: 'ses_me', nowMs: 200, staleMs: 100 })).toBe<LeaseVerdict>('crashed')
  })

  /**
   * 时钟倒流（用户改了系统时间、或者两个标签页的 `performance.timeOrigin` 不一样）。
   *
   * 差值是负数，`>=` 不成立，于是判 `live-elsewhere`——**不接管**。这是对的那一边：
   * 判错成 live-elsewhere 的代价是「打不开，让他关掉另一个标签页」，判错成 crashed
   * 的代价是**两个会话同时编同一份工程**，后写的那个覆盖先写的。
   */
  it('时钟倒流时不接管，判 live-elsewhere', () => {
    const verdict = classifyLease(lease({ heartbeatAt: 900_000 }), { sessionId: 'ses_me', nowMs: 100_000 })
    expect(verdict).toBe<LeaseVerdict>('live-elsewhere')
  })
})

describe('两个常量', () => {
  it('LEASE_STALE_MS 是三个心跳周期', () => {
    expect(LEASE_STALE_MS).toBe(HEARTBEAT_MS * 3)
  })

  /**
   * 一跳就判死的配置，会把一次 GC 停顿判成崩溃。这条断言存在的意义是：调小 `LEASE_STALE_MS`
   * 时得先来这里把理由改掉，而不是顺手把 3 改成 1。
   */
  it('至少留两跳的容错', () => {
    expect(LEASE_STALE_MS).toBeGreaterThanOrEqual(HEARTBEAT_MS * 2)
  })
})
