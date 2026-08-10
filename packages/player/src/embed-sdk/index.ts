/**
 * T-274 · 宿主 SDK。
 *
 * ## 零依赖，而且**不 import 播放器的任何东西**
 *
 * 这个文件会被拷进客户的页面里，与播放器**分别升级**——客户今年拿到的 SDK 明年可能还在
 * 跑，而那台播放器已经升过三次。所以：
 *
 * - 协议版本号自己写一份字面量（`SUPPORTED_PROTOCOLS`），**不 import `EMBED_PROTOCOL`**。
 *   import 就等于假设两边永远同版本，而那正是「嵌入」这件事最不成立的假设。
 * - 一致性由测试保证：T-274 的测试**读这个文件的源码文本**、用正则抠出那个字面量，
 *   再与 `EMBED_PROTOCOL` 比。两边 import 同一个常量的测试**永远绿**——那是这张卡要
 *   证明的东西本身。
 * - 零依赖：客户的构建工具是什么我们不知道，也不该知道。
 */

/** 这份 SDK 认得的协议版本。**手写的字面量，不许改成 import。** */
const SUPPORTED_PROTOCOLS = [1]

/** 一条回执。字段与 `@w3/core` 的 `Ack` 对齐，但类型是本文件自己写的一份。 */
interface Ack {
  kind: 'ack'
  protocol: number
  id: string
  ok: boolean
  data?: unknown
  code?: string
  message?: string
}

/** 一条推送。 */
interface Evt {
  kind: 'evt'
  protocol: number
  event: string
  payload?: unknown
}

export interface MountOptions {
  /** 播放器的地址。**必须带 `?embed=1`**，否则播放器不会装嵌入层。 */
  src: string
  /** 挂在哪。 */
  container: HTMLElement
  /** iframe 的 sandbox。默认给一组够用的最小权限。 */
  sandbox?: string
  /** 握手超时（毫秒）。默认 15 秒——一份大场景在慢网上确实要这么久。 */
  timeoutMs?: number
}

export interface PlayerHandle {
  /** 播放器报上来的可用命令。**据它判断能不能调**，不要硬编码一份。 */
  readonly commands: readonly string[]
  readonly protocol: number
  readonly scene: unknown
  can(command: string): boolean
  play(): Promise<void>
  pause(): Promise<void>
  getVariable(id: string): Promise<unknown>
  setVariable(id: string, value: unknown): Promise<void>
  goToStep(step: number): Promise<void>
  screenshot(): Promise<{ dataUrl?: string }>
  subscribe(events: readonly string[] | null): Promise<void>
  on(event: string, handler: (payload: unknown) => void): () => void
  destroy(): void
}

/** 一次调用失败。**带 `code`**，好让宿主按码分支而不是按中文匹配。 */
export class PlayerError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'PlayerError'
  }
}

/**
 * 把播放器嵌进一个容器，等它握上手。
 *
 * @returns 握手成功后的句柄。握不上手（超时 / 协议不匹配）时 reject。
 */
export function mount(options: MountOptions): Promise<PlayerHandle> {
  const iframe = document.createElement('iframe')
  iframe.src = options.src
  iframe.style.border = '0'
  iframe.style.width = '100%'
  iframe.style.height = '100%'
  // 默认给最小够用的一组。**没有 `allow-same-origin`**：播放器不需要读宿主的存储，
  // 而给了它就等于让 iframe 里的代码拿到宿主的同源权限。
  iframe.setAttribute('sandbox', options.sandbox ?? 'allow-scripts')
  options.container.appendChild(iframe)

  const pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()
  const listeners = new Map<string, Set<(payload: unknown) => void>>()
  let seq = 0
  let target = new URL(options.src, location.href).origin
  let destroyed = false

  const onMessage = (event: MessageEvent): void => {
    if (destroyed || event.source !== iframe.contentWindow) return
    const data = event.data as Ack | Evt | undefined
    if (!data || typeof data !== 'object') return

    if (data.kind === 'ack') {
      const slot = pending.get(data.id)
      if (!slot) return
      pending.delete(data.id)
      if (data.ok) slot.resolve(data.data)
      else slot.reject(new PlayerError(data.code ?? 'internal-error', data.message ?? '调用失败。'))
      return
    }
    if (data.kind === 'evt') {
      for (const handler of listeners.get(data.event) ?? []) handler(data.payload)
    }
  }
  window.addEventListener('message', onMessage)

  const call = (name: string, params?: Record<string, unknown>): Promise<unknown> => {
    if (destroyed) return Promise.reject(new PlayerError('destroyed', '播放器已经被销毁。'))
    const id = `w3-${++seq}`
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject })
      iframe.contentWindow?.postMessage({ kind: 'cmd', protocol: SUPPORTED_PROTOCOLS[0], id, name, ...(params ? { params } : {}) }, target)
    })
  }

  return new Promise<PlayerHandle>((resolve, reject) => {
    const timeoutMs = options.timeoutMs ?? 15_000
    const timer = setTimeout(() => {
      cleanup()
      reject(new PlayerError('timeout', `播放器在 ${timeoutMs} 毫秒内没有握手。请确认地址带了 ?embed=1，且宿主域在播放器的嵌入白名单里。`))
    }, timeoutMs)

    function cleanup(): void {
      clearTimeout(timer)
    }

    // 播放器起来之后会广播一条 `boot`。收到它再握手——在那之前 postMessage 会打进一个
    // 还没装监听器的 iframe，消息就丢了。
    const onBoot = (event: MessageEvent): void => {
      if (event.source !== iframe.contentWindow) return
      const data = event.data as Evt | undefined
      if (!data || data.kind !== 'evt' || data.event !== 'boot') return
      window.removeEventListener('message', onBoot)
      // 握手回来的 origin 才是权威的那个（`options.src` 可能是相对路径）。
      target = event.origin
      void call('ready')
        .then((info) => {
          const ready = info as { protocol: number; commands: string[]; scene: unknown }
          if (!SUPPORTED_PROTOCOLS.includes(ready.protocol)) {
            cleanup()
            reject(
              new PlayerError(
                'protocol-mismatch',
                `播放器的嵌入协议是 ${ready.protocol}，这份 SDK 只认 ${SUPPORTED_PROTOCOLS.join(' / ')}。请升级 SDK。`,
              ),
            )
            return
          }
          cleanup()
          resolve(makeHandle(ready))
        })
        .catch((error: unknown) => {
          cleanup()
          reject(error instanceof Error ? error : new PlayerError('internal-error', String(error)))
        })
    }
    window.addEventListener('message', onBoot)

    function makeHandle(ready: { protocol: number; commands: string[]; scene: unknown }): PlayerHandle {
      const commands = ready.commands
      /** 调之前先看在不在清单里。**不在就本地拒绝**，省一次往返。 */
      const guarded = async (name: string, params?: Record<string, unknown>): Promise<unknown> => {
        if (!commands.includes(name)) {
          throw new PlayerError('unsupported-capability', `这个播放器不支持「${name}」。可用：${commands.join(', ')}。`)
        }
        return call(name, params)
      }
      return {
        commands,
        protocol: ready.protocol,
        scene: ready.scene,
        can: (command) => commands.includes(command),
        play: async () => void (await guarded('play')),
        pause: async () => void (await guarded('pause')),
        getVariable: (id) => guarded('getVariable', { id }),
        setVariable: async (id, value) => void (await guarded('setVariable', { id, value })),
        goToStep: async (step) => void (await guarded('goToStep', { step })),
        screenshot: async () => (await guarded('screenshot')) as { dataUrl?: string },
        subscribe: async (events) => void (await guarded('subscribe', { events: events as unknown })),
        on(event, handler) {
          const set = listeners.get(event) ?? new Set()
          set.add(handler)
          listeners.set(event, set)
          return () => set.delete(handler)
        },
        destroy() {
          destroyed = true
          window.removeEventListener('message', onMessage)
          window.removeEventListener('message', onBoot)
          pending.clear()
          listeners.clear()
          iframe.remove()
        },
      }
    }
  })
}
