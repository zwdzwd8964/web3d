import { describe, expect, it } from 'vitest'
import { buildIndex, checkIntegrity, createEmptyDocument, createNode, createSequentialIdFactory, walkTree } from '../src/index.js'
import type { Node, SceneDocument } from '../src/index.js'

/**
 * T-184 · the complexity of the document-wide operations.
 *
 * These assert SHAPE, not milliseconds. A wall-clock threshold on a shared CI machine is a
 * test that fails when someone else's build kicks off, and the team learns to re-run it
 * until it passes — at which point it stops being a gate at all.
 *
 * So each one measures the same operation at n and 2n and asserts the RATIO. Linear work
 * doubles (~2×); quadratic work quadruples (~4×). The bound is 3, which is far enough from
 * 2 that ordinary noise cannot reach it and far enough from 4 that a genuine regression
 * cannot hide under it. Every one of these was ~4× before this card (measured, and written
 * into METRICS): `buildIndex` 6.8 ms → 100 ms going from 1000 nodes to 4000.
 *
 * The document is deliberately built with real depth. A flat list of roots would make
 * `childrenOf` one bucket and hide exactly the bug this is here to catch.
 */

const SMALL = 400
const LARGE = 800
/** Repeats per measurement — enough that one unlucky GC pause cannot decide the ratio. */
const REPEATS = 12

function makeDocument(count: number): SceneDocument {
  const ctx = { newId: createSequentialIdFactory(), now: () => '2026-01-01T00:00:00.000Z' }
  const doc = createEmptyDocument({ name: '规模', ctx })
  const nodes: Node[] = []
  const groups = Math.max(1, Math.round(count / 50))

  for (let g = 0; g < groups; g++) {
    const group = createNode({ name: `装配体 ${g + 1}`, order: g * 100, ctx })
    nodes.push(group)
    let parent = group.id
    const perGroup = Math.floor((count - groups) / groups)
    for (let i = 0; i < perGroup; i++) {
      const part = createNode({ name: `零件 ${i + 1}`, parent, order: i * 100, ctx })
      nodes.push(part)
      if (i % 10 === 9) parent = part.id
    }
  }
  return { ...doc, nodes }
}

const small = makeDocument(SMALL)
const large = makeDocument(LARGE)

/** Median rather than mean: one GC pause must not move the number it reports. */
function median(samples: number[]): number {
  const sorted = [...samples].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]!
}

function cost(doc: SceneDocument, run: (doc: SceneDocument) => void): number {
  run(doc) // warm up: the first call pays for JIT, and that cost is not in the algorithm
  const samples: number[] = []
  for (let i = 0; i < REPEATS; i++) {
    const start = performance.now()
    run(doc)
    samples.push(performance.now() - start)
  }
  return median(samples)
}

/** How much slower the operation got when the document doubled. */
function growth(run: (doc: SceneDocument) => void): number {
  // Interleaved, so a machine that gets busy halfway through skews both measurements
  // rather than only the second one — which would otherwise read as a regression.
  const a = cost(small, run)
  const b = cost(large, run)
  const a2 = cost(small, run)
  return b / Math.max(median([a, a2]), 0.001)
}

describe('doubling the document must not quadruple the work (T-184)', () => {
  it('buildIndex is linear', () => {
    // Was O(n²): `childrenOf` called `getChildren` — a full array scan — once per node.
    // This runs on every structural edit, so a 1000-node import spent 6.8 ms rebuilding the
    // index each time and a 4000-node one spent 100 ms, which is six frames of frozen UI.
    expect(growth((doc) => void buildIndex(doc))).toBeLessThan(3)
  })

  it('checkIntegrity is linear', () => {
    // Was O(n²) through `getUnreachableNodes` → `walkTree`. The status bar runs it after
    // every commit, so the whole editor got slower with the square of the model size.
    expect(growth((doc) => void checkIntegrity(doc))).toBeLessThan(3)
  })

  it('walkTree is linear', () => {
    expect(growth((doc) => walkTree(doc, () => undefined))).toBeLessThan(3)
  })
})

describe('the index still says the same thing (T-184)', () => {
  /**
   * Speed is worthless if the answer changed. `buildIndex` no longer calls `getChildren`,
   * so nothing structural forces the two to agree any more — this is what keeps them honest.
   */
  it('sorts siblings by order, not by their position in the array', () => {
    // The generated document above happens to list children in ascending `order`, so a
    // missing sort is invisible in it — dropping the sort left every test green. Siblings
    // only arrive out of order after a drag in the tree, which is exactly when getting it
    // wrong makes the panel disagree with the document the user just edited.
    const ctx = { newId: createSequentialIdFactory(), now: () => '2026-01-01T00:00:00.000Z' }
    const doc = createEmptyDocument({ name: '乱序', ctx })
    const parent = createNode({ name: '父', order: 0, ctx })
    const late = createNode({ name: '后面的', parent: parent.id, order: 300, ctx })
    const early = createNode({ name: '前面的', parent: parent.id, order: 100, ctx })
    const middle = createNode({ name: '中间的', parent: parent.id, order: 200, ctx })

    const index = buildIndex({ ...doc, nodes: [parent, late, early, middle] })
    expect(index.childrenOf.get(parent.id)?.map((n) => n.name)).toEqual(['前面的', '中间的', '后面的'])
  })

  it('childrenOf matches a straight filter, in the same order, for every parent', () => {
    const index = buildIndex(large)
    for (const parent of [null, ...large.nodes.map((n) => n.id)]) {
      const expected = large.nodes
        .filter((n) => n.parent === parent)
        .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
      expect(index.childrenOf.get(parent)?.map((n) => n.id) ?? [], `parent=${parent}`).toEqual(
        expected.map((n) => n.id),
      )
    }
  })

  it('gives every node a bucket, so an empty one means "no children" and not "no such node"', () => {
    const index = buildIndex(large)
    for (const node of large.nodes) expect(index.childrenOf.has(node.id), node.id).toBe(true)
    expect(index.childrenOf.has('nd_00000000'), '不存在的节点就该是不存在').toBe(false)
  })

  it('keeps a node whose parent does not exist reachable, under the roots', () => {
    // A dangling `parent` is a broken document and `checkIntegrity` reports it — but until
    // someone fixes it the object still has to appear in the tree. Dropping it here would
    // make a corrupt file quietly lose objects, which is the worst way to fail.
    // A FRESH sequential id factory restarts from the same first id, so building the orphan
    // with one gave it the id of an existing root — and the assertion below passed by
    // finding that root instead. It took the mutation to notice; the test read fine.
    const orphan = {
      ...createNode({
        name: '孤儿',
        parent: 'nd_ffffffff',
        order: 0,
        ctx: { newId: createSequentialIdFactory(), now: () => '2026-01-01T00:00:00.000Z' },
      }),
      id: 'nd_orphan01',
    }
    const doc = { ...small, nodes: [...small.nodes, orphan] }
    expect(small.nodes.some((n) => n.id === orphan.id), '前提：这个 id 是新的').toBe(false)
    const roots = buildIndex(doc).childrenOf.get(null) ?? []
    expect(roots.some((n) => n.id === orphan.id), '父级不存在的节点必须还在树里找得到').toBe(true)
  })
})
