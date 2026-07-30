import { ViewpointIdSchema } from '@w3/schema'
import { z } from '@w3/schema'
import type { ActionDefinition } from '../types.js'
import { defineAction, viewpointName } from './define.js'

/**
 * ECA_SPEC §4.2 · camera.
 *
 * `moveCamera` can only fly to a SAVED viewpoint. Letting a rule specify arbitrary
 * coordinates would mean hand-authoring a camera inside the rule editor: the form
 * explodes in complexity and almost nobody gets it right. Saving a viewpoint first is
 * both simpler to build and simpler to explain.
 */

const MoveCameraParams = z.object({
  viewpointId: ViewpointIdSchema,
  /** Seconds. 0 jumps instantly. */
  duration: z.number().min(0).default(1),
  await: z.boolean().default(true),
})

export const moveCamera = defineAction<z.infer<typeof MoveCameraParams>>({
  type: 'moveCamera',
  schema: MoveCameraParams,
  async handler(ctx, p, signal) {
    const done = ctx.moveCamera(p.viewpointId, { duration: p.duration, signal })
    if (p.await) {
      await done
      return
    }
    void done.catch(() => undefined)
  },
  ui: {
    label: '移动相机到视点',
    group: 'camera',
    icon: 'camera',
    fields: [
      { key: 'viewpointId', type: 'ref', refKind: 'viewpoint', label: '视点', required: true },
      { key: 'duration', type: 'number', label: '飞行时长（秒）', min: 0, step: 0.1, default: 1 },
      { key: 'await', type: 'boolean', label: '等待到位再执行下一步', default: true },
    ],
  },
  refs: (p) => [{ kind: 'viewpoint', id: p.viewpointId }],
  describe: (p, doc) =>
    `相机飞到视点「${viewpointName(doc, p.viewpointId)}」${p.duration > 0 ? `（${p.duration} 秒）` : '（瞬移）'}`,
})

export const CAMERA_ACTIONS: ActionDefinition<any>[] = [moveCamera]
