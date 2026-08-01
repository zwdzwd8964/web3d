import { MediaIdSchema } from '@w3/schema'
import { z } from '@w3/schema'
import type { ActionDefinition } from '../types.js'
import { defineAction } from './define.js'

/** v0.5 进化规划 §4.3 · media actions. */

const PlayMediaParams = z.object({
  mediaId: MediaIdSchema,
  /** Hold the sequence until the clip finishes. Default false — same as `playAnimation`. */
  await: z.boolean().default(false),
  loop: z.boolean().default(false),
  volume: z.number().min(0).max(1).default(1),
})

/**
 * D19 · the media actions share the animation actions' promise semantics exactly.
 *
 * `await: true` suspends the sequence for `durationS` — through `ctx.wait`, so a headless
 * run advances a fake clock and the whole thing is testable with no audio hardware (C8).
 * The three boundaries below all resolve IMMEDIATELY, and each has a reason:
 *
 * - **`loop: true`** — a looping clip has no end, so awaiting it would hang the sequence
 *   for ever. Same boundary `playAnimation` draws (D6), and the card marks it 必测.
 * - **`durationS` missing** — the browser would not report a length at import (T-160). We
 *   do not know how long to wait, and inventing a number would hang a sequence on a value
 *   nobody measured. Resolve and warn.
 * - **autoplay refused** — handled inside `ctx.playMedia`, which resolves rather than
 *   rejects (risk V3). A rejection here would abort the whole chain: 「响完铃再弹面板」
 *   would become 「铃没响，面板也没弹」, and the user would see nothing at all rather
 *   than one missing sound.
 */
const playMedia = defineAction<z.infer<typeof PlayMediaParams>>({
  type: 'playMedia',
  schema: PlayMediaParams,
  async handler(ctx, p, signal) {
    await ctx.playMedia(p.mediaId, {
      loop: p.loop,
      volume: p.volume,
      ...(signal ? { signal } : {}),
    })
    if (!p.await) return

    if (p.loop) {
      ctx.log('debug', `playMedia：「${mediaName(ctx.doc, p.mediaId)}」是循环播放，不等待其结束`)
      return
    }

    const durationS = ctx.doc.media.find((m) => m.id === p.mediaId)?.durationS
    if (durationS === undefined) {
      ctx.log(
        'warn',
        `playMedia：「${mediaName(ctx.doc, p.mediaId)}」没有时长记录（导入时浏览器未能读出），无法等待其播完，本步立即继续。`,
      )
      return
    }

    await ctx.wait(durationS * 1000, signal)
  },
  ui: {
    label: '播放媒体',
    group: 'scene',
    icon: 'sound',
    fields: [
      // `refKind: 'media'` has been in `FieldDescriptor` since v0 (ECA_SPEC §4.4), so the
      // rule editor grows this form with no change at all — C5's acceptance evidence.
      { key: 'mediaId', type: 'ref', refKind: 'media', label: '媒体', required: true },
      { key: 'await', type: 'boolean', label: '等待播完' },
      { key: 'loop', type: 'boolean', label: '循环播放' },
      { key: 'volume', type: 'number', label: '音量', min: 0, max: 1, step: 0.05 },
    ],
  },
  // `expectType: 'audio'` is what makes I14's third clause real. `playMedia` accepts audio
  // only (进化规划 §1.3 灰区裁决：视频进 ECA 动作 —— 不做), and the picker cannot enforce it
  // because `refKind: 'media'` lists every media record. Without this the check had no
  // producer at all: a video clip selected here passed integrity, passed the publish gate,
  // and failed at play time with 「浏览器不允许自动播放」 — a diagnosis with nothing to do
  // with the cause.
  refs: (p) => [{ kind: 'media', id: p.mediaId, expectType: 'audio' }],
  describe: (p, doc) => {
    const parts: string[] = []
    if (p.loop) parts.push('循环')
    if (p.await && !p.loop) parts.push('等待播完')
    if (p.volume !== 1) parts.push(`音量 ${Math.round(p.volume * 100)}%`)
    const how = parts.length > 0 ? `（${parts.join(' / ')}）` : ''
    return `播放媒体「${mediaName(doc, p.mediaId)}」${how}`
  },
})

const StopMediaParams = z.object({
  /** A media id, or `'all'`. The literal is what 「停止全部声音」 needs to be expressible. */
  mediaId: z.union([MediaIdSchema, z.literal('all')]),
})

const stopMedia = defineAction<z.infer<typeof StopMediaParams>>({
  type: 'stopMedia',
  schema: StopMediaParams,
  handler(ctx, p) {
    ctx.stopMedia(p.mediaId)
  },
  ui: {
    label: '停止媒体',
    group: 'scene',
    icon: 'sound-off',
    fields: [
      // Not a `ref` field: `'all'` is a legal value and a media picker cannot offer it.
      // A string with the format in its label is the same trade `setLight`'s colour makes —
      // `FieldDescriptor` is a closed set of six kinds and a new action must not widen it.
      { key: 'mediaId', type: 'string', label: '媒体 ID，或填 all 停止全部' },
    ],
  },
  // `'all'` refers to nothing in particular, so it contributes no reference — otherwise the
  // integrity check would report a dangling media id called "all" on every scene that uses it.
  refs: (p) => (p.mediaId === 'all' ? [] : [{ kind: 'media', id: p.mediaId }]),
  describe: (p, doc) => (p.mediaId === 'all' ? '停止全部媒体' : `停止媒体「${mediaName(doc, p.mediaId)}」`),
})

/** The media record's display name, or the raw id when it has gone missing. */
function mediaName(doc: { media: readonly { id: string; name: string }[] }, mediaId: string): string {
  return doc.media.find((m) => m.id === mediaId)?.name ?? mediaId
}

// The registry is heterogeneous by design (ECA_SPEC §10); this matches every other list.
export const MEDIA_ACTIONS: ActionDefinition<any>[] = [playMedia, stopMedia]
