import { createGoldenPathDocument } from '@w3/schema'
import { describe, expect, it } from 'vitest'
import {
  ActionRegistry,
  BUILTIN_ACTIONS,
  createActionRefResolver,
  registerBuiltinActions,
} from '../../src/eca/actions/index.js'
import type { ActionDefinition } from '../../src/eca/types.js'

/** T-082 · ECA_SPEC §4.1. */

const minimal = (type: string): ActionDefinition<Record<string, never>> => ({
  type,
  schema: { safeParse: () => ({ success: true, data: {} }) } as never,
  handler: () => undefined,
  ui: { label: type, group: 'state', fields: [] },
  refs: () => [],
  describe: () => type,
})

describe('ActionRegistry', () => {
  it('registers and retrieves a definition', () => {
    const registry = new ActionRegistry()
    registry.register(minimal('demo'))
    expect(registry.get('demo')?.type).toBe('demo')
    expect(registry.has('demo')).toBe(true)
    expect(registry.all()).toHaveLength(1)
  })

  it('refuses a duplicate type instead of silently replacing it', () => {
    const registry = new ActionRegistry()
    registry.register(minimal('demo'))
    expect(() => registry.register(minimal('demo'))).toThrow(/already registered/)
  })

  it('refuses an empty or non-string type', () => {
    const registry = new ActionRegistry()
    expect(() => registry.register({ ...minimal('x'), type: '' })).toThrow(/non-empty string/)
  })

  it('refuses a definition missing any of the five mandatory members', () => {
    for (const key of ['schema', 'handler', 'ui', 'refs', 'describe'] as const) {
      const registry = new ActionRegistry()
      const broken = { ...minimal('demo') } as Record<string, unknown>
      delete broken[key]
      expect(() => registry.register(broken as unknown as ActionDefinition), key).toThrow(
        new RegExp(`missing required member \`${key}\``),
      )
    }
  })

  it('refuses members of the wrong shape', () => {
    const registry = new ActionRegistry()
    expect(() => registry.register({ ...minimal('a'), handler: 'nope' as never })).toThrow(/must be a function/)
    expect(() => registry.register({ ...minimal('b'), refs: 'nope' as never })).toThrow(/must be functions/)
    expect(() => registry.register({ ...minimal('c'), ui: { label: 'x', group: 'state', fields: 'nope' as never } })).toThrow(
      /ui\.fields/,
    )
  })

  it('clear() empties it, so a suite cannot leak into the next', () => {
    const registry = new ActionRegistry()
    registry.register(minimal('demo'))
    registry.clear()
    expect(registry.size).toBe(0)
  })
})

describe('registerBuiltinActions()', () => {
  it('registers the whole built-in action set', () => {
    const registry = registerBuiltinActions(new ActionRegistry())
    expect(registry.size).toBe(BUILTIN_ACTIONS.length)
    expect(registry.all().map((a) => a.type).sort()).toEqual(
      [
        'closePanel',
        'explode',
      'highlight',
        'moveCamera',
        'openLink',
        'openPanel',
        'playAnimation',
        'playMedia',
        'resetScene',
        'seekAnimation',
        'setLight',
        'setMaterial',
        'setVariable',
        'setVisible',
        'stopAnimation',
        'stopMedia',
        'wait',
      ].sort(),
    )
  })

  it('is idempotent, so importing twice is harmless', () => {
    const registry = new ActionRegistry()
    registerBuiltinActions(registry)
    expect(() => registerBuiltinActions(registry)).not.toThrow()
    expect(registry.size).toBe(BUILTIN_ACTIONS.length)
  })

  it('every built-in carries a UI label and a field list the rule editor can render', () => {
    for (const definition of BUILTIN_ACTIONS) {
      expect(definition.ui.label.length, definition.type).toBeGreaterThan(0)
      expect(Array.isArray(definition.ui.fields), definition.type).toBe(true)
      for (const field of definition.ui.fields) {
        expect(field.key.length, `${definition.type}.${field.key}`).toBeGreaterThan(0)
        expect(field.label.length, `${definition.type}.${field.key}`).toBeGreaterThan(0)
      }
    }
  })

  it('every ref-typed field names a ref kind the resolver understands', () => {
    const known = new Set(['node', 'material', 'animation', 'hotspot', 'viewpoint', 'variable', 'media'])
    for (const definition of BUILTIN_ACTIONS) {
      for (const field of definition.ui.fields) {
        if (field.type === 'ref') expect(known.has(field.refKind), `${definition.type}.${field.key}`).toBe(true)
      }
    }
  })
})

describe('createActionRefResolver()', () => {
  const registry = registerBuiltinActions(new ActionRegistry())
  const resolve = createActionRefResolver(registry)

  it('extracts the ids a valid action points at', () => {
    expect(resolve({ action: 'playAnimation', params: { animationId: 'anm_j2l4n6p8' } })).toEqual([
      { kind: 'animation', id: 'anm_j2l4n6p8' },
    ])
    expect(resolve({ action: 'setMaterial', params: { nodeId: 'nd_b3n5m7k9', materialId: 'mat_c4d6f8h1' } })).toEqual([
      { kind: 'node', id: 'nd_b3n5m7k9' },
      { kind: 'material', id: 'mat_c4d6f8h1' },
    ])
  })

  it('returns nothing for an unknown action rather than throwing', () => {
    // A document may name an action this build does not have. That is checkIntegrity's
    // finding to report (I3), not a crash in the indexer.
    expect(resolve({ action: 'notRegistered', params: {} })).toEqual([])
  })

  it('returns nothing when the params do not satisfy the action’s schema', () => {
    expect(resolve({ action: 'playAnimation', params: { animationId: 'not-an-id' } })).toEqual([])
  })

  it('feeds checkIntegrity so it can see inside action params', () => {
    const doc = createGoldenPathDocument()
    expect(resolve(doc.rules[0]!.then[0]!)).toEqual([{ kind: 'animation', id: 'anm_j2l4n6p8' }])
  })
})
