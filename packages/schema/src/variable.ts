import { z } from 'zod'
import { VariableIdSchema } from './id.js'

/**
 * SCHEMA_SPEC §6.3 · variables.
 *
 * The technical assessment (§1.2, discipline 4) singles this out: without a small state
 * store there is nowhere for a condition to be evaluated and nowhere for a flow to live.
 * It is the easiest field to forget and the hardest to retrofit, because every rule and
 * every future flow sits on top of it. v1's `flows` are literally "the current step is a
 * variable", so getting this right now is not optional.
 */

export const VARIABLE_TYPES = ['number', 'string', 'boolean', 'enum'] as const
export const VariableTypeSchema = z.enum(VARIABLE_TYPES)
export type VariableType = z.infer<typeof VariableTypeSchema>

export const VariableValueSchema = z.union([z.number().finite(), z.string(), z.boolean()])
export type VariableValue = z.infer<typeof VariableValueSchema>

export const VariableSchema = z
  .object({
    id: VariableIdSchema,
    /** Chinese display name. */
    name: z.string().min(1),
    type: VariableTypeSchema,
    default: VariableValueSchema,
    /** Required when `type === 'enum'`; checked by checkIntegrity I5. */
    options: z.array(z.string()).optional(),
    /** Persist across sessions. v0 ignores it; the field lands now to avoid a migration. */
    persist: z.boolean().default(false),
  })
  .strict()
export type Variable = z.infer<typeof VariableSchema>

/** Runtime variable state. Derived, never persisted (C1). */
export type VariableBag = Record<string, VariableValue>

/** True when `value` is assignable to a variable of type `type`. No implicit coercion. */
export function isValueOfType(value: VariableValue, type: VariableType): boolean {
  if (type === 'enum') return typeof value === 'string'
  return typeof value === type
}
