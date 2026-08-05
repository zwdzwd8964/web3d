import { createGoldenPathDocument } from '@w3/schema'
import type { Node, SceneDocument } from '@w3/schema'
import { BoxGeometry, Mesh, MeshStandardMaterial, PerspectiveCamera, Plane, SphereGeometry, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { Picker } from '../../src/runtime/picker.js'
import { SceneGraph } from '../../src/runtime/scene-graph.js'

/**
 * T-250 · 拾取要跟着剖切走。
 *
 * 不做的话「点击被剖掉的墙仍会选中墙」——所有剖切功能里观感最差的一处：画面上那面墙
 * 明明被切开了，点它却选中它。渲染器把这些像素丢了，拾取也该丢。
 *
 * 场景：一面墙（z=0 附近），墙后面一个球（z=−3）。相机在 z=+5 往 −z 看。
 * 剖切平面法线 −z、常数使 z>0 的一侧被裁掉 ⇒ 墙的前半被切掉。
 */

const WALL = 'nd_wall00001'
const BALL = 'nd_ball00001'

const shared = {
  section: null,
  explode: null,
  explodeOffset: null,
  prefabRef: null,
  assetRef: null,
  primitive: null,
  light: null,
  visible: true,
  locked: false,
  overrides: {},
  parent: null as string | null,
}

function doc(): SceneDocument {
  const base = createGoldenPathDocument()
  const node = (id: string, name: string, z: number): Node =>
    ({
      ...shared,
      id,
      name,
      order: id === WALL ? 1 : 2,
      transform: { p: [0, 0, z], r: [0, 0, 0, 1], s: [1, 1, 1] },
    }) as Node
  return { ...base, nodes: [...base.nodes, node(WALL, '墙', 0), node(BALL, '球', -3)] }
}

/**
 * 一个装好真几何体的图。
 *
 * `SceneGraph` 对没有承载体的节点造空 Group，射线打不到——所以这里在建完之后把真
 * 网格塞进去。断言的是拾取逻辑，不是图怎么造几何体。
 */
function setup() {
  const document = doc()
  const graph = new SceneGraph()
  graph.build(document)
  graph.objectFor(WALL)!.add(new Mesh(new BoxGeometry(10, 10, 0.5), new MeshStandardMaterial()))
  graph.objectFor(BALL)!.add(new Mesh(new SphereGeometry(1, 16, 16), new MeshStandardMaterial()))
  graph.root.updateMatrixWorld(true)

  const camera = new PerspectiveCamera(50, 1, 0.1, 100)
  camera.position.set(0, 0, 5)
  camera.lookAt(0, 0, 0)
  camera.updateMatrixWorld(true)

  const picker = new Picker(graph)
  return { document, graph, camera, picker }
}

/** 屏幕正中央往里打一条射线。 */
const pickCentre = (s: ReturnType<typeof setup>) => s.picker.pick(400, 400, 800, 800, s.camera, s.document)

describe('T-250 · 被剖掉的命中要丢掉', () => {
  it('前提：没有剖切时命中的是墙', () => {
    // 少了这条，下面那条「命中球」对一个「墙根本打不中」的场景同样成立。
    const s = setup()
    expect(pickCentre(s)?.nodeId).toBe(WALL)
  })

  it('**剖掉墙的前半 → 命中球，不是墙**', () => {
    const s = setup()
    // 法线 −z，过 z = −0.5：保留 z < −0.5 的一侧，墙（z≈0）整个被裁掉
    s.picker.setClipPlanes([new Plane(new Vector3(0, 0, -1), -0.5)])
    expect(pickCentre(s)?.nodeId).toBe(BALL)
  })

  it('关掉剖切之后又命中墙', () => {
    const s = setup()
    s.picker.setClipPlanes([new Plane(new Vector3(0, 0, -1), -0.5)])
    expect(pickCentre(s)?.nodeId).toBe(BALL)

    s.picker.setClipPlanes([])
    expect(pickCentre(s)?.nodeId).toBe(WALL)
  })

  it('多个平面是交集语义：任意一个裁掉就算裁掉', () => {
    const s = setup()
    s.picker.setClipPlanes([
      new Plane(new Vector3(0, 0, -1), -0.5), // 裁掉墙
      new Plane(new Vector3(0, 1, 0), 100), // 什么都不裁
    ])
    expect(pickCentre(s)?.nodeId).toBe(BALL)
  })

  it('`pickAll` 也跟着裁，且顺序仍按距离', () => {
    const s = setup()
    expect(s.picker.pickAll(400, 400, 800, 800, s.camera, s.document).map((r) => r.nodeId)).toEqual([WALL, BALL])

    s.picker.setClipPlanes([new Plane(new Vector3(0, 0, -1), -0.5)])
    expect(s.picker.pickAll(400, 400, 800, 800, s.camera, s.document).map((r) => r.nodeId)).toEqual([BALL])
  })
})

describe('T-250 · 容差', () => {
  /**
   * 卡面变异 ② 的落点，**而卡面给的样本规格杀不掉那条变异**。
   *
   * 卡面说「命中点恰好落在平面上」，那就是 `d === 0`——而 `d < -1e-6` 与 `d < 0` 在
   * `d === 0` 上**同为 false**，两版判据逐字一致。越照卡面精确造样本，越杀不掉它。
   *
   * 真正能区分两者的样本是 **d 严格落在 `(-1e-6, 0)` 之间**：容差版留下它，`< 0` 版
   * 把它裁掉。做法是把平面常数往前挪一个 1e-9 量级的偏移——这正是浮点求交在切口上
   * 会产生的那种误差。
   */
  const eachSide = (offset: number) => {
    const s = setup()
    // 墙的正面在 z = +0.25（厚 0.5、中心 z=0）。法线 +z、过 z = 0.25 + offset：
    // 命中点到平面的距离 = −offset。offset 取 1e-9 ⇒ d = −1e-9 ∈ (−1e-6, 0)
    s.picker.setClipPlanes([new Plane(new Vector3(0, 0, 1), -(0.25 + offset))])
    return pickCentre(s)?.nodeId
  }

  it('命中点在容差之内（d ≈ −1e-9）时**不算被裁**', () => {
    // 容差改成 0 的实现在这条下红：它会把这个点判成被裁掉，于是命中球。
    expect(eachSide(1e-9)).toBe(WALL)
  })

  it('命中点明显在负侧（d ≈ −0.01）时算被裁', () => {
    // 反向：容差不是「一律不裁」。少了这条，把 `isClipped` 写成恒 false 也能过上一条。
    // 这个平面把墙**和**它后面的球一起裁掉了（球在 z=−3，更负），所以什么都拾不到——
    // 而 `isClipped` 恒 false 的实现在这里会拾到墙。
    expect(eachSide(0.01)).toBeUndefined()
  })

  it('恰好落在平面上（d === 0）时两版判据一致 —— 登记这条样本杀不掉变异', () => {
    // 留着它是为了让下一个人不必再推一遍：`d < -1e-6` 与 `d < 0` 在 d===0 上都是 false，
    // 所以这条无论容差取多少都绿。它证明的是「恰好在平面上的点不会被裁」，本身有价值，
    // 但它**不是**容差那条变异的判据。
    expect(eachSide(0)).toBe(WALL)
  })
})

describe('T-250 · 零回归', () => {
  it('没设过平面时行为与从前逐字一致', () => {
    const s = setup()
    const before = s.picker.pickAll(400, 400, 800, 800, s.camera, s.document).map((r) => r.nodeId)
    s.picker.setClipPlanes([])
    expect(s.picker.pickAll(400, 400, 800, 800, s.camera, s.document).map((r) => r.nodeId)).toEqual(before)
  })
})
