import type { SceneDocument } from '@w3/schema'
import { createGoldenPathDocument } from '@w3/schema'
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

const round3 = (v: [number, number, number]) => v.map((n) => Math.round(n * 1e5) / 1e5) as [number, number, number]
const round4 = (v: [number, number, number, number]) =>
  v.map((n) => Math.round(n * 1e5) / 1e5) as [number, number, number, number]

let sampleGlb: ArrayBuffer

beforeAll(async () => {
  sampleGlb = await buildSamplePumpGlb()
})

describe('undo restores the rendered scene', () => {
  it(`${OPERATIONS} random edits, then ${OPERATIONS} undos, leaves the scene graph identical`, async () => {
    const initial = createGoldenPathDocument()
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
    let applied = 0

    for (let i = 0; i < OPERATIONS; i++) {
      const nodeId = nodeIds[Math.floor(random() * nodeIds.length)]!
      const pick = Math.floor(random() * 5)

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
          default: {
            const materialId = materialIds[Math.floor(random() * materialIds.length)]
            if (materialId === null || materialId === undefined) delete node.overrides.materialId
            else node.overrides.materialId = materialId
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
