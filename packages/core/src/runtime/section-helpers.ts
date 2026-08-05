import type { SceneDocument } from '@w3/schema'
import { ArrowHelper, Group, Vector3 } from 'three'
import type { Object3D } from 'three'
import type { SceneGraph } from './scene-graph.js'

/**
 * T-251 · 剖切平面在编辑期看起来是什么样。
 *
 * 指示矩形本身由承载体工厂造（`section-layer.ts` 的 `sectionFactory`），它在文档里、
 * 能被 gizmo 拖。**这一层只加两样它不该有的东西**：
 *
 * - **法线箭头**——看不出刀朝哪一边，就分不清「切掉前面」与「切掉后面」，而两者的
 *   画面差别巨大。
 * - **沿 +n 偏移 1mm**——不偏的话箭头与矩形恰好落在裁剪平面上，被自己切掉一半，
 *   画面上是一条闪烁的锯齿。
 *
 * 与 `light-helpers.ts` 同一条理由挂在 chrome 而不是 `graph.root`：全览按
 * `Box3.setFromObject(graph.root)` 取景，把辅助物放进图里会让「加一把刀」改变整个场景
 * 的取景。play 模式一个都不建（C1 · 这是编辑期家具，与网格同类）。
 *
 * ## M9 的教训逐字照抄
 *
 * 每条记录都存**建构时那个 Object3D**。图重建会换掉它，而一个指向被丢弃对象的辅助物
 * 会静默冻结：它继续画在那个对象曾经在的地方。比身份是把「幽灵」变成「重建」的唯一办法。
 */

/** 沿法线推开的距离（米）。刚好躲开自己的裁剪面，又看不出偏移。 */
const NORMAL_OFFSET = 0.001

/** 箭头长度（米）。够看出朝向，又不至于在小场景里喧宾夺主。 */
const ARROW_LENGTH = 0.5

const LOCAL_NORMAL = new Vector3(0, 0, 1)

interface HelperEntry {
  readonly nodeId: string
  /** 建构时那个 Object3D。见类注释的 M9 段。 */
  readonly source: Object3D
  readonly arrow: ArrowHelper
}

export class SectionHelperLayer {
  readonly root = new Group()

  private entries = new Map<string, HelperEntry>()

  constructor(private readonly graph: SceneGraph) {
    this.root.name = 'w3:section-helpers'
  }

  /** 当前有几个辅助物。测试的观测点。 */
  get size(): number {
    return this.entries.size
  }

  /**
   * 按文档重建这一层。
   *
   * 三种情况都要拆掉重来：节点没了、不再是剖切面、**或者图重建换了 Object3D**。
   * 第三种是 M9 那条缺陷的形状，也是最容易漏的一种——前两种在文档上看得见，第三种
   * 只在对象身份上看得见。
   */
  sync(doc: SceneDocument): void {
    const sections = new Set(doc.nodes.filter((n) => n.section !== null).map((n) => n.id))

    for (const [nodeId, entry] of [...this.entries]) {
      if (!sections.has(nodeId) || this.graph.objectFor(nodeId) !== entry.source) this.remove(nodeId)
    }

    for (const nodeId of sections) {
      if (this.entries.has(nodeId)) continue
      const source = this.graph.objectFor(nodeId)
      // 图还没 materialise 它（补丁先于重建到达）。下一次 sync 会接上，
      // 少一个辅助物不值得一条警告。
      if (!source) continue

      const arrow = new ArrowHelper(new Vector3(0, 0, 1), new Vector3(), ARROW_LENGTH, 0x4aa8c7, 0.12, 0.06)
      arrow.name = `w3:section-normal:${nodeId}`
      this.root.add(arrow)
      this.entries.set(nodeId, { nodeId, source, arrow })
    }

    this.update()
  }

  /**
   * 每帧把箭头摆到位。
   *
   * 与 `light-helpers` 一样每帧跑：拖动 gizmo 时对象的世界矩阵每帧都在变，而辅助物
   * 落后一帧的表现是「箭头跟着手在抖」。
   */
  update(): void {
    for (const entry of this.entries.values()) {
      const source = entry.source
      source.updateWorldMatrix(true, false)
      const normal = LOCAL_NORMAL.clone().transformDirection(source.matrixWorld).normalize()
      const origin = new Vector3().setFromMatrixPosition(source.matrixWorld)
      // 沿 +n 推开 1mm：不推的话箭头落在裁剪面上，被自己切掉一半
      entry.arrow.position.copy(origin).addScaledVector(normal, NORMAL_OFFSET)
      entry.arrow.setDirection(normal)
      entry.arrow.visible = worldVisible(source)
    }
  }

  private remove(nodeId: string): void {
    const entry = this.entries.get(nodeId)
    if (!entry) return
    this.entries.delete(nodeId)
    this.root.remove(entry.arrow)
    entry.arrow.dispose()
  }

  dispose(): void {
    for (const nodeId of [...this.entries.keys()]) this.remove(nodeId)
    this.root.removeFromParent()
  }
}

/** 与 `section-layer.ts` 同一条判据：它自己以及每一个祖先都得可见。 */
function worldVisible(object: Object3D): boolean {
  let current: Object3D | null = object
  while (current) {
    if (!current.visible) return false
    current = current.parent
  }
  return true
}
