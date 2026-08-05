import type { SceneDocument, Section } from '@w3/schema'
import { BufferGeometry, DoubleSide, Float32BufferAttribute, Group, LineBasicMaterial, LineSegments, Mesh, MeshBasicMaterial, Plane, PlaneGeometry, Vector3 } from 'three'
import type { Object3D } from 'three'
import type { RendererLike } from './renderer-like.js'
import type { SceneGraph } from './scene-graph.js'

/**
 * T-243 · 剖切平面。
 *
 * ## 它为什么这么便宜
 *
 * 剖切面是**节点的第四种承载体**（X-03 的裁决）。平面的位置与法线就是节点的 transform，
 * 开关就是 `node.visible`。于是它自动继承：变换手柄、层级树、撤销、`setVisible` 动作、
 * 退出预览还原——**整个功能零新增动作**，成本从 5 个 core 文件降到 1 个。
 *
 * ## 两条必须记下来的耦合
 *
 * 1. **three 把裁剪平面的「数量」放进 shader program 的 cache key。** 开 / 关剖切会让
 *    场景里每一个材质重新编译一次着色器。第一次开启时的卡顿是这个，不是平面本身贵。
 *    由 T-284 度量。
 * 2. **`Material.copy()` 会连 `clippingPlanes` 一起复制**，而 `MaterialRegistry` 的克隆
 *    走 clone/copy。今天只用全局裁剪（`scope: 'scene'`，单成员闭合枚举），所以没有材质
 *    带着裁剪状态；**一旦启用逐材质剖切，每次高亮克隆都会继承裁剪状态**，而症状是
 *    「高亮某个零件之后它被切了一刀」。`SECTION_SCOPES` 只有一项就是为了让这件事在
 *    加第二项时必须先过一次分诊，而不是顺手加个枚举值。
 */

/**
 * 渲染器同时最多吃几条裁剪平面。
 *
 * ⚠ **这个 3 是拍的，不是测的**（与设备像素比封顶、描边预设上限同一处境）：目标机器
 * benchmark（H1 / 原 G0.5-8）尚未闭合，见 ADR-0022。碰到它时不要当成实测结论引用。
 */
export const MAX_SECTION_PLANES = 3

/** 平面的局部法线：指示矩形躺在 XY 面上，法线是 +Z。保留的是法线那一侧。 */
const LOCAL_NORMAL = new Vector3(0, 0, 1)

const _normal = new Vector3()
const _point = new Vector3()

/**
 * 编辑期看得见的那块指示矩形。
 *
 * 它是**双面**的：从被剖掉的那一侧看过去，用户仍然要能看见自己把刀放在哪。
 * `visible` 由文档驱动（承载体的开关就是 `node.visible`），所以这里不碰它。
 */
export function createSectionObject(section: Section): Object3D {
  const group = new Group()
  const [width, height] = section.size
  const fill = new Mesh(
    new PlaneGeometry(width, height),
    new MeshBasicMaterial({ color: 0x4aa8c7, transparent: true, opacity: 0.12, side: DoubleSide, depthWrite: false }),
  )
  const border = new LineSegments(borderGeometry(width, height), new LineBasicMaterial({ color: 0x4aa8c7 }))
  group.add(fill, border)
  return group
}

function borderGeometry(width: number, height: number): BufferGeometry {
  const x = width / 2
  const y = height / 2
  const corners = [
    [-x, -y], [x, -y],
    [x, -y], [x, y],
    [x, y], [-x, y],
    [-x, y], [-x, -y],
  ]
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(corners.flatMap(([cx, cy]) => [cx!, cy!, 0]), 3))
  return geometry
}

/** 承载体工厂的形状，与 `PrimitiveFactory` / `LightFactory` 同形。 */
export interface SectionFactory {
  create(section: Section): Object3D
  /** 尺寸变了可以原地改；`false` = 结构性变化，调用方换对象。 */
  update(object: Object3D, section: Section): boolean
  dispose(object: Object3D): void
}

export const sectionFactory: SectionFactory = {
  create: createSectionObject,
  update(object, section) {
    const [fill, border] = object.children as [Mesh | undefined, LineSegments | undefined]
    if (!fill || !border) return false
    const [width, height] = section.size
    const previousFill = fill.geometry
    const previousBorder = border.geometry
    fill.geometry = new PlaneGeometry(width, height)
    border.geometry = borderGeometry(width, height)
    // 换完再释放：先释放会有一帧画不出东西（与 primitive-factory 逐字同一条纪律）
    previousFill.dispose()
    previousBorder.dispose()
    return true
  },
  dispose(object) {
    for (const child of object.children) {
      const mesh = child as Mesh
      mesh.geometry?.dispose()
      const material = mesh.material
      if (Array.isArray(material)) for (const m of material) m.dispose()
      else material?.dispose()
    }
  },
}

/**
 * 把文档里启用中的剖切面算成 `THREE.Plane`，并写到渲染器上。
 *
 * **写的是 `renderer.clippingPlanes`，读的也该是它。** 只断这一层自己的 `livePlanes`
 * 是假绿：那是本层的账本，删掉「写给渲染器」那一行它照样对——v0.5 M11「断言渲染器
 * 而不是文档」的第四次同形。
 */
export class SectionLayer {
  private planes: Plane[] = []

  constructor(private readonly graph: SceneGraph) {}

  /**
   * 按文档与场景图重算。`renderer` 为 null 时只算不写（无头路径也要能问「有几条」）。
   */
  sync(doc: SceneDocument, renderer: RendererLike | null): void {
    const active: Plane[] = []
    for (const node of doc.nodes) {
      if (node.section === null) continue
      const object = this.graph.objectFor(node.id)
      if (!object || !worldVisible(object)) continue
      if (active.length >= MAX_SECTION_PLANES) break

      object.updateWorldMatrix(true, false)
      // 法线走 normalMatrix 而不是 matrixWorld：带缩放时用 matrixWorld 变换法线会把它
      // 拧歪（非等比缩放下法线不是随点一起变的那种向量）。
      _normal.copy(LOCAL_NORMAL).transformDirection(object.matrixWorld).normalize()
      _point.setFromMatrixPosition(object.matrixWorld)
      active.push(new Plane().setFromNormalAndCoplanarPoint(_normal, _point))
    }
    this.planes = active
    if (renderer) renderer.clippingPlanes = active
  }

  /** 当前算出来的平面。**测试要断渲染器那一侧，不是这里**（见类注释）。 */
  get livePlanes(): readonly Plane[] {
    return this.planes
  }

  dispose(renderer: RendererLike | null): void {
    this.planes = []
    if (renderer) renderer.clippingPlanes = []
  }
}

/**
 * 世界可见性：它自己以及每一个祖先都得可见。
 *
 * **不是 `object.visible`。** 用户把一个分组收起来之后，组里那把刀如果还在切，画面被
 * 剖开而看得见的地方一个平面都没有——找不着，也关不掉。
 */
function worldVisible(object: Object3D): boolean {
  let current: Object3D | null = object
  while (current) {
    if (!current.visible) return false
    current = current.parent
  }
  return true
}
