import { MaterialIdSchema, NodeIdSchema } from '@w3/schema'
import { z } from '@w3/schema'
import { highlightPresetOptions } from '../../highlight-presets.js'
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
  /**
   * null restores the source asset's own material.
   *
   * `.default(null)` is what makes 「留空还原」 work at all. The rule editor DELETES the key
   * when the field is cleared (`RulePanel.tsx`: `if (value === '') delete params[key]`), so
   * without a default the params arrive as `{nodeId}`, zod refuses them for a missing
   * required field, and the executor reports `status: 'failed'` — for the one gesture the
   * label tells the user to make.
   */
  materialId: MaterialIdSchema.nullable().default(null),
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
  /** null clears the highlight. See `SetMaterialParams.materialId` for why `.default(null)`. */
  preset: z.string().nullable().default(null),
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
        // Generated from HIGHLIGHT_PRESETS, never typed alongside it. The hand-written list
        // that used to sit here had four entries against the table's five, which made
        // `outline_white` a preset no user could select — for the whole of v0 and v0.5.
        options: highlightPresetOptions(),
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
  // Kept in step with what `RuntimeContext.resetScene` actually does. v0.5 added lights,
  // highlights and media to that list, and this string did not follow — the generated
  // acceptance document (R14) then described a narrower action than the one that ships.
  describe: () => '停止播放与高亮，将变换、显隐、材质、灯光与变量全部恢复到文档初始状态',
})

/**
 * v1.0 · T-246 · 爆炸视图。参数逐字照规划 §4.3 的冻结条目。
 *
 * `expectType: 'explodeGroup'` 在**编辑期/发布期**由 `checkIntegrity` 消费（I14）；
 * 执行期它是空转的——`REF_KINDS.node` 没有 `expectTypeOf` 钩子，`refTypeOk` 在钩子
 * 缺席时无条件返回 true。所以 B9 的「目标不是爆炸分组就跳过」由**运行时自己**报，
 * 不靠引用检查（两个运行时的措辞在契约套件里逐字比对，T-245）。
 */
const ExplodeParams = z.object({
  nodeId: NodeIdSchema,
  factor: z.number().min(0).max(5).default(1),
  durationS: z.number().min(0).max(60).default(0.6),
  await: z.boolean().default(false),
})

export const explode = defineAction<z.infer<typeof ExplodeParams>>({
  type: 'explode',
  schema: ExplodeParams,
  async handler(ctx, p, signal) {
    const done = ctx.setExplode(p.nodeId, p.factor, { durationS: p.durationS, signal })
    if (p.await) {
      await done
      return
    }
    // `await: false` 必须 `.catch`：一次中断会变成未处理拒绝，在浏览器里是一条用户
    // 会当成 bug 报上来的控制台错误（与 playAnimation 逐字同形）。
    void done.catch(() => undefined)
  },
  ui: {
    label: '爆炸视图',
    group: 'scene',
    icon: 'sparkle',
    fields: [
      { key: 'nodeId', type: 'ref', refKind: 'node', label: '爆炸分组', required: true },
      { key: 'factor', type: 'number', label: '系数（0 即复原）', default: 1, min: 0, max: 5 },
      { key: 'durationS', type: 'number', label: '过渡时长（秒）', default: 0.6, min: 0, max: 60 },
      { key: 'await', type: 'boolean', label: '等待过渡结束再执行下一步', default: false },
    ],
  },
  refs: (p) => [{ kind: 'node', id: p.nodeId, expectType: 'explodeGroup' }],
  describe: (p, doc) =>
    p.factor === 0
      ? `复原分组「${nodeName(doc, p.nodeId)}」的爆炸视图`
      : `将分组「${nodeName(doc, p.nodeId)}」爆炸到 ${p.factor} 成${p.await ? '（等待结束）' : ''}`,
})

export const SCENE_ACTIONS: ActionDefinition<any>[] = [setVisible, setMaterial, highlight, resetScene, explode]
