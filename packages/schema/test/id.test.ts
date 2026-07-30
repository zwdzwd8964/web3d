import { describe, expect, it } from 'vitest'
import {
  Id,
  PREFIXES,
  RESERVED_VARIABLE_IDS,
  VariableIdSchema,
  createSequentialIdFactory,
  isId,
  isReservedVariableId,
  newId,
} from '../src/id.js'

/** T-010 · SCHEMA_SPEC §2. Constitution C9. */
describe('id generation and validation', () => {
  it('mints an id with the right prefix and exactly 8 body characters', () => {
    for (const kind of Object.keys(PREFIXES) as (keyof typeof PREFIXES)[]) {
      const id = newId(kind)
      expect(id).toMatch(new RegExp(`^${PREFIXES[kind]}_[0-9a-z]{8}$`))
      expect(isId(kind, id)).toBe(true)
    }
  })

  it('rejects an id of the wrong kind — a node id is not a material id', () => {
    const nodeId = newId('node')
    expect(isId('node', nodeId)).toBe(true)
    expect(isId('material', nodeId)).toBe(false)
    expect(Id(PREFIXES.material).safeParse(nodeId).success).toBe(false)
  })

  it('rejects hand-written, mis-sized, uppercase and non-string ids', () => {
    const NodeId = Id(PREFIXES.node)
    for (const bad of ['', 'nd_', 'nd_ABCDEFGH', 'nd_abc', 'nd_abcdefghi', 'node_abcdefgh', '阀盖', 'Root/Pump/Body']) {
      expect(NodeId.safeParse(bad).success, bad).toBe(false)
    }
    expect(NodeId.safeParse(42).success).toBe(false)
    expect(NodeId.safeParse(null).success).toBe(false)
  })

  it('regenerates when the minted id is already taken', () => {
    // Every id the first 200 attempts could produce is claimed except one escape hatch:
    // instead of faking the CSPRNG, assert the contract on a large real sample.
    const existing = new Set<string>()
    for (let i = 0; i < 500; i++) existing.add(newId('node', existing))
    expect(existing.size).toBe(500)
  })

  it('never returns an id present in the supplied set', () => {
    const taken = new Set(Array.from({ length: 100 }, () => newId('node')))
    for (let i = 0; i < 200; i++) {
      expect(taken.has(newId('node', taken))).toBe(false)
    }
  })

  it('accepts an array as well as a Set for the taken ids', () => {
    const taken = [newId('node'), newId('node')]
    const fresh = newId('node', taken)
    expect(taken).not.toContain(fresh)
  })

  it('generates unique ids under repetition', () => {
    const seen = new Set<string>()
    for (let i = 0; i < 5000; i++) seen.add(newId('node'))
    // 8 base36 chars is ~2.8e12 of space; 5000 draws colliding would mean a broken RNG.
    expect(seen.size).toBe(5000)
  })

  it('the sequential factory is deterministic, 8 characters wide, and per-kind', () => {
    const a = createSequentialIdFactory()
    const b = createSequentialIdFactory()
    expect(a('node')).toBe('nd_00000001')
    expect(a('node')).toBe('nd_00000002')
    expect(a('material')).toBe('mat_00000001')
    expect(b('node')).toBe('nd_00000001')
    expect(isId('node', a('node'))).toBe(true)
  })
})

describe('variable ids — the one user-authored key (SCHEMA_SPEC §2)', () => {
  it('accepts readable identifiers', () => {
    for (const good of ['step', '_tmp', 'currentPart', 'A', 'a'.repeat(32)]) {
      expect(VariableIdSchema.safeParse(good).success, good).toBe(true)
    }
  })

  it('rejects malformed identifiers', () => {
    for (const bad of ['2step', 'my var', 'step-1', '步骤', '', 'a'.repeat(33)]) {
      expect(VariableIdSchema.safeParse(bad).success, bad).toBe(false)
    }
  })

  it('rejects every reserved word', () => {
    expect(RESERVED_VARIABLE_IDS.length).toBeGreaterThan(0)
    for (const word of RESERVED_VARIABLE_IDS) {
      expect(isReservedVariableId(word), word).toBe(true)
      expect(VariableIdSchema.safeParse(word).success, word).toBe(false)
    }
  })

  it('does not treat a reserved word as reserved when it is only a prefix', () => {
    expect(isReservedVariableId('event')).toBe(true)
    expect(isReservedVariableId('eventName')).toBe(false)
    expect(VariableIdSchema.safeParse('eventName').success).toBe(true)
  })
})
