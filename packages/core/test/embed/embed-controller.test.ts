import { createGoldenPathDocument } from '@w3/schema'
import { describe, expect, it } from 'vitest'
import { COMMANDS, EMBED_PROTOCOL, EmbedController, availableCommands, summarizeScene } from '../../src/embed/index.js'
import type { CommandDeps, Evt } from '../../src/embed/index.js'

/**
 * T-271 · 嵌入控制器。**全跑在纯 Node**：无 jsdom、无 canvas、无 iframe。
 *
 * 控制器传输无关，所以这里能把每条命令、每种错误码、订阅位图全部穷举一遍，而
 * `postMessage` 的那一半（origin 策略、握手、放大器）在 T-272 另测。
 */

const doc = createGoldenPathDocument()

function wire(extra: Partial<CommandDeps> = {}) {
  const sent: Evt[] = []
  const vars = new Map<string, unknown>(doc.variables.map((v) => [v.id, v.default]))
  const calls: string[] = []
  const deps: CommandDeps = {
    document: () => doc,
    play: () => void calls.push('play'),
    pause: () => void calls.push('pause'),
    getVariable: (id) => vars.get(id),
    setVariable: (id, value) => void vars.set(id, value),
    hasVariable: (id) => vars.has(id),
    subscribe: () => {},
    ...extra,
  }
  const controller = new EmbedController({ deps, send: (m) => void sent.push(m), summary: () => summarizeScene(doc) })
  return { controller, sent, calls, vars, deps }
}

const cmd = (name: string, params?: Record<string, unknown>, id = 'c1') => ({
  kind: 'cmd' as const,
  protocol: EMBED_PROTOCOL,
  id,
  name,
  ...(params ? { params } : {}),
})

describe('T-271 · handle 返回 null = 不是给我们的', () => {
  it('别人的消息零回复', async () => {
    // 宿主页面上跑着 React DevTools、统计脚本、别的 iframe。对着别人的消息喊「未知命令」
    // 会把宿主的控制台淹掉，而那是我们唯一能被看见的地方。
    const { controller, sent } = wire()
    for (const junk of [null, undefined, 42, 'hello', {}, { kind: 'other' }, { kind: 'cmd' }]) {
      expect(await controller.handle(junk)).toBeNull()
    }
    expect(sent, '零回复也意味着零推送').toHaveLength(0)
  })

  it('**长得像我们的消息但命令不认识 → 有回执，不是 null**', async () => {
    // 静默的话宿主只会看到一个永远不 resolve 的 Promise。
    const { controller } = wire()
    const ack = await controller.handle(cmd('teleport'))
    expect(ack?.ok).toBe(false)
    expect(ack?.code).toBe('unknown-command')
    expect(ack?.message).toContain('teleport')
  })

  it('协议版本不匹配也回执', async () => {
    const { controller } = wire()
    const ack = await controller.handle({ ...cmd('play'), protocol: 99 })
    expect(ack?.code).toBe('protocol-mismatch')
    expect(ack?.message).toContain('99')
  })
})

describe('T-271 · ready', () => {
  it('`commands` 由注册表推导 —— **不是手写数组**', async () => {
    const { controller, deps } = wire()
    const ack = await controller.handle(cmd('ready'))
    const data = ack?.data as { protocol: number; commands: string[] }

    expect(data.protocol).toBe(EMBED_PROTOCOL)
    // 门槛断言：加一条命令自动出现在这里。
    expect(data.commands).toEqual(availableCommands(deps))
  })

  it('**注入缺失时命令不出现在清单里**（X-53：goToScene 在 v1.0 恒缺）', async () => {
    const { controller } = wire()
    const ack = await controller.handle(cmd('ready'))
    const data = ack?.data as { commands: string[] }

    expect(data.commands, 'v1.0 没有多场景实现').not.toContain('goToScene')
    expect(data.commands, '没注入出图').not.toContain('screenshot')
    // 而协议里那个名字保留着——v1.5 接上时开始注入，命令自己就出现，协议号一个数不用动。
    expect(Object.keys(COMMANDS)).toContain('goToScene')
  })

  it('注入之后命令就出现了', async () => {
    const { controller } = wire({ screenshot: async () => ({ ok: true, dataUrl: 'data:image/png;base64,AA' }) })
    const ack = await controller.handle(cmd('ready'))
    expect((ack?.data as { commands: string[] }).commands).toContain('screenshot')
  })

  it('场景摘要只报 id 与名字，不报变量的当前值', async () => {
    // 握手发生在加载完那一刻，而值随后每一帧都可能变。报一个会立刻过期的值，宿主会
    // 理所当然地把它当成初始状态缓存起来。
    const { controller } = wire()
    const ack = await controller.handle(cmd('ready'))
    const scene = (ack?.data as { scene: ReturnType<typeof summarizeScene> }).scene
    expect(scene.sceneId).toBe(doc.sceneId)
    expect(scene.variables[0]).toEqual({ id: doc.variables[0]!.id, name: doc.variables[0]!.name })
    expect('value' in (scene.variables[0] as object)).toBe(false)
  })
})

describe('T-271 · 每条命令', () => {
  it('play / pause 落到注入的回调上', async () => {
    const { controller, calls } = wire()
    await controller.handle(cmd('play'))
    await controller.handle(cmd('pause'))
    expect(calls).toEqual(['play', 'pause'])
  })

  it('**getVariable 打错字 → unknown-variable，不是一个默认值**', async () => {
    // 直接透传 `getVar` 的话，打错的名字会返回默认值（数字 0 / 空串），宿主据此显示
    // 「当前步骤：0」，而真相是那个变量根本不存在。
    const { controller } = wire()
    const ack = await controller.handle(cmd('getVariable', { id: 'stpe' }))
    expect(ack?.ok).toBe(false)
    expect(ack?.code).toBe('unknown-variable')
    expect(ack?.data).toBeUndefined()
  })

  it('getVariable 取得到真的变量', async () => {
    const { controller } = wire()
    const id = doc.variables[0]!.id
    const ack = await controller.handle(cmd('getVariable', { id }))
    expect(ack?.ok).toBe(true)
    expect(ack?.data).toBe(doc.variables[0]!.default)
  })

  it('setVariable 写得进去，写不存在的名字被拒', async () => {
    const { controller, vars } = wire()
    const id = doc.variables[0]!.id
    expect((await controller.handle(cmd('setVariable', { id, value: 7 })))?.ok).toBe(true)
    expect(vars.get(id)).toBe(7)
    expect((await controller.handle(cmd('setVariable', { id: 'nope', value: 1 })))?.code).toBe('unknown-variable')
  })

  it('参数类型不对 → bad-params', async () => {
    const { controller } = wire({ goToStep: () => {} })
    expect((await controller.handle(cmd('getVariable', { id: 42 })))?.code).toBe('bad-params')
    expect((await controller.handle(cmd('subscribe', { events: [1, 2] })))?.code).toBe('bad-params')
    expect((await controller.handle(cmd('goToStep', { step: 'x' })))?.code).toBe('bad-params')
  })

  it('screenshot 把失败翻成 internal-error', async () => {
    const { controller } = wire({ screenshot: async () => ({ ok: false, reason: '显卡资源不足' }) })
    const ack = await controller.handle(cmd('screenshot'))
    expect(ack?.ok).toBe(false)
    expect(ack?.message).toContain('显卡资源不足')
  })

  it('命令 run 抛异常 → internal-error，不拖垮传输层', async () => {
    const { controller } = wire({
      goToStep: () => {
        throw new Error('步骤越界')
      },
    })
    const ack = await controller.handle(cmd('goToStep', { step: 99 }))
    expect(ack?.code).toBe('internal-error')
    expect(ack?.message).toContain('步骤越界')
  })

  it('回执带回宿主给的那个 id —— 多实例 / 并发靠它对上号', async () => {
    const { controller } = wire()
    expect((await controller.handle(cmd('play', undefined, 'abc-123')))?.id).toBe('abc-123')
  })
})

describe('T-271 · 门槛：注册表里每条命令都有测试', () => {
  it('遍历 Object.keys(COMMANDS) 比对测试清单', () => {
    // 手写一份清单会在加命令的那天悄悄落后。这条断言让「加了命令没写测试」当场红。
    const tested = new Set([
      'ready',
      'play',
      'pause',
      'getVariable',
      'setVariable',
      'subscribe',
      'screenshot',
      'goToStep',
      'goToScene',
    ])
    expect(Object.keys(COMMANDS).filter((name) => !tested.has(name))).toEqual([])
  })

  it('goToScene 虽然 v1.0 不可用，参数校验仍然测得到', async () => {
    const { controller } = wire({ goToScene: async () => {} })
    expect((await controller.handle(cmd('goToScene', { sceneId: 42 })))?.code).toBe('bad-params')
    expect((await controller.handle(cmd('goToScene', { sceneId: 'sc_1' })))?.ok).toBe(true)
  })
})

describe('T-271 · 订阅位图', () => {
  it('默认全订', () => {
    const { controller, sent } = wire()
    controller.notify({ event: 'sceneReady' })
    controller.notify({ event: 'click', nodeId: 'nd_1' })
    expect(sent.map((e) => e.event)).toEqual(['sceneReady', 'click'])
  })

  it('订了之后只推订过的', async () => {
    const { controller, sent } = wire()
    await controller.handle(cmd('subscribe', { events: ['click'] }))
    controller.notify({ event: 'sceneReady' })
    controller.notify({ event: 'click', nodeId: 'nd_1' })
    expect(sent.map((e) => e.event)).toEqual(['click'])
  })

  it('省略 events 回到全订', async () => {
    const { controller, sent } = wire()
    await controller.handle(cmd('subscribe', { events: ['click'] }))
    await controller.handle(cmd('subscribe'))
    controller.notify({ event: 'sceneReady' })
    expect(sent.map((e) => e.event)).toEqual(['sceneReady'])
  })

  it('dispose 之后既不回执也不推送', async () => {
    const { controller, sent } = wire()
    controller.dispose()
    expect(await controller.handle(cmd('play'))).toBeNull()
    controller.notify({ event: 'sceneReady' })
    expect(sent).toHaveLength(0)
  })
})
