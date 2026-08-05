import { describe, expect, it } from 'vitest'
import type { ActionRefResolver } from '../src/index-builder.js'
import { buildIndex, describeReferences, referencesTo } from '../src/index-builder.js'
import { GOLDEN_PATH_IDS, createGoldenPathDocument } from '../src/samples.js'
import type { SceneDocument } from '../src/document.js'
import goldenPathTwo from './fixtures/v2/golden-path-2.json' with { type: 'json' }
import orchestration from './fixtures/v3/orchestration.json' with { type: 'json' }
import placeholder from './fixtures/v3/integration-placeholder.json' with { type: 'json' }
import { migrate } from '../src/migrate.js'

/** 迁移链的产物，失败时把错误打出来而不是给出一个空对象。 */
const unwrapChain = (r: ReturnType<typeof migrate>): SceneDocument => {
  if (!r.ok) throw new Error(`v2 fixture 迁移失败：${JSON.stringify(r.error)}`)
  return r.value.document
}

/** T-015 · SCHEMA_SPEC §8. */

const actionRefs: ActionRefResolver = (action) => {
  const p = action.params as Record<string, unknown>
  const out: { kind: string; id: string }[] = []
  for (const [key, kind] of [
    ['animationId', 'animation'],
    ['nodeId', 'node'],
    ['materialId', 'material'],
    ['hotspotId', 'hotspot'],
    ['viewpointId', 'viewpoint'],
    ['variableId', 'variable'],
  ] as const) {
    if (typeof p[key] === 'string') out.push({ kind, id: p[key] as string })
  }
  return out
}

const doc = createGoldenPathDocument()

describe('buildIndex()', () => {
  it('indexes every collection by id', () => {
    const index = buildIndex(doc)
    expect(index.nodeById.size).toBe(3)
    expect(index.assetById.get(GOLDEN_PATH_IDS.asset)?.name).toBe('pump.glb')
    expect(index.materialById.get(GOLDEN_PATH_IDS.material)?.name).toBe('拉丝不锈钢')
    expect(index.animationById.get(GOLDEN_PATH_IDS.animation)?.name).toBe('阀盖抬起')
    expect(index.hotspotById.get(GOLDEN_PATH_IDS.hotspot)?.name).toBe('拆卸提示')
    expect(index.viewpointById.get(GOLDEN_PATH_IDS.viewpoint)?.name).toBe('拆解视角')
    expect(index.variableById.get('step')?.name).toBe('当前步骤')
  })

  it('sorts childrenOf by `order`, not by array position', () => {
    const shuffled = { ...doc, nodes: [doc.nodes[2]!, doc.nodes[0]!, doc.nodes[1]!] }
    const index = buildIndex(shuffled)
    expect(index.childrenOf.get(null)!.map((n) => n.name)).toEqual(['泵组'])
    expect(index.childrenOf.get(GOLDEN_PATH_IDS.nodePump)!.map((n) => n.name)).toEqual(['泵体', '阀盖'])
  })

  it('groups rules by event type — the dispatch entry point (ECA_SPEC §2.3)', () => {
    const index = buildIndex(doc)
    expect([...index.rulesByEvent.keys()]).toEqual(['click'])
    expect(index.rulesByEvent.get('click')).toHaveLength(1)
    expect(index.rulesByEvent.get('hoverEnter')).toBeUndefined()
  })

  it('keeps rule order within an event bucket — all matching rules run, in document order', () => {
    const second = { ...doc.rules[0]!, id: 'rl_99999999', name: '第二条' }
    const index = buildIndex({ ...doc, rules: [doc.rules[0]!, second] })
    expect(index.rulesByEvent.get('click')!.map((r) => r.name)).toEqual(['点击阀盖执行第一步', '第二条'])
  })
})

describe('refsTo — the reverse index behind "what breaks if I delete this?"', () => {
  it('finds structural references without any action resolver', () => {
    const index = buildIndex(doc)
    expect(index.actionRefsResolved).toBe(false)

    const toCover = referencesTo(index, GOLDEN_PATH_IDS.nodeCover)
    const paths = toCover.map((r) => r.path)
    expect(paths).toContain('animations[0].targets[0].nodeId')
    expect(paths).toContain('hotspots[0].anchor.nodeId')
    expect(paths).toContain('rules[0].when')
  })

  it('reaches into action params once core supplies the resolver', () => {
    const index = buildIndex(doc, { actionRefs })
    expect(index.actionRefsResolved).toBe(true)
    const toAnimation = referencesTo(index, GOLDEN_PATH_IDS.animation)
    expect(toAnimation.map((r) => r.path)).toContain('rules[0].then[0]')
    expect(referencesTo(index, GOLDEN_PATH_IDS.hotspot).map((r) => r.path)).toContain('rules[0].then[2]')
  })

  it('records the referring entity, not just the location', () => {
    const index = buildIndex(doc, { actionRefs })
    const ref = referencesTo(index, GOLDEN_PATH_IDS.animation).find((r) => r.from.kind === 'rule')
    expect(ref?.from.id).toBe(GOLDEN_PATH_IDS.rule)
    expect(ref?.targetKind).toBe('animation')
  })

  it('tracks parent, asset and material references from nodes', () => {
    const index = buildIndex(doc)
    expect(referencesTo(index, GOLDEN_PATH_IDS.nodePump).map((r) => r.path)).toEqual([
      'nodes[1].parent',
      'nodes[2].parent',
    ])
    expect(referencesTo(index, GOLDEN_PATH_IDS.asset).map((r) => r.path)).toContain('nodes[1].assetRef.assetId')
    expect(referencesTo(index, GOLDEN_PATH_IDS.material).map((r) => r.path)).toEqual([
      'nodes[2].overrides.materialId',
    ])
  })

  it('returns an empty list for an unreferenced id rather than undefined', () => {
    expect(referencesTo(buildIndex(doc), 'nd_99999999')).toEqual([])
  })

  it('answers T-092’s delete-confirmation sentence', () => {
    const index = buildIndex(doc, { actionRefs })
    const text = describeReferences(index, GOLDEN_PATH_IDS.nodeCover)
    expect(text).toContain('条规则')
    expect(text).toContain('个动画')
    expect(text).toContain('个热点')
    expect(describeReferences(index, 'nd_99999999')).toBe('')
  })

  it('counts distinct referring entities, not raw reference sites', () => {
    // The rule points at 阀盖 from its trigger AND from a highlight action; that is one rule.
    const index = buildIndex(doc, { actionRefs })
    const text = describeReferences(index, GOLDEN_PATH_IDS.nodeCover)
    expect(text).toContain('1 条规则')
  })

  it('indexes media, flow and hotspot-content references too', () => {
    const withExtras = {
      ...doc,
      media: [{ id: 'med_a1b2c3d4', type: 'image' as const, assetId: GOLDEN_PATH_IDS.asset, name: 'warning.png' }],
      flows: [{ id: 'flw_a1b2c3d4', name: '流程', variableId: 'step', startStepId: null, steps: [] }],
    }
    const index = buildIndex(withExtras)
    expect(referencesTo(index, GOLDEN_PATH_IDS.asset).map((r) => r.path)).toContain('media[0].assetId')
    expect(referencesTo(index, 'step').map((r) => r.path)).toContain('flows[0].variableId')
  })
})

/* ========================================================================== */
/* T-122 · v2 index increments                                                */
/* ========================================================================== */

describe('the v2 index', () => {
  /**
   * **先迁移，再当 SceneDocument 用。**
   *
   * 原来是把 v2 的原始 JSON 直接 `as unknown as SceneDocument` —— 于是 `dataSources`
   * / `prefabs` 这些 v3 集合在类型上「有」、在运行时是 `undefined`。T-227 给
   * `buildIndex` 加了 `doc.dataSources.forEach` 之后这六条当场 TypeError。
   *
   * 这与 T-225 在 `integrity.test.ts` 里修的是同一处形状：一份 v2 文档不是 v3 的
   * `SceneDocument`，让类型断言说它是，只是把发现时间推迟到有人真去读那个字段。
   */
  const v2 = () => unwrapChain(migrate(structuredClone(goldenPathTwo)))

  it('indexes media by id like every other collection', () => {
    const index = buildIndex(v2())
    const doc = v2()
    for (const media of doc.media) {
      expect(index.mediaById.get(media.id)?.name).toBe(media.name)
    }
    expect(index.mediaById.size).toBe(doc.media.length)
    expect(index.mediaById.get('med_99999999')).toBeUndefined()
  })

  it('answers "what breaks if I delete this media" — the hotspot that shows it', () => {
    const doc = v2()
    const image = doc.media.find((m) => m.type === 'image')!
    const index = buildIndex(doc)
    expect(referencesTo(index, image.id).map((r) => r.path)).toContain('hotspots[0].content.mediaId')
    expect(describeReferences(index, image.id)).toContain('个热点')
  })

  it('answers it for the rule that plays it, once the resolver can see into params', () => {
    const doc = v2()
    const audio = doc.media.find((m) => m.type === 'audio')!
    const mediaAware: ActionRefResolver = (action) => {
      const id = (action.params as Record<string, unknown>).mediaId
      return typeof id === 'string' ? [{ kind: 'media', id }] : []
    }
    expect(describeReferences(buildIndex(doc, { actionRefs: mediaAware }), audio.id)).toContain('条规则')
    // …and without a resolver it honestly reports nothing rather than guessing.
    expect(describeReferences(buildIndex(doc), audio.id)).toBe('')
  })

  it('indexes the environment map, so deleting the .hdr is not a silent scene change', () => {
    // Nothing in `nodes` points at it — the reference is on the document itself, which is
    // exactly why it would have been missed.
    const doc = v2()
    const index = buildIndex(doc)
    const refs = referencesTo(index, doc.meta.environment.hdriAssetId!)
    expect(refs.map((r) => r.path)).toContain('meta.environment.hdriAssetId')
    expect(describeReferences(index, doc.meta.environment.hdriAssetId!)).toContain('场景设置')
  })

  it('says nothing about the environment map when there is none', () => {
    const doc = v2()
    const hdriId = doc.meta.environment.hdriAssetId!
    doc.meta.environment.hdriAssetId = null
    expect(referencesTo(buildIndex(doc), hdriId)).toHaveLength(0)
  })

  it('indexes the texture a material samples, so the same question works for 贴图', () => {
    const doc = v2()
    const textureId = doc.materials[0]!.params.maps.map!
    const index = buildIndex(doc)
    expect(referencesTo(index, textureId).map((r) => r.path)).toContain('materials[0].params.maps.map')
    expect(describeReferences(index, textureId)).toContain('个材质')
  })
})

/* ========================================================================== */
/* T-227 · v3 的索引面                                                         */
/* ========================================================================== */

describe('the v3 index', () => {
  const orc = () => structuredClone(orchestration) as unknown as SceneDocument
  const ph = () => structuredClone(placeholder) as unknown as SceneDocument

  const pathsTo = (doc: SceneDocument, id: string) =>
    referencesTo(buildIndex(doc), id)
      .map((r) => r.path)
      .sort()

  it('前提：夹具里确实有页面、覆盖层、流程与数据源', () => {
    // 扫描面下限。夹具哪天被改空，下面每一条 toEqual([]) 都会「通过」。
    const o = orc()
    expect(o.pages[0]!.overlays).toHaveLength(4)
    expect(o.flows[0]!.steps).toHaveLength(3)
    expect(ph().dataSources.length).toBeGreaterThanOrEqual(2)
  })

  it('覆盖层引用的媒体：路径逐字，计数是 1 —— 不是「大于 0」', () => {
    // `toContain` / `length > 0` 对「pages 那一段被删掉一半」同样为真。
    expect(pathsTo(orc(), 'med_img00001')).toEqual(['pages[0].overlays[1].props.mediaId'])
  })

  it('删一个被覆盖层引用的媒体，删除确认说得出「1 个覆盖层」', () => {
    expect(describeReferences(buildIndex(orc()), 'med_img00001')).toBe('1 个覆盖层')
  })

  it('覆盖层与规则一起引用同一个流程时，三条路径都在', () => {
    expect(pathsTo(orc(), 'flw_00000001')).toEqual([
      'pages[0].overlays[0].props.flowId',
      'pages[0].overlays[3].props.flowId',
      'rules[2].when',
    ])
  })

  it('步骤的引用有三类：startStepId、next、以及 flowStepEnter 规则', () => {
    // 卡面验收把它写成「两类」，那是在 flowStepEnter 只登记 flow 的前提下。
    // 这里登记了 flow + step 两条，所以是三类——理由见 eventDescriptorRefs 的注释。
    expect(pathsTo(orc(), 'st_00000001')).toEqual(['flows[0].startStepId'])
    expect(pathsTo(orc(), 'st_00000002')).toEqual(['flows[0].steps[0].next', 'rules[2].when'])
    expect(pathsTo(orc(), 'st_00000003')).toEqual(['flows[0].steps[1].next'])
  })

  it('页面被 pageEnter 规则引用', () => {
    expect(pathsTo(orc(), 'pg_00000001')).toEqual(['rules[1].when'])
  })

  it('覆盖层被 overlayClick 规则引用', () => {
    expect(pathsTo(orc(), 'ov_00000003')).toEqual(['rules[3].when'])
  })

  it('数据源映射引用的变量：路径逐字，摘要说「1 个数据源」', () => {
    const doc = ph()
    const index = buildIndex(doc)
    const mapped = doc.dataSources.flatMap((ds) => ds.map.map((m) => m.variableId))
    expect(mapped.length, '夹具里没有映射，这条断言没有对象').toBeGreaterThan(0)
    const first = mapped[0]!
    expect(referencesTo(index, first).map((r) => r.path)).toEqual([`dataSources[1].map[0].variableId`])
    expect(describeReferences(index, first)).toBe('1 个数据源')
  })

  it('成环的流程不会让索引挂住，且只登记链上走得到的那些', () => {
    const doc = orc()
    // st_3 指回 st_1：链变成 1 → 2 → 3 → (回到 1，截断)
    doc.flows[0]!.steps[2]!.next = 'st_00000001'
    const index = buildIndex(doc)
    // 三条 next 全都在链上，所以三条都登记；关键是它**返回了**，没有转圈
    expect(referencesTo(index, 'st_00000001').map((r) => r.path).sort()).toEqual([
      'flows[0].startStepId',
      'flows[0].steps[2].next',
    ])
  })

  it('链断在中间时，断点之后的 next 不被登记', () => {
    const doc = orc()
    doc.flows[0]!.steps[0]!.next = null
    const index = buildIndex(doc)
    // 走不到 st_2，所以 st_2 → st_3 那条 next 不该出现在索引里
    expect(referencesTo(index, 'st_00000003').map((r) => r.path)).toEqual([])
  })
})
