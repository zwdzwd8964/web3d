/**
 * T-272 · 谁可以嵌我们，谁不可以。
 *
 * ## 这是本仓库安全面积最大的一处，而它只有几十行
 *
 * 一个嵌进宿主页面的播放器，会收到**任何页面**发来的 `message`。判错一次的后果不是
 * 「功能不对」，是把命令通道交给了攻击者：读变量、写变量、截图、跳步全在里面。
 *
 * 所以这里的每一条规则都写成**纯函数**（零 DOM、零 `window`），好让对抗用例能在纯 Node
 * 里穷举——`source.test.ts` 那套「逐个绕过手法各写一条」的风格，是这个文件唯一认的写法。
 *
 * ## 规则，五条
 *
 * 1. **精确匹配**：`https://a.example` 只匹配 `https://a.example`。
 * 2. **最左单标签通配**：`https://*.example.com` 匹配 `https://a.example.com`，
 *    **不匹配** `https://a.b.example.com`（单标签），**更不匹配** `https://example.com`。
 * 3. **显式全通** `"*"`：一个条目就是它自己，写下它的人知道自己在做什么。
 * 4. **scheme 必须是 https**，唯一例外是 localhost / 127.0.0.1（本地开发）。
 * 5. 读不懂的条目、读不懂的 origin：**拒**。不是「宽松处理」——一个读不懂的规则被当成
 *    通过，等于白名单形同虚设。
 */

/** 一份解析好的白名单。 */
export interface EmbedPolicy {
  /** 精确 origin，已归一化（小写、去默认端口、去末尾斜杠）。 */
  readonly exact: readonly string[]
  /** 通配后缀，形如 `.example.com`（**带前导点**）。 */
  readonly suffixes: readonly string[]
  /** 显式写了 `"*"`。 */
  readonly any: boolean
}

const EMPTY: EmbedPolicy = { exact: [], suffixes: [], any: false }

/** 本地开发例外。`http://` 只在这几个 host 上放行。 */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

/**
 * 把一个 origin 串归一化成可比的形式。
 *
 * 归一化的是**大小写、默认端口、末尾斜杠**三样——它们在 `postMessage` 的 `event.origin`
 * 里都不出现，但在人手写的配置文件里天天出现。看不懂返回 null。
 */
function normalise(value: string): string | null {
  const trimmed = value.trim()
  if (trimmed === '') return null
  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    return null
  }
  // `URL.origin` 已经小写化 host、去掉了默认端口与路径。`data:` / `blob:` 这类
  // opaque origin 会得到字符串 `"null"`，下面按不合法处理。
  return url.origin === 'null' ? null : url.origin
}

/**
 * 读一份白名单配置。
 *
 * @param raw 配置文件的文本。**坏 JSON → 空白名单 + warn**，不是全通：
 *   一份打错字的配置让所有人都能嵌，是这里唯一不可接受的失效方向。
 */
export function parsePolicy(raw: string, onWarn?: (message: string) => void): EmbedPolicy {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (cause) {
    onWarn?.(`嵌入白名单解析失败，已按「谁都不许嵌」处理：${cause instanceof Error ? cause.message : String(cause)}`)
    return EMPTY
  }

  const list = Array.isArray(parsed) ? parsed : (parsed as { allow?: unknown })?.allow
  if (!Array.isArray(list)) {
    onWarn?.('嵌入白名单格式不对（需要一个数组，或一个带 allow 数组的对象），已按「谁都不许嵌」处理。')
    return EMPTY
  }

  const exact: string[] = []
  const suffixes: string[] = []
  let any = false

  for (const entry of list) {
    if (typeof entry !== 'string') {
      onWarn?.(`嵌入白名单里有一条不是字符串的条目，已忽略：${JSON.stringify(entry)}`)
      continue
    }
    const item = entry.trim()
    if (item === '*') {
      any = true
      continue
    }
    if (item.includes('*')) {
      const wildcard = parseWildcard(item)
      if (!wildcard) {
        onWarn?.(`嵌入白名单里的通配条目无法解析，已忽略：${item}`)
        continue
      }
      suffixes.push(wildcard)
      continue
    }
    const origin = normalise(item)
    if (!origin) {
      onWarn?.(`嵌入白名单里的条目不是一个合法 origin，已忽略：${item}`)
      continue
    }
    exact.push(origin)
  }

  return { exact, suffixes, any }
}

/**
 * 解析 `https://*.example.com` 这种条目，返回 `.example.com`。
 *
 * **只认最左单标签**：`*` 必须紧跟在 scheme 之后、且是整个第一个标签。
 * `https://a.*.com` / `https://*.com` / `https://ex*.com` 一律拒——
 * 前者位置不对，中间那个会放行**任何**二级域（`evil.com` 也匹配 `*.com`）。
 */
function parseWildcard(item: string): string | null {
  const match = /^(https?):\/\/\*\.(.+)$/i.exec(item)
  if (!match) return null
  const scheme = match[1]!.toLowerCase()
  const rest = match[2]!.toLowerCase()
  // `*` 之后至少要有两段（`example.com`），否则 `*.com` 会放行整个 TLD。
  if (rest.split('.').filter(Boolean).length < 2) return null
  // 端口 / 路径不参与通配：一个带路径的通配条目说明写的人误解了这个字段。
  if (rest.includes('/') || rest.includes(':')) return null
  if (scheme !== 'https' && !LOCAL_HOSTS.has(rest)) return null
  return `.${rest}`
}

/**
 * 这个 origin 可以嵌我们吗。
 *
 * @param origin `event.origin` 原样传进来。sandbox 没有 `allow-same-origin` 时浏览器给的
 *   是**字符串 `"null"`**，那是一个 opaque origin——它谁都可能是，所以一律拒。
 */
export function isAllowed(origin: string, policy: EmbedPolicy): boolean {
  if (policy.any) return true

  const normalised = normalise(origin)
  // 读不懂（含 `"null"` / `data:` / 空串）→ 拒。
  if (!normalised) return false

  let url: URL
  try {
    url = new URL(normalised)
  } catch {
    return false
  }

  const host = url.hostname.toLowerCase()
  // scheme 限制：https，或者 http + 本地 host。
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && LOCAL_HOSTS.has(host))) return false

  if (policy.exact.includes(normalised)) return true

  // **`endsWith('.' + suffix)` 而不是 `endsWith(suffix)`**：后者让
  // `customer.example.evil.com` 匹配 `.example.com`，那是这一层最经典的漏法。
  return policy.suffixes.some((suffix) => {
    if (!host.endsWith(suffix)) return false
    // 单标签：`.example.com` 只吃 `a.example.com`，不吃 `a.b.example.com`。
    const label = host.slice(0, host.length - suffix.length)
    return label !== '' && !label.includes('.')
  })
}
