import { z } from 'zod'
import { AnimationIdSchema, HotspotIdSchema, NodeIdSchema, RuleIdSchema, VariableIdSchema } from './id.js'

/**
 * The document shape of a rule. Semantics live in ECA_SPEC; this file only fixes the
 * data, because @w3/schema must not depend on @w3/core.
 *
 * The single most important decision here is that an action is a GENERIC ENVELOPE:
 *
 *     { action: "playAnimation", params: { animationId: "anm_…", await: true } }
 *
 * Per-action parameter schemas live in core's action registry (ECA_SPEC §4.1), not
 * here. That is precisely what makes ECA_SPEC §10 true — registering a new action
 * touches three files and *none of them is the schema*. A discriminated union of every
 * action type would look tidier and would quietly re-couple every new capability to a
 * schemaVersion bump.
 *
 * The price is that `params` cannot be validated by `validate()` alone. It is validated
 * where the knowledge lives: `checkIntegrity(doc, { actionRefs })` takes a resolver
 * backed by the registry, and the executor parses params through the registered schema
 * before running a handler.
 */

/* -------------------------------------------------------------------------- */
/* Events — ECA_SPEC §2.2                                                     */
/* -------------------------------------------------------------------------- */

export const NodeTargetSchema = z.union([
  z.object({ nodeId: NodeIdSchema }).strict(),
  /**
   * Selecting the "泵组" group in the tree and configuring one interaction must cover
   * its children. Without this, a 34-mesh assembly needs 34 identical rules.
   */
  z.object({ nodeId: NodeIdSchema, includeDescendants: z.literal(true) }).strict(),
  /** Any node — for "click anywhere" style rules. */
  z.object({ any: z.literal(true) }).strict(),
])
export type NodeTarget = z.infer<typeof NodeTargetSchema>

export const TIMER_START_MODES = ['sceneReady', 'manual'] as const

export const EventDescriptorSchema = z.discriminatedUnion('event', [
  z.object({ event: z.literal('sceneReady') }).strict(),
  z.object({ event: z.literal('click'), target: NodeTargetSchema }).strict(),
  z.object({ event: z.literal('hoverEnter'), target: NodeTargetSchema }).strict(),
  z.object({ event: z.literal('hoverLeave'), target: NodeTargetSchema }).strict(),
  z.object({ event: z.literal('hotspotClick'), hotspotId: HotspotIdSchema }).strict(),
  z.object({ event: z.literal('animationEnd'), animationId: AnimationIdSchema }).strict(),
  z.object({ event: z.literal('variableChange'), variableId: VariableIdSchema }).strict(),
  z
    .object({
      event: z.literal('timer'),
      /** Milliseconds. */
      delay: z.number().nonnegative(),
      repeat: z.boolean().default(false),
      startOn: z.enum(TIMER_START_MODES).default('sceneReady'),
    })
    .strict(),
])
export type EventDescriptor = z.infer<typeof EventDescriptorSchema>

/** Every event type a v0 rule may declare. `pageEnter` / `flowStepEnter` arrive in v1. */
export const EVENT_TYPES = [
  'sceneReady',
  'click',
  'hoverEnter',
  'hoverLeave',
  'hotspotClick',
  'animationEnd',
  'variableChange',
  'timer',
] as const
export type EventType = (typeof EVENT_TYPES)[number]

/* -------------------------------------------------------------------------- */
/* Value expressions — ECA_SPEC §3.1                                          */
/* -------------------------------------------------------------------------- */

export const NODE_PROP_KEYS = ['visible', 'materialId', 'positionY'] as const
export const EVENT_PAYLOAD_KEYS = ['nodeId', 'hotspotId', 'animationId'] as const

export const ValueExprSchema = z.union([
  z.object({ const: z.union([z.number().finite(), z.string(), z.boolean()]) }).strict(),
  z.object({ var: VariableIdSchema }).strict(),
  z
    .object({
      prop: z.object({ nodeId: NodeIdSchema, key: z.enum(NODE_PROP_KEYS) }).strict(),
    })
    .strict(),
  /**
   * Reads the payload of the event that fired. This is what lets "highlight whatever
   * was clicked" be one wildcard rule instead of one rule per node.
   */
  z.object({ event: z.enum(EVENT_PAYLOAD_KEYS) }).strict(),
])
export type ValueExpr = z.infer<typeof ValueExprSchema>

/* -------------------------------------------------------------------------- */
/* Conditions — ECA_SPEC §3.2                                                 */
/* -------------------------------------------------------------------------- */

export const COMPARE_OPS = ['eq', 'ne', 'gt', 'gte', 'lt', 'lte'] as const
export type CompareOp = (typeof COMPARE_OPS)[number]

export const ConditionSchema = z.union([
  z.object({ op: z.enum(COMPARE_OPS), left: ValueExprSchema, right: ValueExprSchema }).strict(),
  z
    .object({
      op: z.literal('in'),
      left: ValueExprSchema,
      right: z.array(z.union([z.number().finite(), z.string(), z.boolean()])),
    })
    .strict(),
  z.object({ op: z.literal('isVisible'), nodeId: NodeIdSchema, value: z.boolean() }).strict(),
  z.object({ op: z.literal('isPlaying'), animationId: AnimationIdSchema, value: z.boolean() }).strict(),
  z.object({ op: z.literal('isPanelOpen'), hotspotId: HotspotIdSchema, value: z.boolean() }).strict(),
])
export type Condition = z.infer<typeof ConditionSchema>

/* -------------------------------------------------------------------------- */
/* Actions — a generic envelope, see the file header                          */
/* -------------------------------------------------------------------------- */

export const ActionSchema = z
  .object({
    /** Must match a `type` registered in core's action registry. */
    action: z.string().min(1),
    params: z.record(z.string(), z.unknown()).default({}),
  })
  .strict()
export type Action = z.infer<typeof ActionSchema>

/* -------------------------------------------------------------------------- */
/* Rules — SCHEMA_SPEC §6.6                                                   */
/* -------------------------------------------------------------------------- */

export const EXECUTION_MODES = ['sequence', 'parallel'] as const
export type ExecutionMode = (typeof EXECUTION_MODES)[number]

/**
 * MVP_V0 D9 · re-entry. The technical assessment never covered it and it must be
 * decided before the first rule ships: a user triple-clicks, three sequences overlap,
 * animations and variables fight, and the resulting bug only shows up during the demo.
 */
export const REENTRY_POLICIES = ['restart', 'ignore', 'queue'] as const
export type ReentryPolicy = (typeof REENTRY_POLICIES)[number]

export const REENTRY_LABELS: Record<ReentryPolicy, string> = {
  restart: '重新开始（中断上一次）',
  ignore: '忽略（上一次未结束时丢弃新触发）',
  queue: '排队（上一次结束后依次执行）',
}

export const ON_ERROR_MODES = ['abort', 'continue'] as const
export type OnErrorMode = (typeof ON_ERROR_MODES)[number]

export const RuleSchema = z
  .object({
    id: RuleIdSchema,
    name: z.string().min(1),
    enabled: z.boolean().default(true),
    when: EventDescriptorSchema,
    /**
     * SCHEMA_SPEC §6.6 · two flat arrays, deliberately NOT an arbitrarily nested
     * boolean tree. Editing UI for a nested tree costs several times more, while ~95%
     * of real conditions are "these all hold". Complex logic is expressed by splitting
     * into two rules with an intermediate variable — which also keeps the rule table
     * convertible into acceptance test cases (R14).
     */
    if: z.array(ConditionSchema).default([]),
    ifAny: z.array(ConditionSchema).default([]),
    mode: z.enum(EXECUTION_MODES).default('sequence'),
    reentry: z.enum(REENTRY_POLICIES).default('restart'),
    onError: z.enum(ON_ERROR_MODES).default('abort'),
    then: z.array(ActionSchema).min(1),
  })
  .strict()
export type Rule = z.infer<typeof RuleSchema>
