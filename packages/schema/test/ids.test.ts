import { describe, expect, it } from 'vitest'
import { ID_PREFIXES, VariableId, createId, createSequentialIdFactory, isId, zId } from '../src/ids.js'

describe('stable ids (C9)', () => {
  it('mints ids with the right prefix for every kind', () => {
    for (const kind of Object.keys(ID_PREFIXES) as (keyof typeof ID_PREFIXES)[]) {
      const id = createId(kind)
      expect(id.startsWith(`${ID_PREFIXES[kind]}_`)).toBe(true)
      expect(isId(kind, id)).toBe(true)
    }
  })

  it('rejects an id of the wrong kind — a node id is not a material id', () => {
    const nodeId = createId('node')
    expect(isId('node', nodeId)).toBe(true)
    expect(isId('material', nodeId)).toBe(false)
    expect(zId('material').safeParse(nodeId).success).toBe(false)
  })

  it('rejects hand-written or empty ids', () => {
    for (const bad of ['', 'nd_', 'nd_AB12', 'nd_ab', '阀盖', 'Root/Pump/Body', 3 as unknown as string]) {
      expect(zId('node').safeParse(bad).success).toBe(false)
    }
  })

  it('sequential factory is deterministic and per-kind', () => {
    const a = createSequentialIdFactory()
    const b = createSequentialIdFactory()
    expect(a('node')).toBe('nd_000001')
    expect(a('node')).toBe('nd_000002')
    expect(a('material')).toBe('mat_000001')
    expect(b('node')).toBe('nd_000001')
  })

  it('generates unique ids under repetition', () => {
    const seen = new Set<string>()
    for (let i = 0; i < 2000; i++) seen.add(createId('node'))
    expect(seen.size).toBe(2000)
  })

  it('variable ids are user-authored identifiers, not generated', () => {
    for (const good of ['step', '_tmp', 'currentStep2', 'A']) {
      expect(VariableId.safeParse(good).success).toBe(true)
    }
    for (const bad of ['2step', 'my var', 'step-1', '步骤', '']) {
      expect(VariableId.safeParse(bad).success).toBe(false)
    }
  })
})
