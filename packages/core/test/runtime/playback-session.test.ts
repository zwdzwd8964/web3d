import { createGoldenPathDocument } from '@w3/schema'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { registerBuiltinActions } from '../../src/eca/actions/index.js'
import { buildSamplePumpGlb } from '../../src/assets/sample.js'
import { createMemoryResolver } from '../../src/runtime/loader.js'
import { createPlaybackSession } from '../../src/runtime/playback-session.js'
import { SceneRuntime } from '../../src/runtime/scene-runtime.js'

/**
 * The start/stop race.
 *
 * `start()` awaits asset loading before marking itself running, and `stop()` used to
 * begin with `if (!running) return`. A stop arriving inside that window did nothing at
 * all, and `start()` then went on to enable an engine whose host had already dropped its
 * reference — an unstoppable session: timers firing forever against a disposed runtime,
 * rules running in edit mode (ECA_SPEC §7), and a second `enter()` leaving two live
 * engines on one runtime.
 *
 * Found by adversarial review. No test that existed at the time could have caught it,
 * because every one of them awaited `start()` before doing anything else.
 */

let glb: ArrayBuffer

beforeAll(async () => {
  registerBuiltinActions()
  glb = await buildSamplePumpGlb()
})

/** A resolver that hands out bytes only when the test releases it. */
function gatedResolver(url: string) {
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  return {
    release,
    resolver: {
      async resolve(requested: string): Promise<ArrayBuffer> {
        await gate
        if (requested !== url) throw new Error(`unexpected url ${requested}`)
        return glb
      },
    },
  }
}

const makeRuntime = (
  doc: ReturnType<typeof createGoldenPathDocument>,
  resolver?: { resolve(url: string): Promise<ArrayBuffer> },
) =>
  new SceneRuntime(doc, {
    resolver: resolver ?? createMemoryResolver(new Map([[doc.assets[0]!.url, glb]])),
    mode: 'play',
    now: () => 0,
  })

describe('stop() during start()', () => {
  it('cancels a start that is still loading assets', async () => {
    const doc = createGoldenPathDocument()
    const { resolver, release } = gatedResolver(doc.assets[0]!.url)
    const runtime = makeRuntime(doc, resolver)
    const session = createPlaybackSession({ runtime, document: doc })

    const starting = session.start()
    session.stop() // arrives while `runtime.load` is still awaiting
    release()
    await starting

    // Before the fix: isRunning true, engine enabled, a forwarder attached, and nobody
    // left holding a reference able to stop any of it.
    expect(session.isRunning).toBe(false)
    expect(session.engine.isEnabled).toBe(false)
    runtime.dispose()
  })

  it('does not fire sceneReady for a cancelled start', async () => {
    const doc = createGoldenPathDocument()
    const { resolver, release } = gatedResolver(doc.assets[0]!.url)
    const runtime = makeRuntime(doc, resolver)
    const results: string[] = []
    const session = createPlaybackSession({ runtime, document: doc, onResult: (r) => results.push(r.ruleId) })

    const starting = session.start()
    session.dispose()
    release()
    await starting

    expect(results).toEqual([])
    runtime.dispose()
  })

  it('leaves no event forwarder on the runtime', async () => {
    const doc = createGoldenPathDocument()
    const { resolver, release } = gatedResolver(doc.assets[0]!.url)
    const runtime = makeRuntime(doc, resolver)
    const session = createPlaybackSession({ runtime, document: doc })
    const spy = vi.spyOn(runtime, 'onEvent')

    const starting = session.start()
    session.stop()
    release()
    await starting

    expect(spy, '被取消的 start 不得注册监听器').not.toHaveBeenCalled()
    runtime.dispose()
  })

  it('a later start still works — the guard is a generation, not a latch', async () => {
    const doc = createGoldenPathDocument()
    const runtime = makeRuntime(doc)
    const session = createPlaybackSession({ runtime, document: doc })

    // A stop before anything started must not poison the session forever.
    session.stop()
    await session.start()
    expect(session.isRunning).toBe(true)

    session.stop()
    expect(session.isRunning).toBe(false)
    runtime.dispose()
  })

  it('stop is idempotent', async () => {
    const doc = createGoldenPathDocument()
    const runtime = makeRuntime(doc)
    const session = createPlaybackSession({ runtime, document: doc })
    await session.start()
    session.stop()
    expect(() => session.stop()).not.toThrow()
    runtime.dispose()
  })
})

describe('the ordinary path still works', () => {
  it('starts, dispatches and stops', async () => {
    const doc = createGoldenPathDocument()
    const runtime = makeRuntime(doc)
    const session = createPlaybackSession({ runtime, document: doc })

    await session.start()
    expect(session.isRunning).toBe(true)
    expect(session.engine.isEnabled).toBe(true)

    expect(() => session.click(doc.nodes[0]!.id)).not.toThrow()
    session.stop()
    expect(session.engine.isEnabled).toBe(false)
    runtime.dispose()
  })

  it('hover reports leave-then-enter and drops repeats', async () => {
    const doc = createGoldenPathDocument()
    const runtime = makeRuntime(doc)
    const seen: string[] = []
    const session = createPlaybackSession({ runtime, document: doc })
    const original = session.engine.dispatch.bind(session.engine)
    session.engine.dispatch = (event) => {
      if (event.event === 'hoverEnter' || event.event === 'hoverLeave') seen.push(`${event.event}:${event.nodeId}`)
      original(event)
    }

    await session.start()
    session.pointerOver('a')
    session.pointerOver('a') // repeat, must be dropped
    session.pointerOver('b')
    session.pointerOver(null)

    // Leave before enter, so an enter rule never runs against state the outgoing leave
    // rule is about to undo.
    expect(seen).toEqual(['hoverEnter:a', 'hoverLeave:a', 'hoverEnter:b', 'hoverLeave:b'])
    session.stop()
    runtime.dispose()
  })
})

describe('leaving a session silences the scene (M12 · T-163 验收)', () => {
  /** The golden path plus one audio record, and an element stand-in that always plays. */
  const mediaDoc = () => {
    const doc = createGoldenPathDocument()
    return {
      ...doc,
      assets: [...doc.assets, { ...doc.assets[0]!, id: 'ast_med00001', type: 'audio', name: '讲解.mp3' }],
      media: [{ id: 'med_00000001', type: 'audio', assetId: 'ast_med00001', name: '讲解', durationS: 2 }],
    } as ReturnType<typeof createGoldenPathDocument>
  }

  const fakeMediaElement = () => ({
    src: '',
    volume: 1,
    loop: false,
    currentTime: 0,
    play: () => Promise.resolve(),
    pause: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
  })

  it('stopping the session stops the audio', async () => {
    // The card's acceptance is 「退出预览音频停止」, and the chain that delivers it is four
    // hops long: exit → session.dispose → stop → runtime.resetScene → MediaBus.stop('all').
    // Every hop worked on its own and nothing asserted the chain — the exact shape of gap
    // M10 and M11 each found once. A narration that keeps playing after the user has left
    // the scene it belongs to is the most jarring thing this feature can do.
    const doc = mediaDoc()
    const runtime = new SceneRuntime(doc, {
      resolver: { resolve: async () => new ArrayBuffer(8) },
      mode: 'play',
      createMediaElement: () => fakeMediaElement(),
      now: () => 0,
    })
    const session = createPlaybackSession({ runtime, document: doc })
    await session.start()

    await runtime.playMedia('med_00000001', {})
    expect(runtime.isMediaPlaying('med_00000001'), '前提：声音确实在播').toBe(true)

    session.dispose()

    expect(runtime.isMediaPlaying('med_00000001'), '退出预览必须静音').toBe(false)
  })
})
