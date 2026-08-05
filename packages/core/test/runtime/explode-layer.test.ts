import { createGoldenPathDocument } from '@w3/schema'
import type { Node, SceneDocument } from '@w3/schema'
import { describe, expect, it } from 'vitest'
import { ExplodeLayer } from '../../src/runtime/explode-layer.js'
import { SceneGraph } from '../../src/runtime/scene-graph.js'
import { AbortError } from '../../src/eca/types.js'

/**
 * T-244 · 爆炸叠加层。
 *
 * **每一条断言读的都是 `graph.objectFor(id).position`，不是文档。** 系数是运行时瞬态
 * （D29），文档里根本没有它——断文档等于断一个恒定不变的量。
 *
 * 叠加式（`base = position − 上一帧我加的`）不是实现细节，它是这张卡的全部：记原始值
 * 那条路会在图重建时过期（M9 那条灯光 helper 缺陷的形状）。因此下面有两组测试专门压
 * 「与补间复合」与「被 patch 覆盖之后不塌」——它们是叠加式与记账式之间唯一的分界。
 */

/** 一个带 4 个成员的爆炸分组。锚点**互不相同**，否则 radial 位移恒为零。 */
function explodeDoc(overrides: Partial<Node['explode'] & object> = {}): SceneDocument {
  const base = createGoldenPathDocument()
  const group: Node = {
    section: null,
    explodeOffset: null,
    prefabRef: null,
    assetRef: null,
    primitive: null,
    light: null,
    id: 'nd_grp00001',
    name: '泵组',
    parent: null,
    order: 500,
    transform: { p: [0, 0, 0], r: [0, 0, 0, 1], s: [1, 1, 1] },
    visible: true,
    locked: false,
    overrides: {},
    explode: { mode: 'radial', gain: 2, axis: [0, 1, 0], spacing: 0.5, easing: 'linear', ...overrides },
  }
  const member = (n: number, p: [number, number, number]): Node => ({
    ...group,
    id: `nd_mem0000${n}`,
    name: `零件 ${n}`,
    parent: 'nd_grp00001',
    order: n,
    explode: null,
    transform: { p, r: [0, 0, 0, 1], s: [1, 1, 1] },
    primitive: { kind: 'box', size: [0.2, 0.2, 0.2] },
  })
  return {
    ...base,
    nodes: [
      ...base.nodes,
      group,
      member(1, [0, 0, 0]),
      member(2, [1, 0, 0]),
      member(3, [0, 1, 0]),
      member(4, [0, 0, 1]),
    ],
  }
}

function setup(doc: SceneDocument = explodeDoc()) {
  const graph = new SceneGraph()
  graph.build(doc)
  const layer = new ExplodeLayer(graph)
  const posOf = (id: string) => graph.objectFor(id)!.position.clone()
  return { doc, graph, layer, posOf }
}

const GROUP = 'nd_grp00001'

describe('T-244 · factor=1 的位置', () => {
  it('等于文档值 + 偏移，断的是渲染器手上的对象', async () => {
    const { doc, layer, posOf } = setup()
    const before = posOf('nd_mem00002')

    await layer.setExplode(doc, GROUP, 1, 0)

    // 前提：这份 fixture 的锚点互不相同，radial 位移非零。锚点全重合的文档会让
    // 下面每一条断言退化成 0 === 0 —— 黄金路径的三个节点正是那样。
    expect(posOf('nd_mem00002').distanceTo(before), 'fixture 的位移是零，这组测试什么都没测').toBeGreaterThan(0.1)

    // 质心 = (0.25, 0.25, 0.25)，gain = 2 → 成员 2 的位移 = ([1,0,0] − 质心) × 2
    expect(posOf('nd_mem00002').x).toBeCloseTo(1 + (1 - 0.25) * 2, 6)
    expect(posOf('nd_mem00002').y).toBeCloseTo(0 + (0 - 0.25) * 2, 6)
  })

  it('1 → 0 之后**逐位等于**文档值', async () => {
    const { doc, layer, posOf } = setup()
    const before = posOf('nd_mem00002').toArray()

    await layer.setExplode(doc, GROUP, 1, 0)
    await layer.setExplode(doc, GROUP, 0, 0)

    // toEqual 而不是 toBeCloseTo：叠加式该精确归位，「差一点点」说明有账没平
    expect(posOf('nd_mem00002').toArray()).toEqual(before)
  })

  it('`explodeOffset` 非空时整条替换派生值', async () => {
    const doc = explodeDoc()
    const pinned = {
      ...doc,
      nodes: doc.nodes.map((n) => (n.id === 'nd_mem00002' ? { ...n, explodeOffset: [5, 0, 0] as [number, number, number] } : n)),
    }
    const { layer, posOf } = setup(pinned)

    await layer.setExplode(pinned, GROUP, 1, 0)

    // 用户钉的是最终位置，不是「在算出来的基础上再挪一点」
    expect(posOf('nd_mem00002').x).toBeCloseTo(1 + 5, 6)
  })

  it('嵌套两组各自叠加，互不干扰', async () => {
    const base = explodeDoc()
    const second: Node = {
      ...base.nodes.find((n) => n.id === GROUP)!,
      id: 'nd_grp00002',
      name: '第二组',
      order: 600,
    }
    const doc: SceneDocument = {
      ...base,
      nodes: [
        ...base.nodes,
        second,
        { ...base.nodes.find((n) => n.id === 'nd_mem00002')!, id: 'nd_mem00005', parent: 'nd_grp00002', order: 1, transform: { p: [3, 0, 0], r: [0, 0, 0, 1], s: [1, 1, 1] } },
        { ...base.nodes.find((n) => n.id === 'nd_mem00002')!, id: 'nd_mem00006', parent: 'nd_grp00002', order: 2, transform: { p: [5, 0, 0], r: [0, 0, 0, 1], s: [1, 1, 1] } },
      ],
    }
    const { layer, posOf } = setup(doc)
    const untouched = posOf('nd_mem00002').toArray()

    await layer.setExplode(doc, 'nd_grp00002', 1, 0)

    expect(posOf('nd_mem00005').x).not.toBeCloseTo(3, 3)
    expect(posOf('nd_mem00002').toArray(), '第一组一动都不该动').toEqual(untouched)
  })
})

describe('T-244 · 叠加式：与别的东西复合', () => {
  it('**与补间复合** —— 位置 = 补间采样值 + 爆炸偏移', async () => {
    const { doc, graph, layer, posOf } = setup()
    await layer.setExplode(doc, GROUP, 1, 0)
    const exploded = posOf('nd_mem00002').clone()

    // 补间把它挪到别处（补间写的是绝对位置，与爆炸无关）
    const object = graph.objectFor('nd_mem00002')!
    const tweenTarget = exploded.clone().add({ x: 0, y: 2, z: 0 } as never)
    object.position.copy(tweenTarget)

    layer.update(doc, 16)

    // 叠加式：这一帧的 base 是补间刚写的位置减去上一帧我加的，再加回同样的偏移
    expect(posOf('nd_mem00002').y).toBeCloseTo(tweenTarget.y, 6)
  })

  it('**收到 transform patch 之后再 tick 一帧，位置仍正确（不塌）**', async () => {
    const { doc, graph, layer, posOf } = setup()
    await layer.setExplode(doc, GROUP, 1, 0)
    const offsetY = posOf('nd_mem00002').y - 0

    // 一条 patch 把文档值写回对象（`graph.setTransform` 就是这么做的），
    // 并按 `apply-patch` 的 `case 'transform'` 通知叠加层账本过期
    graph.objectFor('nd_mem00002')!.position.set(1, 0, 0)
    layer.forgetApplied('nd_mem00002')
    layer.update(doc, 16)

    // 记账式（base = position，不减上一帧）在这条下红：它会把 1,0,0 当成新的 base
    // 再叠一次偏移，位置越叠越远
    expect(posOf('nd_mem00002').y).toBeCloseTo(offsetY, 6)
    expect(posOf('nd_mem00002').x).toBeCloseTo(1 + (1 - 0.25) * 2, 6)
  })

  it('**只清被 patch 的那个成员的账本，别的不许翻倍**', () => {
    // 整片清账本的实现在这条下红：没被覆盖的成员仍停在「base + 偏移」上，
    // 账本一清，下一帧 delta = wanted，位置直接叠成两倍。
    const { doc, graph, layer, posOf } = setup()
    void layer.setExplode(doc, GROUP, 1, 0)
    const untouched = posOf('nd_mem00003').clone()

    graph.objectFor('nd_mem00002')!.position.set(1, 0, 0)
    layer.forgetApplied('nd_mem00002')
    layer.update(doc, 16)

    expect(posOf('nd_mem00003').distanceTo(untouched)).toBeLessThan(1e-9)
  })
})

describe('T-244 · 过渡', () => {
  it('durationS 内逐帧推进，结束时 resolve', async () => {
    const { doc, layer } = setup()
    let done = false
    const promise = layer.setExplode(doc, GROUP, 1, 0, { durationS: 0.5 }).then(() => {
      done = true
    })

    layer.update(doc, 250)
    expect(layer.factorOf(GROUP)).toBeCloseTo(0.5, 3)
    await Promise.resolve()
    expect(done, '中途不该 resolve').toBe(false)

    layer.update(doc, 500)
    await promise
    expect(layer.factorOf(GROUP)).toBe(1)
    expect(done).toBe(true)
  })

  it('**中断时停在中途**，既不等于起点也不等于终点，且 reject AbortError', async () => {
    const { doc, layer, posOf } = setup()
    const start = posOf('nd_mem00002').clone()
    const controller = new AbortController()
    const promise = layer.setExplode(doc, GROUP, 1, 0, { durationS: 1, signal: controller.signal })

    layer.update(doc, 300)
    const midway = posOf('nd_mem00002').clone()
    controller.abort()

    await expect(promise).rejects.toBeInstanceOf(AbortError)
    layer.update(doc, 600)

    expect(posOf('nd_mem00002').distanceTo(start), '回零了 —— 用户眼里是一次闪回').toBeGreaterThan(0.01)
    expect(posOf('nd_mem00002').distanceTo(midway), '中断后不该继续走').toBeLessThan(1e-6)
    expect(layer.factorOf(GROUP)).toBeGreaterThan(0)
    expect(layer.factorOf(GROUP)).toBeLessThan(1)
  })

  it('已经 abort 的 signal 直接 reject，不启动', async () => {
    const { doc, layer, posOf } = setup()
    const before = posOf('nd_mem00002').toArray()
    const controller = new AbortController()
    controller.abort()

    await expect(layer.setExplode(doc, GROUP, 1, 0, { durationS: 1, signal: controller.signal })).rejects.toBeInstanceOf(
      AbortError,
    )
    expect(posOf('nd_mem00002').toArray()).toEqual(before)
  })

  it('连点两次：上一条被冻结并 reject，新的接管', async () => {
    const { doc, layer } = setup()
    const first = layer.setExplode(doc, GROUP, 1, 0, { durationS: 1 })
    const firstSettled = expect(first).rejects.toBeInstanceOf(AbortError)

    layer.update(doc, 200)
    const second = layer.setExplode(doc, GROUP, 0.2, 200, { durationS: 0.1 })
    await firstSettled

    layer.update(doc, 300)
    await second
    expect(layer.factorOf(GROUP)).toBeCloseTo(0.2, 6)
  })
})

describe('T-244 · reset', () => {
  it('回到文档值，**且再 tick 十帧仍不动**', async () => {
    // 只断「回到文档值」是不够的：重建之后第一帧位置本来就是对的，坏的是第二帧。
    const { doc, layer, posOf } = setup()
    const before = posOf('nd_mem00002').toArray()
    await layer.setExplode(doc, GROUP, 1, 0)

    layer.reset(doc)
    expect(posOf('nd_mem00002').toArray()).toEqual(before)

    for (let i = 1; i <= 10; i++) layer.update(doc, i * 16)
    expect(posOf('nd_mem00002').toArray(), '第二帧起开始飘 —— 账本没清干净').toEqual(before)
  })

  it('reset 之后 activeCount 归零', async () => {
    const { doc, layer } = setup()
    await layer.setExplode(doc, GROUP, 1, 0)
    expect(layer.activeCount).toBe(1)
    layer.reset(doc)
    expect(layer.activeCount).toBe(0)
  })
})

describe('T-244 · 缓存失效', () => {
  it('**改了子件 transform.p 之后偏移跟着变**', async () => {
    // 缓存永不失效的实现在这条下红。位移是全组锚点的函数：动一个成员，其余每一个都变。
    const doc = explodeDoc()
    const { layer, posOf } = setup(doc)
    await layer.setExplode(doc, GROUP, 1, 0)
    const first = posOf('nd_mem00002').clone()

    // 把成员 4 挪远 → 质心变 → 成员 2 的位移跟着变
    const moved: SceneDocument = {
      ...doc,
      nodes: doc.nodes.map((n) =>
        n.id === 'nd_mem00004' ? { ...n, transform: { ...n.transform, p: [0, 0, 9] as [number, number, number] } } : n,
      ),
    }
    layer.invalidate()
    layer.update(moved, 16)

    expect(posOf('nd_mem00002').distanceTo(first), '缓存没失效，偏移还是老的').toBeGreaterThan(0.5)
  })

  it('不 invalidate 就用缓存 —— 这正是它存在的理由', async () => {
    const doc = explodeDoc()
    const { layer, posOf } = setup(doc)
    await layer.setExplode(doc, GROUP, 1, 0)
    const first = posOf('nd_mem00002').clone()

    const moved: SceneDocument = {
      ...doc,
      nodes: doc.nodes.map((n) =>
        n.id === 'nd_mem00004' ? { ...n, transform: { ...n.transform, p: [0, 0, 9] as [number, number, number] } } : n,
      ),
    }
    layer.update(moved, 16)

    expect(posOf('nd_mem00002').distanceTo(first)).toBeLessThan(1e-6)
  })
})

describe('T-244 · 不是爆炸分组的目标', () => {
  it('分组没有 explode 时什么都不做，不抛', async () => {
    const { doc, layer, posOf } = setup()
    const before = posOf('nd_mem00002').toArray()
    await expect(layer.setExplode(doc, 'nd_mem00001', 1, 0)).resolves.toBeUndefined()
    expect(posOf('nd_mem00002').toArray()).toEqual(before)
  })
})

/* ========================================================================== */
/* T-244 · 接缝防线：叠加层真的被装在运行时上                                  */
/* ========================================================================== */

describe('T-244 · 接缝防线', () => {
  /** 一个装好了图与叠加层的真运行时。爆炸不需要渲染器。 */
  async function runtimeWith(doc: SceneDocument) {
    const { SceneRuntime } = await import('../../src/runtime/scene-runtime.js')
    const { createMemoryResolver } = await import('../../src/runtime/loader.js')
    const { NullHotspotRenderer } = await import('../../src/runtime/hotspot-layer.js')
    let clock = 0
    const runtime = new SceneRuntime(doc, {
      resolver: createMemoryResolver(new Map()),
      mode: 'play',
      hotspotRenderer: new NullHotspotRenderer(),
      now: () => clock,
    })
    runtime.graph.build(doc)
    return { runtime, advance: (ms: number) => (clock += ms) }
  }

  it('`setExplode` 走到了运行时上，位置真的变了', async () => {
    const doc = explodeDoc()
    const { runtime } = await runtimeWith(doc)
    const before = runtime.graph.objectFor('nd_mem00002')!.position.clone()

    await runtime.setExplode(GROUP, 1)

    expect(runtime.explodeOf(GROUP)).toBe(1)
    expect(runtime.graph.objectFor('nd_mem00002')!.position.distanceTo(before)).toBeGreaterThan(0.1)
    runtime.dispose()
  })

  it('目标不是爆炸分组 → 不抛、系数为 0、报 error 日志', async () => {
    const doc = explodeDoc()
    const { SceneRuntime } = await import('../../src/runtime/scene-runtime.js')
    const { createMemoryResolver } = await import('../../src/runtime/loader.js')
    const { NullHotspotRenderer } = await import('../../src/runtime/hotspot-layer.js')
    const logs: [string, string][] = []
    const runtime = new SceneRuntime(doc, {
      resolver: createMemoryResolver(new Map()),
      mode: 'play',
      hotspotRenderer: new NullHotspotRenderer(),
      now: () => 0,
      onLog: (level, message) => logs.push([level, message]),
    })
    runtime.graph.build(doc)

    await expect(runtime.setExplode('nd_mem00001', 1)).resolves.toBeUndefined()

    expect(runtime.explodeOf('nd_mem00001')).toBe(0)
    expect(logs.some(([level, m]) => level === 'error' && m.includes('不是爆炸分组'))).toBe(true)
    runtime.dispose()
  })

  it('**tick 排在补间与片段之后** —— 一边补间一边爆炸，零件不塌', async () => {
    // 顺序反过来的话补间会把爆炸偏移覆盖掉，而单独测各自都是绿的。
    const doc = explodeDoc()
    const { runtime, advance } = await runtimeWith(doc)
    await runtime.setExplode(GROUP, 1)
    const exploded = runtime.graph.objectFor('nd_mem00002')!.position.clone()

    advance(16)
    runtime.tick()

    expect(runtime.graph.objectFor('nd_mem00002')!.position.distanceTo(exploded)).toBeLessThan(1e-9)
    runtime.dispose()
  })

  it('**resetScene 之后再 tick 十帧仍不动**', async () => {
    // 卡面变异 ②：只断「回到文档值」是不够的——重建之后第一帧位置本来就是对的，
    // 坏的是第二帧。这条读的是真 `resetScene`，不是 `layer.reset`。
    const doc = explodeDoc()
    const { runtime, advance } = await runtimeWith(doc)
    const before = runtime.graph.objectFor('nd_mem00002')!.position.toArray()
    await runtime.setExplode(GROUP, 1)

    runtime.resetScene()
    expect(runtime.graph.objectFor('nd_mem00002')!.position.toArray()).toEqual(before)

    for (let i = 0; i < 10; i++) {
      advance(16)
      runtime.tick()
    }
    expect(runtime.graph.objectFor('nd_mem00002')!.position.toArray(), '第二帧起开始飘').toEqual(before)
    expect(runtime.explodeOf(GROUP)).toBe(0)
    runtime.dispose()
  })

  it('一条 transform patch 之后再 tick，爆炸不塌（走真 apply-patch）', async () => {
    const doc = explodeDoc()
    const { runtime, advance } = await runtimeWith(doc)
    await runtime.setExplode(GROUP, 1)
    const exploded = runtime.graph.objectFor('nd_mem00002')!.position.clone()

    const index = doc.nodes.findIndex((n) => n.id === 'nd_mem00002')
    const next = {
      ...doc,
      nodes: doc.nodes.map((n, k) => (k === index ? { ...n, transform: { ...n.transform, p: [1, 0, 0] as [number, number, number] } } : n)),
    }
    runtime.applyPatch([{ op: 'replace', path: ['nodes', index, 'transform', 'p'], value: [1, 0, 0] }], next, doc)
    advance(16)
    runtime.tick()

    expect(runtime.fullRebuildCount).toBe(0)
    expect(runtime.graph.objectFor('nd_mem00002')!.position.distanceTo(exploded), '塌了').toBeLessThan(1e-6)
    runtime.dispose()
  })
})
