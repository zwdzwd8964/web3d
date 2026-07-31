import { describe, expect, it } from 'vitest'
import type { ActionRefResolver } from '../src/index-builder.js'
import { buildIndex, describeReferences, referencesTo } from '../src/index-builder.js'
import { GOLDEN_PATH_IDS, createGoldenPathDocument } from '../src/samples.js'

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
      flows: [{ id: 'flw_a1b2c3d4', name: '流程', variableId: 'step', steps: [] }],
    }
    const index = buildIndex(withExtras)
    expect(referencesTo(index, GOLDEN_PATH_IDS.asset).map((r) => r.path)).toContain('media[0].assetId')
    expect(referencesTo(index, 'step').map((r) => r.path)).toContain('flows[0].variableId')
  })
})
