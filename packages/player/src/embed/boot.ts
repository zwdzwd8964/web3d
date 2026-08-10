import type { EmbedController } from '@w3/core'
import { parsePolicy } from './policy.js'
import type { EmbedPolicy } from './policy.js'
import { installTransport } from './transport.js'
import type { Transport } from './transport.js'

/**
 * T-272 · 唯一一处认识浏览器的嵌入代码。
 *
 * 上面两个文件（`policy.ts` / `transport.ts`）零 DOM，所以 43 条对抗用例跑在纯 Node 里。
 * 真正的 `window.addEventListener('message', …)` 只出现在这里，一处。
 *
 * ## 只在 `?embed=1` 时被 import
 *
 * `main.ts` 动态 import 它（T-273）。不带参数打开播放器时，这个模块**一个字节都不下载**——
 * 嵌入是少数场景，而独立打开播放器是多数场景，让多数场景付少数场景的代价没有道理。
 */

/** 白名单文件的位置。相对路径，随 `--base` 走（C7：文档里不许出现主机名）。 */
const POLICY_URL = 'embed-policy.json'

export interface BootOptions {
  readonly controller: EmbedController
  /** 注入的取白名单口。生产走 `fetch`，测试给一段文本。 */
  readonly loadPolicy?: () => Promise<string>
  readonly onWarn?: (message: string) => void
}

/**
 * 装上嵌入传输层，并向父窗口打一次招呼。
 *
 * @returns 传输层句柄；不在 iframe 里时返回 null（没有父窗口可打招呼）。
 */
export async function bootEmbed(options: BootOptions): Promise<Transport | null> {
  const warn = options.onWarn ?? ((message: string) => console.warn(message))

  let policy: EmbedPolicy = parsePolicy('[]', warn)
  try {
    const raw = await (options.loadPolicy ?? defaultLoadPolicy)()
    policy = parsePolicy(raw, warn)
  } catch (cause) {
    // 取不到白名单 = 谁都不许嵌。**不是全通**——同 `parsePolicy` 的坏 JSON 分支。
    warn(`嵌入白名单读取失败，已按「谁都不许嵌」处理：${cause instanceof Error ? cause.message : String(cause)}`)
  }

  const transport = installTransport({
    controller: options.controller,
    getPolicy: () => policy,
    addListener: (handler) => {
      const listener = (event: MessageEvent): void =>
        handler({ data: event.data, origin: event.origin, source: event.source })
      window.addEventListener('message', listener)
      return () => window.removeEventListener('message', listener)
    },
    postTo: (source, message, targetOrigin) => {
      ;(source as { postMessage?: (m: unknown, o: string) => void })?.postMessage?.(message, targetOrigin)
    },
    onWarn: warn,
  })

  // 握手：告诉父窗口「我起来了」。**这是全仓唯一允许 `'*'` 的一处**，因为此刻还不知道
  // 父窗口是谁——它的 origin 要等它回话才知道。这条消息里没有任何场景数据，只有一个信号。
  if (window.parent !== window) {
    window.parent.postMessage({ kind: 'evt', protocol: 1, event: 'boot' }, '*')
  }

  return transport
}

/** 生产的取白名单口。相对 URL，随部署的 `--base` 走。 */
async function defaultLoadPolicy(): Promise<string> {
  const response = await fetch(POLICY_URL)
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return response.text()
}
