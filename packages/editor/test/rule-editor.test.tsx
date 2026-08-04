import { createGoldenPathDocument, z } from '@w3/schema'
import type { Rule, SceneDocument } from '@w3/schema'
import { ActionRegistry, HIGHLIGHT_PRESETS, HeadlessRuntime, allActions, defaultRegistry, defineAction, execute, getAction, registerBuiltinActions } from '@w3/core'
import type { FieldDescriptor } from '@w3/core'
import { beforeAll, describe, expect, it } from 'vitest'
import { applyParamChange } from '../src/panels/RulePanel.jsx'
import { refOptions } from '../src/rule-editor/ActionFields.jsx'
import { validateVariableId } from '../src/panels/VariablePanel.jsx'

/**
 * T-091 · the acceptance bar, stated as a test.
 *
 * The task card puts it plainly: "新注册一个动作后，规则编辑器**零改动**即可编辑它（这是
 * C5 的实战检验）". The check that makes that real is not "does the panel render" — it is
 * that every field kind an action may declare has a renderer, and that the rule editor
 * source contains no branch on any specific action type.
 *
 * A DOM test would need jsdom and would still not prove the second half. Reading the
 * source for the forbidden pattern does, and it keeps failing if someone adds the branch
 * later, which is when it actually matters.
 */

const FIELD_KINDS: FieldDescriptor['type'][] = ['ref', 'number', 'boolean', 'string', 'enum', 'valueExpr']

// The host registers; the library does not self-register (ADR-0008). The editor does this
// in `main.tsx`, and these tests exercise the same registry it populates.
beforeAll(() => registerBuiltinActions())

describe('T-091 · a newly registered action needs no UI changes', () => {
  it('every field kind the closed set allows has a renderer', async () => {
    const source = await readSource('src/rule-editor/ActionFields.tsx')
    for (const kind of FIELD_KINDS) {
      expect(source, `FieldDescriptor 的 ${kind} 没有对应分支`).toContain(`case '${kind}':`)
    }
  })

  it('the rule editor branches on no action type at all', async () => {
    const sources = await Promise.all([
      readSource('src/rule-editor/ActionFields.tsx'),
      readSource('src/rule-editor/ConditionRow.tsx'),
      readSource('src/panels/RulePanel.tsx'),
    ])
    const combined = sources.join('\n')

    // Every registered action's type name. If any of them appears in the rule editor,
    // someone hand-wrote a form for it and ECA_SPEC §10's "three files" claim is dead.
    for (const definition of allActions()) {
      expect(combined, `规则编辑器里出现了动作类型名 ${definition.type}，说明有人给它手写了表单`).not.toContain(
        `'${definition.type}'`,
      )
    }
  })

  it('an action registered at runtime exposes a complete, renderable form', () => {
    const registry = new ActionRegistry()
    const fake = defineAction<{ nodeId: string; amount: number; loud: boolean; note: string; kind: string }>({
      type: 'w3TestOnly.shout',
      schema: z.object({
        nodeId: z.string(),
        amount: z.number(),
        loud: z.boolean(),
        note: z.string(),
        kind: z.string(),
      }),
      handler: () => {},
      ui: {
        label: '测试动作',
        group: 'scene',
        fields: [
          { key: 'nodeId', type: 'ref', refKind: 'node', label: '对象' },
          { key: 'amount', type: 'number', label: '数量', min: 0 },
          { key: 'loud', type: 'boolean', label: '大声' },
          { key: 'note', type: 'string', label: '备注' },
          { key: 'kind', type: 'enum', label: '种类', options: [{ value: 'a', label: '甲' }] },
        ],
      },
      refs: (p) => [{ kind: 'node', id: p.nodeId }],
      describe: (p) => `对 ${p.nodeId} 喊 ${p.amount} 次`,
    })
    registry.register(fake)

    const found = registry.get('w3TestOnly.shout')!
    // Everything the panel needs comes off the definition; nothing needs looking up.
    expect(found.ui.label).toBe('测试动作')
    expect(found.ui.fields.map((f) => f.type)).toEqual(['ref', 'number', 'boolean', 'string', 'enum'])
    for (const field of found.ui.fields) expect(FIELD_KINDS).toContain(field.type)
  })
})

describe('refOptions', () => {
  const doc = createGoldenPathDocument()

  it('covers every RefKind an action may declare', () => {
    const declared = new Set(
      allActions().flatMap((d) => d.ui.fields.filter((f) => f.type === 'ref').map((f) => f.refKind)),
    )
    // A ref kind with no options builder renders an empty dropdown — the field would look
    // broken with no explanation, which is the worst of the three possible failures.
    for (const kind of declared) expect(() => refOptions(doc, kind)).not.toThrow()
  })

  it('names entities the way the user does, not by id', () => {
    expect(refOptions(doc, 'node').map((o) => o.name)).toContain('阀盖')
  })

  it('shows a media record by ITS name, not the file it came from (T-186)', () => {
    // The dropdown read the asset's name, which is the filename at import. So renaming a
    // clip 「警报声」 in the media panel changed nothing here — the rule editor went on
    // saying `alarm.wav` — and two clips cut from one file were indistinguishable.
    const withMedia = {
      ...doc,
      assets: [...doc.assets, { ...doc.assets[0]!, id: 'ast_med00001', type: 'audio' as const, name: 'alarm.wav' }],
      media: [
        { id: 'med_00000001', type: 'audio' as const, assetId: 'ast_med00001', name: '警报声', durationS: 2 },
        { id: 'med_00000002', type: 'audio' as const, assetId: 'ast_med00001', name: '解除警报', durationS: 3 },
      ],
    } as SceneDocument

    expect(refOptions(withMedia, 'media').map((o) => o.name), '用户改的是 media.name').toEqual([
      '警报声',
      '解除警报',
    ])
  })
})

describe('T-090 · variable id validation, SCHEMA_SPEC §6.3', () => {
  const none = new Set<string>()

  it('accepts what the pattern allows', () => {
    for (const id of ['step', '_x', 'a1', 'A_b_2']) expect(validateVariableId(id, none)).toBeNull()
  })

  it('rejects what it does not', () => {
    expect(validateVariableId('1step', none)).toMatch(/不能以数字开头/)
    expect(validateVariableId('has-dash', none)).toMatch(/下划线/)
    expect(validateVariableId('x'.repeat(33), none)).toMatch(/32/)
  })

  it('rejects reserved words, which mean something else in a value expression', () => {
    expect(validateVariableId('event', none)).toMatch(/保留字/)
  })

  it('rejects a duplicate', () => {
    expect(validateVariableId('step', new Set(['step']))).toBe('已有同名变量')
  })

  it('says nothing about an empty box, because the user has not typed yet', () => {
    expect(validateVariableId('', none)).toBeNull()
  })
})

describe('the golden path sample stays editable by this panel', () => {
  it('every action it uses is registered and describable', () => {
    const doc = createGoldenPathDocument()
    for (const rule of doc.rules) {
      for (const action of rule.then) {
        const definition = getAction(action.action)
        expect(definition, `样例文档用了未注册的动作 ${action.action}`).toBeDefined()
        expect(() => definition!.describe(action.params, doc)).not.toThrow()
      }
    }
    expect(defaultRegistry.all().length).toBeGreaterThan(0)
  })
})

/** Reads a source file relative to the package root. */
async function readSource(relative: string): Promise<string> {
  const { readFile } = await import('node:fs/promises')
  const { fileURLToPath } = await import('node:url')
  const root = fileURLToPath(new URL('..', import.meta.url))
  return readFile(`${root}${relative}`, 'utf8')
}

/**
 * T-215 · the editor half of 「留空取消高亮」.
 *
 * The card asks for a test that goes through `RulePanel`'s own `onChange`, and this does —
 * `applyParamChange` IS that handler, extracted so it can be reached without a DOM. Testing
 * a re-implementation of the rule would prove nothing; that is how the bug survived two
 * releases in the first place.
 */
describe('T-215 · 选「（未指定）」之后', () => {
  it('drops the key rather than writing an empty string into the document', () => {
    const next = applyParamChange({ nodeId: 'nd_00000001', preset: 'outline_amber' }, 'preset', '')
    expect('preset' in next).toBe(false)
    expect(next).toEqual({ nodeId: 'nd_00000001' })
  })

  it('and those params still execute — status is not `failed`', async () => {
    const doc = createGoldenPathDocument()
    const nodeId = doc.nodes[0]!.id
    const params = applyParamChange({ nodeId, preset: 'outline_amber' }, 'preset', '')

    const ctx = new HeadlessRuntime(doc)
    const registry = registerBuiltinActions(new ActionRegistry())
    const rule: Rule = {
      id: 'rl_00000001',
      name: '取消高亮',
      enabled: true,
      when: { event: 'click', target: { nodeId } },
      if: [],
      ifAny: [],
      then: [{ action: 'highlight', params }],
      mode: 'sequence',
      reentry: 'restart',
      onError: 'continue',
    }
    const result = await execute(rule, ctx, null, new AbortController().signal, { registry })
    expect(result.status, JSON.stringify(result.steps)).not.toBe('failed')
  })

  it('offers every preset in the table, including the one that was unreachable', () => {
    const field = getAction('highlight')!.ui.fields.find((f) => f.key === 'preset')
    const options = field && field.type === 'enum' ? field.options : []
    expect(options.map((o) => o.value)).toEqual(Object.keys(HIGHLIGHT_PRESETS))
    expect(options.map((o) => o.value)).toContain('outline_white')
  })
})
