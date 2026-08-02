import { createGoldenPathDocument } from '@w3/schema'
import type { SceneDocument } from '@w3/schema'
import { describe, expect, it, vi } from 'vitest'
import type { SceneRuntime } from '@w3/core'
import { createPatchForwarder, patchesSettled } from '../src/viewport/runtime-bridge.js'

/**
 * T-185 · the store-to-runtime patch path.
 *
 * This function decides, for every commit the editor makes, whether the runtime can be
 * updated NOW or has to wait for bytes — and it had no tests at all. Breaking the `'assets'`
 * check left both the unit suites and the E2E green (T-176 审查所得): the E2E imports through
 * a path where the assets happen to already be resident, so the slow path never mattered to
 * it, and nothing else went near this file.
 *
 * The two ways it fails are opposite and both bad:
 *   - too eager → an import applies before its bytes parse, and the model silently does not
 *     appear while the document insists it is there;
 *   - too lazy → a gizmo drag is pushed onto a microtask queue behind whatever is loading,
 *     and dragging goes jerky for the rest of the session.
 */

const doc = () => createGoldenPathDocument()

interface FakeRuntime {
  readonly applied: string[][][]
  readonly ensured: number[]
  readonly framed: () => number
  readonly runtime: SceneRuntime
  /** Resolves the OLDEST outstanding `ensureAssets`, so tests decide when bytes "arrive". */
  release(): void
}

/** Lets every already-queued microtask run. Nothing here waits on real time. */
const flush = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve()
}

function fakeRuntime(): FakeRuntime {
  const applied: string[][][] = []
  const ensured: number[] = []
  let frames = 0
  // A LIST, not a single slot. Two imports in flight means two outstanding waits, and a
  // single slot silently dropped the first one — which looked exactly like the deadlock
  // the serialisation test is there to rule out.
  const waiting: (() => void)[] = []

  const runtime = {
    applyPatch: (patches: { path: string[] }[]) => {
      applied.push(patches.map((p) => p.path))
    },
    ensureAssets: async () => {
      ensured.push(ensured.length)
      await new Promise<void>((resolve) => waiting.push(resolve))
    },
    camera: { frameAll: () => void frames++ },
  } as unknown as SceneRuntime

  return {
    applied,
    ensured,
    framed: () => frames,
    runtime,
    release: () => waiting.shift()?.(),
  }
}

const patch = (path: (string | number)[]) => ({ op: 'replace' as const, path, value: 1 })
const transformPatch = () => [patch(['nodes', 0, 'transform', 'p'])]

describe('the fast path', () => {
  it('applies an ordinary edit synchronously — no await anywhere', () => {
    // Dragging a gizmo emits a patch per frame. If this ever became a promise, every drag
    // would land a frame late and the object would trail the cursor.
    const fake = fakeRuntime()
    const forward = createPatchForwarder(() => fake.runtime)

    forward(transformPatch(), doc(), doc())

    expect(fake.applied, '普通编辑必须当场应用，不进队列').toHaveLength(1)
    expect(fake.ensured, '不碰资产就不该等字节').toHaveLength(0)
  })

  it('keeps a material SLIDER on the fast path', () => {
    // The asset check is narrow on purpose: `/materials/3/params/maps/map`, not
    // `/materials/**`. A roughness slider emits sixty material patches a second, and
    // queueing those would make dragging it feel broken.
    const fake = fakeRuntime()
    const forward = createPatchForwarder(() => fake.runtime)

    forward([patch(['materials', 3, 'params', 'roughness'])], doc(), doc())
    expect(fake.applied, '拖粗糙度滑杆不该进队列').toHaveLength(1)
    expect(fake.ensured).toHaveLength(0)
  })

  it('does nothing at all when there is no runtime yet', () => {
    // The store outlives the viewport: a commit can land before the canvas mounts, and
    // during teardown after it goes. Neither may throw.
    const forward = createPatchForwarder(() => null)
    expect(() => forward(transformPatch(), doc(), doc())).not.toThrow()
  })
})

describe('the slow path', () => {
  it('waits for the bytes before applying an /assets patch', async () => {
    // Applying first is the failure this exists to prevent: the nodes reference an asset
    // the loader has never seen, so nothing renders while the tree, the panels and the
    // document all say the import worked.
    const fake = fakeRuntime()
    const forward = createPatchForwarder(() => fake.runtime)

    forward([patch(['assets', 0])], doc(), doc())
    await flush()

    expect(fake.ensured, '应当先去要字节').toHaveLength(1)
    expect(fake.applied, '字节还没到，不许应用').toHaveLength(0)

    fake.release()
    await patchesSettled()
    expect(fake.applied, '字节到了才应用').toHaveLength(1)
  })

  it('also waits when a material starts REFERENCING a texture', async () => {
    // Not obvious, and it cost M11 a real bug: the cache loads what materials reference,
    // but the reference is usually set in a LATER commit than the import — so a texture
    // picked from the panel was never loaded and the slot rendered empty.
    const fake = fakeRuntime()
    const forward = createPatchForwarder(() => fake.runtime)

    forward([patch(['materials', 0, 'params', 'maps', 'map'])], doc(), doc())
    await flush()

    expect(fake.ensured, '刚被引用的贴图也要先加载').toHaveLength(1)
    expect(fake.applied).toHaveLength(0)

    fake.release()
    await patchesSettled()
    expect(fake.applied).toHaveLength(1)
  })

  it('applies two imports in the order the user made them', async () => {
    // Serialised deliberately. Without the queue they would apply in the order their bytes
    // finished parsing, so the second import's nodes would land against the first import's
    // document — and a small file imported after a large one would jump ahead of it.
    const fake = fakeRuntime()
    const forward = createPatchForwarder(() => fake.runtime)

    forward([patch(['assets', 0])], doc(), doc())
    forward([patch(['assets', 1])], doc(), doc())
    await flush()

    expect(fake.ensured, '队列是串行的：第二个导入还没开始要字节').toHaveLength(1)

    fake.release()
    await flush()
    expect(fake.ensured, '第一个走完了，第二个才开始').toHaveLength(2)

    fake.release()
    await patchesSettled()

    expect(fake.applied.map((p) => p[0]![1]), '先提交的先落地').toEqual([0, 1])
  })

  it('holds an ORDINARY edit behind a pending import, so it lands on the right document', async () => {
    // The subtle one. An ordinary edit is on the fast path, but only while nothing is
    // queued — jumping the queue would apply a node move to a graph the import's nodes have
    // not reached, and the move would be silently lost.
    const fake = fakeRuntime()
    const forward = createPatchForwarder(() => fake.runtime)

    forward([patch(['assets', 0])], doc(), doc())
    forward(transformPatch(), doc(), doc())
    await flush()

    expect(fake.applied, '导入还在队列里，后面的编辑不许插队').toHaveLength(0)

    fake.release()
    await patchesSettled()
    expect(fake.applied.map((p) => p[0]![0])).toEqual(['assets', 'nodes'])
  })

  it('returns to the fast path once the queue drains', async () => {
    // One import must not make every later edit asynchronous for the rest of the session.
    const fake = fakeRuntime()
    const forward = createPatchForwarder(() => fake.runtime)

    forward([patch(['assets', 0])], doc(), doc())
    await flush()
    fake.release()
    await patchesSettled()

    const before = fake.applied.length
    forward(transformPatch(), doc(), doc())
    expect(fake.applied.length, '队列排空之后普通编辑要立刻应用').toBe(before + 1)
  })
})

describe('framing what just arrived', () => {
  const withExtraNode = (base: SceneDocument): SceneDocument => ({
    ...base,
    nodes: [...base.nodes, { ...base.nodes[0]!, id: 'nd_import01' }],
  })

  it('frames the camera when an import brought nodes with it', async () => {
    // Without it the model lands wherever the exporter put its origin — often outside the
    // current view — and the user gets the same 「哪儿都说成功了但我什么都没看见」 as the
    // empty-resolver bug.
    const fake = fakeRuntime()
    const forward = createPatchForwarder(() => fake.runtime)
    const before = doc()

    forward([patch(['assets', 0])], withExtraNode(before), before)
    await flush()
    fake.release()
    await patchesSettled()

    expect(fake.framed(), '导入带进来了对象，就该把镜头拉到看得见它').toBe(1)
  })

  it('does NOT move the camera for an asset change that added no node', async () => {
    // Re-uploading a model replaces bytes and keeps every node. Moving the camera then
    // throws away the view the user had carefully set up, for no reason they can see.
    const fake = fakeRuntime()
    const forward = createPatchForwarder(() => fake.runtime)

    forward([patch(['assets', 0])], doc(), doc())
    await flush()
    fake.release()
    await patchesSettled()

    expect(fake.framed(), '节点没变多就别动镜头').toBe(0)
  })
})

describe('patchesSettled', () => {
  it('is already resolved when nothing is queued', async () => {
    const fake = fakeRuntime()
    const forward = createPatchForwarder(() => fake.runtime)
    forward(transformPatch(), doc(), doc())

    const spy = vi.fn()
    void patchesSettled().then(spy)
    await Promise.resolve()
    await Promise.resolve()
    expect(spy, '快路径不该让调用者多等一轮').toHaveBeenCalled()
  })

  it('is what a library drop waits on before measuring (T-146)', async () => {
    // A drop has to measure what it imported before it can rest it on a surface. Measuring
    // straight after the commit measures a scene graph the nodes have not reached, which
    // reads as 「模型不落在我放的地方」.
    const fake = fakeRuntime()
    const forward = createPatchForwarder(() => fake.runtime)

    forward([patch(['assets', 0])], doc(), doc())
    let done = false
    const waiting = patchesSettled().then(() => {
      done = true
    })

    await flush()
    expect(done, '字节还没到，等待不该结束').toBe(false)

    fake.release()
    await waiting
    expect(fake.applied, '等到了就意味着 patch 真的进了 runtime').toHaveLength(1)
  })
})
