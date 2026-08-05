import { describe, expect, it } from 'vitest'
import { buildIndex, checkIntegrity, createEmptyDocument, createNode, createSequentialIdFactory, walkTree } from '../src/index.js'
import type { Node, SceneDocument } from '../src/index.js'

/**
 * T-184 · the complexity of the document-wide operations.
 *
 * These assert SHAPE, not milliseconds — and after 2026-08-04 they assert it **by counting,
 * not by timing**.
 *
 * The original version measured wall-clock at n and 2n and asserted the ratio stayed under 3.
 * It was green on every developer machine and then **false-red on CI**: `walkTree is linear`
 * reported `3.2085` for an algorithm whose true ratio is exactly 2. At `SMALL = 400` the whole
 * operation takes microseconds, so the ratio measures the garbage collector.
 *
 * That is the same trap T-224's card names in so many words —「比值测试若用 200/400 节点，
 * 两种复杂度都在噪声里」— and the same fix applies: **count the work.** A Proxy over
 * `doc.nodes` counts index reads, which is precisely the quantity that used to blow up:
 * every one of the three regressions this card fixed was 「scan the whole node array, once per
 * node」. Linear work reads ~c·n; quadratic reads ~n². Measured, deterministic, identical on
 * every machine: 400→800 and 1000→2000 both give **exactly 2.00**.
 *
 * **A flaky detector is not a detector.** A timing test that has to be re-run until it passes
 * teaches the team to re-run it, and then it is not a gate.
 *
 * `quadraticReference` below keeps this honest: it is a deliberately O(n²) function held to
 * the same bound, and it must FAIL it. Without that, a counter that had stopped counting
 * would report 1.00 for everything and pass — the shape D36 keeps naming.
 *
 * The document is deliberately built with real depth. A flat list of roots would make
 * `childrenOf` one bucket and hide exactly the bug this is here to catch.
 */

const SMALL = 1000
const LARGE = 2000

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

/**
 * How many times an operation reads an element of `doc.nodes`.
 *
 * Deterministic by construction — no clock, no warm-up, no median. This is the quantity the
 * three regressions actually blew up: each of them scanned the entire node array once per
 * node, so the reads went from ~c·n to ~n².
 */
function reads(doc: SceneDocument, run: (doc: SceneDocument) => void): number {
  let count = 0
  const counted: SceneDocument = {
    ...doc,
    nodes: new Proxy(doc.nodes, {
      get(target, key, receiver) {
        if (typeof key === 'string' && /^\d+$/.test(key)) count++
        return Reflect.get(target, key, receiver)
      },
    }),
  }
  run(counted)
  return count
}

/** Reads at 2n over reads at n. Linear → 2. Quadratic → 4. */
function growth(run: (doc: SceneDocument) => void): number {
  return reads(large, run) / Math.max(reads(small, run), 1)
}

/**
 * A deliberately O(n²) operation, held to the same bound so the bound can be seen to bite.
 *
 * This is the built-in mutation: if the counter ever stops counting — a Proxy that no longer
 * intercepts, a `run` that copies the array before touching it — every real assertion below
 * would read 1.00 and pass, and the whole file would become decoration. This one has to fail
 * for the others to mean anything.
 */
function quadraticReference(doc: SceneDocument): void {
  for (const node of doc.nodes) {
    // The exact shape T-184 removed: a full scan, once per node.
    void doc.nodes.find((n) => n.id === node.parent)
  }
}

describe('doubling the document must not quadruple the work (T-184)', () => {
  it('the counter can tell the two apart — otherwise nothing below means anything', () => {
    expect(growth(quadraticReference), 'O(n²) 的对照物没有超出上限，说明计数器已经不再计数了').toBeGreaterThan(3)
  })

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

/* ========================================================================== */
/* T-226 · 其余各根轴上的线性                                                  */
/* ========================================================================== */

/**
 * **上面那份文档只有 nodes，其余集合全是空数组。**
 *
 * 于是「checkIntegrity is linear」只在节点这一根轴上被证明过。而 `checkIntegrity` 里
 * 真正的二次项从来不在节点上——规划 §4.2 点名了三处：`rules × variables`、
 * `materials × slots × assets`、以及 `typeOf()` 每次 `find`。检查数从 15 涨到 45 之后，
 * 没有人能靠那一条断言发现它已经不是线性的。
 *
 * 这里把其余的轴补上：每个集合按同一个 `count` 一起长，然后**逐个集合**数读取次数。
 */
function makeFullDocument(count: number): SceneDocument {
  const doc = makeDocument(count) as any
  const per = Math.max(2, Math.round(count / 20))
  const pad = (n: number) => String(n).padStart(8, '0')

  doc.assets = Array.from({ length: per }, (_, i) => ({
    id: `ast_${pad(i)}`,
    type: i % 3 === 0 ? 'texture' : 'model',
    name: `资产 ${i}`,
    hash: `sha256:${String(i).padStart(64, '0')}`,
    url: `blob:ast_${pad(i)}`,
    version: 1,
    lineageId: `ast_${pad(i)}`,
    stats: { tris: 1, materials: 1, textures: 1, bytes: 1, textureBytes: 1, nodes: 1, animations: [], clipDurations: {} },
  }))

  doc.materials = Array.from({ length: per }, (_, i) => ({
    id: `mat_${pad(i)}`,
    name: `材质 ${i}`,
    base: 'standard',
    preset: null,
    params: { color: '#cccccc', metalness: 0, roughness: 1, opacity: 1, transparent: false, side: 'front',
      emissive: '#000000', emissiveIntensity: 0,
      maps: { map: `ast_${pad(i * 3 % per)}`, normalMap: null, roughnessMap: null, metalnessMap: null, aoMap: null, emissiveMap: null },
      uv: { offset: [0, 0], repeat: [1, 1], rotationDeg: 0 } },
  }))

  doc.variables = Array.from({ length: per }, (_, i) => ({
    id: `v${i}`, name: `变量 ${i}`, type: 'number', default: 0, persist: false, scope: 'scene',
  }))

  doc.hotspots = Array.from({ length: per }, (_, i) => ({
    id: `hs_${pad(i)}`, name: `热点 ${i}`, nodeId: doc.nodes[i % doc.nodes.length].id,
    anchor: [0, 0, 0], style: { marker: 'dot', color: '#4aa8c7' },
    content: { type: 'text', title: 't', text: 'x', mediaId: null },
  }))

  doc.viewpoints = Array.from({ length: per }, (_, i) => ({
    id: `vp_${pad(i)}`, name: `视点 ${i}`,
    camera: { kind: 'perspective', position: [0, 0, 1], target: [0, 0, 0], up: [0, 1, 0], fov: 50, zoom: 1, near: 0.1, far: 1000 },
  }))

  doc.rules = Array.from({ length: per }, (_, i) => ({
    id: `rl_${pad(i)}`, name: `规则 ${i}`, enabled: true,
    when: { event: 'click', target: { nodeId: doc.nodes[i % doc.nodes.length].id } },
    if: [{ op: 'eq', left: { var: `v${i % per}` }, right: { const: 1 } }],
    ifAny: [], then: [], mode: 'sequence', onError: 'abort', reentry: 'restart',
  }))

  return doc as SceneDocument
}

/** 与上面的 `reads` 同形，但可以数任意一个集合。 */
function readsOf(doc: SceneDocument, collection: string, run: (doc: SceneDocument) => void): number {
  let count = 0
  const source = (doc as unknown as Record<string, unknown[]>)[collection]!
  const counted = {
    ...doc,
    [collection]: new Proxy(source, {
      get(target, key, receiver) {
        if (typeof key === 'string' && /^\d+$/.test(key)) count++
        return Reflect.get(target, key, receiver)
      },
    }),
  } as SceneDocument
  run(counted)
  return count
}

const AXES = ['assets', 'materials', 'variables', 'hotspots', 'viewpoints', 'rules'] as const

describe('T-226 · checkIntegrity 在每一根轴上都线性', () => {
  const smallFull = makeFullDocument(SMALL)
  const largeFull = makeFullDocument(LARGE)

  it('前提：每个集合都真的非空，而且大的那份确实更大', () => {
    // 扫描面下限。任何一个集合是空数组，对应那条 growth 就是 0/0，恒过。
    for (const axis of AXES) {
      const s = (smallFull as unknown as Record<string, unknown[]>)[axis]!
      const l = (largeFull as unknown as Record<string, unknown[]>)[axis]!
      expect(s.length, `${axis} 是空的`).toBeGreaterThan(0)
      expect(l.length, `${axis} 没有跟着长`).toBeGreaterThan(s.length)
    }
  })

  it.each(AXES)('%s 这根轴上是线性的', (axis) => {
    const g = readsOf(largeFull, axis, (d) => void checkIntegrity(d)) / Math.max(readsOf(smallFull, axis, (d) => void checkIntegrity(d)), 1)
    // 线性 → 2，二次 → 4。3 是同一条阈值，与上面那条 node 轴断言一致。
    expect(g, `${axis} 轴上的读取次数增长 ${g.toFixed(3)}，看起来不是线性`).toBeLessThan(3)
  })

  it('内置变异：拿 quadraticReference 跑一遍，阈值必须咬得住', () => {
    // 与上面 node 轴那条同理：计数器一旦失效，六条断言会一起读出 1.00 并全绿。
    const g = readsOf(largeFull, 'rules', quadraticReferenceOnRules) / Math.max(readsOf(smallFull, 'rules', quadraticReferenceOnRules), 1)
    expect(g, '阈值咬不住二次项，上面六条断言全部作废').toBeGreaterThanOrEqual(3)
  })
})

/** 故意在 rules 上跑一次 O(n²)，给上面那条内置变异当对照。 */
function quadraticReferenceOnRules(doc: SceneDocument): void {
  for (let i = 0; i < doc.rules.length; i++) {
    for (let j = 0; j < doc.rules.length; j++) void doc.rules[j]
  }
}
