import type { RuntimeEvent } from '../eca/types.js'
import type { CommandDeps } from './commands.js'
import { COMMANDS, availableCommands } from './commands.js'
import type { Ack, Command, Evt } from './protocol.js'
import { EMBED_PROTOCOL, isCommand } from './protocol.js'
import type { SceneSummary } from './scene-summary.js'

/**
 * T-271 · 嵌入控制器：把命令翻译成动作，把事件翻译成推送。
 *
 * **传输无关。** 它不知道消息从哪来、回到哪去——`handle()` 收一个已经解好的对象、
 * 返回一个要发回去的对象，`notify()` 交给注入的发送口。所以整个控制器能在纯 Node 里
 * 被穷举（T-272 的 `postMessage` 层另测）。
 *
 * ## `handle` 返回 `null` 的含义是「不是给我们的」
 *
 * 宿主页面上跑着的东西不止我们一个：React DevTools、各种统计脚本、其他 iframe 都在往
 * 同一个 window 上撒消息。对它们**零回复、零 warn**——一个对着别人的消息喊「未知命令」
 * 的嵌入播放器，会把宿主的控制台淹掉，而那是我们唯一能被看见的地方。
 */

export interface EmbedControllerOptions {
  readonly deps: CommandDeps
  /** 把一条推送交出去。传输层实现它。 */
  readonly send: (message: Evt) => void
  readonly summary: () => SceneSummary
}

export class EmbedController {
  /** `null` = 全订。`Set` = 只推这些。 */
  private subscribed: Set<string> | null = null
  private disposed = false

  constructor(private readonly options: EmbedControllerOptions) {
    // 订阅位图由 `subscribe` 命令改，所以它要能拿到控制器自己。
    ;(this.options.deps as { subscribe: (e: readonly string[] | null) => void }).subscribe = (events) => {
      this.subscribed = events === null ? null : new Set(events)
    }
  }

  /** 宿主真的能用的命令名。`ready` 报的就是它。 */
  get commands(): string[] {
    return availableCommands(this.options.deps)
  }

  /**
   * 处理一条来路不明的消息。
   *
   * @returns 要发回去的回执；**`null` = 这条消息不是给我们的**，调用方应当完全不作声。
   */
  async handle(message: unknown): Promise<Ack | null> {
    if (this.disposed) return null
    if (!isCommand(message)) return null

    const command = message as Command
    // 协议不匹配也要回执：宿主 SDK 需要知道「我太老了」，而不是超时。
    if (typeof command.protocol === 'number' && command.protocol !== EMBED_PROTOCOL) {
      return this.ack(command, {
        ok: false,
        code: 'protocol-mismatch',
        message: `嵌入协议版本不匹配：宿主 ${command.protocol}，播放器 ${EMBED_PROTOCOL}。请升级宿主 SDK。`,
      })
    }

    const spec = COMMANDS[command.name]
    // **不认识的命令要回执，不能静默返回 null。** 它长得像我们的消息（kind 对、id 对），
    // 静默的话宿主只会看到一个永远不 resolve 的 Promise。
    if (!spec || !spec.available(this.options.deps)) {
      return this.ack(command, {
        ok: false,
        code: 'unknown-command',
        message: `播放器不支持命令「${command.name}」。当前可用：${this.commands.join(', ')}。`,
      })
    }

    if (command.name === 'ready') {
      return this.ack(command, {
        ok: true,
        data: { protocol: EMBED_PROTOCOL, commands: this.commands, scene: this.options.summary() },
      })
    }

    try {
      const result = await spec.run(this.options.deps, command.params ?? {})
      return this.ack(command, result)
    } catch (cause) {
      // 一条命令抛异常不许拖垮传输层——宿主拿到一条失败回执，播放器继续跑。
      return this.ack(command, {
        ok: false,
        code: 'internal-error',
        message: cause instanceof Error ? cause.message : String(cause),
      })
    }
  }

  /** 把一条运行时事件推给宿主，如果它订了的话。 */
  notify(event: RuntimeEvent): void {
    this.push(event.event, event)
  }

  /** 推一条非运行时事件（`openLink` / `error`）。 */
  push(name: string, payload?: unknown): void {
    if (this.disposed) return
    if (this.subscribed !== null && !this.subscribed.has(name)) return
    this.options.send({ kind: 'evt', protocol: EMBED_PROTOCOL, event: name, ...(payload === undefined ? {} : { payload }) })
  }

  dispose(): void {
    this.disposed = true
  }

  private ack(command: Command, result: { ok: boolean; data?: unknown; code?: Ack['code']; message?: string }): Ack {
    return {
      kind: 'ack',
      protocol: EMBED_PROTOCOL,
      id: command.id,
      ok: result.ok,
      ...(result.data === undefined ? {} : { data: result.data }),
      ...(result.code === undefined ? {} : { code: result.code }),
      ...(result.message === undefined ? {} : { message: result.message }),
    }
  }
}
