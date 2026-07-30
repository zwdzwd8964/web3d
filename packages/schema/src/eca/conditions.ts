import { z } from 'zod'
import { AnimationId, NodeId, VariableId } from '../ids.js'
import { Finite } from '../primitives.js'

/** A leaf value in a condition: either a variable read or a literal. */
export const Operand = z.union([
  z.object({ var: VariableId }).strict(),
  z.object({ const: z.union([Finite, z.string(), z.boolean()]) }).strict(),
])
export type Operand = z.infer<typeof Operand>

export const COMPARE_OPS = ['eq', 'ne', 'gt', 'gte', 'lt', 'lte'] as const
export type CompareOp = (typeof COMPARE_OPS)[number]

/**
 * Conditions are data, not code (anti-pattern A6). Keeping them as a closed
 * algebraic structure is what lets the engine be unit-tested without a GPU (C8)
 * and what lets the rule table generate acceptance test skeletons (R14).
 */
export type Condition =
  | { op: CompareOp; left: Operand; right: Operand }
  | { op: 'and'; conditions: Condition[] }
  | { op: 'or'; conditions: Condition[] }
  | { op: 'not'; condition: Condition }
  | { op: 'nodeVisible'; nodeId: string; expected: boolean }
  | { op: 'animationPlaying'; animationId: string; expected: boolean }

export const Condition: z.ZodType<Condition> = z.lazy(() =>
  z.union([
    z.object({ op: z.enum(COMPARE_OPS), left: Operand, right: Operand }).strict(),
    z.object({ op: z.literal('and'), conditions: z.array(Condition).min(1) }).strict(),
    z.object({ op: z.literal('or'), conditions: z.array(Condition).min(1) }).strict(),
    z.object({ op: z.literal('not'), condition: Condition }).strict(),
    z.object({ op: z.literal('nodeVisible'), nodeId: NodeId, expected: z.boolean() }).strict(),
    z.object({ op: z.literal('animationPlaying'), animationId: AnimationId, expected: z.boolean() }).strict(),
  ]),
)

/** Human-readable labels for the rule editor. Keys must cover every `op` above. */
export const CONDITION_OP_LABELS: Record<string, string> = {
  eq: '等于',
  ne: '不等于',
  gt: '大于',
  gte: '大于或等于',
  lt: '小于',
  lte: '小于或等于',
  and: '全部满足',
  or: '任一满足',
  not: '取反',
  nodeVisible: '对象可见性为',
  animationPlaying: '动画播放状态为',
}
