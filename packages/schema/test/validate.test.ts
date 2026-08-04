import { NodeSchema } from '../src/node.js'
import { SceneDocumentSchema } from '../src/document.js'
import { DataSourceSchema } from '../src/data-source.js'
import { describe, expect, it } from 'vitest'
import { CURRENT_VERSION } from '../src/document.js'
import { createGoldenPathDocument } from '../src/samples.js'
import { DocumentValidationError, assertValid, validate } from '../src/validate.js'

/** T-012 · SCHEMA_SPEC §9 structural validation. */

/** Deep-clone the known-good document, then break one thing. */
function broken(mutate: (doc: Record<string, any>) => void): unknown {
  const doc = structuredClone(createGoldenPathDocument()) as Record<string, any>
  mutate(doc)
  return doc
}

const pathsOf = (input: unknown): string[] => {
  const r = validate(input)
  return r.ok ? [] : r.error.map((e) => e.path)
}

describe('validate()', () => {
  it('accepts the golden path document', () => {
    expect(validate(createGoldenPathDocument()).ok).toBe(true)
  })

  it('pins schemaVersion to the literal current version', () => {
    expect(createGoldenPathDocument().schemaVersion).toBe(CURRENT_VERSION)
    // Written against CURRENT_VERSION rather than against literals, so the next bump does
    // not turn this into "rejects version 2" on a build where 2 is the current one.
    // A previous version is rejected HERE on purpose: reading old documents is `migrate`'s
    // job (C4), and `validate` accepting them would let a v1 document through unmigrated.
    expect(validate(broken((d) => (d.schemaVersion = CURRENT_VERSION + 1))).ok).toBe(false)
    expect(validate(broken((d) => (d.schemaVersion = CURRENT_VERSION - 1))).ok).toBe(false)
    expect(validate(broken((d) => (d.schemaVersion = 0))).ok).toBe(false)
  })

  it('rejects anything that is not an object', () => {
    for (const bad of [null, undefined, 42, 'x', []]) expect(validate(bad).ok).toBe(false)
  })

  it('reports a locatable path rather than just "invalid"', () => {
    expect(pathsOf(broken((d) => (d.nodes[0].transform.p = [1, 2])))).toContainEqual(
      expect.stringContaining('nodes[0].transform.p'),
    )
    expect(pathsOf(broken((d) => (d.rules[0].then = [])))).toContainEqual(expect.stringContaining('rules[0].then'))
  })

  it('rejects unknown keys instead of silently dropping them', () => {
    expect(validate(broken((d) => (d.nodes[0].colour = 'red'))).ok).toBe(false)
    expect(validate(broken((d) => (d.somethingNew = 1))).ok).toBe(false)
  })

  it('rejects a `constraints` collection — SCHEMA_SPEC §7 deliberately does not define one', () => {
    expect(validate(broken((d) => (d.constraints = []))).ok).toBe(false)
  })

  it('rejects NaN and Infinity, which do not survive JSON', () => {
    expect(validate(broken((d) => (d.nodes[0].transform.p[1] = Number.NaN))).ok).toBe(false)
    expect(validate(broken((d) => (d.nodes[0].transform.p[1] = Number.POSITIVE_INFINITY))).ok).toBe(false)
  })

  it('enforces id format on every reference field', () => {
    expect(validate(broken((d) => (d.nodes[1].parent = 'pump'))).ok).toBe(false)
    expect(validate(broken((d) => (d.nodes[2].overrides.materialId = 'nd_r5t8y1u3'))).ok).toBe(false)
    expect(validate(broken((d) => (d.hotspots[0].anchor.nodeId = 'nd_TOOLONGXX'))).ok).toBe(false)
  })

  it('enforces material parameter ranges and colour format', () => {
    expect(validate(broken((d) => (d.materials[0].params.roughness = 1.4))).ok).toBe(false)
    expect(validate(broken((d) => (d.meta.background.color = 'red'))).ok).toBe(false)
  })

  it('rejects an animation kind outside the closed union (R03 defence line)', () => {
    const r = validate(
      broken((d) => {
        d.animations[0] = { kind: 'keyframe', id: 'anm_j2l4n6p8', name: 'x', tracks: [] }
      }),
    )
    expect(r.ok).toBe(false)
  })

  /**
   * v3 · **这条断言翻过来了，而翻过来正是它的价值。**
   *
   * v0/v2 里 `pageEnter` / `flowStepEnter` 是被拒的——事件枚举只有八支。v3 把它们加进来
   * （8 → 11），所以「形状正确的 pageEnter 被接受」现在是对的行为。
   *
   * 保留反例那一半：**形状不全的 `flowStepEnter` 仍然必须被拒**。只把上面那条改成
   * `toBe(true)` 就会得到一条「加了事件之后什么都能过」的测试——判别联合的价值恰恰在
   * 每一支的必填字段上，而那正是这一半守的东西。
   */
  it('accepts the v3 event types, and still rejects a malformed one', () => {
    expect(validate(broken((d) => (d.rules[0].when = { event: 'pageEnter', pageId: 'pg_a1b2c3d4' }))).ok).toBe(true)
    // 缺 flowId / stepId
    expect(validate(broken((d) => (d.rules[0].when = { event: 'flowStepEnter' }))).ok).toBe(false)
    // 事件枚举之外的仍然拒
    expect(validate(broken((d) => (d.rules[0].when = { event: 'somethingElse' }))).ok).toBe(false)
  })

  it('accepts every valid node target shape', () => {
    const cover = createGoldenPathDocument().nodes[2]!.id
    for (const target of [{ nodeId: cover }, { nodeId: cover, includeDescendants: true }, { any: true }]) {
      expect(validate(broken((d) => (d.rules[0].when = { event: 'click', target }))).ok, JSON.stringify(target)).toBe(
        true,
      )
    }
    expect(validate(broken((d) => (d.rules[0].when = { event: 'click', target: { any: false } }))).ok).toBe(false)
    expect(
      validate(broken((d) => (d.rules[0].when = { event: 'click', target: { nodeId: cover, includeDescendants: false } })))
        .ok,
    ).toBe(false)
  })

  it('accepts an action envelope without inspecting its params — that is the registry’s job', () => {
    // C5: adding an action must not require a schema change, so `params` is opaque here.
    expect(
      validate(broken((d) => (d.rules[0].then = [{ action: 'somethingBrandNew', params: { whatever: [1, 2, 3] } }]))).ok,
    ).toBe(true)
    expect(validate(broken((d) => (d.rules[0].then = [{ action: '', params: {} }]))).ok).toBe(false)
    expect(validate(broken((d) => (d.rules[0].then = [{ params: {} }]))).ok).toBe(false)
  })

  it('accepts flat if / ifAny and rejects a nested boolean tree (SCHEMA_SPEC §6.6)', () => {
    expect(validate(broken((d) => (d.rules[0].ifAny = d.rules[0].if))).ok).toBe(true)
    expect(validate(broken((d) => (d.rules[0].if = [{ op: 'and', conditions: [] }]))).ok).toBe(false)
    expect(validate(broken((d) => (d.rules[0].if = [{ op: 'not', condition: {} }]))).ok).toBe(false)
  })

  it('accepts every condition operator shape', () => {
    const doc = createGoldenPathDocument()
    const cover = doc.nodes[2]!.id
    const conditions = [
      { op: 'eq', left: { var: 'step' }, right: { const: 1 } },
      { op: 'in', left: { var: 'step' }, right: [1, 2, 3] },
      { op: 'isVisible', nodeId: cover, value: true },
      { op: 'isPlaying', animationId: doc.animations[0]!.id, value: false },
      { op: 'isPanelOpen', hotspotId: doc.hotspots[0]!.id, value: true },
      { op: 'gte', left: { prop: { nodeId: cover, key: 'positionY' } }, right: { const: 0.3 } },
      { op: 'eq', left: { event: 'nodeId' }, right: { const: cover } },
    ]
    for (const cond of conditions) {
      expect(validate(broken((d) => (d.rules[0].if = [cond]))).ok, JSON.stringify(cond)).toBe(true)
    }
    expect(validate(broken((d) => (d.rules[0].if = [{ op: 'matches', left: { var: 'step' }, right: { const: 1 } }]))).ok).toBe(
      false,
    )
    expect(
      validate(broken((d) => (d.rules[0].if = [{ op: 'gte', left: { prop: { nodeId: cover, key: 'rotation' } }, right: { const: 1 } }])))
        .ok,
    ).toBe(false)
  })

  it('rejects a camera whose far plane is not beyond its near plane is out of range', () => {
    expect(validate(broken((d) => (d.viewpoints[0].camera.fov = 200))).ok).toBe(false)
    expect(validate(broken((d) => (d.viewpoints[0].camera.near = 0))).ok).toBe(false)
  })

  it('rejects a tween with no targets and a non-positive duration', () => {
    expect(validate(broken((d) => (d.animations[0].targets = []))).ok).toBe(false)
    expect(validate(broken((d) => (d.animations[0].duration = 0))).ok).toBe(false)
  })

  it('rejects a variable id that is a reserved word', () => {
    expect(validate(broken((d) => (d.variables[0].id = 'event'))).ok).toBe(false)
  })

  it('SCHEMA_SPEC §0.5 · survives a JSON round trip unchanged', () => {
    const doc = createGoldenPathDocument()
    const back = validate(JSON.parse(JSON.stringify(doc)))
    expect(back.ok).toBe(true)
    if (back.ok) expect(back.value).toEqual(doc)
  })

  it('fills declared defaults when optional fields are absent', () => {
    const doc = structuredClone(createGoldenPathDocument()) as Record<string, any>
    delete doc.pages
    delete doc.flows
    delete doc.media
    delete doc.rules[0].enabled
    delete doc.rules[0].reentry
    delete doc.nodes[0].visible
    const r = validate(doc)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.pages).toEqual([])
    expect(r.value.rules[0]!.enabled).toBe(true)
    expect(r.value.rules[0]!.reentry).toBe('restart')
    expect(r.value.nodes[0]!.visible).toBe(true)
  })

  it('assertValid throws a DocumentValidationError carrying every issue', () => {
    expect(() => assertValid(createGoldenPathDocument())).not.toThrow()
    try {
      assertValid(broken((d) => (d.nodes[0].name = 42)))
      expect.unreachable('should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(DocumentValidationError)
      expect((error as DocumentValidationError).errors.length).toBeGreaterThan(0)
      expect((error as DocumentValidationError).message).toContain('nodes[0].name')
    }
  })
})

/* ========================================================================== */
/* T-225 · zod 默认值 —— 「文档里没写这个键」时的取值                           */
/* ========================================================================== */

describe('v3 新字段的 schema 默认值', () => {
  /**
   * **迁移写的默认值和 schema 声明的默认值是两回事，而只有前者被测过。**
   *
   * `V2_TO_V3.up` 显式写 `explode: null`，所以把 `ExplodeSchema.nullable().default(null)`
   * 改成一个真值时，迁移路径上的每一条断言都照样绿——实测：T-225 变异③ 第一次跑，284 条
   * 单测一条没红。zod 的 default 只在**键缺席**时生效，而迁移链上它永远不缺席。
   *
   * 键真正会缺席的地方有两处，都不走迁移：手写/第三方生成的文档，以及 `createNode` 之类
   * 的工厂将来少写一个字段。那两处读到的就是这里断言的值。
   */
  const bareNode = () => ({
    id: 'nd_a1b2c3d4',
    name: '裸节点',
    parent: null,
    order: 100,
    transform: { p: [0, 0, 0], r: [0, 0, 0, 1], s: [1, 1, 1] },
    // assetRef / primitive / light 没有 default（三选一的承载体，缺省是没意义的），
    // 显式写 null 才能构造出一个「只缺 v3 四个新字段」的节点 —— 那才是这条断言的对象。
    assetRef: null,
    primitive: null,
    light: null,
  })

  it('节点四个新承载体的默认值都是 null —— 一份没写它们的文档不会自己爆炸、自己剖切', () => {
    const parsed = NodeSchema.parse(bareNode())
    expect(parsed.explode, '默认爆炸配置 = 打开任何老文档都看到零件散开').toBe(null)
    expect(parsed.explodeOffset).toBe(null)
    expect(parsed.section, '默认剖切面 = 打开任何老文档都看到模型被切开').toBe(null)
    expect(parsed.prefabRef).toBe(null)
  })

  it('meta 的雾与描边默认都关着', () => {
    const parsed = SceneDocumentSchema.parse({
      ...createGoldenPathDocument(),
      meta: { ...createGoldenPathDocument().meta, fog: undefined, effects: undefined },
    })
    expect(parsed.meta.fog.enabled).toBe(false)
    expect(parsed.meta.effects.outline.enabled).toBe(false)
    // 逐字对上冻结表：这两个默认值 T-225 已经写错过一次（strength 1.5 vs 3、hiddenEdge
    // 'hidden' vs 'dim'），反向比对逮到的。这里再钉一遍取值本身。
    expect(parsed.meta.effects.outline.strength).toBe(3)
    expect(parsed.meta.effects.outline.hiddenEdge).toBe('dim')
    expect(parsed.meta.fog.type).toBe('linear')
  })

  it('变量的 scope 默认是 scene，数据源默认关着且不发请求', () => {
    const doc = SceneDocumentSchema.parse({ ...createGoldenPathDocument(), dataSources: undefined })
    expect(doc.dataSources).toEqual([])

    const ds = DataSourceSchema.parse({ id: 'ds_a1b2c3d4', name: '产线读数' })
    expect(ds.enabled, '默认开启 = 升到 v3 的那一刻所有老文档一起开始打 MES').toBe(false)
    expect(ds.intervalMs, '默认值也该保守：下限写进 schema 的论证是防止瘦客户端打爆后端').toBe(30_000)
    expect(ds.auth.kind).toBe('none')
  })
})
