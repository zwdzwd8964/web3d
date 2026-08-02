import { createGoldenPathDocument, z } from '@w3/schema'
import { ActionRegistry, allActions, defaultRegistry, defineAction, getAction, registerBuiltinActions } from '@w3/core'
import type { FieldDescriptor } from '@w3/core'
import { beforeAll, describe, expect, it } from 'vitest'
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

  it('labels media by media.name, which survives a rename — not by the asset file (T-186)', () => {
    // 铁律 3's display-side cousin: the media panel renames `media.name` (T-161); the
    // asset's file name never changes. A dropdown labelled by the file shows the stale
    // import-time name for exactly the records the user cared enough about to rename.
    const withMedia = {
      ...doc,
      assets: [...doc.assets, { ...doc.assets[0]!, id: 'ast_med00001', type: 'audio' as const, name: 'REC_0001.mp3' }],
      media: [{ id: 'med_00000001', type: 'audio' as const, assetId: 'ast_med00001', name: '开机讲解', durationS: 2 }],
    }
    const names = refOptions(withMedia, 'media').map((o) => o.name)
    expect(names).toContain('开机讲解')
    expect(names, '重命名前的文件名不该再出现').not.toContain('REC_0001.mp3')
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
