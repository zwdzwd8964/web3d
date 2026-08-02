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
 * So each one measures the same operation at n and 4n and asserts the RATIO. Linear work
 * grows ~4×; quadratic work grows ~16×. The bound is 8 — the geometric midpoint, over 60%
 * away from both honest outcomes. (The first version used 2n and a bound of 3; a loaded CI
 * runner reached 3.097 on an operation that takes tens of microseconds, and a gate that
 * red-flags someone else's build is exactly what the paragraph above forbids.)
 *
 * Two more defenses against a busy machine, both in `growth()`:
 * - the small and large runs are interleaved SAMPLE BY SAMPLE, so sustained load inflates
 *   both sides by the same factor and cancels out of the ratio;
 * - each side reports its MINIMUM, not its median. Noise on a timing sample is strictly
 *   additive, so the minimum is the best available estimate of the noise-free cost, and
 *   one quiet sample per side is enough to recover it.
 *
 * The document is deliberately built with real depth. A flat list of roots would make
 * `childrenOf` one bucket and hide exactly the bug this is here to catch.
 */

const SMALL = 400
const LARGE = 1600
/** Repeats per measurement — enough that one quiet sample per side is very likely. */
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

function timed(doc: SceneDocument, run: (doc: SceneDocument) => void): number {
  const start = performance.now()
  run(doc)
  return performance.now() - start
}

/** How much slower the operation got when the document quadrupled. */
function growth(run: (doc: SceneDocument) => void): number {
  // Warm up both sizes: the first calls pay for JIT, and that cost is not in the algorithm.
  run(small)
  run(large)
  const smallSamples: number[] = []
  const largeSamples: number[] = []
  // Interleaved per sample: sustained machine load then inflates both sides by the same
  // factor and divides out, instead of landing on whichever side ran while it lasted.
  for (let i = 0; i < REPEATS; i++) {
    smallSamples.push(timed(small, run))
    largeSamples.push(timed(large, run))
  }
  // Minimum, not median: timing noise is strictly additive, so the fastest sample is the
  // closest to the noise-free cost — one quiet sample per side recovers the true ratio.
  return Math.min(...largeSamples) / Math.max(Math.min(...smallSamples), 0.001)
}

describe('quadrupling the document must not square the work (T-184)', () => {
  it('buildIndex is linear', () => {
    // Was O(n²): `childrenOf` called `getChildren` — a full array scan — once per node.
    // This runs on every structural edit, so a 1000-node import spent 6.8 ms rebuilding the
    // index each time and a 4000-node one spent 100 ms, which is six frames of frozen UI.
    expect(growth((doc) => void buildIndex(doc))).toBeLessThan(8)
  })

  it('checkIntegrity is linear', () => {
    // Was O(n²) through `getUnreachableNodes` → `walkTree`. The status bar runs it after
    // every commit, so the whole editor got slower with the square of the model size.
    expect(growth((doc) => void checkIntegrity(doc))).toBeLessThan(8)
  })

  it('walkTree is linear', () => {
    expect(growth((doc) => walkTree(doc, () => undefined))).toBeLessThan(8)
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
