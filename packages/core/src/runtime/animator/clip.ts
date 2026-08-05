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
  /**
   * 墙钟起点。**可写**：`seek` 一条正在播的动画时把它往前后挪，
   * 下一帧算出来的绝对时间才落在被 seek 到的位置上，而不是把 seek 顶掉。
   */
  startedAt: number
  /** 片段自身的长度（秒）。绝对时间驱动用它做取模与钳位；`durationMs` 已经除过速度了。 */
  readonly clipDurationS: number
  readonly speed: number
  readonly loop: boolean
  signal?: AbortSignal
  onAbort?: () => void
}

export class ClipPlayer {
  private mixers = new Map<string, AnimationMixer>()
  /** 复用中的 scoped clip，键是 `${animationId}|${object.uuid}`。见 `bind`。 */
  private clips = new Map<string, AnimationClip>()
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
      // T-237 · 时间由我们写，不由 mixer 推。见 `update` 的注释。
      action.paused = true
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
        clipDurationS: clip.duration,
        speed: Math.max(animation.speed, 0.0001),
        loop: animation.loop,
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

    // T-237 · **每一帧的姿态由绝对时间算出来，不是从上一帧累加出来的。**
    //
    // 累加式（让 `mixer.update(delta)` 自己推 `action.time`）有两处会在长流程里咬人：
    // 丢帧或标签页休眠之后误差不可逆地留在片段时间里；以及「现在应该是第几秒」这个问题的
    // 答案藏在 three 内部，seek 与重播只能靠 `reset()` 猜。
    //
    // 所以：所有 action 都 `paused = true`（于是 `_updateTimeScale` 返回 0，
    // `_updateTime(0)` 原样返回我们写进去的 `action.time`），`mixer.update(delta)`
    // 只负责推权重、求值、把结果写回对象。**循环取模与末尾钳位因此归我们管**——
    // `_updateTime` 在 delta 为 0 时会直接早退，不做任何 loop 处理。
    for (const playback of this.playing.values()) this.writeTime(playback, nowMs)
    for (const mixer of this.mixers.values()) mixer.update(Math.max(0, delta))

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

  /** 把「现在该是片段的第几秒」写进每条 action。循环取模、非循环钳到末尾。 */
  private writeTime(playback: Playback, nowMs: number): void {
    const elapsedS = (Math.max(0, nowMs - playback.startedAt) / 1000) * playback.speed
    const duration = playback.clipDurationS
    const time = duration <= 0 ? 0 : playback.loop ? elapsedS % duration : Math.min(elapsedS, duration)
    for (const action of playback.actions) action.time = time
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
    // T-237 · 正在播的那条要把墙钟起点一起挪走。绝对时间驱动下光写 `action.time` 不够：
    // 下一帧 `writeTime` 会按原起点重算，把这次 seek 原地顶掉。
    if (playback) {
      playback.startedAt = (this.lastNow ?? playback.startedAt) - (timeSeconds / playback.speed) * 1000
    }
    for (const action of actions) {
      action.time = timeSeconds
      // 一律 paused（T-237）：没在播的本来就停在这一帧，在播的由 `writeTime` 驱动。
      action.paused = true
      if (playback === undefined) action.play()
    }
    for (const mixer of this.mixers.values()) mixer.update(0)
  }

  stopAll(): void {
    for (const id of [...this.playing.keys()]) this.stop(id, { notify: false })
  }

  /** 当前活着的 mixer 数。**「反复排练一段流程」不该让它涨**，验收断的就是它。 */
  get mixerCount(): number {
    return this.mixers.size
  }

  /**
   * T-237 · 把一条动画在 three 内部的缓存交回去。
   *
   * `AnimationMixer` 对每个 `(clip, root)` 组合永久持有一条 `AnimationAction`
   * 与一组 `PropertyMixer`，`stop()` 只是把它停下、不释放。改用共享 clip 之后重复
   * play 不再堆积，但**换资产 / 换绑定时那一份仍然是垃圾**，得显式还。
   */
  releaseFor(animationId: string): void {
    const prefix = `${animationId}|`
    for (const [key, clip] of [...this.clips]) {
      if (!key.startsWith(prefix)) continue
      this.clips.delete(key)
      const mixer = this.mixers.get(key.slice(prefix.length))
      if (!mixer) continue
      mixer.uncacheAction(clip)
      mixer.uncacheClip(clip)
    }
  }

  /**
   * 整图重建前调用：mixer 绑死的是 `Object3D` 引用，重建之后那些对象已经不在场景里了。
   *
   * **不清的话它们会继续被驱动**——每帧照常求值、照常写 position，只是写给一棵没人渲染的
   * 幽灵子树。这与 tween 不同：tween 每帧按 nodeId 重解，天然扛得住重建。
   * **那个不对称是巧合，不是设计。**
   */
  clearMixers(): void {
    this.stopAll()
    for (const [uuid, mixer] of this.mixers) {
      mixer.stopAllAction()
      for (const [key, clip] of this.clips) {
        if (!key.endsWith(`|${uuid}`)) continue
        mixer.uncacheAction(clip)
        mixer.uncacheClip(clip)
      }
      const root = mixer.getRoot()
      if (root) mixer.uncacheRoot(root as Object3D)
    }
    this.mixers.clear()
    this.clips.clear()
    this.lastNow = null
  }

  dispose(): void {
    this.clearMixers()
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
      // T-237 · **scoped clip 按 (animationId, object.uuid) 复用。**
      //
      // `mixer.clipAction(clip, root)` 的缓存键是 `clip.uuid`，而 `new AnimationClip`
      // 每次都是新 uuid——原来每 play 一次就往 mixer 里永久多塞一条 action（实测 5 次 play
      // 得 5 条，全仓零 `uncache`）。同一条动画同一个对象，clip 内容逐字相同，
      // 复用它就是复用那条 action。
      const key = `${animation.id}|${object.uuid}`
      let scoped = this.clips.get(key)
      if (!scoped) {
        scoped = new AnimationClip(`${clip.name}@${object.uuid}`, clip.duration, tracks)
        this.clips.set(key, scoped)
      }
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
