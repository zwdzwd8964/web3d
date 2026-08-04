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

/** v3 · 多场景（v1.5 才通电）。`project` 作用域的变量跳场景后还在。 */
export const VARIABLE_SCOPES = ['scene', 'project'] as const
export const VariableScopeSchema = z.enum(VARIABLE_SCOPES)
export type VariableScope = z.infer<typeof VariableScopeSchema>
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
    /**
     * v3 · 变量的作用域（多场景，v1.5 才通电）。
     *
     * `'scene'` = 每个场景一份；`'project'` = 整个项目共享，跳场景后还在。默认 `'scene'`
     * 让所有老文档的观感一个字节不变。
     */
    scope: z.enum(VARIABLE_SCOPES).default('scene'),
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
