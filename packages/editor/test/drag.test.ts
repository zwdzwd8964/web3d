import { createGoldenPathDocument } from '@w3/schema'
import type { SceneDocument, Vec3 } from '@w3/schema'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PRIMITIVE_TEMPLATES } from '../src/lib/library.js'
import type { ImportResult } from '../src/lib/import-flow.js'
import { LIBRARY_MIME, PRIMITIVE_MIME, acceptsDrag, beginDrag, endDrag, getDrag } from '../src/viewport/drag.js'
import { DropController } from '../src/viewport/drop-controller.js'
import { createDocumentStore } from '../src/store/document-store.js'
import { resetSnap, setSnap } from '../src/viewport/snap.js'

/**
 * T-146 · the drag lifecycle M10's review found untested.
 *
 * Both features it flagged — the library drop and the ghost preview — lived entirely inside
 * JSX event handlers, where the editor's Node test environment cannot reach them. The rule
 * this card adds: the gesture layer gets its own seam, and the seam gets tests.
 */

const BOX = PRIMITIVE_TEMPLATES.find((t) => t.kind === 'box')!

afterEach(() => {
  endDrag()
  resetSnap()
})

/** A controller wired to a real document store, so preview/commit semantics are the real ones. */
function wire(doc: SceneDocument = createGoldenPathDocument()) {
  const store = createDocumentStore(doc)
  const state = () => store.getState()
  const importItem = vi.fn<(item: { id: string }) => Promise<ImportResult>>()
  const errors: string[] = []

  const controller = new DropController({
    previewStart: () => state().previewStart(),
    preview: (recipe) => void state().preview(recipe),
    previewCommit: (label) => void state().previewCommit(label),
    previewAbort: () => state().previewAbort(),
    select: (ids) => state().select(ids),
    boundsOf: () => null,
    importItem: importItem as never,
    onError: (message) => void errors.push(message),
  })
  return { store, state, controller, importItem, errors }
}

/** A `place` that always resolves to the same spot, so assertions are about the lifecycle. */
const at =
  (position: Vec3) =>
  (): Vec3 =>
    position

describe('the drag session', () => {
  it('carries the payload the browser refuses to hand over during dragover', () => {
    // `dataTransfer.getData()` returns '' in protected mode; only `types` is readable. A
    // ghost has to know WHAT is being dragged on every frame, so the payload rides here.
    expect(getDrag()).toBeNull()
    beginDrag({ kind: 'primitive', template: BOX })
    expect(getDrag()).toEqual({ kind: 'primitive', template: BOX })
    endDrag()
    expect(getDrag(), '留下上一次的载荷会让下一次拖拽说谎').toBeNull()
  })

  it('claims both kinds of drag and nothing else', () => {
    expect(acceptsDrag([PRIMITIVE_MIME])).toBe(true)
    expect(acceptsDrag([LIBRARY_MIME])).toBe(true)
    // A file dragged onto the viewport must fall through to the browser rather than being
    // swallowed by a handler that has nothing to do with it.
    expect(acceptsDrag(['Files'])).toBe(false)
    expect(acceptsDrag(['text/plain'])).toBe(false)
  })
})

describe('the ghost preview', () => {
  it('appears on the first dragover and MOVES rather than respawning', () => {
    const { state, controller } = wire()
    const before = state().doc.nodes.length

    controller.over({ kind: 'primitive', template: BOX }, at([1, 0, 1]))
    const afterFirst = state().doc.nodes
    expect(afterFirst).toHaveLength(before + 1)
    const ghostId = afterFirst[afterFirst.length - 1]!.id

    controller.over({ kind: 'primitive', template: BOX }, at([2, 0, 2]))
    const afterSecond = state().doc.nodes
    // Recreating it per frame would churn a node id (and a scene-graph object) 60 times a
    // second, and the material record along with it.
    expect(afterSecond).toHaveLength(before + 1)
    expect(afterSecond[afterSecond.length - 1]!.id).toBe(ghostId)
    expect(afterSecond[afterSecond.length - 1]!.transform.p).toEqual([2, 0, 2])
  })

  it('never CREATES the shared material record — a cancelled drag would have to un-create it', () => {
    // A material remove is one of the few patches the runtime deliberately answers with a
    // full scene rebuild. Letting the ghost add the record meant every cancelled drag in a
    // fresh project rebuilt the scene: 铁律 11's alarm firing on 「改主意了」.
    const { state, controller } = wire()
    const materials = state().doc.materials.length

    controller.over({ kind: 'primitive', template: BOX }, at([1, 0, 1]))
    expect(state().doc.materials).toHaveLength(materials)

    // …and the real thing still gets one (D15: an unmateriated primitive renders with a
    // colour the material panel cannot show or edit).
    void controller.drop({ kind: 'primitive', template: BOX }, at([1, 0, 1]), () => [1, 0, 1])
    const created = state().doc.nodes[state().doc.nodes.length - 1]!
    expect(created.overrides.materialId).toBeTruthy()
    expect(state().doc.materials.some((m) => m.id === created.overrides.materialId)).toBe(true)
    expect(state().historyDepth, '造材质也在同一条撤销里').toBe(1)
  })

  it('leaves the undo stack completely alone while it is on screen', () => {
    const { state, controller } = wire()
    controller.over({ kind: 'primitive', template: BOX }, at([1, 0, 1]))
    controller.over({ kind: 'primitive', template: BOX }, at([2, 0, 2]))

    expect(state().historyDepth, '幽灵是预览态，一步都不该进历史').toBe(0)
    expect(state().canUndo).toBe(false)
    expect(state().previewing).toBe(true)
  })

  it('a drag that wanders out of the viewport leaves nothing behind', () => {
    // The failure this rules out is unrecoverable from the user's side: the ghost never
    // reached the history, so no amount of Ctrl+Z would remove a stray object.
    const { state, controller } = wire()
    const before = state().doc.nodes.length

    controller.over({ kind: 'primitive', template: BOX }, at([1, 0, 1]))
    expect(controller.hasGhost).toBe(true)
    controller.leave()

    expect(state().doc.nodes).toHaveLength(before)
    expect(controller.hasGhost).toBe(false)
    expect(state().previewing).toBe(false)
    expect(state().historyDepth).toBe(0)
  })

  it('excludes itself from the ray, or it climbs one box per frame', async () => {
    // The ghost is a real object in the scene. Without the exclusion the drop ray hits it,
    // rests the next frame's ghost on top of the last one, and the object flies upward.
    const { controller } = wire()
    const seen: ReadonlySet<string>[] = []
    const place = (_p: unknown, exclude: ReadonlySet<string>): Vec3 => {
      seen.push(exclude)
      return [0, 0, 0]
    }

    controller.over({ kind: 'primitive', template: BOX }, place)
    controller.over({ kind: 'primitive', template: BOX }, place)

    expect(seen[0]!.size, '第一帧还没有幽灵，没什么可排除').toBe(0)
    expect(seen[1]!.size).toBe(1)
  })

  it('commits exactly one undo entry on drop, and selects what it made', () => {
    const { state, controller } = wire()
    const before = state().doc.nodes.length

    controller.over({ kind: 'primitive', template: BOX }, at([1, 0, 1]))
    void controller.drop({ kind: 'primitive', template: BOX }, at([3, 0, 3]), () => [3, 0, 3])

    expect(state().doc.nodes).toHaveLength(before + 1)
    expect(state().historyDepth).toBe(1)
    expect(state().previewing).toBe(false)
    const created = state().doc.nodes[state().doc.nodes.length - 1]!
    expect(created.transform.p, '落点用的是松手那一刻的位置').toEqual([3, 0, 3])
    expect(state().selection).toEqual([created.id])

    state().undo()
    expect(state().doc.nodes, 'Ctrl+Z 要把整次放置拿掉').toHaveLength(before)
  })

  it('works for a drop with no dragover before it', () => {
    // Synthetic events (and the E2E's `dispatchEvent`) can skip straight to the drop.
    const { state, controller } = wire()
    const before = state().doc.nodes.length
    void controller.drop({ kind: 'primitive', template: BOX }, at([1, 0, 1]), () => [1, 0, 1])
    expect(state().doc.nodes).toHaveLength(before + 1)
    expect(state().historyDepth).toBe(1)
  })

  it('snaps the landing point when the grid is on', () => {
    const { state, controller } = wire()
    setSnap({ translate: 0.5 })
    void controller.drop({ kind: 'primitive', template: BOX }, at([1.2, 0, -0.9]), () => [1.2, 0, -0.9])
    const created = state().doc.nodes[state().doc.nodes.length - 1]!
    expect([created.transform.p[0], created.transform.p[2]]).toEqual([1, -1])
  })
})

describe('dropping a library model', () => {
  /** An import that produces one root node at the origin. */
  const resultWithRoot = (doc: SceneDocument): ImportResult =>
    ({
      asset: {
        id: 'ast_11112222',
        name: '展示台.glb',
        kind: 'model',
        hash: 'blob_1',
        bytes: 1024,
        createdAt: '2026-09-01T00:00:00.000Z',
        audit: null,
        thumbnail: null,
      },
      audit: { level: 'ok', findings: [] },
      nodes: [
        {
          id: 'nd_lib00001',
          name: '展示台',
          parent: null,
          order: 4000,
          assetRef: { assetId: 'ast_11112222', objectPath: 'Root', objectName: 'Root', missing: false },
          primitive: null,
          light: null,
          transform: { p: [0, 0, 0], r: [0, 0, 0, 1], s: [1, 1, 1] },
          visible: true,
          locked: false,
          overrides: {},
        },
      ],
      deduplicated: false,
      hash: 'blob_1',
      doc,
    }) as never

  const ITEM = { id: 'lib_stand', name: '展示台' } as never

  it('imports, places and commits once', async () => {
    const { state, controller, importItem } = wire()
    const before = state().doc.nodes.length
    importItem.mockResolvedValue(resultWithRoot(state().doc))

    await controller.drop({ kind: 'library', item: ITEM }, at([0, 0, 0]), () => [4, 0.5, -2])

    expect(importItem).toHaveBeenCalledTimes(1)
    expect(state().doc.nodes).toHaveLength(before + 1)
    expect(state().historyDepth, '导入 + 落点 = 一条撤销').toBe(1)
    const created = state().doc.nodes[state().doc.nodes.length - 1]!
    expect(created.transform.p).toEqual([4, 0.5, -2])
    expect(state().selection).toEqual([created.id])
  })

  it('lifts the model onto the surface once it can be measured', async () => {
    // The whole reason `boundsOf` exists: a model's size is unknowable until it is built,
    // so the placement happens in two preview steps and one commit.
    const doc = createGoldenPathDocument()
    const store = createDocumentStore(doc)
    const state = () => store.getState()
    const controller = new DropController({
      previewStart: () => state().previewStart(),
      preview: (recipe) => void state().preview(recipe),
      previewCommit: (label) => void state().previewCommit(label),
      previewAbort: () => state().previewAbort(),
      select: (ids) => state().select(ids),
      // Measured after the first preview put the root at the hit point: a box whose bottom
      // is 1 m BELOW the hit, i.e. the model needs lifting by 1.
      boundsOf: () => ({ min: [4, -1, -2], max: [6, 1, 0] }),
      importItem: () => Promise.resolve(resultWithRoot(doc)),
    })

    await controller.drop({ kind: 'library', item: ITEM }, at([0, 0, 0]), () => [5, 0, -1])

    const created = state().doc.nodes[state().doc.nodes.length - 1]!
    expect(created.transform.p).toEqual([5, 1, -1])
    expect(state().historyDepth).toBe(1)
  })

  it('waits for the asset patches to reach the renderer BEFORE measuring', async () => {
    // Asset patches are applied asynchronously — the bytes have to be parsed first. Measuring
    // straight after the preview measures a scene graph the imported nodes have not arrived
    // in: `boundsOf` returns null, the model never gets lifted onto the surface, and it reads
    // as 「模型不理会我放在哪」. The unit test that stubs `boundsOf` cannot see this at all,
    // which is precisely how M10's two false-greens survived.
    const order: string[] = []
    const doc = createGoldenPathDocument()
    const store = createDocumentStore(doc)
    const state = () => store.getState()
    const controller = new DropController({
      previewStart: () => state().previewStart(),
      preview: (recipe) => void state().preview(recipe),
      previewCommit: (label) => void state().previewCommit(label),
      previewAbort: () => state().previewAbort(),
      select: (ids) => state().select(ids),
      settle: async () => {
        await Promise.resolve()
        order.push('settle')
      },
      boundsOf: () => {
        order.push('measure')
        return { min: [0, 0, 0], max: [1, 1, 1] }
      },
      importItem: () => Promise.resolve(resultWithRoot(doc)),
    })

    await controller.drop({ kind: 'library', item: ITEM }, at([0, 0, 0]), () => [1, 0, 1])
    expect(order).toEqual(['settle', 'measure'])
  })

  it('a failed import does not leave the editor stuck in preview', async () => {
    // The failure this rules out is total: with a preview left open every later commit is
    // refused as "mid-preview", and the whole editor stops responding to edits.
    const { state, controller, importItem, errors } = wire()
    importItem.mockRejectedValue(new Error('HTTP 404'))

    await controller.drop({ kind: 'library', item: ITEM }, at([0, 0, 0]), () => [1, 0, 1])

    expect(state().previewing).toBe(false)
    expect(errors[0]).toContain('HTTP 404')
    expect(state().commit('还能改吗', (draft) => void (draft.name = '改了'))).toBe(true)
  })

  it('drops the ghost before importing, so the two placements cannot fight', async () => {
    const { state, controller, importItem } = wire()
    const before = state().doc.nodes.length
    importItem.mockResolvedValue(resultWithRoot(state().doc))

    controller.over({ kind: 'primitive', template: BOX }, at([1, 0, 1]))
    await controller.drop({ kind: 'library', item: ITEM }, at([0, 0, 0]), () => [2, 0, 2])

    expect(controller.hasGhost).toBe(false)
    expect(state().doc.nodes, '幽灵回滚掉，只留下真的导入结果').toHaveLength(before + 1)
    expect(state().historyDepth).toBe(1)
  })
})
