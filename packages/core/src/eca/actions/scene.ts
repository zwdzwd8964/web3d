import { MaterialIdSchema, NodeIdSchema } from '@w3/schema'
import { z } from '@w3/schema'
import type { ActionDefinition } from '../types.js'
import { defineAction, materialName, nodeName } from './define.js'

/** ECA_SPEC §4.2 · scene actions. */

const SetVisibleParams = z.object({
  nodeId: NodeIdSchema,
  value: z.boolean(),
  includeDescendants: z.boolean().default(false),
})

export const setVisible = defineAction<z.infer<typeof SetVisibleParams>>({
  type: 'setVisible',
  schema: SetVisibleParams,
  handler(ctx, p) {
    ctx.setVisible(p.nodeId, p.value, { includeDescendants: p.includeDescendants })
  },
  ui: {
    label: '设置显隐',
    group: 'scene',
    icon: 'eye',
    fields: [
      { key: 'nodeId', type: 'ref', refKind: 'node', label: '对象', required: true },
      { key: 'value', type: 'boolean', label: '可见', default: true },
      { key: 'includeDescendants', type: 'boolean', label: '包含子对象', default: false },
    ],
  },
  refs: (p) => [{ kind: 'node', id: p.nodeId }],
  describe: (p, doc) =>
    `${p.value ? '显示' : '隐藏'}对象「${nodeName(doc, p.nodeId)}」${p.includeDescendants ? '及其子对象' : ''}`,
})

const SetMaterialParams = z.object({
  nodeId: NodeIdSchema,
  /** null restores the source asset's own material. */
  materialId: MaterialIdSchema.nullable(),
})

export const setMaterial = defineAction<z.infer<typeof SetMaterialParams>>({
  type: 'setMaterial',
  schema: SetMaterialParams,
  handler(ctx, p) {
    ctx.setMaterial(p.nodeId, p.materialId)
  },
  ui: {
    label: '替换材质',
    group: 'scene',
    icon: 'palette',
    fields: [
      { key: 'nodeId', type: 'ref', refKind: 'node', label: '对象', required: true },
      { key: 'materialId', type: 'ref', refKind: 'material', label: '材质（留空还原）', required: false },
    ],
  },
  refs: (p) => (p.materialId === null ? [{ kind: 'node' as const, id: p.nodeId }] : [
    { kind: 'node' as const, id: p.nodeId },
    { kind: 'material' as const, id: p.materialId },
  ]),
  describe: (p, doc) =>
    p.materialId === null
      ? `还原对象「${nodeName(doc, p.nodeId)}」的原始材质`
      : `将对象「${nodeName(doc, p.nodeId)}」的材质替换为「${materialName(doc, p.materialId)}」`,
})

const HighlightParams = z.object({
  nodeId: NodeIdSchema,
  /** null clears the highlight. Preset names are semantic, never implementation names. */
  preset: z.string().nullable(),
  includeDescendants: z.boolean().default(false),
})

export const highlight = defineAction<z.infer<typeof HighlightParams>>({
  type: 'highlight',
  schema: HighlightParams,
  handler(ctx, p) {
    ctx.highlight(p.nodeId, p.preset, { includeDescendants: p.includeDescendants })
  },
  ui: {
    label: '高亮对象',
    group: 'scene',
    icon: 'sparkle',
    fields: [
      { key: 'nodeId', type: 'ref', refKind: 'node', label: '对象', required: true },
      {
        key: 'preset',
        type: 'enum',
        label: '预设（留空取消）',
        options: [
          { value: 'outline_amber', label: '琥珀' },
          { value: 'outline_cyan', label: '青' },
          { value: 'outline_red', label: '红' },
          { value: 'outline_green', label: '绿' },
        ],
      },
      { key: 'includeDescendants', type: 'boolean', label: '包含子对象', default: false },
    ],
  },
  refs: (p) => [{ kind: 'node', id: p.nodeId }],
  describe: (p, doc) =>
    p.preset === null ? `取消对象「${nodeName(doc, p.nodeId)}」的高亮` : `高亮对象「${nodeName(doc, p.nodeId)}」`,
})

const ResetSceneParams = z.object({})

export const resetScene = defineAction<z.infer<typeof ResetSceneParams>>({
  type: 'resetScene',
  schema: ResetSceneParams,
  handler(ctx) {
    ctx.resetScene()
  },
  ui: { label: '重置场景', group: 'scene', icon: 'rotate', fields: [] },
  refs: () => [],
  describe: () => '停止全部媒体，并将变换、显隐、材质、灯光与变量全部恢复到文档初始状态',
})

export const SCENE_ACTIONS: ActionDefinition<any>[] = [setVisible, setMaterial, highlight, resetScene]
