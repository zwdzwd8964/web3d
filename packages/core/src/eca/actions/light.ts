import { HexColorSchema, NodeIdSchema } from '@w3/schema'
import { z } from '@w3/schema'
import type { ActionDefinition } from '../types.js'
import { defineAction, nodeName } from './define.js'

/** v0.5 进化规划 §4.3 · light actions. */

/**
 * Both fields optional, and at least one is expected — a `setLight` with neither is legal
 * and does nothing, exactly like `setVisible` with the value it already has. Rejecting it
 * would mean a half-filled form in the rule editor could not be saved, which is worse than
 * a step that no-ops.
 *
 * There is deliberately no `angleDeg`, `range` or `shadow` here. The frozen action list
 * (进化规划 §4.3) is intensity and colour: they are what a scene actually animates in
 * response to an event ("alarm on → the spot goes hot"), while cone angle and shadow
 * quality are authoring decisions. Widening this is a schema-and-spec change, not a
 * convenience — which is the point of the list being frozen.
 */
const SetLightParams = z.object({
  nodeId: NodeIdSchema,
  intensity: z.number().min(0).max(20).optional(),
  color: HexColorSchema.optional(),
})

export const setLight = defineAction<z.infer<typeof SetLightParams>>({
  type: 'setLight',
  schema: SetLightParams,
  handler(ctx, p) {
    ctx.setLight(p.nodeId, {
      ...(p.intensity === undefined ? {} : { intensity: p.intensity }),
      ...(p.color === undefined ? {} : { color: p.color }),
    })
  },
  ui: {
    label: '调整灯光',
    group: 'scene',
    icon: 'bulb',
    fields: [
      // `refKind: 'node'` rather than a light-specific kind: the rule editor renders
      // exactly the seven kinds ECA_SPEC §4.4 closes over, and lights ARE nodes (D12).
      // A node picker that offers every node and an action that skips non-lights with an
      // error is the same trade the other node actions make.
      { key: 'nodeId', type: 'ref', refKind: 'node', label: '灯光对象', required: true },
      { key: 'intensity', type: 'number', label: '强度', min: 0, max: 20, step: 0.1 },
      // A plain string, not a colour picker: `FieldDescriptor` is a closed set of six
      // kinds (ECA_SPEC §4.4) and the rule editor renders exactly those. Adding a
      // `'color'` kind would be a spec change and a rule-editor change — and v0.5's whole
      // claim is that a new action needs neither. The label carries the format instead,
      // and the zod schema rejects anything that is not `#rrggbb` before it ever runs.
      { key: 'color', type: 'string', label: '颜色（#rrggbb）' },
    ],
  },
  refs: (p) => [{ kind: 'node', id: p.nodeId }],
  describe: (p, doc) => {
    const parts: string[] = []
    if (p.intensity !== undefined) parts.push(`强度 ${p.intensity}`)
    if (p.color !== undefined) parts.push(`颜色 ${p.color}`)
    const what = parts.length > 0 ? parts.join(' / ') : '（未设置任何参数）'
    return `将灯光「${nodeName(doc, p.nodeId)}」调整为 ${what}`
  },
})

export const LIGHT_ACTIONS: ActionDefinition<any>[] = [setLight]
