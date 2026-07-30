import type { TweenAnimation } from '@w3/schema'
import { Quaternion, Vector3 } from 'three'
import { AbortError } from '../../eca/types.js'
import { ease } from '../easing.js'
import type { SceneGraph } from '../scene-graph.js'

/**
 * T-038 · tween playback.
 *
 * Three things this has to get right, all of them in MVP_V0 D6:
 *   - `from` absent means "capture the live state when playback starts", which is what
 *     almost every authored tween wants and is impossible to express otherwise;
 *   - rotation interpolates by slerp, not component-wise — lerping quaternions takes the
 *     wrong path around the sphere and looks like a glitch;
 *   - a LOOPING tween resolves its promise immediately, because it never ends and any
 *     sequence awaiting it would hang forever.
 *
 * Time arrives through `update(nowMs)` from the render loop, so tests drive it by hand
 * and never touch the wall clock.
 */

interface Track {
  readonly nodeId: string
  readonly from: { p?: Vector3; r?: Quaternion; s?: Vector3 }
  readonly to: { p?: Vector3; r?: Quaternion; s?: Vector3 }
}

interface Playback {
  readonly animation: TweenAnimation
  readonly tracks: Track[]
  readonly startedAt: number
  readonly durationMs: number
  readonly resolve: () => void
  readonly reject: (error: unknown) => void
  readonly settleOnStart: boolean
  onAbort?: () => void
  signal?: AbortSignal
  done: boolean
}

export interface TweenPlayerEvents {
  /** Fired on natural completion and on interruption, mirroring ECA_SPEC §2.1. */
  onAnimationEnd?: (animationId: string, completed: boolean) => void
}

const _v = new Vector3()
const _q = new Quaternion()

export class TweenPlayer {
  private playing = new Map<string, Playback>()

  constructor(
    private readonly graph: SceneGraph,
    private readonly events: TweenPlayerEvents = {},
  ) {}

  isPlaying(animationId: string): boolean {
    return this.playing.has(animationId)
  }

  get activeCount(): number {
    return this.playing.size
  }

  /**
   * @param nowMs current time from the same source `update` will be given
   * @returns a promise that resolves at natural end, or immediately when `loop` is set
   */
  play(animation: TweenAnimation, nowMs: number, options: { signal?: AbortSignal } = {}): Promise<void> {
    if (options.signal?.aborted) return Promise.reject(new AbortError())

    // Restarting replaces the previous run of the same animation.
    this.stop(animation.id, { reset: false, notify: true })

    const tracks = this.captureTracks(animation)

    return new Promise<void>((resolve, reject) => {
      const playback: Playback = {
        animation,
        tracks,
        startedAt: nowMs,
        durationMs: animation.duration * 1000,
        resolve,
        reject,
        settleOnStart: animation.loop,
        done: false,
      }

      if (options.signal) {
        const onAbort = () => this.abort(animation.id)
        playback.signal = options.signal
        playback.onAbort = onAbort
        options.signal.addEventListener('abort', onAbort, { once: true })
      }

      this.playing.set(animation.id, playback)

      // D6 · a looping tween keeps running but its promise settles now.
      if (playback.settleOnStart) resolve()
    })
  }

  /** Advances every active tween. Called once per frame by the render loop. */
  update(nowMs: number): void {
    for (const [id, playback] of [...this.playing]) {
      const elapsed = nowMs - playback.startedAt
      const { animation, durationMs } = playback

      let progress = durationMs <= 0 ? 1 : elapsed / durationMs
      let finished = false

      if (animation.loop) {
        const cycles = Math.floor(progress)
        let local = progress - cycles
        // yoyo: every odd cycle plays backwards, so the motion reads as a shuttle
        // rather than snapping back to the start each time.
        if (animation.yoyo && cycles % 2 === 1) local = 1 - local
        progress = local
      } else if (progress >= 1) {
        progress = animation.yoyo ? 0 : 1
        finished = true
      } else if (animation.yoyo) {
        progress = progress < 0.5 ? progress * 2 : (1 - progress) * 2
      }

      this.sample(playback, progress)

      if (finished) {
        this.playing.delete(id)
        playback.done = true
        this.detach(playback)
        this.events.onAnimationEnd?.(id, true)
        playback.resolve()
      }
    }
  }

  /** Jumps to a point in the timeline without changing play state. */
  seek(animation: TweenAnimation, timeSeconds: number): void {
    const playback = this.playing.get(animation.id)
    const tracks = playback?.tracks ?? this.captureTracks(animation)
    const progress = animation.duration <= 0 ? 1 : timeSeconds / animation.duration
    this.sample({ ...(playback ?? ({} as Playback)), animation, tracks }, Math.max(0, Math.min(1, progress)))
  }

  stop(animationId: string, options: { reset?: boolean; notify?: boolean } = {}): void {
    const playback = this.playing.get(animationId)
    if (!playback) return
    this.playing.delete(animationId)
    this.detach(playback)

    if (options.reset) this.sample(playback, 0)

    if (options.notify !== false) this.events.onAnimationEnd?.(animationId, false)
    // A stopped animation is not an error for whoever awaited it; the executor treats
    // the rejection as a cancellation and swallows it (ECA_SPEC §5.3).
    if (!playback.settleOnStart) playback.reject(new AbortError())
  }

  private abort(animationId: string): void {
    this.stop(animationId, { reset: false, notify: true })
  }

  stopAll(): void {
    for (const id of [...this.playing.keys()]) this.stop(id, { notify: false })
  }

  private detach(playback: Playback): void {
    if (playback.signal && playback.onAbort) {
      playback.signal.removeEventListener('abort', playback.onAbort)
    }
  }

  /** Reads each target's live transform so an omitted `from` starts where it is now. */
  private captureTracks(animation: TweenAnimation): Track[] {
    const tracks: Track[] = []
    for (const target of animation.targets) {
      const object = this.graph.objectFor(target.nodeId)
      if (!object) continue

      const from: Track['from'] = {}
      const to: Track['to'] = {}

      if (target.to.p) {
        from.p = target.from?.p ? new Vector3(...target.from.p) : object.position.clone()
        to.p = new Vector3(...target.to.p)
      }
      if (target.to.r) {
        from.r = target.from?.r ? new Quaternion(...target.from.r) : object.quaternion.clone()
        to.r = new Quaternion(...target.to.r)
      }
      if (target.to.s) {
        from.s = target.from?.s ? new Vector3(...target.from.s) : object.scale.clone()
        to.s = new Vector3(...target.to.s)
      }
      tracks.push({ nodeId: target.nodeId, from, to })
    }
    return tracks
  }

  private sample(playback: Pick<Playback, 'animation' | 'tracks'>, progress: number): void {
    const k = ease(playback.animation.easing, progress)
    for (const track of playback.tracks) {
      const object = this.graph.objectFor(track.nodeId)
      if (!object) continue
      if (track.from.p && track.to.p) {
        object.position.copy(_v.copy(track.from.p).lerp(track.to.p, k))
      }
      if (track.from.r && track.to.r) {
        // slerp, not lerp: component-wise interpolation of quaternions takes the long
        // way round and reads as a glitch mid-rotation.
        object.quaternion.copy(_q.copy(track.from.r).slerp(track.to.r, k))
      }
      if (track.from.s && track.to.s) {
        object.scale.copy(_v.copy(track.from.s).lerp(track.to.s, k))
      }
      object.updateMatrix()
    }
  }
}
