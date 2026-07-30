import type { ImportedAnimation, SceneDocument } from '@w3/schema'
import { AnimationClip, AnimationMixer, LoopOnce, LoopRepeat, PropertyBinding } from 'three'
import type { AnimationAction, KeyframeTrack, Object3D } from 'three'
import { AbortError } from '../../eca/types.js'
import type { SceneGraph } from '../scene-graph.js'
import type { AssetSource } from '../types.js'

/**
 * T-037 · playing a clip that came with the GLB.
 *
 * The hard part is binding, and it is worth stating plainly. A glTF clip addresses its
 * targets by the object's name inside the asset (`Body.position`). Our scene graph does
 * not reproduce the asset's hierarchy: each document node materialises ONE asset object
 * as an independent instance, and the user is free to rename it to 阀盖. three's
 * `PropertyBinding` resolves names by searching the root's subtree, so handing it the
 * clip unchanged finds nothing — or, worse, finds a same-named object belonging to a
 * different part.
 *
 * So tracks are resolved here, explicitly: group them by the document node their asset
 * object name maps to, then bind each group against that node's Object3D directly.
 * `findNode` returns the root when the track's node name equals the root's uuid, so
 * naming the track after the object's own uuid makes the binding exact and immune to
 * duplicate names.
 *
 * Promise semantics follow MVP_V0 D6 exactly, same as the tween player: natural end
 * resolves, a looping clip resolves IMMEDIATELY, interruption rejects with AbortError.
 */

export interface ClipPlayerEvents {
  readonly onAnimationEnd?: (animationId: string, completed: boolean) => void
  readonly onWarn?: (message: string) => void
}

interface Playback {
  readonly actions: AnimationAction[]
  /** The objects the clip drives, so an interrupted run can be frozen where it is. */
  readonly targets: Object3D[]
  readonly resolve: () => void
  readonly reject: (error: unknown) => void
  /** True for a looping clip: the promise already settled when playback began. */
  readonly settled: boolean
  readonly durationMs: number
  readonly startedAt: number
  signal?: AbortSignal
  onAbort?: () => void
}

export class ClipPlayer {
  private mixers = new Map<string, AnimationMixer>()
  private playing = new Map<string, Playback>()
  private lastNow: number | null = null

  constructor(
    private readonly graph: SceneGraph,
    private readonly assets: AssetSource,
    private readonly events: ClipPlayerEvents = {},
  ) {}

  isPlaying(animationId: string): boolean {
    return this.playing.has(animationId)
  }

  get activeCount(): number {
    return this.playing.size
  }

  play(
    animation: ImportedAnimation,
    doc: SceneDocument,
    nowMs: number,
    options: { signal?: AbortSignal } = {},
  ): Promise<void> {
    if (options.signal?.aborted) return Promise.reject(new AbortError())

    const loaded = this.assets.get(animation.assetId)
    if (!loaded) {
      this.events.onWarn?.(`动画「${animation.name}」的资产尚未加载`)
      return Promise.resolve()
    }
    const clip = loaded.clips.find((c) => c.name === animation.clipName)
    if (!clip) {
      this.events.onWarn?.(
        `资产中不存在名为「${animation.clipName}」的动画片段（可用：${loaded.clips.map((c) => c.name).join('、') || '无'}）`,
      )
      return Promise.resolve()
    }

    this.stop(animation.id, { notify: true })

    const { actions, targets } = this.bind(animation, clip, doc)
    if (actions.length === 0) {
      this.events.onWarn?.(
        `动画「${animation.name}」的所有轨道都没有对应的场景对象，可能是资产重新映射后目标已失效`,
      )
      return Promise.resolve()
    }

    const durationMs = (clip.duration / Math.max(animation.speed, 0.0001)) * 1000

    for (const action of actions) {
      action.reset()
      action.setLoop(animation.loop ? LoopRepeat : LoopOnce, animation.loop ? Number.POSITIVE_INFINITY : 1)
      action.clampWhenFinished = animation.clampWhenFinished
      action.timeScale = animation.speed
      action.play()
    }

    return new Promise<void>((resolve, reject) => {
      const playback: Playback = {
        actions,
        targets,
        resolve,
        reject,
        settled: animation.loop,
        durationMs,
        startedAt: nowMs,
      }
      if (options.signal) {
        const onAbort = () => this.stop(animation.id, { notify: true })
        playback.signal = options.signal
        playback.onAbort = onAbort
        options.signal.addEventListener('abort', onAbort, { once: true })
      }
      this.playing.set(animation.id, playback)

      // D6 · a looping clip never ends; awaiting it would hang the sequence forever.
      if (animation.loop) resolve()
    })
  }

  /**
   * Advances every mixer.
   *
   * Completion is decided by elapsed time rather than by three's `finished` event: the
   * event fires per action, and one animation may drive several. Time is the same signal
   * the tween player uses, which keeps the two consistent under a fake clock.
   */
  update(nowMs: number): void {
    const delta = this.lastNow === null ? 0 : (nowMs - this.lastNow) / 1000
    this.lastNow = nowMs
    if (delta > 0) for (const mixer of this.mixers.values()) mixer.update(delta)

    for (const [id, playback] of [...this.playing]) {
      if (playback.settled) continue
      if (nowMs - playback.startedAt < playback.durationMs) continue
      this.playing.delete(id)
      this.detach(playback)
      if (!playback.actions[0]?.clampWhenFinished) for (const action of playback.actions) action.stop()
      this.events.onAnimationEnd?.(id, true)
      playback.resolve()
    }
  }

  stop(animationId: string, options: { reset?: boolean; notify?: boolean } = {}): void {
    const playback = this.playing.get(animationId)
    if (!playback) return
    this.playing.delete(animationId)
    this.detach(playback)

    // ECA_SPEC §5.3 · a cancelled animation stops on its CURRENT frame. three's
    // `action.stop()` unbinds the mixer, which restores each property to the value it
    // held before playback — the object would visibly snap back to the start, which
    // reads as a glitch rather than as a stop.
    const frozen = options.reset ? null : playback.targets.map(captureTransform)

    for (const action of playback.actions) {
      if (options.reset) action.reset()
      action.stop()
    }

    if (frozen) {
      playback.targets.forEach((object, i) => restoreTransform(object, frozen[i]!))
    }

    if (options.notify !== false) this.events.onAnimationEnd?.(animationId, false)
    // §5.3 · cancellation is not an error; the executor swallows the rejection.
    if (!playback.settled) playback.reject(new AbortError())
  }

  seek(animation: ImportedAnimation, doc: SceneDocument, timeSeconds: number): void {
    const playback = this.playing.get(animation.id)
    const actions = playback?.actions ?? this.bindExisting(animation, doc)
    for (const action of actions) {
      action.time = timeSeconds
      action.paused = playback === undefined
      if (playback === undefined) action.play()
    }
    for (const mixer of this.mixers.values()) mixer.update(0)
  }

  stopAll(): void {
    for (const id of [...this.playing.keys()]) this.stop(id, { notify: false })
  }

  dispose(): void {
    this.stopAll()
    for (const mixer of this.mixers.values()) mixer.stopAllAction()
    this.mixers.clear()
    this.lastNow = null
  }

  private detach(playback: Playback): void {
    if (playback.signal && playback.onAbort) playback.signal.removeEventListener('abort', playback.onAbort)
  }

  private bindExisting(animation: ImportedAnimation, doc: SceneDocument): AnimationAction[] {
    const loaded = this.assets.get(animation.assetId)
    const clip = loaded?.clips.find((c) => c.name === animation.clipName)
    return clip ? this.bind(animation, clip, doc).actions : []
  }

  /** One action per target object, each bound against that object directly. */
  private bind(
    animation: ImportedAnimation,
    clip: AnimationClip,
    doc: SceneDocument,
  ): { actions: AnimationAction[]; targets: Object3D[] } {
    const byObject = new Map<Object3D, KeyframeTrack[]>()

    for (const track of clip.tracks) {
      const parsed = PropertyBinding.parseTrackName(track.name)
      const target = this.resolveTarget(animation.assetId, parsed.nodeName, doc)
      if (!target) continue

      // Address the object by its own uuid: PropertyBinding.findNode returns the root
      // when the track's node name matches the root's uuid, so binding is exact and a
      // duplicate object name elsewhere in the scene cannot capture it.
      const rebound = track.clone()
      rebound.name = `${target.uuid}.${parsed.propertyName}${parsed.propertyIndex ? `[${parsed.propertyIndex}]` : ''}`

      const list = byObject.get(target)
      if (list) list.push(rebound)
      else byObject.set(target, [rebound])
    }

    const actions: AnimationAction[] = []
    const targets: Object3D[] = []
    for (const [object, tracks] of byObject) {
      const mixer = this.mixerFor(object)
      const scoped = new AnimationClip(`${clip.name}@${object.uuid}`, clip.duration, tracks)
      actions.push(mixer.clipAction(scoped, object))
      targets.push(object)
    }
    return { actions, targets }
  }

  /**
   * Maps a track's asset-side object name to the document node instantiated from it.
   *
   * Matching on `assetRef.objectName` rather than on the node's display name is the whole
   * point: the user renames 「Body」 to 「泵体」 on day one, and an animation that stopped
   * working because of a rename would be indistinguishable from a broken export.
   */
  private resolveTarget(assetId: string, objectName: string, doc: SceneDocument): Object3D | null {
    const candidates = doc.nodes.filter(
      (node) => node.assetRef?.assetId === assetId && !node.assetRef.missing && node.assetRef.objectName === objectName,
    )
    if (candidates.length === 0) return null
    if (candidates.length > 1) {
      this.events.onWarn?.(
        `资产对象「${objectName}」对应 ${candidates.length} 个场景节点，动画只驱动第一个（${candidates[0]!.name}）`,
      )
    }
    return this.graph.objectFor(candidates[0]!.id) ?? null
  }

  private mixerFor(object: Object3D): AnimationMixer {
    const existing = this.mixers.get(object.uuid)
    if (existing) return existing
    const mixer = new AnimationMixer(object)
    this.mixers.set(object.uuid, mixer)
    return mixer
  }
}

interface FrozenTransform {
  readonly position: [number, number, number]
  readonly quaternion: [number, number, number, number]
  readonly scale: [number, number, number]
}

const captureTransform = (object: Object3D): FrozenTransform => ({
  position: [object.position.x, object.position.y, object.position.z],
  quaternion: [object.quaternion.x, object.quaternion.y, object.quaternion.z, object.quaternion.w],
  scale: [object.scale.x, object.scale.y, object.scale.z],
})

function restoreTransform(object: Object3D, frozen: FrozenTransform): void {
  object.position.set(...frozen.position)
  object.quaternion.set(...frozen.quaternion)
  object.scale.set(...frozen.scale)
  object.updateMatrix()
}
