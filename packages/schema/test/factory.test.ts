import { describe, expect, it } from 'vitest'
import { CURRENT_SCHEMA_VERSION } from '../src/document.js'
import {
  createEmptyDocument,
  createHotspot,
  createImportedAnimation,
  createMaterial,
  createNode,
  createRule,
  createTweenAnimation,
  createVariable,
  createViewpoint,
  defaultFactoryContext,
  touch,
} from '../src/factory.js'
import { createSequentialIdFactory } from '../src/ids.js'
import { DEFAULT_MATERIAL_PARAMS } from '../src/materials.js'
import { IDENTITY_TRANSFORM } from '../src/primitives.js'
import { createGoldenPathDocument, createSampleFactoryContext } from '../src/samples.js'
import { checkIntegrity } from '../src/integrity.js'
import { validate } from '../src/validate.js'

const ctx = () => createSampleFactoryContext({ at: '2026-03-05T08:00:00.000Z' })

describe('document factories', () => {
  it('creates an empty document that already validates', () => {
    const doc = createEmptyDocument({ name: '空场景', ctx: ctx() })
    expect(validate(doc).ok).toBe(true)
    expect(checkIntegrity(doc).ok).toBe(true)
    expect(doc.schemaVersion).toBe(CURRENT_SCHEMA_VERSION)
    expect(doc.meta.createdAt).toBe('2026-03-05T08:00:00.000Z')
    expect(doc.meta.updatedAt).toBe(doc.meta.createdAt)
  })

  it('creates every reserved collection as an empty array, not undefined', () => {
    const doc = createEmptyDocument({ name: 'x', ctx: ctx() })
    expect(doc.pages).toEqual([])
    expect(doc.media).toEqual([])
    expect(doc.flows).toEqual([])
    expect(doc.constraints).toEqual([])
  })

  it('honours unit / upAxis / description overrides and falls back sensibly', () => {
    const custom = createEmptyDocument({ name: 'x', unit: 'mm', upAxis: 'Z', description: '说明', ctx: ctx() })
    expect(custom.meta).toMatchObject({ unit: 'mm', upAxis: 'Z', description: '说明' })
    const plain = createEmptyDocument({ name: 'x', ctx: ctx() })
    expect(plain.meta).toMatchObject({ unit: 'm', upAxis: 'Y', description: '' })
  })

  it('gives each new node an identity transform that is not shared between nodes', () => {
    const c = ctx()
    const a = createNode({ name: 'a', ctx: c })
    const b = createNode({ name: 'b', ctx: c })
    expect(a.transform).toEqual(IDENTITY_TRANSFORM)
    a.transform.p[0] = 5
    expect(b.transform.p[0]).toBe(0)
    expect(IDENTITY_TRANSFORM.p[0]).toBe(0)
  })

  it('defaults a node to visible, unlocked, unparented, with no asset and no override', () => {
    const n = createNode({ name: 'a', ctx: ctx() })
    expect(n).toMatchObject({ parent: null, assetRef: null, visible: true, locked: false })
    expect(n.overrides.materialId).toBeNull()
  })

  it('accepts explicit node options', () => {
    const c = ctx()
    const parent = createNode({ name: 'p', ctx: c })
    const child = createNode({
      name: 'c',
      parent: parent.id,
      visible: false,
      locked: true,
      materialId: 'mat_000009',
      transform: { p: [1, 2, 3], r: [0, 0, 0, 1], s: [2, 2, 2] },
      assetRef: { assetId: 'ast_000001', objectPath: 'A/B', objectName: 'B' },
      ctx: c,
    })
    expect(child).toMatchObject({ parent: parent.id, visible: false, locked: true })
    expect(child.overrides.materialId).toBe('mat_000009')
    expect(child.transform.p).toEqual([1, 2, 3])
  })

  it('merges material params over the defaults', () => {
    const m = createMaterial({ name: '钢', params: { roughness: 0.2 }, ctx: ctx() })
    expect(m.params.roughness).toBe(0.2)
    expect(m.params.metalness).toBe(DEFAULT_MATERIAL_PARAMS.metalness)
    expect(m.base).toBeNull()
    expect(m.maps).toEqual({})
    const bare = createMaterial({ name: '默认', ctx: ctx() })
    expect(bare.params).toEqual(DEFAULT_MATERIAL_PARAMS)
  })

  it('creates both animation kinds with usable defaults', () => {
    const c = ctx()
    const tween = createTweenAnimation({ name: 't', targets: [{ nodeId: 'nd_000001', from: null, to: { p: [0, 1, 0] } }], ctx: c })
    expect(tween).toMatchObject({ kind: 'tween', durationMs: 1000, easing: 'easeInOutCubic', loop: false })

    const imported = createImportedAnimation({ name: 'i', assetId: 'ast_000001', clipName: 'Disassemble', ctx: c })
    expect(imported).toMatchObject({ kind: 'imported', loop: false, speed: 1 })

    const looped = createImportedAnimation({ name: 'i', assetId: 'ast_000001', clipName: 'Spin', loop: true, speed: 2, ctx: c })
    expect(looped).toMatchObject({ loop: true, speed: 2 })
  })

  it('creates a hotspot that occludes by default and echoes its name into label/title', () => {
    const h = createHotspot({ name: '步骤一', nodeId: 'nd_000001', ctx: ctx() })
    expect(h).toMatchObject({ occlude: true, visible: true, label: '步骤一' })
    expect(h.content).toEqual({ type: 'panel', title: '步骤一', body: '' })
    expect(h.anchor.offset).toEqual([0, 0, 0])

    const explicit = createHotspot({
      name: 'n',
      nodeId: 'nd_000001',
      label: 'L',
      title: 'T',
      body: 'B',
      offset: [0, 1, 0],
      occlude: false,
      ctx: ctx(),
    })
    expect(explicit).toMatchObject({ label: 'L', occlude: false })
    expect(explicit.content).toEqual({ type: 'panel', title: 'T', body: 'B' })
  })

  it('creates a viewpoint with a sane default frustum', () => {
    const v = createViewpoint({ name: '正视', position: [0, 1, 5], target: [0, 1, 0], ctx: ctx() })
    expect(v.camera).toMatchObject({ fov: 45, near: 0.1, far: 1000 })
    const custom = createViewpoint({ name: 'x', position: [0, 0, 1], target: [0, 0, 0], fov: 30, near: 1, far: 50, ctx: ctx() })
    expect(custom.camera).toMatchObject({ fov: 30, near: 1, far: 50 })
  })

  it('creates a variable whose name defaults to its id', () => {
    expect(createVariable({ id: 'step', type: 'number', default: 1 }).name).toBe('step')
    expect(createVariable({ id: 'step', name: '步骤', type: 'number', default: 1 }).name).toBe('步骤')
  })

  it('D9 · a new rule defaults to sequence + restart', () => {
    const r = createRule({
      name: 'r',
      when: { event: 'sceneStart' },
      then: [{ action: 'resetScene' }],
      ctx: ctx(),
    })
    expect(r).toMatchObject({ mode: 'sequence', reentry: 'restart', enabled: true })
    expect(r.if).toEqual([])

    const explicit = createRule({
      name: 'r',
      when: { event: 'sceneStart' },
      then: [{ action: 'resetScene' }],
      mode: 'parallel',
      reentry: 'queue',
      enabled: false,
      if: [{ op: 'eq', left: { var: 'step' }, right: { const: 1 } }],
      ctx: ctx(),
    })
    expect(explicit).toMatchObject({ mode: 'parallel', reentry: 'queue', enabled: false })
    expect(explicit.if).toHaveLength(1)
  })

  it('touch() moves updatedAt without touching createdAt', () => {
    const doc = createEmptyDocument({ name: 'x', ctx: ctx() })
    const later = touch(doc, { newId: createSequentialIdFactory(), now: () => '2026-04-01T00:00:00.000Z' })
    expect(later.meta.createdAt).toBe(doc.meta.createdAt)
    expect(later.meta.updatedAt).toBe('2026-04-01T00:00:00.000Z')
    expect(doc.meta.updatedAt).toBe(doc.meta.createdAt)
  })

  it('falls back to the default context (real clock, random ids) when none is passed', () => {
    const doc = createEmptyDocument({ name: 'x' })
    expect(doc.projectId).toMatch(/^prj_[0-9a-z]{6,32}$/)
    expect(Number.isNaN(Date.parse(doc.meta.createdAt))).toBe(false)
    expect(defaultFactoryContext.newId('node')).toMatch(/^nd_/)
    expect(touch(doc).meta.updatedAt.length).toBeGreaterThan(0)
  })

  it('the golden path builder is deterministic across runs', () => {
    expect(JSON.stringify(createGoldenPathDocument())).toBe(JSON.stringify(createGoldenPathDocument()))
  })

  it('the golden path builder can be re-seeded without colliding', () => {
    const a = createGoldenPathDocument({ idStart: 1 })
    const b = createGoldenPathDocument({ idStart: 100, at: '2027-01-01T00:00:00.000Z' })
    expect(a.projectId).not.toBe(b.projectId)
    expect(b.meta.createdAt).toBe('2027-01-01T00:00:00.000Z')
    expect(validate(b).ok).toBe(true)
  })
})
