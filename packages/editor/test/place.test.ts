import { createGoldenPathDocument, identityTransform } from '@w3/schema'
import type { Primitive, SceneDocument } from '@w3/schema'
import { NullHotspotRenderer, SceneRuntime, createMemoryResolver, primitiveBounds } from '@w3/core'
import { describe, expect, it } from 'vitest'
import { offsetToRestOn, placePrimitiveAt, resolveDropPoint, restOnPoint } from '../src/viewport/place.js'

/**
 * T-142 · D18 · where a dropped object lands.
 *
 * The maths is pure and the ray-casting is three's, so all of this runs in Node. What a
 * browser is needed for is whether the drag FEELS right, which no test claims to cover.
 */

const canvas = () => ({ clientWidth: 800, clientHeight: 600 }) as HTMLCanvasElement

function makeRuntime(doc: SceneDocument) {
  const runtime = new SceneRuntime(doc, {
    canvas: canvas(),
    resolver: createMemoryResolver(new Map()),
    mode: 'edit',
    createRenderer: () =>
      ({
        info: { memory: { geometries: 0, textures: 0 } },
        shadowMap: { enabled: false, type: -1 },
        render: () => undefined,
        setSize: () => undefined,
        dispose: () => undefined,
        domElement: {} as HTMLCanvasElement,
      }) as never,
    hotspotRenderer: new NullHotspotRenderer(),
    now: () => 0,
  })
  runtime.graph.build(doc)
  // Looking straight down at the ground from above, so the centre of the canvas is the
  // world origin and a drop there is easy to reason about.
  runtime.camera.camera.position.set(0, 10, 0.001)
  runtime.camera.camera.lookAt(0, 0, 0)
  runtime.camera.camera.updateMatrixWorld(true)
  return runtime
}

/** A document with one 2 × 0.2 × 2 stage, sitting on the ground. */
function docWithStage(): SceneDocument {
  const base = createGoldenPathDocument()
  return {
    ...base,
    nodes: [
      ...base.nodes,
      {
        id: 'nd_stage001',
        name: '展台',
        parent: null,
        order: 9000,
        assetRef: null,
        primitive: { kind: 'box', size: [2, 0.2, 2] },
        light: null,
        transform: { ...identityTransform(), p: [0, 0.1, 0] },
        visible: true,
        locked: false,
        overrides: {},
      },
    ],
  }
}

describe('restOnPoint', () => {
  it('puts the bounding-box bottom at the hit, centred horizontally', () => {
    // A 1-unit cube centred on its origin: the origin ends up half a unit above the hit.
    const cube = { min: [-0.5, -0.5, -0.5] as const, max: [0.5, 0.5, 0.5] as const }
    expect(restOnPoint([3, 0.2, -4], cube)).toEqual([3, 0.7, -4])
  })

  it('handles an origin that is nowhere near the geometry', () => {
    // The case the whole rule exists for. An exporter can put the origin anywhere, and
    // "put the origin at the hit point" buries this model 5 units into the table.
    const offset = { min: [10, 5, 10] as const, max: [12, 8, 12] as const }
    const placed = restOnPoint([0, 1, 0], offset)
    // Bottom (min.y = 5) lands on y = 1 → the origin moves to 1 - 5 = -4.
    expect(placed[1]).toBe(-4)
    // …and the box's horizontal CENTRE (11, 11) sits over the hit (0, 0).
    expect(placed[0]).toBe(-11)
    expect(placed[2]).toBe(-11)
  })

  it('is the identity for a box already resting on the origin', () => {
    const resting = { min: [-1, 0, -1] as const, max: [1, 2, 1] as const }
    expect(restOnPoint([0, 0, 0], resting)).toEqual([0, 0, 0])
  })

  it('agrees with the geometry the factory actually builds', () => {
    // Bounds measured from real geometry, not re-derived — the two must not drift, and a
    // drift shows up as objects slightly sunk into whatever they were dropped on.
    const box: Primitive = { kind: 'box', size: [2, 0.4, 2] }
    expect(restOnPoint([0, 0, 0], primitiveBounds(box))[1]).toBeCloseTo(0.2, 6)
    const capsule: Primitive = { kind: 'capsule', radius: 0.3, length: 0.6 }
    expect(restOnPoint([0, 0, 0], primitiveBounds(capsule))[1]).toBeCloseTo(0.6, 5)
  })
})

describe('resolveDropPoint', () => {
  it('lands on the ground plane when the ray hits nothing', () => {
    const doc = createGoldenPathDocument()
    const runtime = makeRuntime(doc)
    const drop = resolveDropPoint(runtime, doc, { x: 400, y: 300, width: 800, height: 600 })
    expect(drop.onNodeId).toBeNull()
    expect(drop.point[1]).toBe(0)
    expect(drop.point[0]).toBeCloseTo(0, 2)
    expect(drop.point[2]).toBeCloseTo(0, 2)
    runtime.dispose()
  })

  it('lands on the surface under the cursor when there is one', () => {
    const doc = docWithStage()
    const runtime = makeRuntime(doc)
    const drop = resolveDropPoint(runtime, doc, { x: 400, y: 300, width: 800, height: 600 })
    expect(drop.onNodeId, '正中间应当命中展台').toBe('nd_stage001')
    // The stage is 0.2 tall centred at y = 0.1, so its top surface is at y = 0.2.
    expect(drop.point[1]).toBeCloseTo(0.2, 5)
    runtime.dispose()
  })

  it('drops onto a LOCKED surface — locking blocks selection, not gravity', () => {
    const doc = docWithStage()
    const locked: SceneDocument = { ...doc, nodes: doc.nodes.map((n) => (n.id === 'nd_stage001' ? { ...n, locked: true } : n)) }
    const runtime = makeRuntime(locked)
    expect(resolveDropPoint(runtime, locked, { x: 400, y: 300, width: 800, height: 600 }).onNodeId).toBe('nd_stage001')
    runtime.dispose()
  })

  it('ignores the object being dragged, so it cannot climb onto itself', () => {
    // Without the exclusion the ghost preview hits ITSELF every frame and rises one
    // bounding box per pointer move — a bug that looks like the object flying away.
    const doc = docWithStage()
    const runtime = makeRuntime(doc)
    const drop = resolveDropPoint(runtime, doc, { x: 400, y: 300, width: 800, height: 600 }, {
      exclude: new Set(['nd_stage001']),
    })
    expect(drop.onNodeId).toBeNull()
    expect(drop.point[1]).toBe(0)
    runtime.dispose()
  })

  it('falls back to the origin when the ray never meets the ground', () => {
    // Camera at the horizon looking out. A point a kilometre away would be "placed"
    // somewhere the user cannot find; the origin is somewhere they can.
    const doc = createGoldenPathDocument()
    const runtime = makeRuntime(doc)
    runtime.camera.camera.position.set(0, 1, 0)
    runtime.camera.camera.lookAt(0, 1, -10)
    runtime.camera.camera.updateMatrixWorld(true)
    const drop = resolveDropPoint(runtime, doc, { x: 400, y: 300, width: 800, height: 600 })
    expect(drop.point).toEqual([0, 0, 0])
    runtime.dispose()
  })
})

describe('placePrimitiveAt', () => {
  it('rests a cube on the ground when dropped over empty space', () => {
    const doc = createGoldenPathDocument()
    const runtime = makeRuntime(doc)
    const { position } = placePrimitiveAt(runtime, doc, { kind: 'box', size: [1, 1, 1] }, {
      x: 400,
      y: 300,
      width: 800,
      height: 600,
    })
    expect(position[1]).toBeCloseTo(0.5, 5)
    runtime.dispose()
  })

  it('rests a cube ON the stage when dropped over it — not through it', () => {
    // 黄金路径 II 第 3 步 in miniature: 「包围盒底面对齐命中点，不穿模不悬空」.
    const doc = docWithStage()
    const runtime = makeRuntime(doc)
    const { position, onNodeId } = placePrimitiveAt(runtime, doc, { kind: 'box', size: [0.4, 0.4, 0.4] }, {
      x: 400,
      y: 300,
      width: 800,
      height: 600,
    })
    expect(onNodeId).toBe('nd_stage001')
    // Stage top at 0.2, cube half-height 0.2 → origin at 0.4, bottom exactly on the stage.
    expect(position[1]).toBeCloseTo(0.4, 5)
    runtime.dispose()
  })
})

describe('offsetToRestOn', () => {
  it('reports the delta to move an already-placed subtree onto the hit', () => {
    // Library models arrive from the import pipeline with their own transforms; the drop
    // moves the root by a delta rather than overwriting a position it did not choose.
    const bounds = { min: [-1, 0, -1] as const, max: [1, 2, 1] as const }
    expect(offsetToRestOn([5, 0.2, -3], bounds, [0, 0, 0])).toEqual([5, 0.2, -3])
    expect(offsetToRestOn([5, 0.2, -3], bounds, [1, 1, 1])).toEqual([4, -0.8, -4])
  })
})
