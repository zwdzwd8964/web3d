import type { EmbedController } from '@w3/core'
import type { EmbedPolicy } from './policy.js'
import { isAllowed } from './policy.js'

/**
 * T-272 · 把嵌入协议搬过 `postMessage`。
 *
 * ## 四个注入口，一个都不能少
 *
 * `controller` / `getPolicy` / `addListener` / `postTo` 全部注入，所以这一层在纯 Node 里
 * 跑得动——不用 jsdom、不用真 iframe。真实现只在 `boot.ts` 里出现一次。
 *
 * ## 「每个 source 只回一次 denied」是防放大器
 *
 * 一个非白名单页面可以每毫秒发一条消息。逐条回 `denied` 的话，我们就成了一个反射放大器：
 * 攻击者用一个 iframe 换我们无限量的 `postMessage`，而每一条都要序列化、要跨进程。
 * **回一次是礼貌（让正经宿主知道自己没被允许），回第二次开始就是资源**。
 */

export interface TransportOptions {
  readonly controller: EmbedController
  readonly getPolicy: () => EmbedPolicy
  /** 装一个消息监听器，返回卸载闭包。 */
  readonly addListener: (handler: (message: TransportMessage) => void) => () => void
  /** 把一条消息发回给某个 source。**target origin 必须是协商好的那个，不是 `'*'`。** */
  readonly postTo: (source: unknown, message: unknown, targetOrigin: string) => void
  readonly onWarn?: (message: string) => void
}

/** 一条到达的消息，已经从 `MessageEvent` 里摘出我们要的三样。 */
export interface TransportMessage {
  readonly data: unknown
  readonly origin: string
  readonly source: unknown
}

export interface Transport {
  /** 主动推一条事件给所有已握手的 source。 */
  broadcast: (message: unknown) => void
  dispose: () => void
}

/**
 * 装上传输层。
 *
 * @returns 卸载闭包 + 广播口。
 */
export function installTransport(options: TransportOptions): Transport {
  /** 已经通过校验的 source → 协商好的 origin。回发时用它，**不用 `'*'`**。 */
  const accepted = new Map<unknown, string>()
  /** 已经回过 `denied` 的 source。第二条起沉默。 */
  const denied = new Set<unknown>()
  let disposed = false

  const detach = options.addListener((message) => {
    if (disposed) return
    void handle(message)
  })

  async function handle(message: TransportMessage): Promise<void> {
    const policy = options.getPolicy()

    if (!isAllowed(message.origin, policy)) {
      // 只回一次。第二条起完全沉默——见文件头的放大器。
      if (denied.has(message.source)) return
      denied.add(message.source)
      options.onWarn?.(`来自 ${message.origin} 的嵌入请求被拒绝：该来源不在嵌入白名单里。`)
      // 回执用**发来的那个 origin** 作为 target。用 `'*'` 会把这条拒绝广播给页面上所有人。
      options.postTo(message.source, { kind: 'evt', protocol: 1, event: 'error', payload: { code: 'origin-denied' } }, message.origin)
      return
    }

    const ack = await options.controller.handle(message.data)
    // `null` = 不是给我们的消息。**零回复、零 warn**：宿主页面上还跑着别人的东西。
    if (ack === null) return

    accepted.set(message.source, message.origin)
    options.postTo(message.source, ack, message.origin)
  }

  return {
    broadcast(message) {
      if (disposed) return
      for (const [source, origin] of accepted) options.postTo(source, message, origin)
    },
    dispose() {
      disposed = true
      detach()
      accepted.clear()
      denied.clear()
    },
  }
}
