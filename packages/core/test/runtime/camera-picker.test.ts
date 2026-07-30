import type { Viewpoint } from '@w3/schema'
import { createGoldenPathDocument } from '@w3/schema'
import { beforeEach, describe, expect, it } from 'vitest'
import { CameraController, shortestAngle } from '../../src/runtime/camera-controller.js'
import { Picker } from '../../src/runtime/picker.js'
import { SceneGraph } from '../../src/runtime/scene-graph.js'
import { IDS } from '../helpers.js'
import { createPumpAsset } from './fixtures.js'

/** T-036 + T-035. Camera maths and Raycaster both work without a GL context. */

let graph: SceneGraph
let camera: CameraController
let picker: Picker

const VIEWPOINT: Viewpoint = createGoldenPathDocument().viewpoints[0]!

beforeEach(() => {
  graph = new SceneGraph({ assets: createPumpAsset().source })
  graph.build(createGoldenPathDocument())
  camera = new CameraController(graph, { aspect: 16 / 9 })
  picker = new Picker(graph)
})

describe('orbit', () => {
  it('places the camera on a sphere around the target', () => {
    camera.orbit.target.set(0, 1, 0)
    camera.orbit.distance = 5
    camera.apply()
    expect(camera.camera.position.distanceTo(camera.orbit.target)).toBeCloseTo(5, 6)
  })

  it('clamps the polar angle away from the poles', () => {
    camera.rotate(0, -10)
    expect(camera.orbit.phi).toBeGreaterThan(0)
    expect(camera.orbit.phi).toBeLessThan(Math.PI)
    camera.rotate(0, 10)
    expect(camera.orbit.phi).toBeGreaterThan(0)
  })

  it('never lets distance reach zero', () => {
    camera.dolly(0)
    expect(camera.orbit.distance).toBeGreaterThan(0)
  })

  it('pan moves the target in screen space', () => {
    const before = camera.orbit.target.clone()
    camera.pan(100, 0)
    expect(camera.orbit.target.equals(before)).toBe(false)
  })

  it('setAspect ignores nonsense instead of producing a broken projection', () => {
    camera.setAspect(2)
    expect(camera.camera.aspect).toBe(2)
    camera.setAspect(0)
    camera.setAspect(Number.NaN)
    expect(camera.camera.aspect).toBe(2)
  })
})

describe('viewpoints', () => {
  it('captures the current view in the document’s camera shape', () => {
    camera.jumpTo(VIEWPOINT)
    const captured = camera.captureViewpoint()
    expect(captured.target.map((n) => Math.round(n * 100) / 100)).toEqual(VIEWPOINT.camera.target)
    expect(captured.position[0]).toBeCloseTo(VIEWPOINT.camera.position[0], 3)
    expect(captured.position[1]).toBeCloseTo(VIEWPOINT.camera.position[1], 3)
    expect(captured.position[2]).toBeCloseTo(VIEWPOINT.camera.position[2], 3)
    expect(captured.fov).toBe(VIEWPOINT.camera.fov)
  })

  it('capture -> jump -> capture round-trips', () => {
    camera.rotate(0.4, 0.2)
    camera.dolly(1.3)
    const first = camera.captureViewpoint()
    camera.jumpTo({ id: 'vp_00000001', name: 'x', camera: first })
    const second = camera.captureViewpoint()
    expect(second.position).toEqual(first.position)
    expect(second.target).toEqual(first.target)
  })

  it('jumpTo adopts the stored frustum', () => {
    camera.jumpTo({ ...VIEWPOINT, camera: { ...VIEWPOINT.camera, fov: 35, near: 1, far: 200 } })
    expect(camera.camera.fov).toBe(35)
    expect(camera.camera.near).toBe(1)
    expect(camera.camera.far).toBe(200)
  })
})

describe('flight', () => {
  it('resolves on arrival and lands on the viewpoint', async () => {
    const promise = camera.flyTo(VIEWPOINT, 0, { duration: 1 })
    let settled = false
    void promise.then(() => {
      settled = true
    })

    camera.update(500)
    await Promise.resolve()
    expect(settled).toBe(false)
    expect(camera.isFlying).toBe(true)

    camera.update(1000)
    await promise
    expect(settled).toBe(true)
    expect(camera.isFlying).toBe(false)
    expect(camera.camera.position.x).toBeCloseTo(VIEWPOINT.camera.position[0], 3)
  })

  it('a zero duration jumps and resolves immediately', async () => {
    await expect(camera.flyTo(VIEWPOINT, 0, { duration: 0 })).resolves.toBeUndefined()
    expect(camera.camera.position.x).toBeCloseTo(VIEWPOINT.camera.position[0], 3)
  })

  it('§5.3 · aborting stops where it is and rejects, rather than snapping', async () => {
    const controller = new AbortController()
    const promise = camera.flyTo(VIEWPOINT, 0, { duration: 1, signal: controller.signal })
    const settled = promise.then(
      () => 'resolved',
      () => 'rejected',
    )
    camera.update(400)
    const midway = camera.camera.position.clone()
    controller.abort()

    expect(await settled).toBe('rejected')
    expect(camera.camera.position.equals(midway)).toBe(true)
    expect(camera.isFlying).toBe(false)
  })

  it('user input cancels an in-progress flight', async () => {
    const promise = camera.flyTo(VIEWPOINT, 0, { duration: 1 })
    const settled = promise.then(
      () => 'resolved',
      () => 'rejected',
    )
    camera.update(300)
    camera.rotate(0.1, 0)
    expect(await settled).toBe('rejected')
    expect(camera.isFlying).toBe(false)
  })

  it('an already-aborted signal rejects without moving', async () => {
    const controller = new AbortController()
    controller.abort()
    const before = camera.camera.position.clone()
    await expect(camera.flyTo(VIEWPOINT, 0, { duration: 1, signal: controller.signal })).rejects.toThrow()
    expect(camera.camera.position.equals(before)).toBe(true)
  })

  it('takes the short way round the azimuth', () => {
    expect(shortestAngle(0.1)).toBeCloseTo(0.1, 6)
    // 350° -> 10° must be +20°, not -340°.
    expect(shortestAngle((350 * Math.PI) / 180)).toBeCloseTo((-10 * Math.PI) / 180, 6)
    expect(shortestAngle(Math.PI)).toBeCloseTo(Math.PI, 6)
    expect(shortestAngle(-Math.PI)).toBeCloseTo(Math.PI, 6)
  })
})

describe('framing', () => {
  it('frames a node so it fits the view', () => {
    expect(camera.frameNode(IDS.body)).toBe(true)
    expect(camera.orbit.distance).toBeGreaterThan(0)
    expect(camera.orbit.target.length()).toBeLessThan(10)
  })

  it('reports false for an unknown node', () => {
    expect(camera.frameNode('nd_99999999')).toBe(false)
  })

  it('frameAll fits the whole document', () => {
    expect(camera.frameAll()).toBe(true)
  })

  it('reports false on an empty scene rather than producing NaN', () => {
    const empty = new SceneGraph()
    expect(new CameraController(empty).frameAll()).toBe(false)
  })
})

describe('picking (T-035)', () => {
  const doc = createGoldenPathDocument()

  beforeEach(() => {
    // Put the camera in front of the pump looking at the origin.
    camera.orbit.target.set(0, 0, 0)
    camera.orbit.theta = 0
    camera.orbit.phi = Math.PI / 2
    camera.orbit.distance = 5
    camera.apply()
  })

  it('hits the object under the pointer and reports its node id', () => {
    const hit = picker.pick(50, 50, 100, 100, camera.camera, doc)
    expect(hit).not.toBeNull()
    expect([IDS.body, IDS.cover]).toContain(hit!.nodeId)
    expect(hit!.distance).toBeGreaterThan(0)
    expect(hit!.point).toHaveLength(3)
  })

  it('returns null when the ray misses everything', () => {
    expect(picker.pick(0, 0, 100, 100, camera.camera, doc)).toBeNull()
  })

  it('returns null for a degenerate canvas instead of dividing by zero', () => {
    expect(picker.pick(50, 50, 0, 0, camera.camera, doc)).toBeNull()
  })

  it('skips an invisible node — three would happily report a hit on one', () => {
    const before = picker.pick(50, 50, 100, 100, camera.camera, doc)!
    graph.setVisible(before.nodeId, false)
    const after = picker.pick(50, 50, 100, 100, camera.camera, doc)
    expect(after?.nodeId).not.toBe(before.nodeId)
  })

  it('skips a locked node, which is what locking is for', () => {
    const before = picker.pick(50, 50, 100, 100, camera.camera, doc)!
    const locked = { ...doc, nodes: doc.nodes.map((n) => (n.id === before.nodeId ? { ...n, locked: true } : n)) }
    expect(picker.pick(50, 50, 100, 100, camera.camera, locked)?.nodeId).not.toBe(before.nodeId)
    // The player has no locking concept, so it opts out.
    expect(picker.pick(50, 50, 100, 100, camera.camera, locked, { ignoreLocked: true })?.nodeId).toBe(before.nodeId)
  })

  it('honours an explicit exclusion set', () => {
    const before = picker.pick(50, 50, 100, 100, camera.camera, doc)!
    const next = picker.pick(50, 50, 100, 100, camera.camera, doc, { exclude: new Set([before.nodeId]) })
    expect(next?.nodeId).not.toBe(before.nodeId)
  })

  it('pickAll returns each node once, nearest first', () => {
    const hits = picker.pickAll(50, 50, 100, 100, camera.camera, doc)
    expect(hits.length).toBeGreaterThan(0)
    expect(new Set(hits.map((h) => h.nodeId)).size).toBe(hits.length)
    for (let i = 1; i < hits.length; i++) {
      expect(hits[i]!.distance).toBeGreaterThanOrEqual(hits[i - 1]!.distance)
    }
  })

  it('an invisible ancestor hides its children from picking too', () => {
    graph.setVisible(IDS.pump, false)
    expect(picker.pick(50, 50, 100, 100, camera.camera, doc)).toBeNull()
  })
})
