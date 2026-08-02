import type { Light, Node as SchemaNode, SceneDocument } from '@w3/schema'
import { createGoldenPathDocument, createLightNode, createPrimitiveNode, createSequentialIdFactory } from '@w3/schema'
import { SceneRuntime, buildSamplePumpGlb, createMemoryResolver } from '@w3/core'
import type { Mesh, Object3D } from 'three'
import { beforeAll, describe, expect, it } from 'vitest'
import { createDocumentStore } from '../src/store/document-store.js'

/**
 * T-072 · undo has to restore the SCENE, not just the document.
 *
 * The document round-tripping through patches is already covered by
 * `document-store.test.ts`. What that cannot catch is an incremental applier (D1) whose
 * forward path and inverse path are not symmetric — a `setParent` that detaches but does
 * not restore sibling order, a material override that is applied but not undone. The
 * document would look right and the viewport would be wrong, and nothing would fail.
 *
 * So: drive a few hundred random edits through the store, undo every one, and compare the
 * three.js scene graph against the snapshot taken before the first edit.
 *
 * The randomness is seeded. An unreproducible property test failure is a flake report,
 * not a bug report.
 */

const OPERATIONS = 200
const SEED = 0x5eed

/** xorshift32 — small, fast, and deterministic across platforms. */
function makeRandom(seed: number) {
  let state = seed >>> 0 || 1
  return () => {
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    return ((state >>> 0) % 1_000_000) / 1_000_000
  }
}

/** Everything about the scene graph that a document edit is able to change. */
interface SceneSnapshot {
  readonly nodes: {
    id: string
    name: string
    parent: string | null
    position: [number, number, number]
    quaternion: [number, number, number, number]
    scale: [number, number, number]
    visible: boolean
    /** Visual parameters of the material actually bound to this mesh. */
    material: { color: string; roughness: number; metalness: number; opacity: number } | null
    /**
     * v0.5 · everything the editor gained after this test was written (T-185).
     *
     * The snapshot covered transform, visibility, name and material. Lights, primitive
     * geometry, texture slots and the shadow flags were all invisible to it — so an
     * asymmetric applier for any of them undid the DOCUMENT and left the SCENE wrong,
     * which is the exact failure this file exists to catch, and it would have passed.
     */
    light: { type: string; intensity: number; color: string; extra: number[] } | null
    /** Geometry parameters, so a primitive resized and undone is checked to have resized back. */
    geometry: { type: string; params: number[] } | null
    /** Which map slots are bound, and to which image. Sampler state included — see T-181. */
    maps: string[]
    castShadow: boolean
    receiveShadow: boolean
    /**
     * Which nodes share this exact material instance.
     *
     * Instance identity itself is NOT asserted: clone-on-write recreates a clone every
     * time an override is re-applied, so the uuid legitimately differs after an undo.
     * What must hold is the sharing STRUCTURE — if 泵体 and 阀盖 shared one material
     * before, they must share one after, and if they did not, they must not.
     */
    sharedWith: string[]
  }[]
}

function snapshot(runtime: SceneRuntime, doc: SceneDocument): SceneSnapshot {
  // node id -> the material instance bound to it, so sharing can be compared by group.
  const materialOwners = new Map<string, string[]>()
  for (const node of doc.nodes) {
    const mesh = runtime.graph.objectFor(node.id) as Mesh | undefined
    if (!mesh?.isMesh || Array.isArray(mesh.material)) continue
    const list = materialOwners.get(mesh.material.uuid) ?? []
    list.push(node.id)
    materialOwners.set(mesh.material.uuid, list)
  }

  return {
    nodes: doc.nodes
      .map((node) => {
        const object = runtime.graph.objectFor(node.id) as Object3D | undefined
        if (!object) return null
        const mesh = object as Mesh
        return {
          id: node.id,
          name: object.name,
          parent: runtime.graph.nodeIdFor(object.parent),
          position: round3(object.position.toArray() as [number, number, number]),
          quaternion: round4([
            object.quaternion.x,
            object.quaternion.y,
            object.quaternion.z,
            object.quaternion.w,
          ]),
          scale: round3(object.scale.toArray() as [number, number, number]),
          visible: object.visible,
          material: readMaterial(mesh),
          light: readLight(object),
          geometry: readGeometry(mesh),
          maps: readMaps(mesh),
          castShadow: object.castShadow,
          receiveShadow: object.receiveShadow,
          sharedWith:
            mesh.isMesh && !Array.isArray(mesh.material)
              ? [...(materialOwners.get(mesh.material.uuid) ?? [])].sort()
              : [],
        }
      })
      .filter((n): n is SceneSnapshot['nodes'][number] => n !== null)
      .sort((a, b) => a.id.localeCompare(b.id)),
  }
}

function readMaterial(mesh: Mesh): SceneSnapshot['nodes'][number]['material'] {
  if (!mesh.isMesh || Array.isArray(mesh.material)) return null
  const m = mesh.material as { color?: { getHexString(): string }; roughness?: number; metalness?: number; opacity?: number }
  return {
    color: m.color ? `#${m.color.getHexString()}` : '',
    roughness: m.roughness ?? -1,
    metalness: m.metalness ?? -1,
    opacity: m.opacity ?? -1,
  }
}

/**
 * A light's own parameters, read off the three object rather than the document.
 *
 * `extra` carries whatever the kind has that the others do not — a spot's angle and
 * penumbra, a point's distance and decay. Flattening them into one array keeps this
 * indifferent to which kind it was handed, which is what lets the same snapshot compare a
 * node that CHANGED kind and back again.
 */
function readLight(object: Object3D): SceneSnapshot['nodes'][number]['light'] {
  const light = object as Object3D & {
    isLight?: boolean
    intensity?: number
    color?: { getHexString(): string }
    angle?: number
    penumbra?: number
    distance?: number
    decay?: number
  }
  if (!light.isLight) return null
  return {
    type: object.type,
    intensity: light.intensity ?? -1,
    color: light.color ? `#${light.color.getHexString()}` : '',
    extra: [light.angle ?? -1, light.penumbra ?? -1, light.distance ?? -1, light.decay ?? -1].map(
      (n) => Math.round(n * 1e5) / 1e5,
    ),
  }
}

/** Geometry kind and its build parameters — a resized primitive must resize back. */
function readGeometry(mesh: Mesh): SceneSnapshot['nodes'][number]['geometry'] {
  if (!mesh.isMesh || !mesh.geometry) return null
  const params = (mesh.geometry as { parameters?: Record<string, unknown> }).parameters
  return {
    type: mesh.geometry.type,
    params: Object.values(params ?? {})
      .filter((v): v is number => typeof v === 'number')
      .map((n) => Math.round(n * 1e5) / 1e5),
  }
}

/**
 * Which texture slots are bound, and what each is sampling.
 *
 * The colour space and tiling go in deliberately: since T-181 a slot gets a per-sampler
 * INSTANCE of the image, so "the same picture" is no longer the same object, and an undo
 * that restored the image but not the way it is sampled would render differently while
 * comparing equal.
 */
function readMaps(mesh: Mesh): string[] {
  if (!mesh.isMesh || Array.isArray(mesh.material)) return []
  const material = mesh.material as unknown as Record<string, unknown>
  const out: string[] = []
  for (const slot of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap']) {
    const texture = material[slot] as
      | { colorSpace?: string; repeat?: { x: number; y: number }; rotation?: number; uuid?: string }
      | null
      | undefined
    if (!texture) continue
    out.push(`${slot}:${texture.colorSpace}:${texture.repeat?.x},${texture.repeat?.y}:${texture.rotation}`)
  }
  return out.sort()
}

const round3 = (v: [number, number, number]) => v.map((n) => Math.round(n * 1e5) / 1e5) as [number, number, number]
const round4 = (v: [number, number, number, number]) =>
  v.map((n) => Math.round(n * 1e5) / 1e5) as [number, number, number, number]

/**
 * Adds a spotlight and a primitive to the sample document.
 *
 * Without them the random edits below have nothing v0.5 to touch, and extending the
 * snapshot would assert `null === null` for every node — a change that reads like coverage
 * and is not. The generator's new cases pick these two by id.
 */
function withV05Objects(base: SceneDocument): SceneDocument {
  // Explicit ids, NOT a fresh sequential factory. A new factory restarts from the first id,
  // so the light and the box came out carrying ids the golden path already used — and every
  // `nodes.find(n => n.id === …)` below then matched the WRONG node, silently turning each
  // v0.5 edit into a no-op. Three mutations passed against that before the collision showed
  // up. The same trap cost T-184 a false green in the same session.
  const ctx = { newId: createSequentialIdFactory(), now: () => '2026-01-01T00:00:00.000Z' }
  const spot: Light = {
    kind: 'spot',
    color: '#ffd9a0',
    intensity: 3,
    range: 0,
    decay: 2,
    angleDeg: 30,
    penumbra: 0.2,
    shadow: { enabled: true, quality: 'medium', bias: -0.0005 },
  }
  let doc = base
  const light: SchemaNode = { ...createLightNode(doc, { name: '聚光灯', light: spot, ctx }), id: 'nd_v05light' }
  doc = { ...doc, nodes: [...doc.nodes, light] }
  const box: SchemaNode = {
    ...createPrimitiveNode(doc, { name: '立方体', primitive: { kind: 'box', size: [1, 1, 1] }, ctx }),
    id: 'nd_v05box01',
  }
  doc = { ...doc, nodes: [...doc.nodes, box] }

  const ids = doc.nodes.map((n) => n.id)
  if (new Set(ids).size !== ids.length) throw new Error('测试脚手架自己造出了重复 id')
  return doc
}

let sampleGlb: ArrayBuffer

beforeAll(async () => {
  sampleGlb = await buildSamplePumpGlb()
})

describe('undo restores the rendered scene', () => {
  it(`${OPERATIONS} random edits, then ${OPERATIONS} undos, leaves the scene graph identical`, async () => {
    const initial = withV05Objects(createGoldenPathDocument())
    const files = new Map([[initial.assets[0]!.url, sampleGlb]])

    const runtime = new SceneRuntime(initial, {
      resolver: createMemoryResolver(files),
      mode: 'edit',
      now: () => 0,
    })
    await runtime.load(initial)

    const store = createDocumentStore(initial, {
      now: () => 0,
      // The same wiring main.tsx uses: patches go to the incremental applier (D1).
      onPatch: (patches, next, prev) => runtime.applyPatch(patches, next, prev),
    })

    const before = snapshot(runtime, store.getState().doc)
    // The sample really resolved; comparing a scene of empty placeholders would prove
    // nothing about the applier.
    expect(before.nodes.some((n) => n.material !== null), '示例资产必须真的解析出了几何体').toBe(true)

    const random = makeRandom(SEED)
    const nodeIds = initial.nodes.map((n) => n.id)
    const materialIds = [...initial.materials.map((m) => m.id), null]
    const lightId = initial.nodes.find((n) => n.light !== null)!.id
    const boxId = initial.nodes.find((n) => n.primitive !== null)!.id
    let applied = 0

    // The snapshot only proves something if the scene actually HAS these to lose.
    // `not.toBeNull()` would pass on `undefined` too — which is exactly how the first
    // version of this hid an id collision. Assert the shape, not the absence of null.
    expect(before.nodes.find((n) => n.id === lightId)?.light?.type, '前提：灯真的建进了场景').toBe('SpotLight')
    expect(before.nodes.find((n) => n.id === boxId)?.geometry?.type, '前提：原始体真的建进了场景').toBe('BoxGeometry')

    for (let i = 0; i < OPERATIONS; i++) {
      const nodeId = nodeIds[Math.floor(random() * nodeIds.length)]!
      const pick = Math.floor(random() * 9)

      const ok = store.getState().commit(`随机操作 ${i}`, (draft) => {
        const node = draft.nodes.find((n) => n.id === nodeId)
        if (!node) return
        switch (pick) {
          case 0:
            node.transform.p = [round(random() * 4 - 2), round(random() * 4 - 2), round(random() * 4 - 2)]
            break
          case 1:
            node.transform.s = [round(random() * 2 + 0.1), round(random() * 2 + 0.1), round(random() * 2 + 0.1)]
            break
          case 2:
            node.visible = random() > 0.5
            break
          case 3:
            node.name = `节点 ${i}`
            break
          case 4: {
            const materialId = materialIds[Math.floor(random() * materialIds.length)]
            if (materialId === null || materialId === undefined) delete node.overrides.materialId
            else node.overrides.materialId = materialId
            break
          }
          case 5: {
            // v0.5 · the light's own parameters. Aimed at the light node specifically,
            // because picking a random node would spend most operations on a no-op.
            const light = draft.nodes.find((n) => n.id === lightId)
            if (light?.light && light.light.kind === 'spot') {
              light.light.intensity = round(random() * 10)
              light.light.angleDeg = round(random() * 60 + 5)
              light.light.penumbra = round(random())
            }
            break
          }
          case 6: {
            // v0.5 · resizing a primitive rebuilds its geometry, and the undo has to
            // rebuild it back — restoring the document alone leaves the old box on screen.
            const box = draft.nodes.find((n) => n.id === boxId)
            if (box?.primitive && box.primitive.kind === 'box') {
              box.primitive.size = [round(random() * 3 + 0.2), round(random() * 3 + 0.2), round(random() * 3 + 0.2)]
            }
            break
          }
          case 7:
            // v0.5 · the per-node shadow flags, which live in `overrides` and are written
            // onto the three object rather than being read from the document at draw time.
            if (random() > 0.5) node.overrides.castShadow = random() > 0.5
            else delete node.overrides.castShadow
            break
          default:
            if (random() > 0.5) node.overrides.receiveShadow = random() > 0.5
            else delete node.overrides.receiveShadow
        }
      })
      if (ok) applied++
    }

    // Each v0.5 field has to be shown MOVING before the undo is worth checking.
    //
    // Without this the test is symmetric in the wrong way: an applier that ignores lights
    // entirely leaves them untouched going forward, so undo "restores" them for free and
    // the comparison passes. Three mutations — light params never written, geometry never
    // rebuilt, shadow flags never written — all survived the version that only compared
    // before against after-undo. A parity test proves symmetry; it does not prove the
    // forward path happened at all, and it has to assert both.
    const mid = snapshot(runtime, store.getState().doc)
    const at = (snap: SceneSnapshot, id: string) => snap.nodes.find((n) => n.id === id)

    expect(at(mid, lightId)?.light, '灯的参数必须真的被改到了 three 对象上').not.toEqual(at(before, lightId)?.light)
    expect(at(mid, boxId)?.geometry, '改尺寸必须真的重建了几何').not.toEqual(at(before, boxId)?.geometry)
    expect(
      mid.nodes.map((n) => `${n.castShadow}${n.receiveShadow}`),
      '阴影标志位必须真的写到了 three 对象上',
    ).not.toEqual(before.nodes.map((n) => `${n.castShadow}${n.receiveShadow}`))

    expect(applied, '应该真的产生了编辑').toBeGreaterThan(OPERATIONS / 2)
    expect(snapshot(runtime, store.getState().doc)).not.toEqual(before)

    while (store.getState().canUndo) store.getState().undo()

    expect(store.getState().historyDepth).toBe(0)
    expect(snapshot(runtime, store.getState().doc)).toEqual(before)

    // D1's whole promise: none of that went through a full rebuild.
    expect(runtime.fullRebuildCount, '正常编辑路径不应触发全量重建').toBe(0)

    runtime.dispose()
  })

  it('re-parenting round-trips through the scene graph', async () => {
    const initial = createGoldenPathDocument()
    const runtime = new SceneRuntime(initial, {
      resolver: createMemoryResolver(new Map([[initial.assets[0]!.url, sampleGlb]])),
      mode: 'edit',
      now: () => 0,
    })
    await runtime.load(initial)

    const store = createDocumentStore(initial, {
      now: () => 0,
      onPatch: (patches, next, prev) => runtime.applyPatch(patches, next, prev),
    })

    const before = snapshot(runtime, store.getState().doc)
    const [pump, body, cover] = initial.nodes.map((n) => n.id) as [string, string, string]

    store.getState().commit('移动 泵体', (draft) => {
      const node = draft.nodes.find((n) => n.id === body)
      if (node) node.parent = cover
    })
    expect(runtime.graph.nodeIdFor(runtime.graph.objectFor(body)!.parent)).toBe(cover)

    store.getState().undo()

    expect(runtime.graph.nodeIdFor(runtime.graph.objectFor(body)!.parent)).toBe(pump)
    expect(snapshot(runtime, store.getState().doc)).toEqual(before)
    expect(runtime.fullRebuildCount).toBe(0)

    runtime.dispose()
  })

  it('a gizmo drag undoes to the drag’s starting point, in the scene as well as the document', async () => {
    const initial = createGoldenPathDocument()
    const runtime = new SceneRuntime(initial, {
      resolver: createMemoryResolver(new Map([[initial.assets[0]!.url, sampleGlb]])),
      mode: 'edit',
      now: () => 0,
    })
    await runtime.load(initial)

    const store = createDocumentStore(initial, {
      now: () => 0,
      onPatch: (patches, next, prev) => runtime.applyPatch(patches, next, prev),
    })

    const cover = initial.nodes[2]!.id
    const startY = runtime.graph.objectFor(cover)!.position.y

    store.getState().previewStart()
    for (let frame = 1; frame <= 60; frame++) {
      store.getState().preview((draft) => {
        const node = draft.nodes.find((n) => n.id === cover)
        if (node) node.transform.p = [0, frame / 100, 0]
      })
    }
    store.getState().previewCommit('移动 阀盖')

    expect(runtime.graph.objectFor(cover)!.position.y).toBeCloseTo(0.6, 5)
    expect(store.getState().historyDepth, '一次拖拽一条记录').toBe(1)

    store.getState().undo()

    expect(runtime.graph.objectFor(cover)!.position.y).toBeCloseTo(startY, 5)
    expect(runtime.fullRebuildCount).toBe(0)

    runtime.dispose()
  })
})

const round = (n: number) => Math.round(n * 1e4) / 1e4
