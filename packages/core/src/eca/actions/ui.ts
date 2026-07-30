import { HotspotIdSchema } from '@w3/schema'
import { z } from '@w3/schema'
import type { ActionDefinition } from '../types.js'
import { defineAction, hotspotName } from './define.js'

/** ECA_SPEC §4.2 · panel and link actions. */

const OpenPanelParams = z.object({ hotspotId: HotspotIdSchema })

export const openPanel = defineAction<z.infer<typeof OpenPanelParams>>({
  type: 'openPanel',
  schema: OpenPanelParams,
  handler(ctx, p) {
    ctx.openPanel(p.hotspotId)
  },
  ui: {
    label: '打开热点面板',
    group: 'ui',
    icon: 'panel',
    fields: [{ key: 'hotspotId', type: 'ref', refKind: 'hotspot', label: '热点', required: true }],
  },
  refs: (p) => [{ kind: 'hotspot', id: p.hotspotId }],
  describe: (p, doc) => `打开热点「${hotspotName(doc, p.hotspotId)}」的面板`,
})

const ClosePanelParams = z.object({
  hotspotId: z.union([HotspotIdSchema, z.literal('all')]),
})

export const closePanel = defineAction<z.infer<typeof ClosePanelParams>>({
  type: 'closePanel',
  schema: ClosePanelParams,
  handler(ctx, p) {
    ctx.closePanel(p.hotspotId)
  },
  ui: {
    label: '关闭热点面板',
    group: 'ui',
    icon: 'panel-off',
    fields: [{ key: 'hotspotId', type: 'ref', refKind: 'hotspot', label: '热点（留空关闭全部）', required: false }],
  },
  refs: (p) => (p.hotspotId === 'all' ? [] : [{ kind: 'hotspot' as const, id: p.hotspotId }]),
  describe: (p, doc) => (p.hotspotId === 'all' ? '关闭全部面板' : `关闭热点「${hotspotName(doc, p.hotspotId)}」的面板`),
})

const OpenLinkParams = z.object({
  url: z.string().min(1),
  target: z.enum(['_blank', '_self']).default('_blank'),
})

export const openLink = defineAction<z.infer<typeof OpenLinkParams>>({
  type: 'openLink',
  schema: OpenLinkParams,
  handler(ctx, p) {
    ctx.openLink(p.url, p.target)
  },
  ui: {
    label: '打开链接',
    group: 'ui',
    icon: 'link',
    fields: [
      { key: 'url', type: 'string', label: '地址' },
      {
        key: 'target',
        type: 'enum',
        label: '打开方式',
        options: [
          { value: '_blank', label: '新窗口' },
          { value: '_self', label: '当前窗口' },
        ],
      },
    ],
  },
  refs: () => [],
  describe: (p) => `打开链接 ${p.url}${p.target === '_blank' ? '（新窗口）' : ''}`,
})

export const UI_ACTIONS: ActionDefinition<any>[] = [openPanel, closePanel, openLink]
