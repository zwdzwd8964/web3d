import { z } from 'zod'
import { AnimationId, HotspotId, MaterialId, NodeId, VariableId, ViewpointId } from '../ids.js'
import { Finite } from '../primitives.js'
import type { ParamField } from './params.js'

/* -------------------------------------------------------------------------- */
/* Value expressions                                                          */
/* -------------------------------------------------------------------------- */

export const ARITHMETIC_OPS = ['add', 'sub', 'mul', 'div'] as const
export type ArithmeticOp = (typeof ARITHMETIC_OPS)[number]

/** What `setVariable` may assign: a literal, another variable, or arithmetic over both. */
export type ValueExpr =
  | { const: number | string | boolean }
  | { var: string }
  | { op: ArithmeticOp; left: ValueExpr; right: ValueExpr }

export const ValueExpr: z.ZodType<ValueExpr> = z.lazy(() =>
  z.union([
    z.object({ const: z.union([Finite, z.string(), z.boolean()]) }).strict(),
    z.object({ var: VariableId }).strict(),
    z.object({ op: z.enum(ARITHMETIC_OPS), left: ValueExpr, right: ValueExpr }).strict(),
  ]),
)

/* -------------------------------------------------------------------------- */
/* Highlight presets                                                          */
/* -------------------------------------------------------------------------- */

/**
 * MVP_V0 §1.3 · presets are named by *intent*, never by implementation.
 *
 * v0 renders them as emissive tint, because v0 deliberately ships no EffectComposer
 * (R07 is pushed whole to v1). When v1 swaps in postprocessing's OutlineEffect, these
 * names stay identical and the schema does not move — which is exactly the C5
 * demonstration the incubation plan asks for.
 */
export const HIGHLIGHT_PRESETS = ['amber', 'cyan', 'red', 'green', 'white'] as const
export type HighlightPreset = (typeof HIGHLIGHT_PRESETS)[number]

/* -------------------------------------------------------------------------- */
/* Action shapes                                                              */
/* -------------------------------------------------------------------------- */

export const PlayAnimationAction = z
  .object({
    action: z.literal('playAnimation'),
    animationId: AnimationId,
    /** null = use the animation's own loop setting. */
    loop: z.boolean().nullable(),
    speed: z.number().positive().nullable(),
  })
  .strict()

export const StopAnimationAction = z
  .object({ action: z.literal('stopAnimation'), animationId: AnimationId })
  .strict()

export const SeekAnimationAction = z
  .object({ action: z.literal('seekAnimation'), animationId: AnimationId, timeMs: z.number().min(0) })
  .strict()

export const SetVisibleAction = z
  .object({ action: z.literal('setVisible'), nodeId: NodeId, visible: z.boolean() })
  .strict()

export const SetMaterialAction = z
  .object({ action: z.literal('setMaterial'), nodeId: NodeId, materialId: MaterialId })
  .strict()

export const HighlightAction = z
  .object({ action: z.literal('highlight'), nodeId: NodeId, preset: z.enum(HIGHLIGHT_PRESETS) })
  .strict()

export const ClearHighlightAction = z
  .object({
    action: z.literal('clearHighlight'),
    /** null = clear every highlight in the scene. */
    nodeId: NodeId.nullable(),
  })
  .strict()

export const MoveCameraAction = z
  .object({ action: z.literal('moveCamera'), viewpointId: ViewpointId, durationMs: z.number().min(0) })
  .strict()

export const OpenPanelAction = z.object({ action: z.literal('openPanel'), hotspotId: HotspotId }).strict()

export const ClosePanelAction = z
  .object({ action: z.literal('closePanel'), hotspotId: HotspotId.nullable() })
  .strict()

export const SetVariableAction = z
  .object({ action: z.literal('setVariable'), variableId: VariableId, value: ValueExpr })
  .strict()

export const WaitAction = z.object({ action: z.literal('wait'), durationMs: z.number().min(0) }).strict()

export const OpenLinkAction = z
  .object({
    action: z.literal('openLink'),
    url: z.string().min(1),
    target: z.enum(['self', 'blank']),
  })
  .strict()

export const ResetSceneAction = z.object({ action: z.literal('resetScene') }).strict()

export const Action = z.discriminatedUnion('action', [
  PlayAnimationAction,
  StopAnimationAction,
  SeekAnimationAction,
  SetVisibleAction,
  SetMaterialAction,
  HighlightAction,
  ClearHighlightAction,
  MoveCameraAction,
  OpenPanelAction,
  ClosePanelAction,
  SetVariableAction,
  WaitAction,
  OpenLinkAction,
  ResetSceneAction,
])
export type Action = z.infer<typeof Action>

export const ACTION_KINDS = [
  'playAnimation',
  'stopAnimation',
  'seekAnimation',
  'setVisible',
  'setMaterial',
  'highlight',
  'clearHighlight',
  'moveCamera',
  'openPanel',
  'closePanel',
  'setVariable',
  'wait',
  'openLink',
  'resetScene',
] as const
export type ActionKind = (typeof ACTION_KINDS)[number]

/* -------------------------------------------------------------------------- */
/* The catalog                                                                */
/* -------------------------------------------------------------------------- */

export const ACTION_GROUPS = ['animation', 'visual', 'camera', 'panel', 'state'] as const
export type ActionGroup = (typeof ACTION_GROUPS)[number]

export interface ActionDescriptor {
  readonly action: ActionKind
  readonly label: string
  readonly group: ActionGroup
  /**
   * D6 · true when the returned promise resolves only once the effect has finished.
   * `mode: "sequence"` awaits these; a fire-and-forget action would make
   * "play the animation, *then* open the panel" impossible (anti-pattern A10).
   */
  readonly awaitable: boolean
  readonly help: string
  readonly params: readonly ParamField[]
  readonly schema: z.ZodType<Action>
}

export const ACTION_CATALOG: Record<ActionKind, ActionDescriptor> = {
  playAnimation: {
    action: 'playAnimation',
    label: '播放动画',
    group: 'animation',
    awaitable: true,
    help: '播放到自然结束时 resolve。循环动画立即 resolve，否则 sequence 会永久挂起（D6）。',
    params: [
      { key: 'animationId', label: '动画', kind: 'animationRef', required: true },
      { key: 'loop', label: '循环', kind: 'boolean', required: false, help: '留空则沿用动画自身设置' },
      { key: 'speed', label: '倍速', kind: 'number', required: false, min: 0.1, max: 8, step: 0.1 },
    ],
    schema: PlayAnimationAction,
  },
  stopAnimation: {
    action: 'stopAnimation',
    label: '停止动画',
    group: 'animation',
    awaitable: false,
    help: '立即停止。等待该动画的 playAnimation 会以中断结束，其所在 sequence 静默终止。',
    params: [{ key: 'animationId', label: '动画', kind: 'animationRef', required: true }],
    schema: StopAnimationAction,
  },
  seekAnimation: {
    action: 'seekAnimation',
    label: '跳转动画进度',
    group: 'animation',
    awaitable: false,
    help: '把动画定位到指定时刻，不改变播放/暂停状态。',
    params: [
      { key: 'animationId', label: '动画', kind: 'animationRef', required: true },
      { key: 'timeMs', label: '时刻', kind: 'duration', required: true, min: 0, step: 100 },
    ],
    schema: SeekAnimationAction,
  },
  setVisible: {
    action: 'setVisible',
    label: '设置显隐',
    group: 'visual',
    awaitable: false,
    help: '仅影响运行时可见性，不写回文档（C1：运行时状态不进文档）。',
    params: [
      { key: 'nodeId', label: '对象', kind: 'nodeRef', required: true },
      { key: 'visible', label: '可见', kind: 'boolean', required: true },
    ],
    schema: SetVisibleAction,
  },
  setMaterial: {
    action: 'setMaterial',
    label: '替换材质',
    group: 'visual',
    awaitable: false,
    help: '写时复制：只影响该节点，共享同一源材质的兄弟节点不受影响（D3 / R08）。',
    params: [
      { key: 'nodeId', label: '对象', kind: 'nodeRef', required: true },
      { key: 'materialId', label: '材质', kind: 'materialRef', required: true },
    ],
    schema: SetMaterialAction,
  },
  highlight: {
    action: 'highlight',
    label: '高亮对象',
    group: 'visual',
    awaitable: false,
    help: 'v0 用自发光叠加实现；v1 换成描边后 preset 名称与 schema 均不变（C5 实战演示）。',
    params: [
      { key: 'nodeId', label: '对象', kind: 'nodeRef', required: true },
      {
        key: 'preset',
        label: '预设',
        kind: 'enum',
        required: true,
        options: [
          { value: 'amber', label: '琥珀' },
          { value: 'cyan', label: '青' },
          { value: 'red', label: '红' },
          { value: 'green', label: '绿' },
          { value: 'white', label: '白' },
        ],
      },
    ],
    schema: HighlightAction,
  },
  clearHighlight: {
    action: 'clearHighlight',
    label: '取消高亮',
    group: 'visual',
    awaitable: false,
    help: '留空对象则取消场景内全部高亮。',
    params: [{ key: 'nodeId', label: '对象', kind: 'nodeRef', required: false }],
    schema: ClearHighlightAction,
  },
  moveCamera: {
    action: 'moveCamera',
    label: '移动相机到视点',
    group: 'camera',
    awaitable: true,
    help: '飞行结束时 resolve。时长为 0 则瞬移并立即 resolve。',
    params: [
      { key: 'viewpointId', label: '视点', kind: 'viewpointRef', required: true },
      { key: 'durationMs', label: '时长', kind: 'duration', required: true, min: 0, step: 100 },
    ],
    schema: MoveCameraAction,
  },
  openPanel: {
    action: 'openPanel',
    label: '打开热点面板',
    group: 'panel',
    awaitable: false,
    help: '打开即返回，不等待用户关闭。',
    params: [{ key: 'hotspotId', label: '热点', kind: 'hotspotRef', required: true }],
    schema: OpenPanelAction,
  },
  closePanel: {
    action: 'closePanel',
    label: '关闭热点面板',
    group: 'panel',
    awaitable: false,
    help: '留空热点则关闭全部已打开面板。',
    params: [{ key: 'hotspotId', label: '热点', kind: 'hotspotRef', required: false }],
    schema: ClosePanelAction,
  },
  setVariable: {
    action: 'setVariable',
    label: '设置变量',
    group: 'state',
    awaitable: false,
    help: '值可以是常量、另一个变量，或两者的四则运算。',
    params: [
      { key: 'variableId', label: '变量', kind: 'variableRef', required: true },
      { key: 'value', label: '值', kind: 'valueExpr', required: true },
    ],
    schema: SetVariableAction,
  },
  wait: {
    action: 'wait',
    label: '等待',
    group: 'state',
    awaitable: true,
    help: '走 ctx.wait()，可被中断，测试中由假时钟推进（D10）。',
    params: [{ key: 'durationMs', label: '时长', kind: 'duration', required: true, min: 0, step: 100 }],
    schema: WaitAction,
  },
  openLink: {
    action: 'openLink',
    label: '打开链接',
    group: 'state',
    awaitable: false,
    help: '由宿主决定如何打开；无头环境（测试 / parity）下只记录不跳转。',
    params: [
      { key: 'url', label: '地址', kind: 'url', required: true },
      {
        key: 'target',
        label: '打开方式',
        kind: 'enum',
        required: true,
        options: [
          { value: 'blank', label: '新窗口' },
          { value: 'self', label: '当前窗口' },
        ],
      },
    ],
    schema: OpenLinkAction,
  },
  resetScene: {
    action: 'resetScene',
    label: '重置场景',
    group: 'state',
    awaitable: false,
    help: '变量回到默认值，显隐/材质/高亮/面板回到文档初始状态，动画全部停止。',
    params: [],
    schema: ResetSceneAction,
  },
}

/** Every action kind must appear in the catalog — asserted in the schema test suite. */
export function actionDescriptor(kind: string): ActionDescriptor | undefined {
  return ACTION_CATALOG[kind as ActionKind]
}
