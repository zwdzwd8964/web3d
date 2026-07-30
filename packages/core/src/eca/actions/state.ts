import { ValueExprSchema, VariableIdSchema } from '@w3/schema'
import { z } from '@w3/schema'
import { evaluateValueExpr } from '../conditions.js'
import type { ActionDefinition } from '../types.js'
import { defineAction, variableName } from './define.js'

/** ECA_SPEC §4.2 · variable and timing actions. */

const SetVariableParams = z.object({
  variableId: VariableIdSchema,
  value: ValueExprSchema,
  mode: z.enum(['set', 'add']).default('set'),
})

export const setVariable = defineAction<z.infer<typeof SetVariableParams>>({
  type: 'setVariable',
  schema: SetVariableParams,
  handler(ctx, p) {
    // The value may read the triggering event ({ event: 'nodeId' }), which is why the
    // context exposes `currentEvent()` — see the note on RuntimeContext.
    const resolved = evaluateValueExpr(p.value, ctx, ctx.currentEvent())
    if (resolved === undefined) {
      ctx.log('warn', `setVariable：值表达式无法求值，变量「${p.variableId}」未被修改`, { value: p.value })
      return
    }
    if (p.mode === 'add') {
      const current = ctx.getVar(p.variableId)
      if (typeof current !== 'number' || typeof resolved !== 'number') {
        ctx.log('warn', `setVariable：add 模式要求变量与值都是数字，变量「${p.variableId}」未被修改`, {
          current,
          resolved,
        })
        return
      }
      ctx.setVar(p.variableId, current + resolved)
      return
    }
    ctx.setVar(p.variableId, resolved)
  },
  ui: {
    label: '设置变量',
    group: 'state',
    icon: 'variable',
    fields: [
      { key: 'variableId', type: 'ref', refKind: 'variable', label: '变量', required: true },
      { key: 'value', type: 'valueExpr', label: '值' },
      {
        key: 'mode',
        type: 'enum',
        label: '写入方式',
        options: [
          { value: 'set', label: '赋值' },
          { value: 'add', label: '累加' },
        ],
      },
    ],
  },
  refs: (p) => {
    const out: { kind: 'variable' | 'node'; id: string }[] = [{ kind: 'variable', id: p.variableId }]
    if ('var' in p.value) out.push({ kind: 'variable', id: p.value.var })
    if ('prop' in p.value) out.push({ kind: 'node', id: p.value.prop.nodeId })
    return out
  },
  describe: (p, doc) => {
    const value =
      'const' in p.value
        ? String(p.value.const)
        : 'var' in p.value
          ? `变量「${variableName(doc, p.value.var)}」的值`
          : 'prop' in p.value
            ? `对象属性 ${p.value.prop.key}`
            : `事件的 ${p.value.event}`
    return `${p.mode === 'add' ? '累加到' : '设置'}变量「${variableName(doc, p.variableId)}」为 ${value}`
  },
})

const WaitParams = z.object({
  /** Milliseconds. */
  ms: z.number().min(0),
})

/**
 * Not in the technical assessment's action list, and required anyway: without it,
 * "highlight, pause a second, open the panel" — the single most common bit of
 * choreography — is impossible, and authors resort to fake looping animations to
 * fake a delay.
 */
export const wait = defineAction<z.infer<typeof WaitParams>>({
  type: 'wait',
  schema: WaitParams,
  async handler(ctx, p, signal) {
    await ctx.wait(p.ms, signal)
  },
  ui: {
    label: '等待',
    group: 'state',
    icon: 'clock',
    fields: [{ key: 'ms', type: 'number', label: '时长（毫秒）', min: 0, step: 100, default: 500 }],
  },
  refs: () => [],
  describe: (p) => `等待 ${p.ms} 毫秒`,
})

export const STATE_ACTIONS: ActionDefinition<any>[] = [setVariable, wait]
