import { PREFIXES, checkIntegrity, createGoldenPathDocument } from '@w3/schema'
import type { SceneDocument } from '@w3/schema'
import { beforeAll, describe, expect, it } from 'vitest'
import { ActionRegistry, createActionRefResolver, registerBuiltinActions } from '../../src/eca/actions/index.js'
import type { ActionDefinition } from '../../src/eca/types.js'

/**
 * T-226 ④ · **每一个声明了引用的动作，它的悬空引用真的会被报出来。**
 *
 * `i14-gate.test.ts` 证明了一个动作（`playMedia`）的 `expectType` 接通了生产路径。
 * 这个文件把同一个问题问遍**所有**动作：一个动作在 `ui.fields` 里声明了 `type: 'ref'`
 * 的字段，却在 `refs()` 里忘了返回它，会得到一个**编辑器里选得出、完整性检查看不见**的
 * 引用——删掉被指的对象，规则静默失效，`checkIntegrity` 一句话不说。
 *
 * TypeScript 拦不住这个：`refs()` 的返回类型是数组，返回 `[]` 永远合法。
 *
 * ## 为什么这个文件必须住在 `@w3/core`
 *
 * `allActions()` / `createActionRefResolver` 都住在 `@w3/core`，而
 * `check-deps-direction.mjs` 写的是 `'@w3/schema': []`——schema 不许依赖任何内部包
 * （CLAUDE.md 的包边界表把它的允许依赖写死为 `zod`）。放进 `packages/schema/test/`
 * 只有两条出路，两条都是 blocker：撞包边界，或者**在 schema 里手抄一份动作表**。
 * 后者正是 T-176 那条存活 blocker「测试自造假解析器」的逐字复现，而本文件存在的
 * 全部理由就是防它。
 *
 * `pnpm check:deps-direction` 是这条纪律的机器看守：把本文件挪回 schema 它当场红。
 */

let registry: ActionRegistry
let resolver: ReturnType<typeof createActionRefResolver>

beforeAll(() => {
  registry = registerBuiltinActions(new ActionRegistry())
  resolver = createActionRefResolver(registry)
})

/** 一个**保证不存在**的 id，前缀合法、后 8 位全 z。 */
function danglingId(refKind: string): string {
  const prefix = (PREFIXES as Record<string, string | undefined>)[refKind]
  // 变量 id 不带前缀（是用户起的名字），所以单独给一个不会撞的名字
  return prefix === undefined ? '__no_such_variable__' : `${prefix}_zzzzzzzz`
}

/**
 * 合成器按字段类型猜不出来的参数，逐个点名。
 *
 * 两种情况，各有一条：
 *
 * - **`stopMedia.mediaId`**：引用藏在 `string` 字段里。`FieldDescriptor` 是六种的封闭集，
 *   而这个字段还接受字面量 `'all'`，媒体选择器给不出这个值，所以它没被声明成 `ref`。
 * - **`openLink.url`**：必填的 `string`，但 `FieldDescriptor` 的 `string` 那一支**没有
 *   `required` 标记**（只有 `ref` 支有）。合成器分不清「可选、不填」与「必填、必须填」，
 *   而填错的代价是静默——`safeParse` 失败时解析器返回 `[]`，这个动作直接退出统计。
 *
 * **这张表不是放行清单**：下面有一条断言反查它——每一条要么让 `safeParse` 从失败变成功，
 * 要么让 `refs()` 从空变非空。两样都不占的条目会让那条红。
 */
const PARAM_OVERRIDES: Record<string, Record<string, unknown>> = {
  stopMedia: { mediaId: danglingId('media') },
  openLink: { url: 'https://example.com/manual' },
}

/**
 * 按 `ui.fields` 合成一份参数。
 *
 * **可选字段一律不填，而不是填一个「看起来像默认值」的值。** 最初的版本给没有 default
 * 的 string 字段填 `''`，于是 `setLight` 的 `color: HexColorSchema.optional()` 校验失败
 * ——而 `createActionRefResolver` 对校验失败的参数**返回空数组**。结果是这个动作被静默
 * 跳过，闸门对它一句话不说。合成器猜错值的代价不是报错，是失明。
 */
function synthesizeParams(def: ActionDefinition): Record<string, unknown> {
  const params: Record<string, unknown> = {}
  for (const field of def.ui.fields) {
    switch (field.type) {
      case 'ref':
        params[field.key] = danglingId(field.refKind)
        break
      case 'number':
        if (field.default !== undefined) params[field.key] = field.default
        else if (field.min !== undefined) params[field.key] = field.min
        break
      case 'boolean':
        if (field.default !== undefined) params[field.key] = field.default
        break
      case 'string':
        if (field.default !== undefined) params[field.key] = field.default
        break
      case 'enum':
        if (field.options[0] !== undefined) params[field.key] = field.options[0].value
        break
      case 'valueExpr':
        params[field.key] = { const: 0 }
        break
    }
  }
  return { ...params, ...(PARAM_OVERRIDES[def.type] ?? {}) }
}

/** 一份只含这一个动作的文档。 */
function docWith(action: string, params: Record<string, unknown>): SceneDocument {
  const base = createGoldenPathDocument()
  return {
    ...base,
    rules: [
      {
        id: 'rl_gate0001',
        name: '闸门',
        enabled: true,
        when: { event: 'sceneReady' },
        if: [],
        ifAny: [],
        mode: 'sequence',
        reentry: 'restart',
        onError: 'abort',
        then: [{ action, params }],
      },
    ],
  } as SceneDocument
}

describe('T-226 · 动作引用闸门（用生产解析器）', () => {
  it('注册表非空 —— 下面每一条循环的下限', () => {
    // 扫描面下限。`registry.all()` 返回空数组时，本文件的每一条断言都恒真。
    expect(registry.all().length).toBeGreaterThanOrEqual(16)
  })

  it('合成出来的参数每一份都通过各自的 schema —— 否则解析器会静默返回空数组', () => {
    // **这一条是本文件的自检。** `createActionRefResolver` 在 `safeParse` 失败时返回
    // `[]`（registry.ts:89-90），所以一个合成错的参数不会让测试红，只会让那个动作
    // 悄悄退出统计。实测踩到过：给 string 字段填 `''` 让 setLight 的 color 校验失败。
    const bad: string[] = []
    for (const def of registry.all()) {
      const parsed = def.schema.safeParse(synthesizeParams(def))
      if (!parsed.success) bad.push(`${def.type}: ${parsed.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`)
    }
    expect(bad.join('\n'), '合成的参数过不了 schema，这些动作会被闸门静默跳过').toBe('')
  })

  it('每个在 ui 里声明了 ref 字段的动作，refs() 都真的返回了它', () => {
    // **这一条是主检查。** 一个动作可以在编辑器里长出一个对象选择器，同时让
    // `refs()` 返回 `[]`——两边都编译得过，而完整性检查从此对这个引用失明。
    const missing: string[] = []
    let checked = 0
    for (const def of registry.all()) {
      const refFields = def.ui.fields.filter((f) => f.type === 'ref')
      if (refFields.length === 0) continue
      checked++
      const params = synthesizeParams(def)
      const declared = new Set(def.refs(params as never).map((r) => r.id))
      for (const field of refFields) {
        if (field.type !== 'ref') continue
        const expected = danglingId(field.refKind)
        if (!declared.has(expected)) missing.push(`${def.type}.${field.key}（${field.refKind}）`)
      }
    }
    expect(checked, '一个带 ref 字段的动作都没找到，这条断言已经空转').toBeGreaterThanOrEqual(8)
    expect(missing.join('\n'), 'ui 里选得出、refs() 里看不见 —— 删掉被指对象后规则静默失效').toBe('')
  })

  it('每个声明了引用的动作，悬空引用真的被 checkIntegrity 报出来', () => {
    // 上一条测的是「解析器说了」，这一条测的是「整条链走通了」：
    // 解析器 → checkIntegrity 的 requireRef → 一条 error。
    const silent: string[] = []
    let checked = 0
    for (const def of registry.all()) {
      const params = synthesizeParams(def)
      const refs = def.refs(params as never)
      if (refs.length === 0) continue
      checked++
      const issues = checkIntegrity(docWith(def.type, params), { actionRefs: resolver })
      const reported = new Set(issues.filter((i) => i.refId !== undefined).map((i) => i.refId))
      for (const ref of refs) {
        if (!reported.has(ref.id)) silent.push(`${def.type} → ${ref.kind}:${ref.id}`)
      }
    }
    expect(checked, '一个产出引用的动作都没有，这条断言已经空转').toBeGreaterThanOrEqual(8)
    expect(silent.join('\n'), '解析器报了引用，但 checkIntegrity 没说话').toBe('')
  })

  it('覆盖率：产出引用的动作数 / 声明了 ref 字段的动作数 === 100%', () => {
    const withRefField = registry.all().filter((d) => d.ui.fields.some((f) => f.type === 'ref'))
    const producing = withRefField.filter((d) => d.refs(synthesizeParams(d) as never).length > 0)
    expect(withRefField.length).toBeGreaterThanOrEqual(8)
    expect(
      withRefField.filter((d) => !producing.includes(d)).map((d) => d.type),
      '这些动作在编辑器里有对象选择器，但对完整性检查不可见',
    ).toEqual([])
  })

  it('没有一条引用带着空 id —— 空 id 会被报成「引用了不存在的 X：」', () => {
    // 分母**不是**「全部动作」：`wait` 这类没有引用的动作不该被要求产出引用。
    // 而「没有 ref 字段就一定不产出引用」也不成立——`stopMedia` 的引用藏在 string
    // 字段里，那是 `'all'` 这个字面量逼出来的合法形状。
    //
    // 真正对所有动作都成立的不变量是这一条：产出的 id 不许是空串。空 id 会让
    // `requireRef` 报出一条「引用了不存在的多媒体：」，后面什么都没有。
    for (const def of registry.all()) {
      for (const ref of def.refs(synthesizeParams(def) as never)) {
        expect(ref.id, `${def.type} 产出了一条空 id 的 ${ref.kind} 引用`).not.toBe('')
      }
    }
  })

  it('PARAM_OVERRIDES 里每一条都名副其实 —— 这张表不是放行清单', () => {
    for (const [type, override] of Object.entries(PARAM_OVERRIDES)) {
      const def = registry.all().find((d) => d.type === type)
      expect(def, `${type} 已经不在注册表里了`).toBeTruthy()

      // 逐个键地问：去掉它，是否有东西变差？
      const full = synthesizeParams(def!)
      for (const key of Object.keys(override)) {
        const reduced = { ...full }
        delete reduced[key]
        const brokeSchema = !def!.schema.safeParse(reduced).success
        const lostRef = def!.refs(reduced as never).length < def!.refs(full as never).length
        expect(brokeSchema || lostRef, `${type}.${key} 去掉之后什么都没变，这一条是多余的`).toBe(true)
      }
    }
  })
})
