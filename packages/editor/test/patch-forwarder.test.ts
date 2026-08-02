import { createGoldenPathDocument } from '@w3/schema'
import type { SceneDocument } from '@w3/schema'
import type { DocumentPatch, SceneRuntime } from '@w3/core'
import { describe, expect, it } from 'vitest'
import { createPatchForwarder, patchesSettled } from '../src/viewport/runtime-bridge.js'

/**
 * T-185 ① · createPatchForwarder had zero unit tests: flipping the `'assets'` judgment
 * left every suite green, because undo-runtime-parity wires `onPatch` straight to
 * `runtime.applyPatch` and drag.test.ts stubs `settle`. These tests pin each routing
 * branch of the production forwarder (the one main.tsx actually installs).
 */

type ForwardedPatches = Parameters<SceneRuntime['applyPatch']>[0]

interface RecordedCall {
  readonly kind: 'ensureAssets' | 'applyPatch' | 'frameAll'
  readonly patches?: ForwardedPatches
}

function makeFakeRuntime(options: { gate?: Promise<void> } = {}) {
  const calls: RecordedCall[] = []
  const fake = {
    ensureAssets: async (_doc: SceneDocument): Promise<string[]> => {
      calls.push({ kind: 'ensureAssets' })
      if (options.gate) await options.gate
      return []
    },
    applyPatch: (patches: ForwardedPatches, _next: SceneDocument, _prev: SceneDocument): void => {
      calls.push({ kind: 'applyPatch', patches })
    },
    camera: {
      frameAll: (): void => {
        calls.push({ kind: 'frameAll' })
      },
    },
  }
  return { calls, runtime: fake as unknown as SceneRuntime }
}

const kinds = (calls: readonly RecordedCall[]) => calls.map((c) => c.kind)

const doc = createGoldenPathDocument()
/** `next` with one node more than `prev` — the shape of a model import. */
const withExtraNode = (d: SceneDocument): SceneDocument => ({
  ...d,
  nodes: [...d.nodes, { ...d.nodes[0]!, id: 'nd_fwdtest1' }],
})

const nodePatches: DocumentPatch[] = [{ op: 'replace', path: ['nodes', 0, 'transform', 'p'], value: [0, 1, 0] }]
const assetPatches: DocumentPatch[] = [{ op: 'add', path: ['assets', 0], value: doc.assets[0] }]
const mapPatches: DocumentPatch[] = [
  { op: 'replace', path: ['materials', 0, 'params', 'maps', 'map'], value: { assetId: 'ast_fwdtest1' } },
]
const sliderPatches: DocumentPatch[] = [{ op: 'replace', path: ['materials', 0, 'params', 'roughness'], value: 0.5 }]

describe('createPatchForwarder · fast path', () => {
  it('a node edit reaches applyPatch synchronously, without ensureAssets', () => {
    const { calls, runtime } = makeFakeRuntime()
    const forward = createPatchForwarder(() => runtime)

    forward(nodePatches, doc, doc)

    // SYNCHRONOUS is the contract: a gizmo drag must not queue behind a microtask.
    expect(kinds(calls)).toEqual(['applyPatch'])
    expect(calls[0]!.patches).toBe(nodePatches)
  })

  it('a material slider drag stays on the fast path — `maps` is the narrow trigger, not `materials`', () => {
    const { calls, runtime } = makeFakeRuntime()
    const forward = createPatchForwarder(() => runtime)

    forward(sliderPatches, doc, doc)

    expect(kinds(calls)).toEqual(['applyPatch'])
  })

  it('does nothing (and does not throw) when no runtime is live', () => {
    const { calls } = makeFakeRuntime()
    const forward = createPatchForwarder(() => null)

    expect(() => forward(nodePatches, doc, doc)).not.toThrow()
    expect(calls).toEqual([])
  })
})

describe("createPatchForwarder · the 'assets' judgment", () => {
  it('a batch touching /assets waits for ensureAssets BEFORE applyPatch', async () => {
    const { calls, runtime } = makeFakeRuntime()
    const forward = createPatchForwarder(() => runtime)

    forward(assetPatches, doc, doc)

    // Not synchronous: the bytes are not in hand yet.
    expect(calls, '资产补丁不能走同步快路径').toEqual([])

    await patchesSettled()

    expect(kinds(calls)).toEqual(['ensureAssets', 'applyPatch'])
    expect(calls[1]!.patches).toBe(assetPatches)
  })

  it('a material starting to reference a texture (…/maps/…) also waits for bytes (M11)', async () => {
    const { calls, runtime } = makeFakeRuntime()
    const forward = createPatchForwarder(() => runtime)

    forward(mapPatches, doc, doc)

    expect(calls).toEqual([])
    await patchesSettled()
    expect(kinds(calls)).toEqual(['ensureAssets', 'applyPatch'])
  })

  it('frames the camera only when the asset batch actually added nodes', async () => {
    const grew = makeFakeRuntime()
    const forwardGrew = createPatchForwarder(() => grew.runtime)
    forwardGrew(assetPatches, withExtraNode(doc), doc)
    await patchesSettled()
    expect(kinds(grew.calls), '导入了新节点：镜头要取景').toEqual(['ensureAssets', 'applyPatch', 'frameAll'])

    const flat = makeFakeRuntime()
    const forwardFlat = createPatchForwarder(() => flat.runtime)
    forwardFlat(assetPatches, doc, doc) // a texture import: assets grew, nodes did not
    await patchesSettled()
    expect(kinds(flat.calls), '纹理导入不许动镜头').toEqual(['ensureAssets', 'applyPatch'])
  })
})

describe('createPatchForwarder · queue discipline', () => {
  it('an edit made while an import is loading queues BEHIND it, never overtakes', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const { calls, runtime } = makeFakeRuntime({ gate })
    const forward = createPatchForwarder(() => runtime)

    forward(assetPatches, doc, doc) // slow path, blocked on the gate
    forward(nodePatches, doc, doc) // queued > 0 → must NOT take the fast path

    await Promise.resolve()
    expect(kinds(calls), '导入的字节还没到位，谁都不许先落地').toEqual(['ensureAssets'])

    release()
    await patchesSettled()

    expect(kinds(calls)).toEqual(['ensureAssets', 'applyPatch', 'applyPatch'])
    expect(calls[1]!.patches).toBe(assetPatches)
    expect(calls[2]!.patches).toBe(nodePatches)
  })

  it('returns to the synchronous fast path once the queue drains', async () => {
    const { calls, runtime } = makeFakeRuntime()
    const forward = createPatchForwarder(() => runtime)

    forward(assetPatches, doc, doc)
    await patchesSettled()
    calls.length = 0

    forward(nodePatches, doc, doc)
    // Synchronous again: one import must not make the rest of the session async.
    expect(kinds(calls)).toEqual(['applyPatch'])
  })

  it('a runtime that vanished while the batch was queued is skipped without throwing', async () => {
    const { calls, runtime } = makeFakeRuntime()
    let live: SceneRuntime | null = runtime
    const forward = createPatchForwarder(() => live)

    forward(assetPatches, doc, doc)
    live = null // viewport unmounted before the queue drained

    await patchesSettled()
    expect(calls).toEqual([])
  })

  it('patchesSettled resolves only after the queued batch reached the runtime', async () => {
    const { calls, runtime } = makeFakeRuntime()
    const forward = createPatchForwarder(() => runtime)

    forward(assetPatches, doc, doc)
    await patchesSettled()

    // T-146: measuring a drop before this resolves measures a scene the nodes have not
    // reached yet. The applyPatch MUST already have happened here.
    expect(kinds(calls)).toContain('applyPatch')
  })
})
