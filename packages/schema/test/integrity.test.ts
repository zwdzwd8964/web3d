import { describe, expect, it } from 'vitest'
import type { SceneDocument } from '../src/document.js'
import { checkIntegrity, formatIntegrityReport } from '../src/integrity.js'
import { createGoldenPathDocument } from '../src/samples.js'

function mutated(mutate: (doc: any) => void): SceneDocument {
  const doc = structuredClone(createGoldenPathDocument()) as any
  mutate(doc)
  return doc as SceneDocument
}

const codes = (doc: SceneDocument) => checkIntegrity(doc).issues.map((i) => i.code)

describe('checkIntegrity()', () => {
  it('passes on the golden path document', () => {
    const report = checkIntegrity(createGoldenPathDocument())
    expect(report.ok).toBe(true)
    expect(report.errors).toHaveLength(0)
    expect(report.warnings).toHaveLength(0)
    expect(formatIntegrityReport(report)).toContain('通过')
  })

  it('catches a duplicate id inside a collection', () => {
    const doc = mutated((d) => {
      d.nodes[1].id = d.nodes[0].id
    })
    expect(codes(doc)).toContain('duplicate-id')
    expect(checkIntegrity(doc).ok).toBe(false)
  })

  it('catches a node parented to a missing node', () => {
    const doc = mutated((d) => (d.nodes[1].parent = 'nd_999999'))
    const r = checkIntegrity(doc)
    expect(r.ok).toBe(false)
    expect(r.errors.some((i) => i.code === 'dangling-ref' && i.refKind === 'node')).toBe(true)
  })

  it('catches a node parented to itself', () => {
    const doc = mutated((d) => (d.nodes[1].parent = d.nodes[1].id))
    expect(codes(doc)).toContain('self-parent')
  })

  it('catches a parent cycle and reports it once, not once per member', () => {
    const doc = mutated((d) => {
      // 泵组 -> 阀盖 -> 泵组
      d.nodes[0].parent = d.nodes[2].id
    })
    const cycles = checkIntegrity(doc).issues.filter((i) => i.code === 'parent-cycle')
    expect(cycles.length).toBe(1)
  })

  it('catches a material override pointing at a deleted material', () => {
    const doc = mutated((d) => (d.materials = [d.materials[0]]))
    const r = checkIntegrity(doc)
    expect(r.ok).toBe(false)
    expect(r.errors.some((i) => i.refKind === 'material')).toBe(true)
  })

  it('catches a tween whose target node was deleted', () => {
    const doc = mutated((d) => {
      d.nodes = d.nodes.filter((n: any) => n.name !== '阀盖')
      // keep the hierarchy legal so only the tween reference is at fault
      for (const n of d.nodes) if (n.parent && !d.nodes.some((m: any) => m.id === n.parent)) n.parent = null
      d.hotspots = []
      d.rules = []
    })
    const r = checkIntegrity(doc)
    expect(r.errors.some((i) => i.path.startsWith('animations[0].targets'))).toBe(true)
  })

  it('catches a hotspot anchored to a deleted node', () => {
    const doc = mutated((d) => (d.hotspots[0].anchor.nodeId = 'nd_999999'))
    expect(checkIntegrity(doc).ok).toBe(false)
  })

  it('catches a rule whose trigger node is gone — via the event catalog, not a hard-coded branch', () => {
    const doc = mutated((d) => (d.rules[0].when.nodeId = 'nd_999999'))
    const r = checkIntegrity(doc)
    expect(r.errors.some((i) => i.path === 'rules[0].when.nodeId')).toBe(true)
  })

  it('catches every dangling reference inside a rule action — via the action catalog', () => {
    const doc = mutated((d) => {
      d.rules[0].then[0].animationId = 'anm_999999'
      d.rules[0].then[2].hotspotId = 'hs_999999'
    })
    const r = checkIntegrity(doc)
    expect(r.errors.some((i) => i.path === 'rules[0].then[0].animationId')).toBe(true)
    expect(r.errors.some((i) => i.path === 'rules[0].then[2].hotspotId')).toBe(true)
  })

  it('catches a condition reading an undeclared variable', () => {
    const doc = mutated((d) => (d.rules[0].if[0].left = { var: 'undeclared' }))
    const r = checkIntegrity(doc)
    expect(r.errors.some((i) => i.refKind === 'variable')).toBe(true)
  })

  it('walks nested and/or/not conditions', () => {
    const doc = mutated((d) => {
      d.rules[0].if = [
        { op: 'and', conditions: [{ op: 'not', condition: { op: 'nodeVisible', nodeId: 'nd_999999', expected: true } }] },
      ]
    })
    const r = checkIntegrity(doc)
    expect(r.errors.some((i) => i.path.includes('conditions[0].condition.nodeId'))).toBe(true)
  })

  it('walks arithmetic inside a setVariable value', () => {
    const doc = mutated((d) => {
      d.rules[0].then[3].value = { op: 'add', left: { var: 'step' }, right: { var: 'ghost' } }
    })
    const r = checkIntegrity(doc)
    expect(r.errors.some((i) => i.path.includes('then[3].value.right.var'))).toBe(true)
  })

  it('warns — never errors — on a type mismatch when writing a variable', () => {
    const doc = mutated((d) => (d.rules[0].then[3].value = { const: 'two' }))
    const r = checkIntegrity(doc)
    expect(r.warnings.some((i) => i.code === 'type-mismatch')).toBe(true)
    expect(r.ok).toBe(true)
  })

  it('D5 · an orphaned asset reference is a warning and the node survives', () => {
    const doc = mutated((d) => (d.nodes[3].assetRef.missing = true))
    const r = checkIntegrity(doc)
    expect(r.ok).toBe(true)
    const orphan = r.warnings.find((i) => i.code === 'orphaned-asset-ref')
    expect(orphan).toBeDefined()
    expect(orphan?.message).toContain('配置已保留')
    expect(doc.nodes).toHaveLength(5)
  })

  it('catches a texture slot pointing at a model asset', () => {
    const doc = mutated((d) => (d.materials[0].maps.map = d.assets[0].id))
    expect(codes(doc)).toContain('wrong-asset-type')
  })

  it('warns when parallel mode has nothing to run in parallel', () => {
    const doc = mutated((d) => {
      d.rules[0].mode = 'parallel'
      d.rules[0].then = [d.rules[0].then[1], d.rules[0].then[3]]
    })
    expect(codes(doc)).toContain('pointless-parallel')
  })

  it('checks the reserved collections too (flows / media / pages)', () => {
    const doc = mutated((d) => {
      d.flows = [{ id: 'flw_000001', name: '流程', steps: [{ id: 'st_000001', name: '一', next: 'st_000009' }], stateVariableId: null }]
      d.media = [{ id: 'med_000001', name: '图', type: 'image', assetId: 'ast_999999' }]
      d.pages = [
        {
          id: 'pg_000001',
          name: '页',
          overlays: [{ id: 'ov1', type: 'text', rect: { x: 0, y: 0, w: 1, h: 1 }, text: 'hi', mediaId: 'med_999999', visible: true }],
        },
      ]
    })
    const r = checkIntegrity(doc)
    expect(r.errors.some((i) => i.path.startsWith('flows[0].steps[0].next'))).toBe(true)
    expect(r.errors.some((i) => i.path.startsWith('media[0].assetId'))).toBe(true)
    expect(r.errors.some((i) => i.path.startsWith('pages[0].overlays[0].mediaId'))).toBe(true)
  })

  it('formats a report a publish dialog can show verbatim', () => {
    const doc = mutated((d) => (d.hotspots[0].anchor.nodeId = 'nd_999999'))
    const text = formatIntegrityReport(checkIntegrity(doc))
    expect(text).toContain('阻断')
    expect(text).toContain('hotspots[0].anchor.nodeId')
  })
})
