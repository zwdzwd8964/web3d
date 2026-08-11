import { createGoldenPathDocument, createSequentialIdFactory } from '@w3/schema'
import type { Node, SceneDocument } from '@w3/schema'
import { afterEach, describe, expect, it } from 'vitest'
import { canDragRows, clampScrollTop, filterNodes, flattenTree, rangeBetween } from '../src/panels/tree-dnd.js'
import { getUi, resetUi, setUi } from '../src/store/ui-store.js'

/**
 * T-224 · 层级树搜索过滤。
 *
 * The editor's tests run in plain Node with no jsdom, so anything that lives inside JSX is
 * unobservable here. That is why the scroll clamp and the drag lock are pure functions rather
 * than inline handler logic: a rule that only exists inside an event handler can be described
 * in a test and never actually exercised — `shortcuts.ts` says exactly this about
 * `handleShortcut`, and it is the reason this file can assert them at all.
 */

afterEach(() => resetUi())

/** A tree deep enough that ancestor collection is a real question. */
function deepDocument(): SceneDocument {
  const base = createGoldenPathDocument()
  const newId = createSequentialIdFactory()
  const nodes: Node[] = []
  const push = (name: string, parent: string | null): string => {
    const id = newId('node', new Set([...base.nodes.map((n) => n.id), ...nodes.map((n) => n.id)]))
    nodes.push({ ...base.nodes[0]!, id, name, parent, order: nodes.length * 100 })
    return id
  }
  const root = push('装配根', null)
  const casing = push('泵壳', root)
  push('叶轮', casing)
  push('密封环', casing)
  const cover = push('阀盖', root)
  push('阀盖螺栓', cover)
  return { ...base, nodes: [...base.nodes, ...nodes] }
}

const idsOf = (doc: SceneDocument, name: string) => doc.nodes.filter((n) => n.name === name).map((n) => n.id)

describe('filterNodes · 零开销路径', () => {
  it('returns exactly null for an empty query', () => {
    // `toBe`, not `toBeFalsy`: an empty Set is falsy for nobody and would silently put a
    // membership test in the hot path of every unfiltered render.
    expect(filterNodes(deepDocument(), '')).toBe(null)
  })

  it('returns exactly null for a whitespace-only query', () => {
    expect(filterNodes(deepDocument(), '   ')).toBe(null)
  })

  it('returns a filter as soon as there is a real query', () => {
    const filter = filterNodes(deepDocument(), '叶轮')
    expect(filter).not.toBe(null)
    expect(filter?.matched.size).toBe(1)
  })
})

describe('filterNodes · 祖先与匹配', () => {
  it('keeps every ancestor of a match so the path stays reachable', () => {
    const doc = deepDocument()
    const filter = filterNodes(doc, '叶轮')!
    const [impeller] = idsOf(doc, '叶轮')
    const [casing] = idsOf(doc, '泵壳')
    const [root] = idsOf(doc, '装配根')

    expect(filter.visible.has(impeller!)).toBe(true)
    expect(filter.visible.has(casing!)).toBe(true)
    expect(filter.visible.has(root!)).toBe(true)
    // …and only the match is a match. Without this the highlight would paint the whole path.
    expect([...filter.matched]).toEqual([impeller])
  })

  it('does not keep a sibling that did not match', () => {
    const doc = deepDocument()
    const filter = filterNodes(doc, '叶轮')!
    const [seal] = idsOf(doc, '密封环')
    expect(filter.visible.has(seal!)).toBe(false)
  })

  it('matches an id exactly rather than by substring', () => {
    const doc = deepDocument()
    const [cover] = idsOf(doc, '阀盖')
    const filter = filterNodes(doc, cover!)!
    expect([...filter.matched]).toEqual([cover])
    // A prefix of a real id must not match it — ids are looked up, not browsed.
    expect(filterNodes(doc, cover!.slice(0, 6))!.matched.size).toBe(0)
  })

  it('is case-insensitive on names', () => {
    const doc: SceneDocument = { ...deepDocument() }
    // Only the node this fixture added — the golden path already has one called 阀盖, and
    // renaming both would make the count assertion measure the fixture, not the matching.
    const [cover] = idsOf(doc, '阀盖').slice(-1)
    doc.nodes = doc.nodes.map((n) => (n.id === cover ? { ...n, name: 'ValveCover' } : n))
    expect([...filterNodes(doc, 'valvecover')!.matched]).toEqual([cover])
  })
})

describe('flattenTree · 过滤中的行为', () => {
  it('shows a hit inside a collapsed branch', () => {
    // The whole point of a search: the user does not know where the thing is, so a fold they
    // set ten minutes ago must not hide it from them.
    const doc = deepDocument()
    const [casing] = idsOf(doc, '泵壳')
    const collapsed = new Set([casing!])

    expect(flattenTree(doc, collapsed).map((r) => r.node.name)).not.toContain('叶轮')
    expect(flattenTree(doc, collapsed, filterNodes(doc, '叶轮')).map((r) => r.node.name)).toContain('叶轮')
  })

  it('marks only the matched rows', () => {
    const doc = deepDocument()
    const rows = flattenTree(doc, new Set(), filterNodes(doc, '叶轮'))
    expect(rows.filter((r) => r.matched).map((r) => r.node.name)).toEqual(['叶轮'])
    expect(rows.filter((r) => !r.matched).map((r) => r.node.name)).toEqual(['装配根', '泵壳'])
  })

  it('leaves `matched` absent entirely when unfiltered', () => {
    for (const row of flattenTree(deepDocument(), new Set())) expect(row.matched).toBeUndefined()
  })

  it('keeps `collapsed` untouched, so clearing the search restores the folds', () => {
    const doc = deepDocument()
    const [casing] = idsOf(doc, '泵壳')
    const collapsed = new Set([casing!])
    flattenTree(doc, collapsed, filterNodes(doc, '叶轮'))
    // The filter must not have *consumed* the fold state — clearing the search puts the tree
    // back exactly where it was, which is the difference between a filter and a navigation.
    expect([...collapsed]).toEqual([casing])
    expect(flattenTree(doc, collapsed).map((r) => r.node.name)).not.toContain('叶轮')
  })
})

describe('Shift 范围选 · 过滤中的语义', () => {
  /**
   * ⚠ `rangeBetween` already satisfies these two by construction — it slices the rows array
   * it is GIVEN. So the thing worth asserting is not the function, it is **that the caller
   * hands it the filtered rows**. Both tests below build the filtered row list the way the
   * component does and range over that; passing the unfiltered list would break them.
   */
  it('does not sweep in a node the filter removed', () => {
    const doc = deepDocument()
    const rows = flattenTree(doc, new Set(), filterNodes(doc, '阀盖'))
    const [root] = idsOf(doc, '装配根')
    const [bolt] = idsOf(doc, '阀盖螺栓')
    const [seal] = idsOf(doc, '密封环')

    const swept = rangeBetween(rows, root!, bolt!)
    expect(swept).toContain(bolt)
    expect(swept).not.toContain(seal)
  })

  it('selects only the clicked row when the anchor is filtered out', () => {
    const doc = deepDocument()
    const rows = flattenTree(doc, new Set(), filterNodes(doc, '阀盖'))
    const [seal] = idsOf(doc, '密封环')
    const [bolt] = idsOf(doc, '阀盖螺栓')
    expect(rangeBetween(rows, seal!, bolt!)).toEqual([bolt])
  })
})

describe('滚动钳位与拖拽互锁', () => {
  it('pulls the offset back when the filtered list is shorter than the scroll', () => {
    // 24 rows × 24 px = 576, viewport 300 → max offset 276. Scrolled to 900 before the search.
    expect(clampScrollTop(900, 24, 24, 300)).toBe(276)
  })

  it('leaves a legal offset alone and never goes negative', () => {
    expect(clampScrollTop(100, 24, 24, 300)).toBe(100)
    expect(clampScrollTop(-40, 24, 24, 300)).toBe(0)
    expect(clampScrollTop(50, 2, 24, 300)).toBe(0)
  })

  it('forbids dragging while filtered', () => {
    const doc = deepDocument()
    expect(canDragRows(null)).toBe(true)
    expect(canDragRows(filterNodes(doc, '阀盖'))).toBe(false)
  })
})

describe('ui-store · UI 瞬态不进文档', () => {
  it('holds every transient and notifies on change', () => {
    const seen: string[] = []
    setUi({ search: '叶轮' })
    expect(getUi().search).toBe('叶轮')
    setUi({ renaming: 'nd_00000001', pendingDelete: 'nd_00000002', helpOpen: true })
    expect(getUi()).toEqual({
      search: '叶轮',
      renaming: 'nd_00000001',
      pendingDelete: 'nd_00000002',
      helpOpen: true,
      // T-288 · 配额写满时那条错误旁边的「清理本地数据」把它置 true。
      projectListOpen: false,
    })
    void seen
  })

  it('does not emit a new object for a no-op write', () => {
    // `useSyncExternalStore` compares by reference; a fresh object per keystroke that changed
    // nothing would re-render the whole tree.
    setUi({ search: '叶轮' })
    const before = getUi()
    setUi({ search: '叶轮' })
    expect(getUi()).toBe(before)
    // T-288 · 新加的字段也要在那个逐字段比较里。漏一个，它的写入就永远不通知，
    // 而症状是「点了『清理本地数据』，什么都没发生」。
    setUi({ projectListOpen: true })
    expect(getUi().projectListOpen).toBe(true)
    expect(getUi()).not.toBe(before)
  })

  it('is reset by the test seam', () => {
    setUi({ search: 'x', helpOpen: true })
    resetUi()
    expect(getUi()).toEqual({ search: '', renaming: null, pendingDelete: null, helpOpen: false, projectListOpen: false })
  })
})

describe('规模 · 1000 / 2000 节点', () => {
  /**
   * The ratio, and **1000/2000 is not a stylistic choice**.
   *
   * At 200/400 both a linear and a quadratic implementation finish inside the timer's noise
   * floor, so the test passes either way — the card names this as its most likely false
   * green, and the size below is the card's own answer to it.
   *
   * ⚠ **But 1000/2000 is not enough on its own either, and this is the finding of the card.**
   * Replacing `byId.get(parent)` with `doc.nodes.find(…)` — a textbook O(n²) — was run
   * against this suite twice: once green, once red. The quadratic term is real but small
   * next to the linear setup at these sizes, so the ratio lands near 3 and which side it
   * falls on is decided by the garbage collector. **A flaky detector is not a detector.**
   * The deterministic version is `counts array reads` below; this one stays because it is
   * the card's literal acceptance and because it catches whole-algorithm regressions that a
   * per-call counter would not.
   */
  const wide = (count: number): SceneDocument => {
    const base = createGoldenPathDocument()
    const nodes: Node[] = []
    for (let i = 0; i < count; i++) {
      // Depth every ten, so the tree is a tree rather than one enormous fan — the same shape
      // `scripts/bench-scale.mjs` builds, and depth is what ancestor collection walks.
      const parent = i >= 10 ? nodes[i - 10]!.id : null
      // The deepest node gets a unique name so a query can select it ALONE — see the
      // ancestor-walk test below for why that case has to exist separately.
      const name = i === count - 1 ? '末端零件' : `零件 ${i}`
      nodes.push({ ...base.nodes[0]!, id: `nd_${String(i).padStart(8, '0')}`, name, parent, order: i * 100 })
    }
    return { ...base, nodes }
  }

  /**
   * Median of five, forty iterations each, both sizes warmed first.
   *
   * The first version took a single 20-iteration sample and reported **3.4** for an
   * algorithm whose real ratio is **2.14** (measured by phase: `groupChildren` 1.36,
   * `filterNodes` 1.98). At these sizes each run is a fraction of a millisecond, so one
   * sample measures the garbage collector as much as the code. The card warns that 200/400
   * is too few NODES; the other half of the same trap is too few ITERATIONS — a noisy ratio
   * test can false-red today and false-green on the day it matters.
   */
  const time = (doc: SceneDocument): number => {
    const once = (): number => {
      const started = performance.now()
      // '零件' matches EVERY node, so the work scales with n and only with n. '零件 1' looked
      // reasonable and was not: it matches 1, 10–19, 100–199, 1000–1999, so the match count
      // grows 10× between the two sizes and the ratio would measure the query, not the code.
      for (let i = 0; i < 40; i++) flattenTree(doc, new Set(), filterNodes(doc, '零件'))
      return performance.now() - started
    }
    return [once(), once(), once(), once(), once()].sort((a, b) => a - b)[2]!
  }

  it('scales close to linearly from 1000 to 2000 nodes', () => {
    const [small, large] = [wide(1000), wide(2000)]
    time(small)
    time(large)
    const ratio = time(large) / Math.max(time(small), 0.001)
    expect(ratio).toBeLessThan(3)
  })

  /**
   * The ancestor walk, **counted rather than timed**.
   *
   * Two facts made this necessary. First, the ratio test above cannot see the walk at all:
   * with a query that matches every node, each node's parent is already in `visible` by the
   * time it is reached, so the loop breaks before the lookup ever runs. Second, once the
   * query is narrowed so the walk does run, the timing signal is still too small to call
   * reliably at 1000/2000 — measured green on one run and red on the next.
   *
   * Counting index reads has neither problem. The honest implementation touches the array
   * a fixed number of times (one `map` to build the id index, one `filter` to find matches)
   * and then walks entirely through the Map; a per-hop `find` multiplies that by the chain
   * depth. The bound is a multiple of n rather than an exact figure so that a future
   * `filterNodes` may make one more linear pass without anyone having to re-derive a magic
   * number — what it forbids is a pass per hop.
   */
  it('counts array reads: the ancestor walk uses the id index, not a scan per hop', () => {
    const N = 1000
    const doc = wide(N)
    let reads = 0
    const counted: SceneDocument = {
      ...doc,
      nodes: new Proxy(doc.nodes, {
        get(target, key, receiver) {
          if (typeof key === 'string' && /^\d+$/.test(key)) reads++
          return Reflect.get(target, key, receiver)
        },
      }),
    }

    // Matches the single deepest node, so the walk climbs the full ≈ N/10 chain with
    // nothing pre-visited — the only shape in which the lookup inside it is exercised.
    const filter = filterNodes(counted, '末端零件')
    expect(filter?.matched.size).toBe(1)
    expect(filter!.visible.size).toBeGreaterThan(90) // the whole chain came back, not just the match

    // Linear work is ~2N. A scan per hop is ~N²/20 = 50,000 here, which is what this fails on.
    expect(reads).toBeLessThan(N * 6)
  })
})
