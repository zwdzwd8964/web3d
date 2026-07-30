import { z } from 'zod'
import { VariableId } from './ids.js'
import { Finite } from './primitives.js'

/**
 * Technical assessment §1.2, discipline 4: `variables` is not optional.
 *
 * Without a small state store there is nowhere for a condition to be evaluated and
 * nowhere for a flow to live. It is the single easiest field to forget and the single
 * hardest to retrofit, because every rule and every flow is built on top of it.
 */

export const VARIABLE_TYPES = ['number', 'string', 'boolean'] as const
export const VariableType = z.enum(VARIABLE_TYPES)
export type VariableType = z.infer<typeof VariableType>

export const VariableValue = z.union([Finite, z.string(), z.boolean()])
export type VariableValue = z.infer<typeof VariableValue>

export const Variable = z
  .object({
    id: VariableId,
    name: z.string(),
    type: VariableType,
    default: VariableValue,
  })
  .strict()
  // `VariableType` members are exactly the `typeof` names, so this stays a one-liner.
  .refine((v) => typeof v.default === v.type, {
    message: 'default value does not match the declared variable type',
    path: ['default'],
  })
export type Variable = z.infer<typeof Variable>

/** The runtime's variable map. Not persisted — it is derived state (C1). */
export type VariableBag = Record<string, VariableValue>
