import { describe, expect, it } from 'vitest'
import type { SceneDocument } from '../src/document.js'
import type { ActionRefResolver } from '../src/index-builder.js'
import { checkIntegrity, errorsOf, formatIntegrityIssues, hasErrors, warningsOf } from '../src/integrity.js'
import { createGoldenPathDocument } from '../src/samples.js'

/**
 * T-016 · SCHEMA_SPEC §9. Every check I1–I10 gets a positive case (clean document has
 * no such issue) and a negative case (the specific breakage is caught).
 */

/**
 * Stands in for core's action registry (ECA_SPEC §4.1 `refs`). @w3/schema cannot know
 * what an action's params mean, so the resolver is injected.
 */
const actionRefs: ActionRefResolver = (action) => {
  const p = action.params as Record<string, unknown>
  const out: { kind: string; id: string }[] = []
  const take = (key: string, kind: string) => {
    if (typeof p[key] === 'string') out.push({ kind, id: p[key] as string })
  }
  take('animationId', 'animation')
  take('nodeId', 'node')
  take('materialId', 'material')
  take('hotspotId', 'hotspot')
  take('viewpointId', 'viewpoint')
  take('variableId', 'variable')
  return out
}

function mutated(mutate: (doc: any) => void): SceneDocument {
  const doc = structuredClone(createGoldenPathDocument()) as any
  mutate(doc)
  return doc as SceneDocument
}

const check = (doc: SceneDocument) => checkIntegrity(doc, { actionRefs })
const codes = (doc: SceneDocument) => check(doc).map((i) => i.code)
const has = (doc: SceneDocument, code: string) => codes(doc).includes(code)

describe('checkIntegrity() — clean document', () => {
  it('reports no errors and no warnings on the golden path', () => {
    const issues = check(createGoldenPathDocument())
    expect(errorsOf(issues)).toHaveLength(0)
    expect(warningsOf(issues)).toHaveLength(0)
    expect(hasErrors(issues)).toBe(false)
  })

  it('says so explicitly when no action resolver was supplied, instead of implying a clean check', () => {
    const issues = checkIntegrity(createGoldenPathDocument())
    expect(issues.map((i) => i.code)).toContain('I3-actions-unchecked')
    expect(hasErrors(issues)).toBe(false)
  })
})

describe('I1 · ids unique within each collection', () => {
  it('positive: the clean document has no duplicates', () => {
    expect(has(createGoldenPathDocument(), 'I1')).toBe(false)
  })

  it('negative: a duplicated node id is an error naming the first occurrence', () => {
    const doc = mutated((d) => (d.nodes[1].id = d.nodes[0].id))
    const issue = check(doc).find((i) => i.code === 'I1')
    expect(issue?.level).toBe('error')
    expect(issue?.message).toMatch(/首次出现在 nodes\[0\]/)
  })

  it('negative: duplicated flow step ids are caught too', () => {
    const doc = mutated((d) => {
      d.flows = [
        {
          id: 'flw_a1b2c3d4',
          name: '流程',
          variableId: 'step',
          steps: [
            { id: 'st_a1b2c3d4', name: '一', next: null, onEnter: [] },
            { id: 'st_a1b2c3d4', name: '二', next: null, onEnter: [] },
          ],
        },
      ]
    })
    expect(has(doc, 'I1')).toBe(true)
  })
})

describe('I2 · parent resolves and the chain is acyclic', () => {
  it('positive: the clean hierarchy passes', () => {
    expect(has(createGoldenPathDocument(), 'I2')).toBe(false)
  })

  it('negative: a parent pointing at a missing node', () => {
    const doc = mutated((d) => (d.nodes[1].parent = 'nd_99999999'))
    expect(check(doc).some((i) => i.code === 'I2' && i.level === 'error')).toBe(true)
  })

  it('negative: a self-parent', () => {
    const doc = mutated((d) => (d.nodes[1].parent = d.nodes[1].id))
    expect(check(doc).some((i) => i.code === 'I2' && /自己的父级/.test(i.message))).toBe(true)
  })

  it('negative: a long cycle is reported once, not once per member', () => {
    // 泵组 -> 阀盖 -> 泵组
    const doc = mutated((d) => (d.nodes[0].parent = d.nodes[2].id))
    const cycles = check(doc).filter((i) => i.code === 'I2' && /成环/.test(i.message))
    expect(cycles).toHaveLength(1)
  })
})

describe('I3 · every reference resolves', () => {
  it('positive: the clean document resolves everything', () => {
    expect(has(createGoldenPathDocument(), 'I3')).toBe(false)
  })

  it('negative: a material override pointing at a deleted material', () => {
    const doc = mutated((d) => (d.materials = []))
    expect(check(doc).some((i) => i.code === 'I3' && i.refKind === 'material')).toBe(true)
  })

  it('negative: a hotspot anchored to a deleted node', () => {
    const doc = mutated((d) => (d.hotspots[0].anchor.nodeId = 'nd_99999999'))
    expect(check(doc).some((i) => i.path === 'hotspots[0].anchor.nodeId')).toBe(true)
  })

  it('negative: a rule trigger pointing at a deleted node', () => {
    const doc = mutated((d) => (d.rules[0].when.target.nodeId = 'nd_99999999'))
    expect(check(doc).some((i) => i.path === 'rules[0].when.target.nodeId')).toBe(true)
  })

  it('negative: a dangling id inside an action’s params, found through the injected resolver', () => {
    const doc = mutated((d) => (d.rules[0].then[2].params.hotspotId = 'hs_99999999'))
    const issue = check(doc).find((i) => i.path === 'rules[0].then[2].params')
    expect(issue?.level).toBe('error')
    expect(issue?.refKind).toBe('hotspot')
  })

  it('negative: a texture slot pointing at a model asset', () => {
    const doc = mutated((d) => (d.materials[0].params.maps.map = d.assets[0].id))
    expect(check(doc).some((i) => /非贴图资产/.test(i.message))).toBe(true)
  })

  it('negative: a flow step pointing at a step that does not exist', () => {
    const doc = mutated((d) => {
      d.flows = [
        {
          id: 'flw_a1b2c3d4',
          name: '流程',
          variableId: 'step',
          steps: [{ id: 'st_a1b2c3d4', name: '一', next: 'st_99999999', onEnter: [] }],
        },
      ]
    })
    expect(check(doc).some((i) => i.refKind === 'step')).toBe(true)
  })
})

describe('I4 · rule variables exist and comparisons are type-compatible', () => {
  it('positive: `step == 1` against a number variable is fine', () => {
    expect(has(createGoldenPathDocument(), 'I4')).toBe(false)
  })

  it('negative: a condition reading an undeclared variable', () => {
    const doc = mutated((d) => (d.rules[0].if[0].left = { var: 'undeclared' }))
    expect(check(doc).some((i) => i.code === 'I4' && i.refKind === 'variable')).toBe(true)
  })

  it('negative: comparing a number variable against a string literal', () => {
    const doc = mutated((d) => (d.rules[0].if[0].right = { const: '1' }))
    const issue = check(doc).find((i) => i.code === 'I4')
    expect(issue?.level).toBe('error')
    expect(issue?.message).toMatch(/不做隐式转换/)
  })

  it('negative: detects the mismatch with the operands the other way round', () => {
    const doc = mutated((d) => {
      d.rules[0].if[0] = { op: 'eq', left: { const: '1' }, right: { var: 'step' } }
    })
    expect(has(doc, 'I4')).toBe(true)
  })

  it('negative: an `in` list carrying the wrong element type', () => {
    const doc = mutated((d) => {
      d.rules[0].if = [{ op: 'in', left: { var: 'step' }, right: [1, 'two', 3] }]
    })
    expect(check(doc).some((i) => i.code === 'I4' && /1 项类型不符/.test(i.message))).toBe(true)
  })

  it('negative: a variableChange trigger on an undeclared variable', () => {
    const doc = mutated((d) => (d.rules[0].when = { event: 'variableChange', variableId: 'ghost' }))
    expect(check(doc).some((i) => i.code === 'I4' && i.path === 'rules[0].when.variableId')).toBe(true)
  })
})

describe('I5 · enum variables', () => {
  it('positive: a well-formed enum variable', () => {
    const doc = mutated((d) => {
      d.variables.push({ id: 'mode', name: '模式', type: 'enum', default: 'a', options: ['a', 'b'], persist: false })
    })
    expect(has(doc, 'I5')).toBe(false)
  })

  it('negative: an enum variable with no options', () => {
    const doc = mutated((d) => {
      d.variables.push({ id: 'mode', name: '模式', type: 'enum', default: 'a', persist: false })
    })
    expect(has(doc, 'I5')).toBe(true)
  })

  it('negative: a default outside the options list', () => {
    const doc = mutated((d) => {
      d.variables.push({ id: 'mode', name: '模式', type: 'enum', default: 'z', options: ['a', 'b'], persist: false })
    })
    expect(check(doc).some((i) => i.code === 'I5' && /不在 options 中/.test(i.message))).toBe(true)
  })

  it('negative: a non-enum variable whose default type does not match', () => {
    const doc = mutated((d) => (d.variables[0].default = 'one'))
    expect(has(doc, 'I5')).toBe(true)
  })
})

describe('I6 · animations', () => {
  it('positive: the tween in the clean document is fine', () => {
    expect(has(createGoldenPathDocument(), 'I6')).toBe(false)
  })

  it('negative: a tween whose target node was deleted', () => {
    const doc = mutated((d) => (d.animations[0].targets[0].nodeId = 'nd_99999999'))
    expect(check(doc).some((i) => i.code === 'I6' && i.path === 'animations[0].targets[0].nodeId')).toBe(true)
  })

  it('negative: an imported animation naming a clip the asset does not contain', () => {
    const doc = mutated((d) => {
      d.animations.push({
        kind: 'imported',
        id: 'anm_11111111',
        name: '拆解',
        assetId: d.assets[0].id,
        clipName: 'NoSuchClip',
        speed: 1,
        loop: false,
        clampWhenFinished: true,
      })
    })
    expect(check(doc).some((i) => i.code === 'I6' && /不存在名为/.test(i.message))).toBe(true)
  })

  it('positive: an imported animation naming a clip the asset does contain', () => {
    const doc = mutated((d) => {
      d.animations.push({
        kind: 'imported',
        id: 'anm_11111111',
        name: '拆解',
        assetId: d.assets[0].id,
        clipName: 'Disassemble',
        speed: 1,
        loop: false,
        clampWhenFinished: true,
      })
    })
    expect(has(doc, 'I6')).toBe(false)
  })
})

describe('I7 · orphaned asset references are a warning, never a deletion', () => {
  it('positive: nothing orphaned in the clean document', () => {
    expect(has(createGoldenPathDocument(), 'I7')).toBe(false)
  })

  it('negative: a missing assetRef warns, keeps the node, and does not block publishing', () => {
    const doc = mutated((d) => (d.nodes[1].assetRef.missing = true))
    const issues = check(doc)
    const orphan = issues.find((i) => i.code === 'I7')
    expect(orphan?.level).toBe('warn')
    expect(orphan?.message).toContain('配置已保留')
    expect(hasErrors(issues)).toBe(false)
    expect(doc.nodes).toHaveLength(3)
  })
})

describe('I8 · an enabled rule pointing at an orphaned node', () => {
  it('positive: no warning while nothing is orphaned', () => {
    expect(has(createGoldenPathDocument(), 'I8')).toBe(false)
  })

  it('negative: warns once the referenced node is marked missing', () => {
    const doc = mutated((d) => (d.nodes[2].assetRef.missing = true))
    const issue = check(doc).find((i) => i.code === 'I8')
    expect(issue?.level).toBe('warn')
    expect(issue?.refId).toBe(doc.nodes[2]!.id)
  })

  it('does not warn for a disabled rule', () => {
    const doc = mutated((d) => {
      d.nodes[2].assetRef.missing = true
      d.rules[0].enabled = false
    })
    expect(has(doc, 'I8')).toBe(false)
  })
})

describe('I9 · animations nothing ever triggers', () => {
  it('positive: the golden path animation is referenced by its rule', () => {
    expect(has(createGoldenPathDocument(), 'I9')).toBe(false)
  })

  it('negative: an unreferenced animation is reported as info, not as a failure', () => {
    const doc = mutated((d) => {
      d.animations.push({
        kind: 'tween',
        id: 'anm_11111111',
        name: '孤立动画',
        duration: 1,
        easing: 'linear',
        loop: false,
        yoyo: false,
        targets: [{ nodeId: d.nodes[1].id, to: { p: [0, 1, 0] } }],
      })
    })
    const issue = check(doc).find((i) => i.code === 'I9')
    expect(issue?.level).toBe('info')
    expect(hasErrors(check(doc))).toBe(false)
  })
})

describe('I10 · unreachable nodes', () => {
  it('positive: every node in the clean document reaches a root', () => {
    expect(has(createGoldenPathDocument(), 'I10')).toBe(false)
  })

  it('negative: nodes stranded behind a cycle never render, and that is an error', () => {
    const doc = mutated((d) => (d.nodes[0].parent = d.nodes[2].id))
    const issue = check(doc).find((i) => i.code === 'I10')
    expect(issue?.level).toBe('error')
  })
})

describe('report formatting', () => {
  it('renders errors, warnings and info in that order with their check ids', () => {
    const doc = mutated((d) => {
      d.hotspots[0].anchor.nodeId = 'nd_99999999'
      d.nodes[1].assetRef.missing = true
    })
    const text = formatIntegrityIssues(check(doc))
    expect(text).toContain('阻断')
    expect(text).toContain('提示')
    expect(text).toContain('[I3]')
    expect(text.indexOf('阻断')).toBeLessThan(text.indexOf('提示'))
  })

  it('says so plainly when there is nothing to report', () => {
    expect(formatIntegrityIssues([])).toContain('通过')
  })
})
