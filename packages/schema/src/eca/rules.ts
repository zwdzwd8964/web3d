import { z } from 'zod'
import { RuleId } from '../ids.js'
import { Action } from './actions.js'
import { Condition } from './conditions.js'
import { EventTrigger } from './events.js'

export const EXECUTION_MODES = ['sequence', 'parallel'] as const
export type ExecutionMode = (typeof EXECUTION_MODES)[number]

/**
 * D9 · re-entry policy. The technical assessment never covered this and it has to be
 * decided before the first rule ships.
 *
 * A user triple-clicks. Without a policy, three sequences overlap, animations and
 * variables fight each other, and the resulting bug is close to unreproducible.
 * Default is `restart`: abort the in-flight run's signal and begin again.
 */
export const REENTRY_POLICIES = ['restart', 'ignore', 'queue'] as const
export type ReentryPolicy = (typeof REENTRY_POLICIES)[number]

export const REENTRY_LABELS: Record<ReentryPolicy, string> = {
  restart: '重新开始（中断上一次）',
  ignore: '忽略（上一次未结束时丢弃新触发）',
  queue: '排队（上一次结束后依次执行）',
}

export const Rule = z
  .object({
    id: RuleId,
    name: z.string(),
    enabled: z.boolean(),
    when: EventTrigger,
    /** Empty array = always true. All entries must hold (implicit AND). */
    if: z.array(Condition),
    mode: z.enum(EXECUTION_MODES),
    reentry: z.enum(REENTRY_POLICIES),
    then: z.array(Action).min(1),
  })
  .strict()
export type Rule = z.infer<typeof Rule>
