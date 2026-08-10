import type { RuntimeEvent } from '../eca/types.js'

/**
 * T-271 · 嵌入协议：宿主与播放器之间说什么话。
 *
 * ## 传输无关，是这个文件唯一的纪律
 *
 * 这里**没有 `window`、没有 `postMessage`、没有 DOM**。协议是数据形状加一套语义，
 * 而 `postMessage` 只是把它搬过去的一种方式（T-272）。分开的收益很具体：控制器可以在
 * 纯 Node 里被穷举，一个 iframe 都不用建；将来换 `MessageChannel` 或者 WebSocket 时，
 * 需要重测的只有传输层。`scripts/check-embed-layering.mjs`（T-272）把这条纪律变成机器。
 *
 * ## 版本号只有一个数
 *
 * 宿主 SDK 自己写死一份 `SUPPORTED_PROTOCOLS = [1]`（**不 import 这个常量**，T-274 的
 * 一致性测试读源码文本比对）。理由是 SDK 会被拷进客户的页面里、与播放器分别升级——
 * 让它 import 就等于假设两边永远同版本，而那正是「嵌入」这件事最不成立的假设。
 */

/** 协议版本。改它意味着老宿主 SDK 会被拒握手，所以只在**不兼容**变更时 +1。 */
export const EMBED_PROTOCOL = 1

/** 宿主能下的命令。**闭集**——不认识的命令一律回 `unknown-command`，不静默丢弃。 */
export type CommandName =
  | 'ready'
  | 'play'
  | 'pause'
  | 'getVariable'
  | 'setVariable'
  | 'goToStep'
  | 'goToScene'
  | 'screenshot'
  | 'subscribe'

/** 一条宿主发来的命令。 */
export interface Command {
  readonly kind: 'cmd'
  readonly protocol: number
  /** 宿主自己给的调用 id，原样回在 `Ack` 里。多实例 / 并发靠它对上号。 */
  readonly id: string
  readonly name: string
  readonly params?: Record<string, unknown>
}

/** 一条回执。**每条命令恰好一条**，成功失败都有。 */
export interface Ack {
  readonly kind: 'ack'
  readonly protocol: number
  readonly id: string
  readonly ok: boolean
  readonly data?: unknown
  readonly code?: EmbedErrorCode
  /** 面向宿主开发者的中文说明。失败时必有。 */
  readonly message?: string
}

/** 一条推送给宿主的事件。 */
export interface Evt {
  readonly kind: 'evt'
  readonly protocol: number
  readonly event: string
  readonly payload?: unknown
}

/**
 * 错误码，闭集。
 *
 * 宿主要能**按码分支**，所以它们是稳定标识符而不是中文——中文在 `message` 里。
 */
export type EmbedErrorCode =
  | 'unknown-command'
  | 'bad-params'
  | 'unknown-variable'
  | 'unsupported-capability'
  | 'protocol-mismatch'
  | 'not-ready'
  | 'internal-error'

/** 判一条来路不明的消息是不是给我们的命令。**不是就返回 false，不抛、不 warn。** */
export function isCommand(value: unknown): value is Command {
  if (typeof value !== 'object' || value === null) return false
  const message = value as Record<string, unknown>
  return message['kind'] === 'cmd' && typeof message['id'] === 'string' && typeof message['name'] === 'string'
}

/** 运行时事件的名字集合，**逐字转写 `eca/types.ts` 的联合**。 */
export const RUNTIME_EVENT_TYPES = [
  'sceneReady',
  'click',
  'hoverEnter',
  'hoverLeave',
  'hotspotClick',
  'animationEnd',
  'variableChange',
  'timer',
] as const

/**
 * 编译期哨兵：`RUNTIME_EVENT_TYPES` 与 `RuntimeEvent` 的联合必须一一对应。
 *
 * 往 `RuntimeEvent` 加一支而忘了加进这里，下面这行**编译不过**——而运行时的表现只是
 * 「宿主收不到那种事件」，没有任何东西会红。
 */
const _EXHAUSTIVE: RuntimeEvent['event'] = 'sceneReady' as (typeof RUNTIME_EVENT_TYPES)[number]
void _EXHAUSTIVE

/** 宿主可以订阅的事件名。除运行时事件外，多两条只有嵌入侧才有的。 */
export const EVENT_NAMES = [...RUNTIME_EVENT_TYPES, 'openLink', 'error'] as const
export type EventName = (typeof EVENT_NAMES)[number]
