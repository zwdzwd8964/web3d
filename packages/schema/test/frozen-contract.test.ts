import { describe, expect, it } from 'vitest'
import { LightSchema, SHADOW_QUALITIES } from '../src/light.js'
import { MEDIA_ASSET_TYPES, MEDIA_TYPES, MediaSchema } from '../src/media.js'
import { PRIMITIVE_KINDS, PrimitiveSchema } from '../src/primitive.js'
import { MaterialParamsSchema, PHYSICAL_ONLY_PARAMS } from '../src/material.js'
import { EnvironmentSchema } from '../src/document.js'
import { DATA_SOURCE_AUTH_KINDS, DataSourceSchema } from '../src/data-source.js'
import { DEFAULT_EFFECTS, DEFAULT_OUTLINE, EffectsSchema, HIDDEN_EDGE_MODES, OutlineEffectSchema } from '../src/effects.js'
import { EXPLODE_MODES, ExplodeSchema } from '../src/explode.js'
import { DEFAULT_FOG, FOG_TYPES, FogSchema } from '../src/fog.js'
import { PREFIXES } from '../src/id.js'
import { NodeSchema } from '../src/node.js'
import {
  DEFAULT_OVERLAY_PROPS,
  OVERLAY_ANCHORS,
  OVERLAY_TOKENS,
  OVERLAY_TYPES,
  OverlaySchema,
} from '../src/page.js'
import { PrefabSchema } from '../src/prefab.js'
import { PrefabRefSchema } from '../src/prefab-ref.js'
import { EVENT_PAYLOAD_KEYS, EVENT_TYPES } from '../src/rule.js'
import { SECTION_SCOPES, SectionSchema } from '../src/section.js'

/**
 * The frozen v2 field contract (MVP_V0_5 §4.1), asserted value by value.
 *
 * This file exists because of an accident. While M8's adversarial review was running, its
 * agents edited the schema to test their suspicions — `groundColor` default, `angleDeg`
 * range, `radiusTop` constraint, two `.strict()` calls, and the whole `MEDIA_ASSET_TYPES`
 * table went to obviously wrong values — and the entire test suite stayed green. Eight
 * changes to numbers that a product decision froze, and nothing noticed.
 *
 * Every other test in this package asserts BEHAVIOUR, which is right: they would catch a
 * broken migration or a check that stops checking. But a default value has no behaviour of
 * its own — it is a decision, and the only way to protect a decision is to write it down
 * twice and compare. That is what this file is, and it is deliberately boring.
 *
 * Rule for changing anything here: the numbers come from §4.1 (v2) and
 * `docs/SCHEMA_V3_FREEZE.md` (v3), both frozen. A diff in this file that is not accompanied
 * by a schemaVersion bump and an ADR is a bug report.
 *
 * **扩写既有那句，而不是在下面再写一句中文的。** 卡面要求「文件头补一句」，而这句话
 * 已经在这里了——同一条纪律在同一个文件头有两份措辞，是 docs/CLAUDE.md 顶上那条
 * 「同一份内容存在两处，漂移是时间问题」的现成实例。
 */

/** Parses the minimum a variant needs and returns the fully-defaulted object. */
const defaultsOf = <T>(schema: { parse: (input: unknown) => T }, seed: Record<string, unknown>): T =>
  schema.parse(seed)

describe('§4.1.2 · primitives', () => {
  it('has exactly the seven kinds, in the order the library panel shows them', () => {
    expect([...PRIMITIVE_KINDS]).toEqual(['box', 'sphere', 'cylinder', 'cone', 'torus', 'plane', 'capsule'])
  })

  it.each([
    [{ kind: 'box' }, { kind: 'box', size: [1, 1, 1] }],
    [{ kind: 'sphere' }, { kind: 'sphere', radius: 0.5 }],
    [{ kind: 'cylinder' }, { kind: 'cylinder', radiusTop: 0.5, radiusBottom: 0.5, height: 1 }],
    [{ kind: 'cone' }, { kind: 'cone', radius: 0.5, height: 1 }],
    [{ kind: 'torus' }, { kind: 'torus', radius: 0.5, tube: 0.15 }],
    [{ kind: 'plane' }, { kind: 'plane', width: 1, height: 1 }],
    [{ kind: 'capsule' }, { kind: 'capsule', radius: 0.3, length: 0.6 }],
  ])('%o defaults to the frozen dimensions', (seed, expected) => {
    expect(defaultsOf(PrimitiveSchema, seed)).toEqual(expected)
  })

  it('a cylinder may have a zero radius at one end — that is how a frustum is expressed', () => {
    expect(PrimitiveSchema.safeParse({ kind: 'cylinder', radiusTop: 0, radiusBottom: 0.5, height: 1 }).success).toBe(true)
    expect(PrimitiveSchema.safeParse({ kind: 'cylinder', radiusTop: -1, radiusBottom: 0.5, height: 1 }).success).toBe(false)
  })

  it('rejects an unknown field on every variant — a typo must not be stored as data', () => {
    for (const kind of PRIMITIVE_KINDS) {
      expect(PrimitiveSchema.safeParse({ kind, nonsense: 1 }).success, kind).toBe(false)
    }
  })
})

describe('§4.1.3 · lights', () => {
  it('ambient carries colour and intensity, and no shadow it could not cast', () => {
    expect(defaultsOf(LightSchema, { kind: 'ambient' })).toEqual({ kind: 'ambient', color: '#ffffff', intensity: 0.6 })
  })

  it('hemisphere carries a sky colour, a ground colour and an intensity', () => {
    expect(defaultsOf(LightSchema, { kind: 'hemisphere' })).toEqual({
      kind: 'hemisphere',
      skyColor: '#ffffff',
      groundColor: '#444444',
      intensity: 0.6,
    })
  })

  it('directional defaults to 1.5 with shadows off', () => {
    expect(defaultsOf(LightSchema, { kind: 'directional' })).toEqual({
      kind: 'directional',
      color: '#ffffff',
      intensity: 1.5,
      shadow: { enabled: false, quality: 'medium', bias: -0.0005 },
    })
  })

  it('point defaults to unlimited range and physical decay', () => {
    expect(defaultsOf(LightSchema, { kind: 'point' })).toEqual({
      kind: 'point',
      color: '#ffffff',
      intensity: 1,
      range: 0,
      decay: 2,
      shadow: { enabled: false, quality: 'medium', bias: -0.0005 },
    })
  })

  it('spot defaults to a 30° cone', () => {
    expect(defaultsOf(LightSchema, { kind: 'spot' })).toEqual({
      kind: 'spot',
      color: '#ffffff',
      intensity: 2,
      range: 0,
      decay: 2,
      angleDeg: 30,
      penumbra: 0.2,
      shadow: { enabled: false, quality: 'medium', bias: -0.0005 },
    })
  })

  it('holds the frozen ranges: intensity ceilings, cone limits, bias clamp', () => {
    const ok = (input: unknown) => LightSchema.safeParse(input).success
    // Ambient / hemisphere cap at 10, the directional family at 20 (§4.1.3).
    expect(ok({ kind: 'ambient', intensity: 10 })).toBe(true)
    expect(ok({ kind: 'ambient', intensity: 10.1 })).toBe(false)
    expect(ok({ kind: 'directional', intensity: 20 })).toBe(true)
    expect(ok({ kind: 'directional', intensity: 20.1 })).toBe(false)
    // A cone is 1°–89°: 0 lights nothing and 90+ is no longer a cone.
    expect(ok({ kind: 'spot', angleDeg: 1 })).toBe(true)
    expect(ok({ kind: 'spot', angleDeg: 89 })).toBe(true)
    expect(ok({ kind: 'spot', angleDeg: 0 })).toBe(false)
    expect(ok({ kind: 'spot', angleDeg: 90 })).toBe(false)
    // Bias outside ±0.01 erases the shadow instead of degrading it.
    expect(ok({ kind: 'spot', shadow: { bias: -0.01 } })).toBe(true)
    expect(ok({ kind: 'spot', shadow: { bias: -0.011 } })).toBe(false)
    expect(ok({ kind: 'point', decay: 4 })).toBe(true)
    expect(ok({ kind: 'point', decay: 4.1 })).toBe(false)
    expect(ok({ kind: 'point', range: -1 })).toBe(false)
  })

  it('has three shadow quality buckets and rejects a fourth', () => {
    expect([...SHADOW_QUALITIES]).toEqual(['low', 'medium', 'high'])
    expect(LightSchema.safeParse({ kind: 'spot', shadow: { quality: 'ultra' } }).success).toBe(false)
  })

  it('rejects an unknown field on every variant', () => {
    for (const kind of ['ambient', 'hemisphere', 'directional', 'point', 'spot']) {
      expect(LightSchema.safeParse({ kind, nonsense: 1 }).success, kind).toBe(false)
    }
  })
})

describe('§4.1.4 · environment', () => {
  it('defaults to no IBL, neutral intensity and neutral exposure', () => {
    expect(EnvironmentSchema.parse({})).toEqual({ hdriAssetId: null, intensity: 1, exposure: 1 })
  })

  it('holds the frozen ranges', () => {
    const ok = (input: unknown) => EnvironmentSchema.safeParse(input).success
    expect(ok({ intensity: 4 })).toBe(true)
    expect(ok({ intensity: 4.1 })).toBe(false)
    // Exposure floors at 0.1: zero is a black frame with no error anywhere.
    expect(ok({ exposure: 0.1 })).toBe(true)
    expect(ok({ exposure: 0 })).toBe(false)
    expect(ok({ exposure: 4.1 })).toBe(false)
  })
})

describe('§4.1.5 · material increments', () => {
  it('names exactly the five physical-only parameters I15 warns about', () => {
    expect([...PHYSICAL_ONLY_PARAMS]).toEqual(['transmission', 'ior', 'thickness', 'clearcoat', 'clearcoatRoughness'])
  })

  it('holds the frozen physical ranges', () => {
    const ok = (params: Record<string, unknown>) => MaterialParamsSchema.safeParse(params).success
    expect(ok({ transmission: 1 })).toBe(true)
    expect(ok({ transmission: 1.1 })).toBe(false)
    // IOR below 1 is not a material, it is a typo.
    expect(ok({ ior: 1 })).toBe(true)
    expect(ok({ ior: 0.9 })).toBe(false)
    expect(ok({ ior: 2.5 })).toBe(true)
    expect(ok({ ior: 2.6 })).toBe(false)
    expect(ok({ thickness: 0 })).toBe(true)
    expect(ok({ thickness: -1 })).toBe(false)
    expect(ok({ clearcoat: 1 })).toBe(true)
    expect(ok({ clearcoatRoughness: 1.1 })).toBe(false)
  })

  it('defaults the uv block to an identity transform when present', () => {
    expect(MaterialParamsSchema.parse({ uv: {} }).uv).toEqual({ repeat: [1, 1], offset: [0, 0], rotationDeg: 0 })
    expect(MaterialParamsSchema.parse({}).uv, 'absent means "inherit", not "identity"').toBeUndefined()
  })

  it('clamps uv rotation to one turn either way', () => {
    expect(MaterialParamsSchema.safeParse({ uv: { rotationDeg: 360 } }).success).toBe(true)
    expect(MaterialParamsSchema.safeParse({ uv: { rotationDeg: 361 } }).success).toBe(false)
    expect(MaterialParamsSchema.safeParse({ uv: { rotationDeg: -361 } }).success).toBe(false)
  })
})

describe('§4.1.6 · media', () => {
  it('has three media types', () => {
    expect([...MEDIA_TYPES]).toEqual(['image', 'video', 'audio'])
  })

  it('each media type requires the asset type of the same name', () => {
    // This table was silently corrupted to image→texture / video→hdri / audio→model and
    // every test stayed green, which is why it is now written down twice.
    expect(MEDIA_ASSET_TYPES).toEqual({ image: 'image', video: 'video', audio: 'audio' })
  })

  it('requires a name and treats durationS as genuinely optional', () => {
    const seed = { id: 'med_a1b2c3d4', type: 'audio', assetId: 'ast_a1b2c3d4' }
    expect(MediaSchema.safeParse(seed).success, 'name has no default and cannot have one').toBe(false)
    expect(MediaSchema.safeParse({ ...seed, name: '' }).success).toBe(false)
    expect(MediaSchema.parse({ ...seed, name: 'alarm.wav' })).toEqual({ ...seed, name: 'alarm.wav' })
    expect(MediaSchema.safeParse({ ...seed, name: 'a.wav', durationS: 0 }).success, 'a zero-length clip is a bug').toBe(false)
  })
})

/* ========================================================================== */
/* v3 · SCHEMA_V3_FREEZE.md §1.2 – §1.5                                       */
/*                                                                            */
/* **卡面点名的清单有四处数错了，这里按 schema 与签字表实现：**                 */
/*   「fog 四个」  → 6 个（enabled/type/color/near/far/density）                */
/*   「outline 两个」→ 5 个（enabled/color/widthPx/strength/hiddenEdge）——      */
/*      而漏掉的三个里，strength 与 hiddenEdge 正是 T-225 真实漂移过的两个值    */
/*   「section 三个 + plane 三个」→ SectionSchema 只有 scope/size 两个字段，    */
/*      **仓库里根本没有 section.plane**（grep 只命中 PRIMITIVE_KINDS 的图元）  */
/*   「explode 两个」→ 5 个。卡面的数字抄自被否决的「每节点爆炸」模型，         */
/*      explode.ts:11-14 已就地点名它是残留                                    */
/* ========================================================================== */

describe('v3 §1.2 · fog', () => {
  it('六个字段的默认值逐个写死', () => {
    expect(FogSchema.parse({})).toEqual({
      enabled: false,
      type: 'linear',
      color: '#1a1a1a',
      near: 10,
      far: 100,
      density: 0.02,
    })
  })

  it('DEFAULT_FOG 与 schema 的默认值是同一份', () => {
    // 两处各写一份的下场：T-225 让 outline 的 strength 在 schema 里是 1.5、
    // 在签字表里是 3，两边都「自洽」。
    expect(DEFAULT_FOG).toEqual(FogSchema.parse({}))
  })

  it('只有两种雾', () => {
    expect([...FOG_TYPES]).toEqual(['linear', 'exp2'])
  })

  it('near / far 不接受负数，density 上限是 1', () => {
    expect(FogSchema.safeParse({ near: -1 }).success).toBe(false)
    expect(FogSchema.safeParse({ far: -1 }).success).toBe(false)
    expect(FogSchema.safeParse({ density: 1.01 }).success).toBe(false)
    expect(FogSchema.safeParse({ density: 1 }).success).toBe(true)
  })
})

describe('v3 §1.2 · outline', () => {
  it('五个字段的默认值逐个写死', () => {
    expect(OutlineEffectSchema.parse({})).toEqual({
      enabled: false,
      color: '#ffb020',
      widthPx: 3,
      strength: 3,
      hiddenEdge: 'dim',
    })
  })

  it('DEFAULT_OUTLINE / DEFAULT_EFFECTS 与 schema 同源', () => {
    expect(DEFAULT_OUTLINE).toEqual(OutlineEffectSchema.parse({}))
    expect(DEFAULT_EFFECTS).toEqual(EffectsSchema.parse({}))
  })

  it('遮挡边三种模式，逐字且有序', () => {
    // T-225 曾把它实现成 ['hidden','dashed','solid']，冻结表写的是这三个。
    expect([...HIDDEN_EDGE_MODES]).toEqual(['hide', 'dim', 'show'])
  })

  it('widthPx 与 strength 的上下限', () => {
    expect(OutlineEffectSchema.safeParse({ widthPx: 0 }).success).toBe(false)
    expect(OutlineEffectSchema.safeParse({ widthPx: 9 }).success).toBe(false)
    expect(OutlineEffectSchema.safeParse({ strength: -1 }).success).toBe(false)
    expect(OutlineEffectSchema.safeParse({ strength: 6 }).success).toBe(false)
  })

  it('effects 里只有 outline —— 没有 bloom / ssao 占位', () => {
    // 占位字段是承诺（D20 已被 ADR-0021 撤销）。
    expect(Object.keys(EffectsSchema.parse({}))).toEqual(['outline'])
  })
})

describe('v3 §1.3 · section', () => {
  it('两个字段，不是「三个 + plane 三个」', () => {
    expect(SectionSchema.parse({})).toEqual({ scope: 'scene', size: [4, 4] })
  })

  it('scope 是单值封闭枚举 —— 加一支就要改 schema', () => {
    expect([...SECTION_SCOPES]).toEqual(['scene'])
    expect(SectionSchema.safeParse({ scope: 'subtree' }).success).toBe(false)
  })
})

describe('v3 §1.3 · explode', () => {
  it('五个字段的默认值逐个写死，不是「两个」', () => {
    expect(ExplodeSchema.parse({})).toEqual({
      mode: 'radial',
      gain: 1.5,
      axis: [0, 1, 0],
      spacing: 0.5,
      easing: 'easeInOutCubic',
    })
  })

  it('两种模式，逐字且有序', () => {
    expect([...EXPLODE_MODES]).toEqual(['radial', 'axis'])
  })

  it('gain 与 spacing 的上下限', () => {
    expect(ExplodeSchema.safeParse({ gain: -1 }).success).toBe(false)
    expect(ExplodeSchema.safeParse({ gain: 21 }).success).toBe(false)
    expect(ExplodeSchema.safeParse({ spacing: -1 }).success).toBe(false)
    expect(ExplodeSchema.safeParse({ spacing: 1001 }).success).toBe(false)
  })
})

describe('v3 §1.3 · prefab', () => {
  it('note / version / nodes / materials 的默认值', () => {
    const seed = { id: 'pfb_a1b2c3d4', name: '标准泵组' }
    expect(PrefabSchema.parse(seed)).toEqual({ ...seed, note: '', version: 1, nodes: [], materials: [] })
  })

  it('version 是从 1 起的正整数 —— 0 与小数都不行', () => {
    const seed = { id: 'pfb_a1b2c3d4', name: 'x' }
    expect(PrefabSchema.safeParse({ ...seed, version: 0 }).success).toBe(false)
    expect(PrefabSchema.safeParse({ ...seed, version: 1.5 }).success).toBe(false)
  })

  it('prefabRef 的 overridden 默认空数组', () => {
    expect(PrefabRefSchema.parse({ prefabId: 'pfb_a1b2c3d4' })).toEqual({ prefabId: 'pfb_a1b2c3d4', overridden: [] })
  })
})

describe('v3 §1.5 · overlay 四支 props', () => {
  const rect = { x: 0, y: 0, w: 1, h: 1 }
  const parse = (type: string) => OverlaySchema.parse({ id: 'ov_a1b2c3d4', type, rect })

  it('text 支', () => {
    expect(parse('text').props).toEqual({ text: '', size: 16, color: '#ffffff', align: 'left', flowId: null })
  })

  it('image 支', () => {
    expect(parse('image').props).toEqual({ mediaId: null, fit: 'contain' })
  })

  it('button 支', () => {
    expect(parse('button').props).toEqual({ label: '按钮', variant: 'primary' })
  })

  it('panel 支', () => {
    expect(parse('panel').props).toEqual({ title: '', text: '', mediaId: null, flowId: null, progress: false })
  })

  /**
   * **两条路径必须给出同一个答案。**
   *
   * `props` 整个缺席时，zod 用的是 `.default(DEFAULT_*_PROPS)` 那个**手写常量**；
   * `props: {}` 时才逐字段走各自的 `.default()`。两者是两份独立的值，可以静默分叉。
   *
   * 实测：把 `TextPropsSchema.size` 的 default 从 16 改成 24，上面那批「props 逐值」
   * 断言**一条都不红**——因为它们走的全是常量那条路。这一条把另一条路也钉上。
   */
  it.each([...OVERLAY_TYPES])('%s · props 缺席与 props 为空对象，两条路径同值', (type) => {
    const absent = OverlaySchema.parse({ id: 'ov_a1b2c3d4', type, rect }).props
    const empty = OverlaySchema.parse({ id: 'ov_a1b2c3d4', type, rect, props: {} }).props
    expect(empty, '逐字段 default 与手写常量分叉了').toEqual(absent)
    expect(DEFAULT_OVERLAY_PROPS[type], '迁移读的那张表也得是同一份').toEqual(absent)
  })

  it('anchor 默认左上，九个锚点逐字有序', () => {
    expect(parse('text').anchor).toBe('tl')
    expect([...OVERLAY_ANCHORS]).toEqual(['tl', 'tc', 'tr', 'ml', 'mc', 'mr', 'bl', 'bc', 'br'])
  })

  it('四个占位符逐字有序', () => {
    expect([...OVERLAY_TOKENS]).toEqual(['{flowName}', '{stepName}', '{stepIndex}', '{stepTotal}'])
  })

  it('四支各自 .strict() —— 一个拼错的 prop 名会被拒，不是被静默保存', () => {
    expect(OverlaySchema.safeParse({ id: 'ov_a1b2c3d4', type: 'text', rect, props: { txet: 'x' } }).success).toBe(false)
  })
})

describe('v3 §1.4 · dataSource', () => {
  it('十二个字段的默认值逐个写死', () => {
    const seed = { id: 'ds_a1b2c3d4', name: '产线读数' }
    expect(DataSourceSchema.parse(seed)).toEqual({
      ...seed,
      enabled: false,
      mode: 'live',
      url: '',
      method: 'get',
      body: null,
      auth: { kind: 'none', secretRef: '', headerName: '' },
      intervalMs: 30_000,
      timeoutMs: 10_000,
      startOn: 'sceneReady',
      onError: 'keep',
      map: [],
      sample: [],
    })
  })

  it('intervalMs 的上下限：1 秒到 1 小时', () => {
    const seed = { id: 'ds_a1b2c3d4', name: 'x' }
    expect(DataSourceSchema.safeParse({ ...seed, intervalMs: 999 }).success).toBe(false)
    expect(DataSourceSchema.safeParse({ ...seed, intervalMs: 1000 }).success).toBe(true)
    expect(DataSourceSchema.safeParse({ ...seed, intervalMs: 3_600_001 }).success).toBe(false)
    expect(DataSourceSchema.safeParse({ ...seed, intervalMs: 1500.5 }).success, '毫秒必须是整数').toBe(false)
  })

  it('timeoutMs 的上下限：1 秒到 1 分钟', () => {
    const seed = { id: 'ds_a1b2c3d4', name: 'x' }
    expect(DataSourceSchema.safeParse({ ...seed, timeoutMs: 999 }).success).toBe(false)
    expect(DataSourceSchema.safeParse({ ...seed, timeoutMs: 60_001 }).success).toBe(false)
  })

  it('四种鉴权方式逐字有序', () => {
    expect([...DATA_SOURCE_AUTH_KINDS]).toEqual(['none', 'bearer', 'basic', 'header'])
  })

  it('url 不做 .url() 校验 —— 写了一半的地址不该让整份文档打不开（C4）', () => {
    expect(DataSourceSchema.safeParse({ id: 'ds_a1b2c3d4', name: 'x', url: 'http://' }).success).toBe(true)
  })
})

describe('v3 §1.6 · 事件与载荷', () => {
  it('十一种事件，逐字且有序', () => {
    // freeze-table.test.ts 已断了长度与三个新成员在册，**但没断顺序**。
    // 顺序也是契约：编辑器的下拉框按它渲染。
    expect([...EVENT_TYPES]).toEqual([
      'sceneReady',
      'click',
      'hoverEnter',
      'hoverLeave',
      'hotspotClick',
      'animationEnd',
      'variableChange',
      'timer',
      'pageEnter',
      'flowStepEnter',
      'overlayClick',
    ])
  })

  it('五个载荷键，逐字且有序', () => {
    expect([...EVENT_PAYLOAD_KEYS]).toEqual(['nodeId', 'hotspotId', 'animationId', 'stepId', 'pageId'])
  })
})

describe('v3 · 四个新前缀的字面值', () => {
  it('ov / ds / scn / pfb', () => {
    // 前缀是 id 的一部分，改一个字母等于让所有历史 id 变非法。
    expect(PREFIXES.overlay).toBe('ov')
    expect(PREFIXES.dataSource).toBe('ds')
    expect(PREFIXES.scene).toBe('scn')
    expect(PREFIXES.prefab).toBe('pfb')
  })

  it('一共 17 个前缀，且互不重复', () => {
    const values = Object.values(PREFIXES)
    expect(values).toHaveLength(17)
    expect(new Set(values).size, '两个种类共用一个前缀，id 就分不出是谁的').toBe(17)
  })
})

describe('v3 · 节点四个新承载体字段的默认值', () => {
  it('全是 null —— 一份没写它们的文档不会自己爆炸、自己剖切', () => {
    const bare = {
      id: 'nd_a1b2c3d4',
      name: 'x',
      parent: null,
      order: 100,
      assetRef: null,
      primitive: null,
      light: null,
      transform: { p: [0, 0, 0], r: [0, 0, 0, 1], s: [1, 1, 1] },
    }
    const parsed = NodeSchema.parse(bare)
    expect(parsed.section).toBe(null)
    expect(parsed.explode).toBe(null)
    expect(parsed.explodeOffset).toBe(null)
    expect(parsed.prefabRef).toBe(null)
  })
})
