/**
 * T-184 · the CPU cost of a big document.
 *
 * Separate from `bench.html` (T-110) on purpose. That one measures the GPU and is only
 * meaningful on the customer's machine; everything here is array and Map work, has no
 * renderer in it at all, and therefore gives the same answer on any machine — so it can be
 * a number we commit and a threshold we defend.
 *
 * Run: node scripts/bench-scale.mjs [nodeCount]
 */
import {
  buildIndex,
  checkIntegrity,
  createEmptyDocument,
  createNode,
  createSequentialIdFactory,
  getDescendants,
  validate,
  walkTree,
} from '../packages/schema/dist/index.js'
// T-224 · imported from source, not from a build. `@w3/editor` has no module dist (it is a
// bundled Vite app), and Node 24 strips the types natively. There is deliberately NO
// try/catch fallback here: a bench that silently skips the thing it was extended to measure
// reads exactly like a bench that measured it and found it fast.
import { filterNodes, flattenTree } from '../packages/editor/src/panels/tree-dnd.ts'

const COUNT = Number(process.argv[2] ?? 1000)
const REPEATS = 20

/**
 * A document shaped like a real imported assembly: a few top-level groups, each with a
 * couple of levels under it. A flat list of 1000 roots would understate `childrenOf`, which
 * is the map most of this is about.
 */
function makeDocument(count) {
  const ctx = { newId: createSequentialIdFactory(), now: () => '2026-01-01T00:00:00.000Z' }
  const doc = createEmptyDocument({ name: '规模基准', ctx })
  const nodes = []
  const groups = Math.max(1, Math.round(count / 50))

  for (let g = 0; g < groups; g++) {
    const group = createNode({ name: `装配体 ${g + 1}`, order: g * 100, ctx })
    nodes.push(group)
    const perGroup = Math.floor((count - groups) / groups)
    let parent = group.id
    for (let i = 0; i < perGroup; i++) {
      const part = createNode({
        name: `零件 ${g + 1}-${i + 1}`,
        parent,
        order: i * 100,
        primitive: { kind: 'box', size: [1, 1, 1] },
        ctx,
      })
      nodes.push(part)
      // Every tenth part becomes the next level's parent, so the tree has depth rather
      // than being one wide fan — depth is what `flattenTree` recurses through.
      if (i % 10 === 9) parent = part.id
    }
  }

  return { ...doc, nodes }
}

function time(label, fn) {
  fn()
  const start = performance.now()
  for (let i = 0; i < REPEATS; i++) fn()
  const ms = (performance.now() - start) / REPEATS
  console.log(`  ${label.padEnd(28)} ${ms.toFixed(2)} ms`)
  return ms
}

const doc = makeDocument(COUNT)
const check = validate(doc)
if (!check.ok) {
  console.error('基准文档不合 schema，先修文档生成器：', check.error.slice(0, 3))
  process.exit(1)
}

console.log(`\n${doc.nodes.length} 个节点，${REPEATS} 次取平均\n`)
const results = {}
results.buildIndex = time('buildIndex', () => buildIndex(doc))
results.checkIntegrity = time('checkIntegrity', () => checkIntegrity(doc))

results.walkTree = time('walkTree（可达性检查）', () => walkTree(doc, () => {}))
results.getDescendants = time('getDescendants（删子树）', () => getDescendants(doc, doc.nodes[0].id))

// Deleting a node near the FRONT of the array is the worst case: everything after it
// shifts, so every downstream consumer sees a changed index.
const afterDelete = { ...doc, nodes: doc.nodes.filter((_, i) => i !== 1) }
results.rebuildAfterDelete = time('删一个节点后重建索引', () => buildIndex(afterDelete))

// T-224 · the hierarchy tree re-flattens on EVERY document change, and once there is a
// search box it also re-filters on every keystroke. Both are on the typing path, so a
// number over one frame here is a visibly laggy search box, not a slow batch job.
const noCollapse = new Set()
// Matches one group's parts — a partial word, which is what people actually type, and the
// case where the ancestor walk has real work to do (the matches are deep, their parents
// are not matches).
const QUERY = '零件 1-'
results.flattenTree = time('flattenTree（渲染行）', () => flattenTree(doc, noCollapse))
results.filterNodes = time('filterNodes（搜索过滤）', () => filterNodes(doc, QUERY))
const filter = filterNodes(doc, QUERY)
results.flattenFiltered = time('flattenTree（过滤后）', () => flattenTree(doc, noCollapse, filter))
console.log(`  ${'（命中 / 可见 / 全部）'.padEnd(24)} ${filter.matched.size} / ${filter.visible.size} / ${doc.nodes.length}`)

console.log('')
for (const [key, ms] of Object.entries(results)) {
  if (ms > 16) console.log(`  ⚠ ${key} 超过一帧（16 ms）`)
}
console.log('')
