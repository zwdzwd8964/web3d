import { describe, expect, it } from 'vitest'
import { CURRENT_VERSION } from '../src/document.js'
import {
  DEFAULT_MATERIAL_NAME,
  appendNode,
  createEmptyDocument,
  createHotspot,
  createImportedAnimation,
  createLightNode,
  createMaterial,
  createMediaRecord,
  createNode,
  createPrimitiveNode,
  createRule,
  createTweenAnimation,
  createVariable,
  createViewpoint,
  defaultFactoryContext,
  ensureDefaultMaterial,
  touch,
} from '../src/factory.js'
import { createSequentialIdFactory } from '../src/id.js'
import { checkIntegrity, hasErrors } from '../src/integrity.js'
import { ORDER_STEP } from '../src/primitives.js'
import {
  collectAllIds,
  getAncestors,
  getAppendOrder,
  getChildren,
  getDescendants,
  getDisplayPath,
  getOrderBetween,
  getSubtreeIds,
  getUnreachableNodes,
  renumberSiblings,
  walkTree,
  wouldCreateCycle,
} from '../src/selectors.js'
import { GOLDEN_PATH_IDS, createGoldenPathDocument } from '../src/samples.js'
import { validate } from '../src/validate.js'

/** T-014 · factories and selectors. */

const ctx = () => ({ newId: createSequentialIdFactory(), now: () => '2026-03-05T08:00:00.000Z' })

describe('factories produce documents that validate', () => {
  it('an empty document is already valid and internally consistent', () => {
    const doc = createEmptyDocument({ name: '空场景', ctx: ctx() })
    expect(validate(doc).ok).toBe(true)
    expect(hasErrors(checkIntegrity(doc))).toBe(false)
    expect(doc.schemaVersion).toBe(CURRENT_VERSION)
    expect(doc.meta.createdAt).toBe('2026-03-05T08:00:00.000Z')
    expect(doc.meta.updatedAt).toBe(doc.meta.createdAt)
    expect(doc.meta.background).toEqual({ type: 'color', color: '#1a1a1a' })
  })

  it('creates every deferred collection as an empty array, not undefined', () => {
    const doc = createEmptyDocument({ name: 'x', ctx: ctx() })
    expect([doc.pages, doc.flows, doc.media]).toEqual([[], [], []])
  })

  it('honours unit / upAxis overrides and falls back to metres and Y-up', () => {
    expect(createEmptyDocument({ name: 'x', unit: 'mm', upAxis: 'Z', ctx: ctx() }).meta).toMatchObject({
      unit: 'mm',
      upAxis: 'Z',
    })
    expect(createEmptyDocument({ name: 'x', ctx: ctx() }).meta).toMatchObject({ unit: 'm', upAxis: 'Y' })
  })

  it('gives each new node its own identity transform', () => {
    const c = ctx()
    const a = createNode({ name: 'a', ctx: c })
    const b = createNode({ name: 'b', ctx: c })
    a.transform.p[0] = 5
    expect(b.transform.p[0]).toBe(0)
  })

  it('defaults a node to root, visible, unlocked, asset-less and un-overridden', () => {
    const n = createNode({ name: 'a', ctx: ctx() })
    expect(n).toMatchObject({ parent: null, assetRef: null, visible: true, locked: false, order: ORDER_STEP })
    expect(n.overrides).toEqual({})
  })

  it('accepts explicit node options', () => {
    const c = ctx()
    const parent = createNode({ name: 'p', ctx: c })
    const child = createNode({
      name: 'c',
      parent: parent.id,
      order: 4000,
      visible: false,
      locked: true,
      overrides: { materialId: 'mat_00000009' },
      assetRef: { assetId: 'ast_00000001', objectPath: 'A/B', objectName: 'B', missing: false },
      ctx: c,
    })
    expect(child).toMatchObject({ parent: parent.id, order: 4000, visible: false, locked: true })
    expect(child.overrides.materialId).toBe('mat_00000009')
  })

  it('appendNode picks the next free order and avoids id collisions with the document', () => {
    const doc = createGoldenPathDocument()
    const added = appendNode(doc, { name: '新增件', parent: GOLDEN_PATH_IDS.nodePump })
    expect(added.order).toBe(3000)
    expect(collectAllIds(doc).has(added.id)).toBe(false)
  })

  it('creates materials with the standard base and an empty map set', () => {
    const m = createMaterial({ name: '钢', params: { roughness: 0.2, maps: {} }, ctx: ctx() })
    expect(m).toMatchObject({ base: 'standard', preset: 'custom' })
    expect(m.params.roughness).toBe(0.2)
    expect(createMaterial({ name: '默认', ctx: ctx() }).params).toEqual({ maps: {} })
  })

  it('creates both animation kinds with the defaults SCHEMA_SPEC §6.2 states', () => {
    const c = ctx()
    const tween = createTweenAnimation({ name: 't', targets: [{ nodeId: 'nd_00000001', to: { p: [0, 1, 0] } }], ctx: c })
    expect(tween).toMatchObject({ kind: 'tween', duration: 1, easing: 'easeInOutCubic', loop: false, yoyo: false })

    const imported = createImportedAnimation({ name: 'i', assetId: 'ast_00000001', clipName: 'Disassemble', ctx: c })
    expect(imported).toMatchObject({ kind: 'imported', speed: 1, loop: false, clampWhenFinished: true })
  })

  it('creates a hotspot that occludes by default with a panel body', () => {
    const h = createHotspot({ name: '步骤一', nodeId: 'nd_00000001', ctx: ctx() })
    expect(h).toMatchObject({ occlude: true, visible: true, fadeWithDistance: false })
    expect(h.content).toEqual({ type: 'panel', title: '步骤一', text: '' })
    expect(h.style).toEqual({ marker: 'dot', color: '#ffb020' })
  })

  it('creates a viewpoint with the default frustum, overridable per field', () => {
    const v = createViewpoint({ name: '正视', position: [0, 1, 5], target: [0, 1, 0], ctx: ctx() })
    expect(v.camera).toMatchObject({ kind: 'perspective', fov: 50, zoom: 1, near: 0.1, far: 1000, up: [0, 1, 0] })
    const ortho = createViewpoint({
      name: 'x',
      position: [0, 0, 1],
      target: [0, 0, 0],
      camera: { kind: 'orthographic', zoom: 2 },
      ctx: ctx(),
    })
    expect(ortho.camera).toMatchObject({ kind: 'orthographic', zoom: 2 })
  })

  it('creates a variable whose display name defaults to its id', () => {
    expect(createVariable({ id: 'step', type: 'number', default: 1 }).name).toBe('step')
    expect(createVariable({ id: 'step', name: '步骤', type: 'number', default: 1 }).persist).toBe(false)
    const mode = createVariable({ id: 'mode', type: 'enum', default: 'a', options: ['a', 'b'] })
    expect(mode.options).toEqual(['a', 'b'])
  })

  it('D9 · a new rule defaults to sequence + restart + abort-on-error', () => {
    const rule = createRule({ name: 'r', when: { event: 'sceneReady' }, then: [{ action: 'resetScene', params: {} }], ctx: ctx() })
    expect(rule).toMatchObject({ mode: 'sequence', reentry: 'restart', onError: 'abort', enabled: true })
    expect(rule.if).toEqual([])
    expect(rule.ifAny).toEqual([])
  })

  it('touch() moves updatedAt and leaves createdAt alone', () => {
    const doc = createEmptyDocument({ name: 'x', ctx: ctx() })
    const later = touch(doc, { newId: createSequentialIdFactory(), now: () => '2026-04-01T00:00:00.000Z' })
    expect(later.meta.createdAt).toBe(doc.meta.createdAt)
    expect(later.meta.updatedAt).toBe('2026-04-01T00:00:00.000Z')
    expect(doc.meta.updatedAt).toBe(doc.meta.createdAt)
  })

  it('falls back to the real clock and CSPRNG when no context is given', () => {
    const doc = createEmptyDocument({ name: 'x' })
    expect(doc.projectId).toMatch(/^prj_[0-9a-z]{8}$/)
    expect(Number.isNaN(Date.parse(doc.meta.createdAt))).toBe(false)
    expect(defaultFactoryContext.newId('node')).toMatch(/^nd_/)
    expect(validate(doc).ok).toBe(true)
  })
})

describe('selectors', () => {
  const doc = createGoldenPathDocument()

  it('reads the hierarchy in order', () => {
    expect(getChildren(doc, null).map((n) => n.name)).toEqual(['泵组'])
    expect(getChildren(doc, GOLDEN_PATH_IDS.nodePump).map((n) => n.name)).toEqual(['泵体', '阀盖'])
    expect(getDescendants(doc, GOLDEN_PATH_IDS.nodePump).map((n) => n.name)).toEqual(['泵体', '阀盖'])
    expect(getAncestors(doc, GOLDEN_PATH_IDS.nodeCover).map((n) => n.name)).toEqual(['泵组'])
    expect(getSubtreeIds(doc, GOLDEN_PATH_IDS.nodePump)).toHaveLength(3)
  })

  it('builds a display path from names — display only, never a key', () => {
    expect(getDisplayPath(doc, GOLDEN_PATH_IDS.nodeCover)).toBe('泵组/阀盖')
    expect(getDisplayPath(doc, 'nd_99999999')).toBe('')
  })

  it('walks the tree depth-first with depths', () => {
    const seen: [string, number][] = []
    walkTree(doc, (n, d) => seen.push([n.name, d]))
    expect(seen).toEqual([
      ['泵组', 0],
      ['泵体', 1],
      ['阀盖', 1],
    ])
  })

  it('SCHEMA_SPEC §4.2 · refuses the drags that would create a cycle', () => {
    expect(wouldCreateCycle(doc, GOLDEN_PATH_IDS.nodePump, GOLDEN_PATH_IDS.nodeCover)).toBe(true)
    expect(wouldCreateCycle(doc, GOLDEN_PATH_IDS.nodeCover, GOLDEN_PATH_IDS.nodeCover)).toBe(true)
    expect(wouldCreateCycle(doc, GOLDEN_PATH_IDS.nodeCover, null)).toBe(false)
    expect(wouldCreateCycle(doc, GOLDEN_PATH_IDS.nodeBody, GOLDEN_PATH_IDS.nodeCover)).toBe(false)
  })

  it('terminates on an already-corrupted parent chain instead of hanging', () => {
    const broken = structuredClone(doc)
    broken.nodes[0]!.parent = broken.nodes[2]!.id
    expect(getAncestors(broken, broken.nodes[1]!.id).length).toBeLessThan(10)
    expect(getDescendants(broken, broken.nodes[0]!.id).length).toBeLessThan(10)
    expect(getUnreachableNodes(broken)).toHaveLength(3)
  })

  it('reports nothing unreachable in a healthy document', () => {
    expect(getUnreachableNodes(doc)).toEqual([])
  })

  it('allocates order keys with room to insert between them', () => {
    expect(getAppendOrder(doc, GOLDEN_PATH_IDS.nodePump)).toBe(3000)
    expect(getAppendOrder(doc, GOLDEN_PATH_IDS.nodeCover)).toBe(ORDER_STEP)
    expect(getOrderBetween(1000, 2000)).toBe(1500)
    expect(getOrderBetween(null, 2000)).toBe(1000)
    expect(getOrderBetween(1000, null)).toBe(2000)
    expect(getOrderBetween(null, null)).toBe(ORDER_STEP)
  })

  it('signals exhaustion so the caller renumbers instead of colliding', () => {
    expect(getOrderBetween(1000, 1001)).toBeNull()
    expect(getOrderBetween(1000, 1000)).toBeNull()
    const renumbered = renumberSiblings(doc, GOLDEN_PATH_IDS.nodePump)
    expect([...renumbered.values()]).toEqual([1000, 2000])
  })

  it('collects every id in the document, including flow steps', () => {
    const ids = collectAllIds({
      ...doc,
      flows: [
        {
          id: 'flw_a1b2c3d4',
          name: '流程',
          variableId: 'step',
          startStepId: null,
          steps: [{ id: 'st_a1b2c3d4', name: '一', next: null, onEnter: [] }],
        },
      ],
    })
    expect(ids.has(GOLDEN_PATH_IDS.project)).toBe(true)
    expect(ids.has(GOLDEN_PATH_IDS.nodeCover)).toBe(true)
    expect(ids.has('st_a1b2c3d4')).toBe(true)
  })
})

/* ========================================================================== */
/* T-122 · v2 factories                                                       */
/* ========================================================================== */

describe('v2 carrier factories', () => {
  const ids = () => ({ newId: createSequentialIdFactory(), now: () => '2026-09-01T00:00:00.000Z' })

  it('createPrimitiveNode produces a node that validates, with exactly one carrier', () => {
    const doc = createEmptyDocument({ name: '设备展台', ctx: ids() })
    const node = createPrimitiveNode(doc, { name: '展台', primitive: { kind: 'box', size: [2, 0.2, 2] }, ctx: ids() })
    doc.nodes.push(node)

    expect(node.primitive).toEqual({ kind: 'box', size: [2, 0.2, 2] })
    expect(node.assetRef).toBeNull()
    expect(node.light).toBeNull()
    expect(validate(doc).ok, JSON.stringify(validate(doc).ok ? '' : (validate(doc) as any).error)).toBe(true)
    expect(hasErrors(checkIntegrity(doc))).toBe(false)
  })

  it('createLightNode produces a light node that validates', () => {
    const doc = createEmptyDocument({ name: '设备展台', ctx: ids() })
    const node = createLightNode(doc, {
      name: '聚光灯',
      light: {
        kind: 'spot',
        color: '#ffd9a0',
        intensity: 3,
        range: 0,
        decay: 2,
        angleDeg: 30,
        penumbra: 0.2,
        shadow: { enabled: true, quality: 'medium', bias: -0.0005 },
      },
      ctx: ids(),
    })
    doc.nodes.push(node)

    expect(node.light?.kind).toBe('spot')
    expect(node.assetRef).toBeNull()
    expect(node.primitive).toBeNull()
    expect(validate(doc).ok).toBe(true)
  })

  it('both factories append after existing siblings rather than colliding on order', () => {
    const doc = createEmptyDocument({ name: '设备展台', ctx: ids() })
    doc.nodes.push(createPrimitiveNode(doc, { name: '展台', primitive: { kind: 'box', size: [1, 1, 1] }, ctx: ids() }))
    doc.nodes.push(createLightNode(doc, { name: '灯', light: { kind: 'ambient', color: '#ffffff', intensity: 0.6 }, ctx: ids() }))
    expect(doc.nodes.map((n) => n.order)).toEqual([ORDER_STEP, ORDER_STEP * 2])
  })

  it('createMediaRecord omits durationS when unknown rather than inventing one', () => {
    // D19 · a fabricated length would hang a `playMedia(await: true)` sequence for exactly
    // as long as the number was wrong. Absent means "resolve immediately and warn".
    const doc = createEmptyDocument({ name: '设备展台', ctx: ids() })
    const withDuration = createMediaRecord(doc, { type: 'audio', assetId: 'ast_a1b2c3d4', name: 'alarm.wav', durationS: 2.4, ctx: ids() })
    const without = createMediaRecord(doc, { type: 'image', assetId: 'ast_a1b2c3d4', name: 'warning.png', ctx: ids() })
    expect(withDuration.durationS).toBe(2.4)
    expect('durationS' in without).toBe(false)
  })

  it('createMediaRecord mints an id that does not collide with anything in the document', () => {
    const doc = createEmptyDocument({ name: '设备展台', ctx: ids() })
    const first = createMediaRecord(doc, { type: 'audio', assetId: 'ast_a1b2c3d4', name: 'a.wav' })
    doc.media.push(first)
    const second = createMediaRecord(doc, { type: 'audio', assetId: 'ast_a1b2c3d4', name: 'b.wav' })
    expect(second.id).not.toBe(first.id)
  })
})

describe('ensureDefaultMaterial · D15', () => {
  const ids = () => ({ newId: createSequentialIdFactory(), now: () => '2026-09-01T00:00:00.000Z' })

  it('creates the shared 「默认材质」 record once and returns the same id afterwards', () => {
    const doc = createEmptyDocument({ name: '设备展台', ctx: ids() })
    const first = ensureDefaultMaterial(doc, ids())
    const second = ensureDefaultMaterial(doc, ids())
    expect(second).toBe(first)
    expect(doc.materials.filter((m) => m.name === DEFAULT_MATERIAL_NAME)).toHaveLength(1)
  })

  it('the record is a real, editable document material — not a hidden rendering state', () => {
    const doc = createEmptyDocument({ name: '设备展台', ctx: ids() })
    const id = ensureDefaultMaterial(doc, ids())
    const material = doc.materials.find((m) => m.id === id)!
    expect(material.name).toBe(DEFAULT_MATERIAL_NAME)
    expect(material.params.color).toBeDefined()
    expect(validate(doc).ok).toBe(true)
  })

  it('a primitive pointed at it passes integrity, and the material panel would find it', () => {
    const doc = createEmptyDocument({ name: '设备展台', ctx: ids() })
    const materialId = ensureDefaultMaterial(doc, ids())
    doc.nodes.push(
      createPrimitiveNode(doc, { name: '展台', primitive: { kind: 'box', size: [1, 1, 1] }, overrides: { materialId }, ctx: ids() }),
    )
    expect(hasErrors(checkIntegrity(doc))).toBe(false)
    expect(doc.nodes[0]!.overrides.materialId).toBe(materialId)
  })

  it('two primitives share it, which is what 默认材质 is supposed to mean', () => {
    const doc = createEmptyDocument({ name: '设备展台', ctx: ids() })
    const a = ensureDefaultMaterial(doc, ids())
    const b = ensureDefaultMaterial(doc, ids())
    expect(a).toBe(b)
    expect(doc.materials).toHaveLength(1)
  })
})
