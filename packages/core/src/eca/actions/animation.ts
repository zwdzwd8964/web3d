import { AnimationIdSchema } from '@w3/schema'
import { z } from '@w3/schema'
import type { ActionDefinition } from '../types.js'
import { animationName, defineAction } from './define.js'

/** ECA_SPEC §4.2 / §4.3 · animation actions. */

const PlayParams = z.object({
  animationId: AnimationIdSchema,
  await: z.boolean().default(true),
  restart: z.boolean().default(true),
})

export const playAnimation = defineAction<z.infer<typeof PlayParams>>({
  type: 'playAnimation',
  schema: PlayParams,
  async handler(ctx, p, signal) {
    // T-253 · `restart: false` 从前是一条**从未被执行过**的分支：两个运行时的 `play()`
    // 都无条件先停上一次，所以不管这个参数是什么，结果都是重播——与 UI 文案
    // 「若正在播放则从头开始」正相反。
    //
    // 收口成与文案一致：**已经在播就什么都不做，本步立即结束**。
    // ⚠ `await` 与否都不再等待已在跑的那一次——我们没有持有它的 promise。
    // 这一句要回写进 ECA_SPEC §4.2（T-296）。
    if (!p.restart && ctx.isAnimationPlaying(p.animationId)) {
      ctx.log('debug', `动画「${p.animationId}」已在播放，restart:false 时本步跳过`)
      return
    }
    if (p.restart) ctx.stopAnimation(p.animationId, { reset: true })
    const done = ctx.playAnimation(p.animationId, { signal })
    if (p.await) {
      await done
      return
    }
    // Fire-and-forget still has to own its rejection: an aborted animation would
    // otherwise surface as an unhandled promise rejection and, in a browser, as a
    // console error the user reports as a bug.
    void done.catch(() => undefined)
  },
  ui: {
    label: '播放动画',
    group: 'animation',
    icon: 'play',
    fields: [
      { key: 'animationId', type: 'ref', refKind: 'animation', label: '动画', required: true },
      { key: 'await', type: 'boolean', label: '等待播放完成再执行下一步', default: true },
      { key: 'restart', type: 'boolean', label: '若正在播放则从头开始', default: true },
    ],
  },
  refs: (p) => [{ kind: 'animation', id: p.animationId }],
  describe: (p, doc) => `播放动画「${animationName(doc, p.animationId)}」${p.await ? '（等待播完）' : ''}`,
})

const StopParams = z.object({
  animationId: AnimationIdSchema,
  reset: z.boolean().default(false),
})

export const stopAnimation = defineAction<z.infer<typeof StopParams>>({
  type: 'stopAnimation',
  schema: StopParams,
  handler(ctx, p) {
    ctx.stopAnimation(p.animationId, { reset: p.reset })
  },
  ui: {
    label: '停止动画',
    group: 'animation',
    icon: 'stop',
    fields: [
      { key: 'animationId', type: 'ref', refKind: 'animation', label: '动画', required: true },
      // §5.3: a cancelled animation stays on its current frame; jumping back to the
      // start produces a visible snap, so it is opt-in rather than the default.
      { key: 'reset', type: 'boolean', label: '回到起始状态', default: false },
    ],
  },
  refs: (p) => [{ kind: 'animation', id: p.animationId }],
  describe: (p, doc) => `停止动画「${animationName(doc, p.animationId)}」${p.reset ? '并回到起始状态' : ''}`,
})

const SeekParams = z.object({
  animationId: AnimationIdSchema,
  /** Seconds, matching SCHEMA_SPEC §6.2's tween duration unit. */
  time: z.number().min(0),
})

export const seekAnimation = defineAction<z.infer<typeof SeekParams>>({
  type: 'seekAnimation',
  schema: SeekParams,
  handler(ctx, p) {
    ctx.seekAnimation(p.animationId, p.time)
  },
  ui: {
    label: '跳转动画进度',
    group: 'animation',
    fields: [
      { key: 'animationId', type: 'ref', refKind: 'animation', label: '动画', required: true },
      { key: 'time', type: 'number', label: '时刻（秒）', min: 0, step: 0.1, default: 0 },
    ],
  },
  refs: (p) => [{ kind: 'animation', id: p.animationId }],
  describe: (p, doc) => `将动画「${animationName(doc, p.animationId)}」跳转到 ${p.time} 秒`,
})

export const ANIMATION_ACTIONS: ActionDefinition<any>[] = [playAnimation, stopAnimation, seekAnimation]
