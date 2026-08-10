import { describe, expect, it, vi } from 'vitest'
import { isAllowed, parsePolicy } from '../src/embed/policy.js'
import { installTransport } from '../src/embed/transport.js'
import type { TransportMessage } from '../src/embed/transport.js'

/**
 * T-272 · 嵌入白名单与传输层。
 *
 * ## 这是本仓库安全面积最大的一处
 *
 * 一个嵌进宿主页面的播放器会收到**任何页面**发来的 `message`。判错一次的后果不是「功能
 * 不对」，是把命令通道交给了攻击者——读变量、写变量、截图、跳步全在里面。
 *
 * 所以这份测试照 `source.test.ts` 的对抗风格写：**每一种绕过手法各占一条**，而不是一条
 * 「大概能挡住」的笼统断言。一条笼统断言在被绕过的那天仍然是绿的。
 */

const policy = (...entries: string[]) => parsePolicy(JSON.stringify(entries))

describe('T-272 · parsePolicy', () => {
  it('坏 JSON → 空白名单 + warn，**不是全通**', () => {
    // 一份打错字的配置让所有人都能嵌，是这里唯一不可接受的失效方向。
    const warn = vi.fn()
    const parsed = parsePolicy('{ 这不是 json', warn)
    expect(parsed).toEqual({ exact: [], suffixes: [], any: false })
    expect(warn).toHaveBeenCalledTimes(1)
    expect(isAllowed('https://a.example', parsed)).toBe(false)
  })

  it('不是数组也不是 { allow: [] } → 空白名单 + warn', () => {
    const warn = vi.fn()
    expect(parsePolicy('"just a string"', warn).exact).toEqual([])
    expect(warn).toHaveBeenCalled()
  })

  it('两种形状都认：裸数组与 { allow }', () => {
    expect(parsePolicy('["https://a.example"]').exact).toEqual(['https://a.example'])
    expect(parsePolicy('{"allow":["https://a.example"]}').exact).toEqual(['https://a.example'])
  })

  it('条目本身是坏字符串 → 忽略那一条并 warn，其余照常', () => {
    const warn = vi.fn()
    const parsed = parsePolicy('["not a url","https://ok.example"]', warn)
    expect(parsed.exact).toEqual(['https://ok.example'])
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('条目不是字符串 → 忽略并 warn', () => {
    const warn = vi.fn()
    expect(parsePolicy('[42,{"a":1},"https://ok.example"]', warn).exact).toEqual(['https://ok.example'])
    expect(warn).toHaveBeenCalledTimes(2)
  })

  it('归一化：大小写、默认端口、末尾斜杠', () => {
    // 这三样在 `event.origin` 里都不出现，但在人手写的配置文件里天天出现。
    expect(policy('HTTPS://A.EXAMPLE').exact).toEqual(['https://a.example'])
    expect(policy('https://a.example:443').exact).toEqual(['https://a.example'])
    expect(policy('https://a.example/').exact).toEqual(['https://a.example'])
    expect(policy('  https://a.example  ').exact).toEqual(['https://a.example'])
  })

  it('非默认端口保留 —— 它是 origin 的一部分', () => {
    expect(policy('https://a.example:8443').exact).toEqual(['https://a.example:8443'])
  })
})

describe('T-272 · isAllowed · 精确匹配', () => {
  const allow = policy('https://customer.example')

  it.each([
    ['原样', 'https://customer.example', true],
    ['大小写不同的 host', 'https://CUSTOMER.EXAMPLE', true],
    ['带默认端口', 'https://customer.example:443', true],
    ['末尾斜杠', 'https://customer.example/', true],
    ['非默认端口', 'https://customer.example:8443', false],
    ['另一个域', 'https://other.example', false],
    ['子域', 'https://sub.customer.example', false],
    ['父域', 'https://example', false],
  ])('%s → %s', (_label, origin, expected) => {
    expect(isAllowed(origin, allow), origin).toBe(expected)
  })
})

describe('T-272 · isAllowed · 通配（最左单标签）', () => {
  const allow = policy('https://*.customer.example')

  it.each([
    ['单标签子域', 'https://a.customer.example', true],
    ['另一个单标签子域', 'https://portal.customer.example', true],
    ['大小写不同', 'https://A.CUSTOMER.EXAMPLE', true],
    ['**两级子域**（单标签规则）', 'https://a.b.customer.example', false],
    ['裸域本身', 'https://customer.example', false],
  ])('%s → %s', (_label, origin, expected) => {
    expect(isAllowed(origin, allow), origin).toBe(expected)
  })

  // ── 绕过手法，逐个一条 ──────────────────────────────────────────────────────
  it('**`https://customer.example.evil.com` 必须拒**', () => {
    // 最经典的漏法：`endsWith('customer.example')` 而不是 `endsWith('.customer.example')`。
    expect(isAllowed('https://customer.example.evil.com', allow)).toBe(false)
  })

  it('`https://evil.com#.customer.example` 必须拒（fragment 不是 host）', () => {
    expect(isAllowed('https://evil.com#.customer.example', allow)).toBe(false)
  })

  it('`https://evil.com?.customer.example` 必须拒（query 不是 host）', () => {
    expect(isAllowed('https://evil.com?.customer.example', allow)).toBe(false)
  })

  it('`https://evil.com/.customer.example` 必须拒（path 不是 host）', () => {
    expect(isAllowed('https://evil.com/.customer.example', allow)).toBe(false)
  })

  it('`https://evil.com@a.customer.example` —— userinfo 形式', () => {
    // 这个 URL 的真实 host 是 a.customer.example，所以它其实**应当**通过；
    // 记一条是为了钉住「我们判的是解析后的 origin，不是字符串前缀」。
    expect(isAllowed('https://evil.com@a.customer.example', allow)).toBe(true)
  })
})

describe('T-272 · isAllowed · 通配条目本身的合法性', () => {
  it('**`https://*.com` 必须拒** —— 它会放行整个 TLD', () => {
    const warn = vi.fn()
    const allow = parsePolicy('["https://*.com"]', warn)
    expect(allow.suffixes).toEqual([])
    expect(warn).toHaveBeenCalled()
    expect(isAllowed('https://evil.com', allow)).toBe(false)
  })

  it('`*` 出现在中间必须拒', () => {
    for (const entry of ['https://a.*.com', 'https://ex*.com', 'https://*a.example.com']) {
      const allow = policy(entry)
      expect(allow.suffixes, entry).toEqual([])
    }
  })

  it('通配条目带端口或路径必须拒 —— 写的人误解了这个字段', () => {
    expect(policy('https://*.example.com:8443').suffixes).toEqual([])
    expect(policy('https://*.example.com/app').suffixes).toEqual([])
  })

  it('`http://*.example.com` 必须拒 —— 通配只给 https', () => {
    expect(policy('http://*.example.com').suffixes).toEqual([])
  })
})

describe('T-272 · isAllowed · scheme 与 opaque origin', () => {
  const allow = policy('https://a.example', 'http://localhost:5173', 'http://evil.example')

  it('**字符串 `"null"` 必须拒** —— sandbox 无 allow-same-origin 时浏览器给的就是它', () => {
    // opaque origin 谁都可能是。
    expect(isAllowed('null', allow)).toBe(false)
  })

  it('`data:` origin 必须拒', () => {
    expect(isAllowed('data:text/html,<b>x</b>', allow)).toBe(false)
  })

  it('空串、空白、垃圾串必须拒', () => {
    for (const origin of ['', '   ', 'not-an-origin', '://', 'https://']) {
      expect(isAllowed(origin, allow), JSON.stringify(origin)).toBe(false)
    }
  })

  it('**`http://` 非 localhost 必须拒，哪怕它写在白名单里**', () => {
    // 明文 http 的 origin 是可以被中间人伪造的，写进白名单也不算数。
    expect(isAllowed('http://evil.example', allow)).toBe(false)
  })

  it('`http://localhost` 与 `127.0.0.1` 放行 —— 本地开发例外', () => {
    expect(isAllowed('http://localhost:5173', policy('http://localhost:5173'))).toBe(true)
    expect(isAllowed('http://127.0.0.1:5173', policy('http://127.0.0.1:5173'))).toBe(true)
  })

  it('`file://` 必须拒', () => {
    expect(isAllowed('file://', allow)).toBe(false)
  })
})

describe('T-272 · isAllowed · 显式全通', () => {
  it('`"*"` 一个条目就是它自己 —— 写下它的人知道自己在做什么', () => {
    const allow = policy('*')
    expect(allow.any).toBe(true)
    for (const origin of ['https://anything.example', 'http://plain.example', 'null']) {
      expect(isAllowed(origin, allow), origin).toBe(true)
    }
  })

  it('空白名单谁都拒', () => {
    const allow = policy()
    expect(isAllowed('https://a.example', allow)).toBe(false)
  })
})

/* -------------------------------------------------------------------------- */
/* 传输层                                                                      */
/* -------------------------------------------------------------------------- */

function wireTransport(allowList: string[]) {
  const posts: { source: unknown; message: unknown; targetOrigin: string }[] = []
  let handler: ((m: TransportMessage) => void) | null = null
  const acks: unknown[] = []
  const controller = {
    handle: async (data: unknown) => {
      // 只认 `kind: 'cmd'`，与真控制器同形。
      if (typeof data !== 'object' || data === null || (data as { kind?: string }).kind !== 'cmd') return null
      const ack = { kind: 'ack', protocol: 1, id: (data as { id: string }).id, ok: true }
      acks.push(ack)
      return ack
    },
  }
  const warn = vi.fn()
  const transport = installTransport({
    controller: controller as never,
    getPolicy: () => parsePolicy(JSON.stringify(allowList)),
    addListener: (h) => {
      handler = h
      return () => {
        handler = null
      }
    },
    postTo: (source, message, targetOrigin) => void posts.push({ source, message, targetOrigin }),
    onWarn: warn,
  })
  const send = async (origin: string, source: unknown, data: unknown = { kind: 'cmd', id: 'c1', name: 'play' }) => {
    handler?.({ data, origin, source })
    // handle 是异步的，让它跑完。
    await Promise.resolve()
    await Promise.resolve()
  }
  return { transport, posts, send, warn, handler: () => handler }
}

describe('T-272 · transport（纯 Node，注入假件）', () => {
  it('白名单内 → 回执，且 target origin **等于协商 origin**', async () => {
    const { posts, send } = wireTransport(['https://a.example'])
    await send('https://a.example', 'src-1')

    expect(posts).toHaveLength(1)
    expect(posts[0]!.targetOrigin, "用 '*' 会把回执广播给页面上所有人").toBe('https://a.example')
    expect((posts[0]!.message as { ok: boolean }).ok).toBe(true)
  })

  it('**非白名单 origin 收到恰好一条 denied，第二条起沉默**', async () => {
    // 逐条回的话我们就成了反射放大器：攻击者用一个 iframe 换我们无限量的 postMessage。
    const { posts, send, warn } = wireTransport(['https://a.example'])
    await send('https://evil.example', 'src-evil')
    await send('https://evil.example', 'src-evil')
    await send('https://evil.example', 'src-evil')

    expect(posts).toHaveLength(1)
    expect((posts[0]!.message as { event: string }).event).toBe('error')
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('不同 source 各自回一次 —— 「只回一次」是按 source 记的', async () => {
    const { posts, send } = wireTransport(['https://a.example'])
    await send('https://evil.example', 'src-a')
    await send('https://evil.example', 'src-b')
    expect(posts).toHaveLength(2)
  })

  it('不认识的消息：**零回复零 warn**', async () => {
    // 宿主页面上跑着 DevTools、统计脚本、别的 iframe。
    const { posts, send, warn } = wireTransport(['https://a.example'])
    await send('https://a.example', 'src-1', { hello: 'world' })
    expect(posts).toHaveLength(0)
    expect(warn).not.toHaveBeenCalled()
  })

  it('broadcast 只发给已握手的 source，且用各自协商的 origin', async () => {
    const { transport, posts, send } = wireTransport(['https://a.example', 'https://b.example'])
    await send('https://a.example', 'src-a')
    await send('https://b.example', 'src-b')
    posts.length = 0

    transport.broadcast({ kind: 'evt', protocol: 1, event: 'click' })

    expect(posts.map((p) => p.targetOrigin).sort()).toEqual(['https://a.example', 'https://b.example'])
  })

  it('dispose 之后卸载监听器，也不再广播', async () => {
    const { transport, posts, send, handler } = wireTransport(['https://a.example'])
    await send('https://a.example', 'src-1')
    posts.length = 0

    transport.dispose()
    expect(handler()).toBeNull()
    transport.broadcast({ kind: 'evt' })
    expect(posts).toHaveLength(0)
  })
})
