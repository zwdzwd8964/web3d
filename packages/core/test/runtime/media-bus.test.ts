import { createGoldenPathDocument } from '@w3/schema'
import type { SceneDocument } from '@w3/schema'
import { describe, expect, it, vi } from 'vitest'
import { MediaBus } from '../../src/runtime/media-bus.js'
import type { MediaElementLike } from '../../src/runtime/media-bus.js'

/**
 * T-163 · the scene's audio.
 *
 * Runs in plain Node (C8): the element factory is injected, so pooling, volume, loop, stop
 * and — the one that matters — the AUTOPLAY fallback are all exercised without a decoder.
 *
 * That fallback is the risk this class exists to contain (V3). Browsers refuse to play
 * audio before the user has interacted with the page, and the refusal arrives as a rejected
 * promise. Letting it through aborts the whole rule chain: 「响完铃再弹面板」 becomes
 * 「铃没响，面板也没弹」, and the user sees nothing at all rather than one missing sound.
 */

const MEDIA_ID = 'med_00000001'

function docWithMedia(): SceneDocument {
  const doc = createGoldenPathDocument()
  return {
    ...doc,
    assets: [...doc.assets, { ...doc.assets[0]!, id: 'ast_med00001', type: 'audio', name: '讲解.mp3' }],
    media: [{ id: MEDIA_ID, type: 'audio', assetId: 'ast_med00001', name: '讲解', durationS: 2 }],
  } as SceneDocument
}

/** A stand-in element whose `play()` outcome each test chooses. */
function fakeElement(play: () => Promise<void> = () => Promise.resolve()) {
  const listeners = new Set<() => void>()
  const element = {
    src: '',
    volume: 1,
    loop: false,
    currentTime: 0,
    paused: false,
    play,
    pause() {
      element.paused = true
    },
    addEventListener: (_type: 'ended', listener: () => void) => void listeners.add(listener),
    removeEventListener: (_type: 'ended', listener: () => void) => void listeners.delete(listener),
    /** Fires `ended`, which is how a clip finishes without real playback. */
    finish: () => {
      for (const listener of [...listeners]) listener()
    },
    listenerCount: () => listeners.size,
  }
  return element
}

function makeBus(options: { play?: () => Promise<void>; resolve?: () => Promise<ArrayBuffer> } = {}) {
  const element = fakeElement(options.play)
  const logs: { level: string; message: string }[] = []
  const bus = new MediaBus({
    resolve: options.resolve ?? (async () => new ArrayBuffer(8)),
    createElement: () => element as unknown as MediaElementLike,
    log: (level, message) => void logs.push({ level, message }),
  })
  bus.setDocument(docWithMedia())
  return { bus, element, logs }
}

describe('playing and stopping', () => {
  it('plays, and says it is playing', async () => {
    const { bus, element } = makeBus()
    await bus.play(MEDIA_ID)

    expect(bus.isPlaying(MEDIA_ID)).toBe(true)
    expect(bus.playingIds).toEqual([MEDIA_ID])
    expect(element.src).not.toBe('')
  })

  it('carries loop and volume onto the element', async () => {
    const { bus, element } = makeBus()
    await bus.play(MEDIA_ID, { loop: true, volume: 0.25 })

    expect(element.loop).toBe(true)
    expect(element.volume).toBe(0.25)
  })

  it('clamps a volume outside 0–1 instead of letting the element throw', async () => {
    const { bus, element } = makeBus()
    await bus.play(MEDIA_ID, { volume: 5 })
    expect(element.volume).toBe(1)
    await bus.play(MEDIA_ID, { volume: -1 })
    expect(element.volume).toBe(0)
  })

  it('restarts from the top rather than resuming', async () => {
    // Replaying a clip that already finished must not be a silent no-op.
    const { bus, element } = makeBus()
    await bus.play(MEDIA_ID)
    element.currentTime = 1.5
    await bus.play(MEDIA_ID)
    expect(element.currentTime).toBe(0)
  })

  it('stops, rewinds, and stops being "playing"', async () => {
    const { bus, element } = makeBus()
    await bus.play(MEDIA_ID)
    bus.stop(MEDIA_ID)

    expect(bus.isPlaying(MEDIA_ID)).toBe(false)
    expect(element.paused).toBe(true)
    expect(element.currentTime).toBe(0)
  })

  it('stopping what is not playing is fine', () => {
    const { bus } = makeBus()
    expect(() => bus.stop(MEDIA_ID)).not.toThrow()
    expect(() => bus.stop('all')).not.toThrow()
  })

  it('marks itself finished when the clip ends on its own', async () => {
    const { bus, element } = makeBus()
    await bus.play(MEDIA_ID)
    element.finish()
    expect(bus.isPlaying(MEDIA_ID)).toBe(false)
  })

  it('does not pile up ended listeners across replays', async () => {
    // A clip played thirty times with thirty listeners means the last stop clears none of
    // them, and every one fires on the next end.
    const { bus, element } = makeBus()
    for (let i = 0; i < 5; i++) await bus.play(MEDIA_ID)
    expect(element.listenerCount()).toBe(1)
  })
})

describe('the autoplay policy (risk V3)', () => {
  it('RESOLVES when the browser refuses, and warns', async () => {
    // Rejecting would abort the whole rule chain. The sequence has to keep running: one
    // missing sound is recoverable, a rule that stopped halfway is not.
    const { bus, logs } = makeBus({
      play: () => Promise.reject(new DOMException('play() failed', 'NotAllowedError')),
    })

    await expect(bus.play(MEDIA_ID)).resolves.toBeUndefined()

    expect(bus.isPlaying(MEDIA_ID), '没播成就不能说在播').toBe(false)
    const warning = logs.find((l) => l.level === 'warn')
    expect(warning?.message, '要说清是哪个媒体，以及规则会继续').toContain('讲解')
    expect(warning?.message).toContain('规则会继续执行')
  })

  it('a later play still works once the user has interacted', async () => {
    // The refusal is about the page's state, not about the clip: retrying must not be
    // blocked by anything the bus remembered.
    let allowed = false
    const { bus } = makeBus({
      play: () => (allowed ? Promise.resolve() : Promise.reject(new Error('NotAllowedError'))),
    })

    await bus.play(MEDIA_ID)
    expect(bus.isPlaying(MEDIA_ID)).toBe(false)

    allowed = true
    await bus.play(MEDIA_ID)
    expect(bus.isPlaying(MEDIA_ID)).toBe(true)
  })
})

describe('resolving and pooling', () => {
  it('creates ONE element per media id, however often it is played', async () => {
    // An <audio> per play leaks decoders on a scene where a rule fires every few seconds.
    const created: unknown[] = []
    const bus = new MediaBus({
      resolve: async () => new ArrayBuffer(8),
      createElement: () => {
        const element = fakeElement()
        created.push(element)
        return element as unknown as MediaElementLike
      },
    })
    bus.setDocument(docWithMedia())

    await bus.play(MEDIA_ID)
    await bus.play(MEDIA_ID)
    await bus.play(MEDIA_ID)

    expect(created).toHaveLength(1)
  })

  it('says nothing can play when this build has no element factory', async () => {
    // The parity harness and the ECA tests are exactly this, and it is a valid
    // configuration rather than a broken bus.
    const bus = new MediaBus({ resolve: async () => new ArrayBuffer(8) })
    bus.setDocument(docWithMedia())

    await expect(bus.play(MEDIA_ID)).resolves.toBeUndefined()
    expect(bus.isPlaying(MEDIA_ID)).toBe(false)
  })

  it('warns for a media id the document does not have', async () => {
    const { bus, logs } = makeBus()
    await bus.play('med_00000000')
    expect(logs.some((l) => l.message.includes('找不到媒体记录'))).toBe(true)
  })

  it('survives a file that cannot be read', async () => {
    const { bus, logs } = makeBus({
      resolve: async () => {
        throw new Error('missing')
      },
    })
    await expect(bus.play(MEDIA_ID)).resolves.toBeUndefined()
    expect(logs.some((l) => l.level === 'error' && l.message.includes('读取失败'))).toBe(true)
  })

  it('revokes every object URL on disposeAll', async () => {
    const revoked: string[] = []
    vi.stubGlobal('URL', {
      createObjectURL: () => 'blob:stub/1',
      revokeObjectURL: (url: string) => void revoked.push(url),
    })
    vi.stubGlobal('Blob', class {})

    const { bus } = makeBus()
    await bus.play(MEDIA_ID)
    bus.disposeAll()

    expect(revoked).toEqual(['blob:stub/1'])
    expect(bus.isPlaying(MEDIA_ID)).toBe(false)
    vi.unstubAllGlobals()
  })
})

describe('waitForEnd', () => {
  it('resolves when the clip ends', async () => {
    const { bus, element } = makeBus()
    await bus.play(MEDIA_ID)

    let settled = false
    void bus.waitForEnd(MEDIA_ID).then(() => void (settled = true))
    await Promise.resolve()
    expect(settled).toBe(false)

    element.finish()
    await Promise.resolve()
    expect(settled).toBe(true)
  })

  it('rejects when the signal aborts', async () => {
    // Abort has to reach the wait, or a restarted sequence leaves the old one waiting on a
    // clip nobody is listening for any more.
    const { bus } = makeBus()
    await bus.play(MEDIA_ID)
    const controller = new AbortController()

    const waiting = bus.waitForEnd(MEDIA_ID, controller.signal)
    controller.abort()

    await expect(waiting).rejects.toThrow()
  })

  it('resolves at once for a clip that is not playing', async () => {
    const { bus } = makeBus()
    await expect(bus.waitForEnd(MEDIA_ID)).resolves.toBeUndefined()
  })
})

describe('a media record deleted while it plays (M12 审查所得)', () => {
  it('stops and releases it', async () => {
    // Left running, the clip sounds for ever with nothing left to stop it: the media
    // panel's row is gone, so there is no 停止 button, and the document no longer mentions
    // it. The user's only remaining option is reloading the page.
    const revoked: string[] = []
    vi.stubGlobal('URL', {
      createObjectURL: () => 'blob:stub/1',
      revokeObjectURL: (url: string) => void revoked.push(url),
    })
    vi.stubGlobal('Blob', class {})

    const { bus } = makeBus()
    await bus.play(MEDIA_ID)
    expect(bus.isPlaying(MEDIA_ID)).toBe(true)

    // The record is deleted; the runtime hands the new document over on the next patch.
    bus.setDocument({ ...docWithMedia(), media: [] } as SceneDocument)

    expect(bus.isPlaying(MEDIA_ID), '记录没了，声音也得停').toBe(false)
    expect(bus.playingIds).toEqual([])
    expect(revoked, '连同它占着的 object URL 一起还回去').toEqual(['blob:stub/1'])
    vi.unstubAllGlobals()
  })

  it('leaves alone the clips the new document still has', async () => {
    const { bus } = makeBus()
    await bus.play(MEDIA_ID)
    bus.setDocument(docWithMedia())
    expect(bus.isPlaying(MEDIA_ID)).toBe(true)
  })
})

/**
 * T-186 / ADR-0019 · the runtime side of D19's 「以先到者为准」.
 *
 * Everything above tests `MediaBus.waitForEnd`, which was complete, correct and had ZERO
 * production callers (T-176 审查所得) — the action only ever waited on `durationS`. A clip
 * whose real length differs from what the browser reported at import then finished early or
 * late with nothing to correct it, and 「响完铃再弹面板」 either cut the last second off or
 * left the user watching a still frame.
 */
describe('SceneRuntime exposes the clip ending to actions (T-186)', () => {
  const makeRuntime = async (element: ReturnType<typeof fakeElement>) => {
    const { SceneRuntime } = await import('../../src/runtime/scene-runtime.js')
    const { NullHotspotRenderer } = await import('../../src/runtime/hotspot-layer.js')
    const doc = docWithMedia()
    const runtime = new SceneRuntime(doc, {
      resolver: { resolve: async () => new ArrayBuffer(8) },
      mode: 'play',
      createMediaElement: () => element as unknown as MediaElementLike,
      hotspotRenderer: new NullHotspotRenderer(),
      now: () => 0,
    })
    runtime.media.setDocument(doc)
    return runtime
  }

  it('resolves when the element really ends, not when a timer says so', async () => {
    const element = fakeElement()
    const runtime = await makeRuntime(element)
    await runtime.playMedia(MEDIA_ID)

    let settled = false
    void runtime.waitForMediaEnd(MEDIA_ID).then(() => void (settled = true))
    await Promise.resolve()
    expect(settled, '还在响，不该结束').toBe(false)

    element.finish()
    await Promise.resolve()
    expect(settled, '真的播完了就该结束——这一跳此前没有任何调用者').toBe(true)
    runtime.dispose()
  })

  it('does NOT resolve when autoplay was refused — the clock decides instead', async () => {
    // V3 · the browser may refuse to start audio. Nothing is playing, so there is no ending
    // to observe — and that is NOT the same as "it already ended".
    //
    // The first version of this bridged straight to `MediaBus.waitForEnd`, which resolves
    // at once for a clip that is not playing. That made `await: true` return instantly
    // whenever audio was blocked, so the rule's next step fired immediately and the
    // authored pacing collapsed: a scene with blocked audio broke in a second, less
    // explicable way on top of being silent. The parity suite's self-check caught it —
    // neither side had diverged, both were equally wrong.
    const element = fakeElement(() => Promise.reject(new Error('NotAllowedError')))
    const runtime = await makeRuntime(element)
    await runtime.playMedia(MEDIA_ID)

    let settled = false
    void runtime.waitForMediaEnd(MEDIA_ID).then(() => void (settled = true))
    for (let i = 0; i < 8; i++) await Promise.resolve()

    expect(settled, '没在响就没有「响完」可听，交给时钟').toBe(false)
    runtime.dispose()
  })
})

/**
 * T-186 · the race itself, driven through the action against a REAL MediaBus.
 *
 * The tests above prove each half works. Neither proves the action USES both: deleting the
 * race and going back to `await ctx.wait(durationS)` left all 699 tests green, because
 * headless never resolves the other side, so in headless the race and the bare wait are
 * indistinguishable by construction.
 *
 * So this one gives the clip an hour-long `durationS` and ends the element immediately. On
 * the clock alone it would take an hour; if the race is wired, it returns at once.
 */
describe('playMedia ends when the clip does, not when the clock says (T-186)', () => {
  it('returns as soon as the element fires ended, however long durationS claims', async () => {
    const { SceneRuntime } = await import('../../src/runtime/scene-runtime.js')
    const { NullHotspotRenderer } = await import('../../src/runtime/hotspot-layer.js')
    const { MEDIA_ACTIONS } = await import('../../src/eca/actions/media.js')
    const playMedia = MEDIA_ACTIONS.find((a) => a.type === 'playMedia')!

    const element = fakeElement()
    const base = docWithMedia()
    // An hour. The recorded duration and the real one disagree — which is the whole point
    // of D19: `durationS` is what the browser guessed at import.
    const doc = { ...base, media: [{ ...base.media[0]!, durationS: 3600 }] } as SceneDocument

    const runtime = new SceneRuntime(doc, {
      resolver: { resolve: async () => new ArrayBuffer(8) },
      mode: 'play',
      createMediaElement: () => element as unknown as MediaElementLike,
      hotspotRenderer: new NullHotspotRenderer(),
      now: () => 0,
    })
    runtime.media.setDocument(doc)

    let settled = false
    const running = playMedia
      .handler(runtime as never, { mediaId: MEDIA_ID, await: true }, new AbortController().signal)
    void Promise.resolve(running).then(() => void (settled = true))

    // Let `play()` resolve and the wait attach before the clip ends.
    for (let i = 0; i < 8; i++) await Promise.resolve()
    expect(settled, '还没播完，不该返回').toBe(false)

    element.finish()
    await running
    expect(settled, '片段真的播完了就该返回，不必等满一小时').toBe(true)

    runtime.dispose()
  })
})
