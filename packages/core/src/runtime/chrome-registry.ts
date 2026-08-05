import { Group } from 'three'
import type { Object3D } from 'three'

/**
 * T-235 · 编辑期辅助物的登记处（X-22 合成裁决）。
 *
 * 「chrome」指只因为**有人在编辑**才存在的东西：地面网格、灯光辅助线框、变换手柄、
 * 拾取代理球。它们不属于场景内容——播放器永远不画它们，而预览模式必须把它们藏起来，
 * 否则「预览」与「播放」看到的是两个场景（C3 分叉）。
 *
 * ## 为什么是注册表而不是一串字段
 *
 * 原来的写法是 `setEditorChromeVisible` 里逐个字段 `if (this.grid) ... if (this.lightHelpers) ...`。
 * 每加一种辅助物就要记得回来加一行，而漏掉的症状是**预览里多出一个播放器没有的东西**
 * ——不会报错，只会让 parity 在某个没人写的场景下失守。注册表把「记得回来加一行」
 * 变成「注册的时候就说了」。
 *
 * ## 可见性为什么落到每个对象而不是只翻 Group
 *
 * 只翻 `root.visible` 也能让渲染器与拾取器跳过整棵子树，但**子对象自己的 `visible`
 * 仍然是 true**——而既有测试就是直接断 `grid.visible === false` 与
 * `lightHelpers.root.visible === false` 的（light-helpers.test.ts:285/297）。更要紧的是
 * 恢复：`gizmo` 的手柄可见性由选择集驱动（无选中时它自己置 false），一律恢复成 `true`
 * 会在「退出预览且无选中」时把 TransformControls 的手柄画出来。所以隐藏时逐个**记下
 * 当时的值**，显示时还原那个值，不是无脑 true。
 */
export class ChromeRegistry {
  /** 所有 chrome 的父容器，同时是 picker 的那个 aux 槽（X-22 合成的另一半）。 */
  readonly root = new Group()

  /** 注册顺序表。`visible` 是隐藏那一刻记下的原值，`null` 表示当前没有被隐藏过。 */
  private readonly entries = new Map<Object3D, { restore: boolean | null }>()

  private hidden = false

  constructor() {
    this.root.name = 'w3:chrome'
  }

  /**
   * 登记一个辅助物，返回反注册闭包。
   *
   * 对象会被挂到 {@link root} 下。反注册走 `removeFromParent()` 而不是
   * `scene.remove(object)`——后者要求调用方知道它被挂在哪，而那正是这个注册表要
   * 隐藏的细节；挂错父级时 `scene.remove` 会静默什么都不做。
   *
   * @param object 辅助物
   * @returns 反注册闭包。重复调用是安全的
   */
  register(object: Object3D): () => void {
    this.root.add(object)
    // 注册在「已经隐藏」的状态下发生时，新来的也要跟着隐藏——否则退出预览前新建一盏灯，
    // 它的辅助线框会立刻出现在预览画面里。
    const restore = this.hidden ? object.visible : null
    if (this.hidden) object.visible = false
    this.entries.set(object, { restore })

    return () => {
      const entry = this.entries.get(object)
      if (entry === undefined) return
      if (entry.restore !== null) object.visible = entry.restore
      object.removeFromParent()
      this.entries.delete(object)
    }
  }

  /**
   * 一次性显示 / 隐藏全部 chrome。
   *
   * 隐藏时记录每个对象**当时**的 `visible`；显示时还原那个值。重复调用同一方向是幂等的
   * ——第二次隐藏不会把「已经被记成 false」的值覆盖成 false 再也回不来。
   */
  setVisible(visible: boolean): void {
    if (visible === !this.hidden) return
    this.hidden = !visible
    for (const [object, entry] of this.entries) {
      if (visible) {
        if (entry.restore !== null) object.visible = entry.restore
        entry.restore = null
      } else {
        entry.restore = object.visible
        object.visible = false
      }
    }
    this.root.visible = visible
  }

  /** 当前登记在册的对象，按注册顺序。遍历断言的唯一数据源。 */
  get objects(): readonly Object3D[] {
    return [...this.entries.keys()]
  }

  /** 清空。只摘不 dispose——几何体与材质归各自的所有者。 */
  dispose(): void {
    for (const object of this.entries.keys()) object.removeFromParent()
    this.entries.clear()
    this.root.removeFromParent()
  }
}
