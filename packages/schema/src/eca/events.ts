import { z } from 'zod'
import { AnimationId, HotspotId, NodeId, VariableId } from '../ids.js'
import type { ParamField } from './params.js'

/**
 * The v0 event vocabulary.
 *
 * `pageEnter` and `flowStepEnter` from the technical assessment §1.3 are deliberately
 * absent: pages and flows have no v0 runtime, and registering an event nothing can
 * ever fire would put an untestable entry in the registry (breaking the C8 coverage
 * gate) while letting authors build rules that silently never run. Adding them in v1
 * is an enum widening — old documents stay valid, so it costs one triage decision,
 * not a migration.
 */

export const SceneStartTrigger = z.object({ event: z.literal('sceneStart') }).strict()
export const ClickTrigger = z.object({ event: z.literal('click'), nodeId: NodeId }).strict()
export const HoverEnterTrigger = z.object({ event: z.literal('hoverEnter'), nodeId: NodeId }).strict()
export const HoverLeaveTrigger = z.object({ event: z.literal('hoverLeave'), nodeId: NodeId }).strict()
export const HotspotClickTrigger = z.object({ event: z.literal('hotspotClick'), hotspotId: HotspotId }).strict()
export const AnimationEndTrigger = z.object({ event: z.literal('animationEnd'), animationId: AnimationId }).strict()
export const VariableChangeTrigger = z.object({ event: z.literal('variableChange'), variableId: VariableId }).strict()
export const TimerTrigger = z
  .object({
    event: z.literal('timer'),
    intervalMs: z.number().int().positive(),
    repeat: z.boolean(),
  })
  .strict()

export const EventTrigger = z.discriminatedUnion('event', [
  SceneStartTrigger,
  ClickTrigger,
  HoverEnterTrigger,
  HoverLeaveTrigger,
  HotspotClickTrigger,
  AnimationEndTrigger,
  VariableChangeTrigger,
  TimerTrigger,
])
export type EventTrigger = z.infer<typeof EventTrigger>

export const EVENT_KINDS = [
  'sceneStart',
  'click',
  'hoverEnter',
  'hoverLeave',
  'hotspotClick',
  'animationEnd',
  'variableChange',
  'timer',
] as const
export type EventKind = (typeof EVENT_KINDS)[number]

export interface EventDescriptor {
  readonly event: EventKind
  readonly label: string
  readonly help: string
  readonly params: readonly ParamField[]
}

export const EVENT_CATALOG: Record<EventKind, EventDescriptor> = {
  sceneStart: {
    event: 'sceneStart',
    label: '场景启动时',
    help: '文档加载完成、首帧渲染前触发一次。',
    params: [],
  },
  click: {
    event: 'click',
    label: '点击对象',
    help: '射线拾取命中该节点时触发。被遮挡的节点不会触发。',
    params: [{ key: 'nodeId', label: '对象', kind: 'nodeRef', required: true }],
  },
  hoverEnter: {
    event: 'hoverEnter',
    label: '鼠标移入对象',
    help: '指针从未命中变为命中该节点时触发一次。',
    params: [{ key: 'nodeId', label: '对象', kind: 'nodeRef', required: true }],
  },
  hoverLeave: {
    event: 'hoverLeave',
    label: '鼠标移出对象',
    help: '指针从命中变为未命中该节点时触发一次。',
    params: [{ key: 'nodeId', label: '对象', kind: 'nodeRef', required: true }],
  },
  hotspotClick: {
    event: 'hotspotClick',
    label: '点击热点',
    help: '点击热点标记时触发。被遮挡且开启遮挡检测的热点不会触发。',
    params: [{ key: 'hotspotId', label: '热点', kind: 'hotspotRef', required: true }],
  },
  animationEnd: {
    event: 'animationEnd',
    label: '动画结束时',
    help: '动画自然播放结束时触发；被 stopAnimation 或中断终止时不触发。',
    params: [{ key: 'animationId', label: '动画', kind: 'animationRef', required: true }],
  },
  variableChange: {
    event: 'variableChange',
    label: '变量变化时',
    help: '变量被写入且新值不等于旧值时触发。写入相同值不触发。',
    params: [{ key: 'variableId', label: '变量', kind: 'variableRef', required: true }],
  },
  timer: {
    event: 'timer',
    label: '定时触发',
    help: '按间隔触发。时间来自 ctx.now()，因此在测试中完全可控（D10）。',
    params: [
      { key: 'intervalMs', label: '间隔', kind: 'duration', required: true, min: 16, step: 100 },
      { key: 'repeat', label: '重复', kind: 'boolean', required: true },
    ],
  },
}
