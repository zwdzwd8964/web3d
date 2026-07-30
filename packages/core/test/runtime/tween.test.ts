import type { TweenAnimation } from '@w3/schema'
import { createGoldenPathDocument } from '@w3/schema'
import { beforeEach, describe, expect, it } from 'vitest'
import { TweenPlayer } from '../../src/runtime/animator/tween.js'
import { EASING_FUNCTIONS, ease } from '../../src/runtime/easing.js'
import { SceneGraph } from '../../src/runtime/scene-graph.js'
import { IDS } from '../helpers.js'
import { createPumpAsset } from './fixtures.js'

/** T-038 · MVP_V0 D6. Time comes from `update(now)`, so nothing here touches the clock. */

const LIFT: TweenAnimation = createGoldenPathDocument().animations[0] as TweenAnimation

const looping = (over: Partial<TweenAnimation> = {}): TweenAnimation => ({ ...LIFT, loop: true, ...over })

let graph: SceneGraph
let player: TweenPlayer
let ended: { id: string; completed: boolean }[]

beforeEach(() => {
  graph = new SceneGraph({ assets: createPumpAsset().source })
  graph.build(createGoldenPathDocument())
  ended = []
  player = new TweenPlayer(graph, { onAnimationEnd: (id, completed) => ended.push({ id, completed }) })
})

const y = () => graph.objectFor(IDS.cover)!.position.y

describe('easing', () => {
  it('every member of the closed enum has a function', () => {
    expect(Object.keys(EASING_FUNCTIONS).sort()).toEqual(
      [
        'linear',
        'easeInQuad',
        'easeOutQuad',
        'easeInOutQuad',
        'easeInCubic',
        'easeOutCubic',
        'easeInOutCubic',
        'easeInBack',
        'easeOutBack',
        'easeInOutBack',
      ].sort(),
    )
  })

  it('every curve starts at 0 and ends at 1', () => {
    for (const [name, fn] of Object.entries(EASING_FUNCTIONS)) {
      expect(fn(0), name).toBeCloseTo(0, 6)
      expect(fn(1), name).toBeCloseTo(1, 6)
    }
  })

  it('clamps out-of-range progress', () => {
    expect(ease('linear', -5)).toBe(0)
    expect(ease('linear', 5)).toBe(1)
  })

  it('back curves deliberately overshoot in the middle', () => {
    // That overshoot is the whole point of "back"; clamping it would make the name a lie.
    expect(EASING_FUNCTIONS.easeOutBack(0.5)).toBeGreaterThan(0.5)
    expect(EASING_FUNCTIONS.easeInBack(0.5)).toBeLessThan(0.5)
  })
})

describe('playback', () => {
  it('interpolates from the live transform to the target', async () => {
    const promise = player.play(LIFT, 0)
    expect(y()).toBe(0)

    player.update(600) // half of 1.2 s
    expect(y()).toBeGreaterThan(0)
    expect(y()).toBeLessThan(0.35)

    player.update(1200)
    await promise
    expect(y()).toBeCloseTo(0.35, 6)
  })

  it('D6 · resolves only at natural completion', async () => {
    let settled = false
    void player.play(LIFT, 0).then(() => {
      settled = true
    })

    player.update(1199)
    await Promise.resolve()
    expect(settled).toBe(false)

    player.update(1200)
    await Promise.resolve()
    expect(settled).toBe(true)
    expect(ended).toEqual([{ id: LIFT.id, completed: true }])
  })

  it('D6 / B2 · a looping tween resolves IMMEDIATELY and keeps running', async () => {
    const animation = looping()
    // Awaiting a looping animation must not hang the sequence containing it.
    await expect(player.play(animation, 0)).resolves.toBeUndefined()
    expect(player.isPlaying(animation.id)).toBe(true)

    player.update(1800) // 1.5 cycles
    expect(y()).toBeGreaterThan(0)
    expect(player.isPlaying(animation.id)).toBe(true)
  })

  it('an omitted `from` captures the live state at play time, not at author time', async () => {
    graph.objectFor(IDS.cover)!.position.set(0, 0.2, 0)
    void player.play(LIFT, 0).catch(() => undefined)
    player.update(0)
    expect(y()).toBeCloseTo(0.2, 6)
    player.update(1200)
    expect(y()).toBeCloseTo(0.35, 6)
  })

  it('an explicit `from` overrides the live state', async () => {
    graph.objectFor(IDS.cover)!.position.set(0, 5, 0)
    const withFrom: TweenAnimation = {
      ...LIFT,
      targets: [{ nodeId: IDS.cover, from: { p: [0, 0, 0] }, to: { p: [0, 0.35, 0] } }],
    }
    void player.play(withFrom, 0).catch(() => undefined)
    player.update(0)
    expect(y()).toBeCloseTo(0, 6)
  })

  it('interpolates rotation by slerp rather than component-wise', async () => {
    const spin: TweenAnimation = {
      ...LIFT,
      targets: [{ nodeId: IDS.cover, to: { r: [0, 0.7071068, 0, 0.7071068] } }],
    }
    void player.play(spin, 0).catch(() => undefined)
    player.update(600)
    // A unit quaternion stays unit under slerp; lerp would shorten it.
    expect(graph.objectFor(IDS.cover)!.quaternion.length()).toBeCloseTo(1, 6)
  })

  it('yoyo returns to the start by the end of a non-looping run', async () => {
    const promise = player.play({ ...LIFT, yoyo: true }, 0)
    player.update(600)
    expect(y()).toBeCloseTo(0.35, 5)
    player.update(1200)
    await promise
    expect(y()).toBeCloseTo(0, 5)
  })

  it('zero-length tweens land on the target instead of dividing by zero', async () => {
    const instant: TweenAnimation = { ...LIFT, duration: 0.0001 }
    const promise = player.play(instant, 0)
    player.update(1)
    await promise
    expect(y()).toBeCloseTo(0.35, 6)
  })

  it('replaying restarts rather than stacking two runs', async () => {
    void player.play(LIFT, 0).catch(() => undefined)
    player.update(600)
    void player.play(LIFT, 600).catch(() => undefined)
    expect(player.activeCount).toBe(1)
  })

  it('skips a target whose node is not in the graph', async () => {
    const dangling: TweenAnimation = { ...LIFT, targets: [{ nodeId: 'nd_99999999', to: { p: [0, 1, 0] } }] }
    const promise = player.play(dangling, 0)
    expect(() => player.update(1200)).not.toThrow()
    await promise
  })
})

describe('interruption (ECA_SPEC §5.3)', () => {
  it('stop leaves the object where it is — snapping back would be a visible glitch', async () => {
    const promise = player.play(LIFT, 0)
    promise.catch(() => undefined)
    player.update(600)
    const mid = y()

    player.stop(LIFT.id)

    expect(y()).toBe(mid)
    expect(player.isPlaying(LIFT.id)).toBe(false)
    expect(ended).toEqual([{ id: LIFT.id, completed: false }])
    await expect(promise).rejects.toThrow()
  })

  it('stop with reset rewinds to the start', async () => {
    const promise = player.play(LIFT, 0)
    promise.catch(() => undefined)
    player.update(600)
    player.stop(LIFT.id, { reset: true })
    expect(y()).toBeCloseTo(0, 6)
  })

  it('an AbortSignal stops it and rejects', async () => {
    const controller = new AbortController()
    const promise = player.play(LIFT, 0, { signal: controller.signal })
    const settled = promise.then(
      () => 'resolved',
      () => 'rejected',
    )
    player.update(300)
    controller.abort()
    expect(await settled).toBe('rejected')
    expect(player.isPlaying(LIFT.id)).toBe(false)
  })

  it('an already-aborted signal rejects without starting', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(player.play(LIFT, 0, { signal: controller.signal })).rejects.toThrow()
    expect(player.activeCount).toBe(0)
  })

  it('stopping a LOOPING tween does not reject — its promise already resolved', async () => {
    const animation = looping()
    await player.play(animation, 0)
    expect(() => player.stop(animation.id)).not.toThrow()
    expect(player.isPlaying(animation.id)).toBe(false)
  })

  it('stopAll clears everything without emitting end events', async () => {
    void player.play(LIFT, 0).catch(() => undefined)
    player.stopAll()
    expect(player.activeCount).toBe(0)
    expect(ended).toEqual([])
  })
})

describe('seek', () => {
  it('positions without changing play state', () => {
    player.seek(LIFT, 0.6)
    expect(y()).toBeGreaterThan(0)
    expect(player.isPlaying(LIFT.id)).toBe(false)

    player.seek(LIFT, 1.2)
    expect(y()).toBeCloseTo(0.35, 6)
  })
})
