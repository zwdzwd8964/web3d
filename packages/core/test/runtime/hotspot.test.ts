import type { Hotspot, SceneDocument } from '@w3/schema'
import { createGoldenPathDocument } from '@w3/schema'
import { beforeEach, describe, expect, it } from 'vitest'
import { CameraController } from '../../src/runtime/camera-controller.js'
import { HotspotProjector, NullHotspotRenderer } from '../../src/runtime/hotspot-layer.js'
import { SceneGraph } from '../../src/runtime/scene-graph.js'
import { IDS } from '../helpers.js'
import { createPumpAsset } from './fixtures.js'

/** T-041 · MVP_V0 D7. The projector is pure maths, so it is fully testable in Node. */

let graph: SceneGraph
let camera: CameraController
let projector: HotspotProjector

const doc = (mutate?: (d: SceneDocument) => SceneDocument): SceneDocument => {
  const base = createGoldenPathDocument()
  return mutate ? mutate(base) : base
}

/** Puts the camera on +Z looking at the origin, so screen maths is easy to reason about. */
function faceScene() {
  camera.orbit.target.set(0, 0, 0)
  camera.orbit.theta = Math.PI / 2
  camera.orbit.phi = Math.PI / 2
  camera.orbit.distance = 5
  camera.apply()
}

beforeEach(() => {
  graph = new SceneGraph({ assets: createPumpAsset().source })
  graph.build(createGoldenPathDocument())
  camera = new CameraController(graph, { aspect: 1 })
  projector = new HotspotProjector(graph, { occlusionInterval: 1 })
  faceScene()
})

describe('anchoring', () => {
  it('resolves the anchor to a world position through the node’s matrix', () => {
    const hotspot = doc().hotspots[0]!
    graph.objectFor(IDS.cover)!.position.set(1, 2, 3)
    const world = projector.anchorPosition(hotspot)!
    // offset [0, 0.2, 0] on a node at [1, 2, 3]
    expect(world.toArray().map((n) => Math.round(n * 100) / 100)).toEqual([1, 2.2, 3])
  })

  it('returns null when the anchored node is gone, rather than projecting the origin', () => {
    const orphan: Hotspot = { ...doc().hotspots[0]!, anchor: { nodeId: 'nd_99999999', offset: [0, 0, 0] } }
    expect(projector.anchorPosition(orphan)).toBeNull()
  })

  it('skips a hotspot whose node is missing instead of emitting a bogus placement', () => {
    const broken = doc((d) => ({
      ...d,
      hotspots: [{ ...d.hotspots[0]!, anchor: { nodeId: 'nd_99999999', offset: [0, 0, 0] } }],
    }))
    expect(projector.update(broken, camera.camera, 800, 600)).toEqual([])
  })
})

describe('projection', () => {
  it('projects an anchor at the target to the centre of the canvas', () => {
    const centred = doc((d) => ({
      ...d,
      hotspots: [{ ...d.hotspots[0]!, anchor: { nodeId: IDS.cover, offset: [0, 0, 0] } }],
    }))
    graph.objectFor(IDS.cover)!.position.set(0, 0, 0)

    const [placement] = projector.update(centred, camera.camera, 800, 600)
    expect(placement!.onScreen).toBe(true)
    expect(placement!.x).toBeCloseTo(400, 0)
    expect(placement!.y).toBeCloseTo(300, 0)
  })

  it('reports distance so markers can be depth-sorted', () => {
    const [placement] = projector.update(doc(), camera.camera, 800, 600)
    expect(placement!.distance).toBeGreaterThan(0)
  })

  it('respects the document’s own visibility flag', () => {
    const hidden = doc((d) => ({ ...d, hotspots: [{ ...d.hotspots[0]!, visible: false }] }))
    expect(projector.update(hidden, camera.camera, 800, 600)[0]!.onScreen).toBe(false)
  })
})

describe('D7 · frustum culling comes before raycasting', () => {
  it('performs no raycast for an off-screen hotspot', () => {
    // Point the camera away from the model.
    camera.orbit.target.set(1000, 0, 0)
    camera.apply()

    const placements = projector.update(doc(), camera.camera, 800, 600)
    expect(placements[0]!.onScreen).toBe(false)
    expect(projector.lastRaycastCount, '视锥外必须零射线').toBe(0)
  })

  it('performs no raycast for a hotspot the document hides', () => {
    const hidden = doc((d) => ({ ...d, hotspots: [{ ...d.hotspots[0]!, visible: false }] }))
    projector.update(hidden, camera.camera, 800, 600)
    expect(projector.lastRaycastCount).toBe(0)
  })

  it('scales: a thousand off-screen hotspots cost zero raycasts', () => {
    const base = doc()
    const many: SceneDocument = {
      ...base,
      hotspots: Array.from({ length: 1000 }, (_, i) => ({
        ...base.hotspots[0]!,
        id: `hs_${String(i).padStart(8, '0')}`,
      })),
    }
    camera.orbit.target.set(1000, 0, 0)
    camera.apply()

    const placements = projector.update(many, camera.camera, 800, 600)
    expect(placements).toHaveLength(1000)
    expect(projector.lastRaycastCount).toBe(0)
  })
})

describe('occlusion', () => {
  it('reports a hotspot as not occluded when nothing is in front of it', () => {
    const exposed = doc((d) => ({
      ...d,
      // Anchor well in front of the geometry, toward the camera.
      hotspots: [{ ...d.hotspots[0]!, anchor: { nodeId: IDS.cover, offset: [0, 0, 3] }, occlude: true }],
    }))
    graph.objectFor(IDS.cover)!.position.set(0, 0, 0)
    expect(projector.update(exposed, camera.camera, 800, 600)[0]!.occluded).toBe(false)
  })

  it('reports a hotspot behind geometry as occluded', () => {
    const behind = doc((d) => ({
      ...d,
      hotspots: [{ ...d.hotspots[0]!, anchor: { nodeId: IDS.cover, offset: [0, 0, -3] }, occlude: true }],
    }))
    graph.objectFor(IDS.cover)!.position.set(0, 0, 0)
    graph.objectFor(IDS.body)!.position.set(0, 0, 0)

    const placement = projector.update(behind, camera.camera, 800, 600)[0]!
    expect(placement.onScreen).toBe(true)
    expect(placement.occluded).toBe(true)
    expect(projector.lastRaycastCount).toBe(1)
  })

  it('never occludes a hotspot with occlusion switched off', () => {
    const noOcclude = doc((d) => ({
      ...d,
      hotspots: [{ ...d.hotspots[0]!, anchor: { nodeId: IDS.cover, offset: [0, 0, -3] }, occlude: false }],
    }))
    graph.objectFor(IDS.cover)!.position.set(0, 0, 0)
    const placement = projector.update(noOcclude, camera.camera, 800, 600)[0]!
    expect(placement.occluded).toBe(false)
    expect(projector.lastRaycastCount).toBe(0)
  })

  it('D7 · throttles the raycast and reuses the previous verdict in between', () => {
    const throttled = new HotspotProjector(graph, { occlusionInterval: 3 })
    const d = doc()

    throttled.update(d, camera.camera, 800, 600)
    expect(throttled.lastRaycastCount).toBe(1)

    throttled.update(d, camera.camera, 800, 600)
    expect(throttled.lastRaycastCount, '第 2 帧沿用上一次判定').toBe(0)

    throttled.update(d, camera.camera, 800, 600)
    expect(throttled.lastRaycastCount).toBe(0)

    throttled.update(d, camera.camera, 800, 600)
    expect(throttled.lastRaycastCount, '第 4 帧重新测一次').toBe(1)
  })

  it('reset() clears the cached verdicts', () => {
    const throttled = new HotspotProjector(graph, { occlusionInterval: 3 })
    throttled.update(doc(), camera.camera, 800, 600)
    throttled.reset()
    throttled.update(doc(), camera.camera, 800, 600)
    expect(throttled.lastRaycastCount).toBe(1)
  })
})

describe('R06 · the renderer is a seam, not a hard-wired DOM implementation', () => {
  it('a non-DOM renderer satisfies the interface, which is what image export will need', () => {
    const renderer = new NullHotspotRenderer()
    const d = doc()
    renderer.update(projector.update(d, camera.camera, 800, 600), d)
    expect(renderer.placements).toHaveLength(1)
    renderer.dispose()
    expect(renderer.placements).toHaveLength(0)
  })
})
