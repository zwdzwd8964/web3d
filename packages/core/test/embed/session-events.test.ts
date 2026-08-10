import { createGoldenPathDocument } from '@w3/schema'
import { describe, expect, it } from 'vitest'
import type { RuntimeEvent } from '../../src/eca/types.js'
import { createPlaybackSession } from '../../src/runtime/playback-session.js'
import { NullHotspotRenderer, SceneRuntime } from '../../src/runtime/index.js'

/**
 * T-271 · `PlaybackSessionOptions.onEvent` —— 进入引擎的每一条事件，**恰好一次**。
 *
 * ## 为什么断的是「序列逐项相等且长度相等」
 *
 * 「恰好一次」有两个失效方向，而它们各自能骗过一半的断言：
 *
 * - **漏发**（某一处仍然直接 `engine.dispatch`）——宿主只是「有时候收不到某种事件」，
 *   一条 `toContain` 完全无感。
 * - **重发**（发完又 dispatch 了一次）——宿主收到两条一模一样的，任何「收到了吗」的
 *   断言都是绿的。这是两者里更难发现的：症状是宿主的计数器每次多加一。
 *
 * 只有「与引擎实际收到的序列逐项相等**且长度相等**」两条同时断，才把两个方向都堵上。
 */

/** 全篇共用同一份文档：`SceneRuntime.document` 是私有的，而测试要的是同一个对象。 */
const DOC = createGoldenPathDocument()

/** 一个不碰 GPU 的运行时。事件路径与渲染无关，替身可以很薄。 */
function runtime(doc = DOC): SceneRuntime {
  return new SceneRuntime(doc, {
    canvas: { clientWidth: 800, clientHeight: 600 } as HTMLCanvasElement,
    resolver: { resolve: async () => new ArrayBuffer(8) },
    mode: 'play',
    createRenderer: () =>
      ({
        info: { memory: { geometries: 0, textures: 0 } },
        shadowMap: { enabled: false, type: -1 },
        render: () => {},
        setSize: () => {},
        setPixelRatio: () => {},
        getPixelRatio: () => 1,
        getSize: (t: { set: (w: number, h: number) => unknown }) => t.set(800, 600),
        setRenderTarget: () => {},
        getRenderTarget: () => null,
        clear: () => {},
        dispose: () => {},
        domElement: {} as HTMLCanvasElement,
        extensions: { has: () => false },
      }) as never,
    hotspotRenderer: new NullHotspotRenderer(),
  } as never)
}

/**
 * 一个会话 + 两条记录：宿主收到的（`onEvent`）与引擎收到的。
 *
 * 引擎那条靠包一层 `dispatch` 拿到——**不是再订阅一次**：再订阅只能证明「事件到过某处」，
 * 而这里要比的是引擎真正被喂进了什么。
 */
function wire() {
  const host: RuntimeEvent[] = []
  const engineSaw: RuntimeEvent[] = []
  const rt = runtime()
  const session = createPlaybackSession({
    runtime: rt,
    document: DOC,
    onEvent: (event) => void host.push(event),
  })
  const original = session.engine.dispatch.bind(session.engine)
  session.engine.dispatch = ((event: RuntimeEvent) => {
    engineSaw.push(event)
    return original(event)
  }) as typeof session.engine.dispatch
  return { session, host, engineSaw, runtime: rt }
}

describe('T-271 · onEvent 恰好一次', () => {
  it('八种来源走一遍，宿主序列与引擎序列**逐项相等且长度相等**', async () => {
    const { session, host, engineSaw, runtime: rt } = wire()

    await session.start()
    session.click('nd_r5t8y1u3')
    session.pointerOver('nd_a')
    session.pointerOver('nd_b')
    session.pointerOver(null)
    session.hotspotClick('hs_1')
    session.dispatch({ event: 'timer', timerId: 'tm_1', tick: 1 })
    rt.setVar(DOC.variables[0]!.id, 42)

    // 长度先断：它一条就同时挡住漏发与重发。
    expect(host.length, '漏一条或多一条都在这里现形').toBe(engineSaw.length)
    expect(host).toEqual(engineSaw)
    // 而且真的走过了那八种来源，不是两个空数组相等。
    expect(host.length).toBeGreaterThanOrEqual(7)
    expect(host.map((e) => e.event)).toContain('sceneReady')
    expect(host.map((e) => e.event)).toContain('hoverLeave')
    expect(host.map((e) => e.event)).toContain('hotspotClick')
  })

  it('先通知宿主，再进引擎', async () => {
    // 反过来的话，规则处理事件时改的状态会先于事件本身到达宿主，宿主看到的是一个
    // 已经被处理过的世界。
    const order: string[] = []
    const rt = runtime()
    const session = createPlaybackSession({
      runtime: rt,
      document: DOC,
      onEvent: () => void order.push('host'),
    })
    const original = session.engine.dispatch.bind(session.engine)
    session.engine.dispatch = ((event: RuntimeEvent) => {
      order.push('engine')
      return original(event)
    }) as typeof session.engine.dispatch

    await session.start()
    expect(order.slice(0, 2)).toEqual(['host', 'engine'])
  })

  it('`stop()` 之后不再被调用', async () => {
    const { session, host } = wire()
    await session.start()
    const before = host.length
    session.stop()
    session.click('nd_r5t8y1u3')
    session.hotspotClick('hs_1')
    session.dispatch({ event: 'timer', timerId: 'tm_1', tick: 1 })
    expect(host.length).toBe(before)
  })

  it('不传 `onEvent` 时一切照旧 —— 老调用点零影响', async () => {
    const rt = runtime()
    const session = createPlaybackSession({ runtime: rt, document: DOC })
    await expect(session.start()).resolves.toBeUndefined()
    expect(() => session.click('nd_r5t8y1u3')).not.toThrow()
  })

  it('`setVariable` 写同值 → 没有 variableChange', async () => {
    // 「值没变也发一条」会让宿主的每一次幂等写入都触发一轮规则。
    const { session, host, runtime: rt } = wire()
    await session.start()
    const id = DOC.variables[0]!.id
    const current = rt.getVar(id)
    const before = host.length

    rt.setVar(id, current)

    expect(host.length, '同值不该产生事件').toBe(before)
  })
})
