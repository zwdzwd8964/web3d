import type { FactoryContext, SceneDocument } from '@w3/schema'
import { DEFAULT_MATERIAL_NAME, createGoldenPathDocument, createSequentialIdFactory } from '@w3/schema'
import { SceneRuntime, TEXTURE_SLOT_COLOR_SPACE, buildSamplePumpGlb, createMemoryResolver, shadowMapSizeFor } from '@w3/core'
import type { TextureSlot } from '@w3/core'
import type { Mesh, MeshStandardMaterial, Object3D, SpotLight, Texture } from 'three'
import { beforeAll, describe, expect, it } from 'vitest'
import { createDocumentStore } from '../src/store/document-store.js'
import { LIGHT_TEMPLATES, addLight, setLightParams, setLightShadow } from '../src/lib/light-edit.js'
import { PRIMITIVE_TEMPLATES, addPrimitive } from '../src/lib/library.js'
import { setMap } from '../src/lib/material-edit.js'

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
 *
 * T-185 ② · the snapshot and the edits cover v0.5 state too. The first version stopped at
 * v0 (transform / visibility / four material scalars), so an inverse-path asymmetry in
 * lights, primitives, texture slots or shadow flags was invisible here — and the fixture
 * itself contained none of that state, so even the forward paths never ran. The fixture
 * now seeds all four, the snapshot reads them from the three side, and the deterministic
 * scenarios below assert the FORWARD value before undoing, so a mutation that kills both
 * directions of a path cannot leave the round-trip comparison green.
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

const TEX_ID = 'ast_texdemo1'
const TEX_URL = 'mem:texdemo'
const TEXTURE_SLOTS = Object.keys(TEXTURE_SLOT_COLOR_SPACE) as TextureSlot[]

/**
 * Golden path I plus one of everything v0.5 added: a spot light with shadows on, a point
 * light, a box primitive (which also creates 默认材质), and a texture bound to that
 * material's base-colour slot so `load()` makes it resident. Built with the editor's own
 * draft helpers — the same code a real session runs, not a hand-rolled imitation.
 */
function createV05Document(): SceneDocument {
  // A sequential factory cannot collide with the golden path's handcrafted ids
  // (`nd_r5t8y1u3`…) — but keep the orphan lesson from scale.test.ts in mind before
  // adding any handcrafted node here.
  const ctx: FactoryContext = { newId: createSequentialIdFactory(), now: () => '2026-01-01T00:00:00.000Z' }
  const doc = createGoldenPathDocument()
  const spotTemplate = LIGHT_TEMPLATES.find((t) => t.kind === 'spot')!
  const pointTemplate = LIGHT_TEMPLATES.find((t) => t.kind === 'point')!
  const boxTemplate = PRIMITIVE_TEMPLATES.find((t) => t.kind === 'box')!

  const spot = addLight(doc, spotTemplate, { ctx, name: '聚光灯' })
  setLightShadow(doc, spot.id, { enabled: true })
  addLight(doc, pointTemplate, { ctx, name: '点光' })
  addPrimitive(doc, boxTemplate, { ctx, name: '展台' })

  doc.assets.push({
    id: TEX_ID,
    type: 'texture',
    name: 'concrete.png',
    hash: 'blob_texdemo1',
    url: TEX_URL,
    version: 1,
    lineageId: TEX_ID,
    stats: { tris: 0, materials: 0, textures: 1, bytes: 8, textureBytes: 8, nodes: 0, animations: [] },
  })
  const defaultMaterial = doc.materials.find((m) => m.name === DEFAULT_MATERIAL_NAME)!
  defaultMaterial.params.maps.map = TEX_ID
  return doc
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
    /** Shadow flags as actually written on the object; meaningless for lights. */
    shadow: { cast: boolean; receive: boolean } | null
    /** What the three light actually carries — undoing a light edit must restore this. */
    light: Record<string, unknown> | null
    /** Geometry class and its constructor parameters — a primitive resize must undo here. */
    geometry: { type: string; parameters: Record<string, unknown> | null } | null
    /** Visual parameters of the material actually bound to this mesh. */
    material: {
      color: string
      roughness: number
      metalness: number
      opacity: number
      /** Per texture slot: what is bound and how it will be sampled, or null. */
      maps: Record<string, { name: string; colorSpace: string; repeat: [number, number]; offset: [number, number]; rotation: number } | null>
    } | null
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
          shadow: readLight(object) === null ? { cast: object.castShadow, receive: object.receiveShadow } : null,
          light: readLight(object),
          geometry: readGeometry(mesh),
          material: readMaterial(mesh),
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

/** Duck-typed: reads whatever light-like fields the object carries, `null` for non-lights. */
function readLight(object: Object3D): Record<string, unknown> | null {
  const l = object as Partial<SpotLight> & { groundColor?: { getHexString(): string } }
  if (!(l as { isLight?: boolean }).isLight) return null
  const out: Record<string, unknown> = { type: object.type }
  if (l.color) out.color = `#${l.color.getHexString()}`
  if (l.groundColor) out.groundColor = `#${l.groundColor.getHexString()}`
  if (l.intensity !== undefined) out.intensity = round(l.intensity)
  if (l.distance !== undefined) out.distance = round(l.distance)
  if (l.decay !== undefined) out.decay = round(l.decay)
  if (l.angle !== undefined) out.angle = round(l.angle)
  if (l.penumbra !== undefined) out.penumbra = round(l.penumbra)
  out.castShadow = object.castShadow
  if (l.shadow) out.shadow = { bias: l.shadow.bias, mapSize: l.shadow.mapSize.width }
  return out
}

/** three's parametric geometries expose their constructor args on `.parameters`. */
function readGeometry(mesh: Mesh): SceneSnapshot['nodes'][number]['geometry'] {
  if (!mesh.isMesh || !mesh.geometry) return null
  const geometry = mesh.geometry as { type: string; parameters?: Record<string, unknown> }
  return { type: geometry.type, parameters: geometry.parameters ?? null }
}

function readMaterial(mesh: Mesh): SceneSnapshot['nodes'][number]['material'] {
  if (!mesh.isMesh || Array.isArray(mesh.material)) return null
  const m = mesh.material as {
    color?: { getHexString(): string }
    roughness?: number
    metalness?: number
    opacity?: number
  }
  const maps: SceneSnapshot['nodes'][number]['material'] extends { maps: infer T } | null ? T : never = {}
  for (const slot of TEXTURE_SLOTS) {
    const texture = (mesh.material as unknown as Record<string, Texture | null | undefined>)[slot]
    maps[slot] = texture
      ? {
          name: texture.name,
          colorSpace: texture.colorSpace,
          repeat: [round(texture.repeat.x), round(texture.repeat.y)],
          offset: [round(texture.offset.x), round(texture.offset.y)],
          rotation: round(texture.rotation),
        }
      : null
  }
  return {
    color: m.color ? `#${m.color.getHexString()}` : '',
    roughness: m.roughness ?? -1,
    metalness: m.metalness ?? -1,
    opacity: m.opacity ?? -1,
    maps,
  }
}

const round3 = (v: [number, number, number]) => v.map((n) => Math.round(n * 1e5) / 1e5) as [number, number, number]
const round4 = (v: [number, number, number, number]) =>
  v.map((n) => Math.round(n * 1e5) / 1e5) as [number, number, number, number]

let sampleGlb: ArrayBuffer

beforeAll(async () => {
  sampleGlb = await buildSamplePumpGlb()
})

async function createRig() {
  const initial = createV05Document()
  const files = new Map([
    [initial.assets[0]!.url, sampleGlb],
    [TEX_URL, new ArrayBuffer(8)],
  ])
  const runtime = new SceneRuntime(initial, {
    resolver: createMemoryResolver(files),
    mode: 'edit',
    now: () => 0,
    // Documented test injection (SceneRuntimeOptions.decodeTexture): decoding needs a
    // browser, the cache logic under test does not (C8).
    decodeTexture: async () => ({ width: 4, height: 4 }) as unknown as TexImageSource,
  })
  await runtime.load(initial)
  const store = createDocumentStore(initial, {
    now: () => 0,
    // Direct wiring to the applier ON PURPOSE, not main.tsx's: the subject here is
    // `applyPatch`'s inverse path. The production forwarder in front of it (asset awaits,
    // queueing, camera framing) has its own suite — patch-forwarder.test.ts (T-185 ①).
    onPatch: (patches, next, prev) => runtime.applyPatch(patches, next, prev),
  })
  return { initial, runtime, store }
}

describe('undo restores the rendered scene', () => {
  it(`${OPERATIONS} random edits, then ${OPERATIONS} undos, leaves the scene graph identical`, async () => {
    const { initial, runtime, store } = await createRig()

    const before = snapshot(runtime, store.getState().doc)
    // The fixture really contains v0.5 state — without these guards this file can
    // silently regress to proving nothing about it, which is exactly how the gap
    // being closed here survived a whole version.
    expect(before.nodes.some((n) => n.material !== null), '示例资产必须真的解析出了几何体').toBe(true)
    expect(before.nodes.some((n) => n.light !== null), '夹具里必须有真的灯').toBe(true)
    expect(before.nodes.some((n) => n.geometry?.parameters !== null && n.geometry !== null), '夹具里必须有原始体').toBe(true)
    expect(
      before.nodes.some((n) => n.material !== null && n.material.maps.map !== null),
      '夹具的贴图必须真的挂上了材质',
    ).toBe(true)
    expect(runtime.textures.has(TEX_ID), '贴图资产必须已驻留').toBe(true)

    const random = makeRandom(SEED)
    const nodeIds = initial.nodes.map((n) => n.id)
    const materialIds = [...initial.materials.map((m) => m.id), null]
    const defaultMaterialId = initial.materials.find((m) => m.name === DEFAULT_MATERIAL_NAME)!.id
    let applied = 0

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
          case 5:
            // Clamped to [0, 10]: valid for every kind (ambient/hemisphere cap at 10).
            // An out-of-range value would commit fine and fail validate() later — the
            // "saves fine, refuses to open" failure class, not this test's subject.
            if (node.light !== null) setLightParams(draft, node.id, { intensity: round(random() * 10) })
            else node.transform.p = [round(random() * 4 - 2), 0, round(random() * 4 - 2)]
            break
          case 6:
            if (node.primitive?.kind === 'box')
              node.primitive = {
                kind: 'box',
                size: [round(random() * 2 + 0.1), round(random() * 2 + 0.1), round(random() * 2 + 0.1)],
              }
            else node.visible = random() > 0.5
            break
          case 7:
            if (node.light === null) {
              if (random() > 0.75) delete node.overrides.castShadow
              else node.overrides.castShadow = random() > 0.5
            } else setLightParams(draft, node.id, { intensity: round(random() * 10) })
            break
          default: {
            const material = draft.materials.find((m) => m.id === defaultMaterialId)
            if (!material) break
            if (random() > 0.5) material.params.maps.roughnessMap = TEX_ID
            else delete material.params.maps.roughnessMap
          }
        }
      })
      if (ok) applied++
    }

    expect(applied, '应该真的产生了编辑').toBeGreaterThan(OPERATIONS / 2)
    expect(snapshot(runtime, store.getState().doc)).not.toEqual(before)

    while (store.getState().canUndo) store.getState().undo()

    expect(store.getState().historyDepth).toBe(0)
    expect(snapshot(runtime, store.getState().doc)).toEqual(before)

    // D1's whole promise: none of that went through a full rebuild.
    expect(runtime.fullRebuildCount, '正常编辑路径不应触发全量重建').toBe(0)

    runtime.dispose()
  })

  it('a light parameter edit undoes on the three light', async () => {
    const { initial, runtime, store } = await createRig()
    const spotId = initial.nodes.find((n) => n.light?.kind === 'spot')!.id

    store.getState().commit('调聚光灯', (draft) => {
      setLightParams(draft, spotId, { intensity: 8, angleDeg: 45 })
    })
    const lit = runtime.graph.objectFor(spotId) as SpotLight
    expect(lit.intensity, '正向必须真的写到 three 灯上').toBe(8)
    expect(lit.angle).toBeCloseTo((45 * Math.PI) / 180, 5)

    store.getState().undo()

    const restored = runtime.graph.objectFor(spotId) as SpotLight
    expect(restored.intensity).toBe(2)
    expect(restored.angle).toBeCloseTo((30 * Math.PI) / 180, 5)
    expect(runtime.fullRebuildCount).toBe(0)
    runtime.dispose()
  })

  it('shadow quality round-trips to the shadow map', async () => {
    const { initial, runtime, store } = await createRig()
    const spotId = initial.nodes.find((n) => n.light?.kind === 'spot')!.id

    store.getState().commit('改阴影质量', (draft) => {
      setLightShadow(draft, spotId, { quality: 'high', bias: -0.001 })
    })
    const lit = runtime.graph.objectFor(spotId) as SpotLight
    expect(lit.shadow.mapSize.width).toBe(shadowMapSizeFor('high'))
    expect(lit.shadow.bias).toBe(-0.001)

    store.getState().undo()

    const restored = runtime.graph.objectFor(spotId) as SpotLight
    expect(restored.shadow.mapSize.width).toBe(shadowMapSizeFor('medium'))
    expect(restored.shadow.bias).toBe(-0.0005)
    expect(runtime.fullRebuildCount).toBe(0)
    runtime.dispose()
  })

  it('a primitive dimension edit undoes in the geometry', async () => {
    const { initial, runtime, store } = await createRig()
    const boxId = initial.nodes.find((n) => n.primitive?.kind === 'box')!.id
    const meshBefore = runtime.graph.objectFor(boxId)

    store.getState().commit('改展台尺寸', (draft) => {
      const node = draft.nodes.find((n) => n.id === boxId)!
      node.primitive = { kind: 'box', size: [2, 0.2, 2] }
    })
    const mesh = runtime.graph.objectFor(boxId) as Mesh
    expect(mesh, '同类参数更新必须就地、不换对象').toBe(meshBefore)
    expect(readGeometry(mesh)?.parameters).toMatchObject({ width: 2, height: 0.2, depth: 2 })

    store.getState().undo()

    expect(readGeometry(runtime.graph.objectFor(boxId) as Mesh)?.parameters).toMatchObject({
      width: 1,
      height: 1,
      depth: 1,
    })
    expect(runtime.fullRebuildCount).toBe(0)
    runtime.dispose()
  })

  it('texture slot set and clear both undo on the material', async () => {
    const { initial, runtime, store } = await createRig()
    const boxId = initial.nodes.find((n) => n.primitive?.kind === 'box')!.id
    const materialId = initial.materials.find((m) => m.name === DEFAULT_MATERIAL_NAME)!.id
    const materialOf = () => (runtime.graph.objectFor(boxId) as Mesh).material as MeshStandardMaterial

    store.getState().commit('挂粗糙度贴图', (draft) => {
      setMap(draft, materialId, 'roughnessMap', TEX_ID)
    })
    expect(materialOf().roughnessMap?.name).toBe('concrete.png')
    expect(materialOf().roughnessMap?.colorSpace).toBe(TEXTURE_SLOT_COLOR_SPACE.roughnessMap)

    store.getState().undo()
    // The card's exact example shape: setting worked, undo must really CLEAR it — a
    // texture the document no longer mentions must not stay bound.
    expect(materialOf().roughnessMap, '撤销之后贴图必须真的摘下来').toBeNull()

    store.getState().commit('清基础色贴图', (draft) => {
      setMap(draft, materialId, 'map', null)
    })
    expect(materialOf().map).toBeNull()

    store.getState().undo()
    expect(materialOf().map?.name).toBe('concrete.png')
    expect(materialOf().map?.colorSpace).toBe(TEXTURE_SLOT_COLOR_SPACE.map)
    expect(runtime.fullRebuildCount).toBe(0)
    runtime.dispose()
  })

  it('a castShadow override undoes on the mesh', async () => {
    const { initial, runtime, store } = await createRig()
    const bodyId = initial.nodes[1]!.id

    // Precondition, not an assumption: the spot light's shadow is on, so meshes default
    // to casting — otherwise both sides of this test would be false for the wrong reason.
    expect((runtime.graph.objectFor(bodyId) as Mesh).castShadow, '前提：阴影管线开着').toBe(true)

    store.getState().commit('关掉泵体投影', (draft) => {
      const node = draft.nodes.find((n) => n.id === bodyId)!
      node.overrides.castShadow = false
    })
    expect((runtime.graph.objectFor(bodyId) as Mesh).castShadow).toBe(false)

    store.getState().undo()

    expect((runtime.graph.objectFor(bodyId) as Mesh).castShadow).toBe(true)
    expect(runtime.fullRebuildCount).toBe(0)
    runtime.dispose()
  })

  it('re-parenting round-trips through the scene graph', async () => {
    const { initial, runtime, store } = await createRig()

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
    const { initial, runtime, store } = await createRig()

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
