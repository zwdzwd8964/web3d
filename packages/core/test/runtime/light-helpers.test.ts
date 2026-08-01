import type { Light, SceneDocument } from '@w3/schema'
import { createGoldenPathDocument, identityTransform } from '@w3/schema'
import { PerspectiveCamera } from 'three'
import { describe, expect, it } from 'vitest'
import { NullHotspotRenderer } from '../../src/runtime/hotspot-layer.js'
import { createMemoryResolver } from '../../src/runtime/loader.js'
import { SceneRuntime } from '../../src/runtime/scene-runtime.js'

/**
 * T-136 · seeing and clicking a light, in edit mode.
 *
 * `Raycaster` needs no GL context, so "can the user select this light" is a real assertion
 * here rather than something only a human with a mouse can check.
 */

const LIGHT_ID = 'nd_light001'

const spot: Light = {
  kind: 'spot',
  color: '#ffd9a0',
  intensity: 3,
  range: 0,
  decay: 2,
  angleDeg: 30,
  penumbra: 0.2,
  shadow: { enabled: false, quality: 'medium', bias: -0.0005 },
}

const point: Light = { kind: 'point', color: '#ffffff', intensity: 1, range: 0, decay: 2, shadow: { enabled: false, quality: 'medium', bias: -0.0005 } }
const ambient: Light = { kind: 'ambient', color: '#ffffff', intensity: 0.6 }

/** The golden path plus one light node at `position`. */
function docWithLight(light: Light, position: [number, number, number] = [0, 0, 0], extra: Partial<{ visible: boolean; locked: boolean }> = {}): SceneDocument {
  const base = createGoldenPathDocument()
  return {
    ...base,
    nodes: [
      ...base.nodes,
      {
        id: LIGHT_ID,
        name: '聚光灯',
        parent: null,
        order: 9000,
        assetRef: null,
        primitive: null,
        light,
        transform: { ...identityTransform(), p: position },
        visible: extra.visible ?? true,
        locked: extra.locked ?? false,
        overrides: {},
      },
    ],
  }
}

const canvas = () => ({ clientWidth: 800, clientHeight: 600 }) as HTMLCanvasElement

function makeRuntime(doc: SceneDocument, mode: 'edit' | 'play' = 'edit') {
  const runtime = new SceneRuntime(doc, {
    canvas: canvas(),
    resolver: createMemoryResolver(new Map()),
    mode,
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
  runtime.lightHelpers?.sync(doc)
  return runtime
}

/**
 * A camera looking down -Z at the origin from z = +5, and the click that lands on it.
 *
 * Centre of an 800×600 canvas is the ray straight down the optical axis, so a light at the
 * origin is exactly what a user aiming at it would hit.
 */
function cameraAtZ5(): PerspectiveCamera {
  const camera = new PerspectiveCamera(50, 800 / 600, 0.1, 1000)
  camera.position.set(0, 0, 5)
  camera.lookAt(0, 0, 0)
  camera.updateMatrixWorld(true)
  return camera
}

describe('light helpers in edit mode', () => {
  it('gives every light a helper and a click proxy', () => {
    const runtime = makeRuntime(docWithLight(spot))
    expect(runtime.lightHelpers?.size).toBe(1)
    // The spot gets both; the proxy is what makes it clickable.
    expect(runtime.lightHelpers?.objects.some((o) => o.name.startsWith('w3:light-proxy'))).toBe(true)
    expect(runtime.lightHelpers?.objects.some((o) => o.name.startsWith('w3:light-helper'))).toBe(true)
    runtime.dispose()
  })

  it('gives an ambient light a proxy but no helper', () => {
    // An ambient light has no position and no direction. A helper would draw a shape that
    // means nothing — worse than nothing, because it looks authoritative.
    const runtime = makeRuntime(docWithLight(ambient))
    expect(runtime.lightHelpers?.size).toBe(1)
    expect(runtime.lightHelpers?.objects.filter((o) => o.name.startsWith('w3:light-helper'))).toHaveLength(0)
    expect(runtime.lightHelpers?.objects.filter((o) => o.name.startsWith('w3:light-proxy'))).toHaveLength(1)
    runtime.dispose()
  })

  it('the proxy is invisible to the renderer but present to the raycaster', () => {
    // `material.visible = false` rather than `object.visible = false`: three skips drawing
    // it either way, but the raycaster tests OBJECTS, and an object-level hide would make
    // the light unclickable — which is the entire problem this exists to solve.
    const runtime = makeRuntime(docWithLight(spot))
    const proxy = runtime.lightHelpers!.objects.find((o) => o.name.startsWith('w3:light-proxy')) as unknown as {
      visible: boolean
      material: { visible: boolean }
    }
    expect(proxy.visible).toBe(true)
    expect(proxy.material.visible).toBe(false)
    runtime.dispose()
  })

  it('a click on the light selects the light node', () => {
    const runtime = makeRuntime(docWithLight(spot))
    const hit = runtime.picker.pick(400, 300, 800, 600, cameraAtZ5(), docWithLight(spot))
    expect(hit?.nodeId).toBe(LIGHT_ID)
    runtime.dispose()
  })

  it('follows the light when the node moves', () => {
    // The proxy is not parented to the light (that would put it inside the document graph
    // and change how 全览 frames the scene), so it has to be moved every frame.
    const moved = docWithLight(spot, [3, 0, 0])
    const runtime = makeRuntime(moved)
    runtime.tick()

    expect(runtime.picker.pick(400, 300, 800, 600, cameraAtZ5(), moved), '灯已经移开，正中间不该再命中它').toBeNull()
    const camera = cameraAtZ5()
    camera.position.set(3, 0, 5)
    camera.lookAt(3, 0, 0)
    camera.updateMatrixWorld(true)
    expect(runtime.picker.pick(400, 300, 800, 600, camera, moved)?.nodeId).toBe(LIGHT_ID)
    runtime.dispose()
  })

  it('a locked light is not pickable, exactly like any other locked node', () => {
    const doc = docWithLight(spot, [0, 0, 0], { locked: true })
    const runtime = makeRuntime(doc)
    expect(runtime.picker.pick(400, 300, 800, 600, cameraAtZ5(), doc)).toBeNull()
    runtime.dispose()
  })

  it('a hidden light is not pickable either', () => {
    const doc = docWithLight(spot, [0, 0, 0], { visible: false })
    const runtime = makeRuntime(doc)
    runtime.tick()
    expect(runtime.picker.pick(400, 300, 800, 600, cameraAtZ5(), doc)).toBeNull()
    runtime.dispose()
  })

  it('rebuilds the helper when the light changes kind', () => {
    // A spot helper drawing a point light's falloff is worse than no helper at all.
    const asSpot = docWithLight(spot)
    const asPoint = docWithLight(point)
    const runtime = makeRuntime(asSpot)
    const before = runtime.lightHelpers!.objects.find((o) => o.name.startsWith('w3:light-helper'))!

    runtime.applyPatch([{ op: 'replace', path: ['nodes', 3, 'light'], value: point }], asPoint, asSpot)
    const after = runtime.lightHelpers!.objects.find((o) => o.name.startsWith('w3:light-helper'))!
    expect(after).not.toBe(before)
    expect(after.type).toBe('PointLightHelper')
    runtime.dispose()
  })

  it('drops the helper when the light node is deleted', () => {
    const lit = docWithLight(spot)
    const plain = createGoldenPathDocument()
    const runtime = makeRuntime(lit)
    expect(runtime.lightHelpers?.size).toBe(1)

    runtime.applyPatch([{ op: 'remove', path: ['nodes', 3] }], plain, lit)
    expect(runtime.lightHelpers?.size).toBe(0)
    expect(runtime.picker.pick(400, 300, 800, 600, cameraAtZ5(), plain)).toBeNull()
    runtime.dispose()
  })

  it('does not appear in the document graph, so it cannot change how the scene is framed', () => {
    // The reason the layer is not parented under `graph.root`: 全览 fits a box around it,
    // and a light contributes nothing to that box today. Click targets are not content.
    const runtime = makeRuntime(docWithLight(spot))
    const names: string[] = []
    runtime.graph.root.traverse((o) => names.push(o.name))
    // `w3:light-target` is excluded on purpose: it IS document content — the -Z aim point
    // the light factory parents to every directional/spot light (D13). Helpers and proxies
    // are the editing furniture that must stay out.
    expect(names.filter((n) => n.startsWith('w3:light-helper') || n.startsWith('w3:light-proxy'))).toEqual([])
    runtime.dispose()
  })
})

describe('light helpers in play mode', () => {
  it('do not exist at all', () => {
    // Editing furniture, like the grid (ECA_SPEC §7). A viewer must never see a light cone,
    // and must never be able to click one.
    const doc = docWithLight(spot)
    const runtime = makeRuntime(doc, 'play')
    expect(runtime.lightHelpers).toBeNull()
    const names: string[] = []
    runtime.scene.traverse((o) => names.push(o.name))
    expect(names.filter((n) => n.startsWith('w3:light-helper') || n.startsWith('w3:light-proxy'))).toEqual([])
    expect(names, '播放器里连 helper 图层的容器都不该存在').not.toContain('w3:light-helpers')
    runtime.dispose()
  })

  it('leave the light unpickable, because there is nothing to hit', () => {
    const doc = docWithLight(spot)
    const runtime = makeRuntime(doc, 'play')
    expect(runtime.picker.pick(400, 300, 800, 600, cameraAtZ5(), doc)).toBeNull()
    runtime.dispose()
  })
})

describe('helpers after a graph rebuild', () => {
  it('re-points at the new light instead of freezing on the old one', () => {
    // Found by M9's closing review. three's helpers hold a reference to their light and
    // read its matrix on every update, and `resetScene` — which is what exiting preview
    // does — rebuilds the whole graph. Every helper was left pointing at a discarded
    // object: it kept drawing where the light used to be, and no test could see it because
    // the proxy (which is repositioned from the graph each frame) still worked.
    const doc = docWithLight(spot, [3, 0, 0])
    const runtime = makeRuntime(doc)
    const lightBefore = runtime.graph.objectFor(LIGHT_ID)
    const helperBefore = runtime.lightHelpers!.objects.find((o) => o.name.startsWith('w3:light-helper'))

    runtime.resetScene()

    const lightAfter = runtime.graph.objectFor(LIGHT_ID)
    expect(lightAfter, 'resetScene 应当重建场景图（前提）').not.toBe(lightBefore)
    const helperAfter = runtime.lightHelpers!.objects.find((o) => o.name.startsWith('w3:light-helper')) as unknown as {
      light: object
    }
    expect(helperAfter).not.toBe(helperBefore)
    expect(helperAfter.light, 'helper 必须指着活着的那盏灯').toBe(lightAfter)
    runtime.dispose()
  })

  it('still selects the light after a rebuild', () => {
    const doc = docWithLight(spot)
    const runtime = makeRuntime(doc)
    runtime.resetScene()
    runtime.tick()
    expect(runtime.picker.pick(400, 300, 800, 600, cameraAtZ5(), doc)?.nodeId).toBe(LIGHT_ID)
    runtime.dispose()
  })
})

/**
 * T-182 · what preview must NOT contain.
 *
 * Preview is not a second runtime — the editor keeps its `mode: 'edit'` one and switches the
 * ECA engine on. Everything `mode === 'edit'` built therefore stays in the scene, so 「预览」
 * was drawing a ground grid and a set of light wireframes that the player never draws, and
 * the picker was still offering the helpers to a click.
 *
 * That is C3 divergence — the two views disagreeing about what the scene contains — in the
 * one feature whose entire job is to rule it out (T-176 审查所得).
 */
describe('preview drops the editing chrome (T-182)', () => {
  it('hides the grid, and brings it back on the way out', () => {
    const runtime = makeRuntime(docWithLight(spot))
    const grid = runtime.scene.children.find((o) => o.name === 'w3:grid')
    expect(grid, '前提：编辑态确实有网格').toBeDefined()

    runtime.setEditorChromeVisible(false)
    expect(grid!.visible, '预览里不该有网格——播放器不画它').toBe(false)

    runtime.setEditorChromeVisible(true)
    expect(grid!.visible, '退出预览要还回来').toBe(true)
    runtime.dispose()
  })

  it('hides the light helpers', () => {
    const runtime = makeRuntime(docWithLight(spot))
    expect(runtime.lightHelpers!.root.visible).toBe(true)

    runtime.setEditorChromeVisible(false)
    expect(runtime.lightHelpers!.root.visible, '灯的线框是编辑期物件').toBe(false)
    runtime.dispose()
  })

  it('stops the helpers eating a click that was aimed past them', () => {
    // The load-bearing one. `visible = false` is honoured by the renderer but NOT by
    // `Raycaster`, which walks the graph regardless — so hiding alone would leave an
    // INVISIBLE proxy swallowing clicks, which is worse than the visible version: the
    // viewer clicks the object, nothing happens, and there is nothing on screen to blame.
    const doc = docWithLight(spot)
    const runtime = makeRuntime(doc)
    expect(runtime.picker.pick(400, 300, 800, 600, cameraAtZ5(), doc)?.nodeId, '前提：编辑态点得到灯').toBe(LIGHT_ID)

    runtime.setEditorChromeVisible(false)
    const hit = runtime.picker.pick(400, 300, 800, 600, cameraAtZ5(), doc)
    expect(hit?.nodeId, '预览里点下去不该打中灯的代理').not.toBe(LIGHT_ID)

    runtime.setEditorChromeVisible(true)
    expect(runtime.picker.pick(400, 300, 800, 600, cameraAtZ5(), doc)?.nodeId, '回到编辑态要能再点中').toBe(LIGHT_ID)
    runtime.dispose()
  })

  it('is a no-op in play mode, where none of this was ever built', () => {
    // The player calls nothing here, but a runtime that threw on it would turn a harmless
    // call into a blank canvas.
    const runtime = makeRuntime(docWithLight(spot), 'play')
    expect(() => runtime.setEditorChromeVisible(false)).not.toThrow()
    expect(runtime.lightHelpers, 'play 模式本来就没有线框').toBeNull()
    runtime.dispose()
  })
})
