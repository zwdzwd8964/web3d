import type { Camera, Object3D, Scene } from 'three'
import { HIGHLIGHT_PRESETS } from '../highlight-presets.js'
import type { HighlightStrategy } from './highlight.js'
import type { SceneGraph } from './scene-graph.js'

/**
 * T-240 · 后处理描边。
 *
 * ## 为什么有上限
 *
 * 每一种预设要一条自己的 `OutlinePass`（描边颜色是 pass 的属性，不是对象的），而每条
 * pass 都是一遍全屏渲染 + 两张离屏目标。**同一时刻超过两种颜色的描边，代价与收益
 * 都不成立**：三条 pass 在集显上直接掉帧，而画面上三种颜色的轮廓线也已经读不出主次。
 *
 * 超限的那些**回落到自发光**而不是被丢掉——用户配的高亮必须出现，只是形式退化。
 * 并且**每个被拒的预设恰好报一条 warn**：报零条会让人以为描边生效了，
 * 每次 `apply` 报一条会在拖拽时刷屏。
 */

/** 同一时刻最多几种描边预设。超过的回落自发光。 */
export const MAX_ACTIVE_OUTLINE_PRESETS = 2

/** 这棵子树里有没有真能画出来的网格。 */
function hasMesh(root: Object3D): boolean {
  let found = false
  root.traverse((child) => {
    if ((child as { isMesh?: boolean }).isMesh) found = true
  })
  return found
}

/** `OutlinePass` 里本模块用到的那部分。真 pass 需要 WebGL 上下文，单测注入桩。 */
export interface OutlinePassLike {
  selectedObjects: Object3D[]
  edgeStrength: number
  edgeThickness: number
  pulsePeriod: number
  visibleEdgeColor: { set(value: string): unknown }
  hiddenEdgeColor: { set(value: string): unknown }
  dispose(): void
}

/** composer 里本模块用到的那部分。 */
export interface OutlineComposerLike {
  addPass(pass: unknown): void
  removePass(pass: unknown): void
}

export interface OutlineLayerOptions {
  readonly composer: OutlineComposerLike
  readonly scene: Scene
  readonly camera: Camera
  /**
   * 只要「按节点 id 取对象」这一个能力。**故意不写成 `SceneGraph`**：这一层与图的其余
   * 部分（建树 / 增量改父子 / 资产源）无关，收窄成一个方法后，单测里一个 Map 就是全部
   * 依赖，不必为了测描边先造一棵图。
   */
  readonly graph: Pick<SceneGraph, 'objectFor'>
  /** 超限时接手的那个策略。通常是 `EmissiveStrategy`。 */
  readonly fallback: HighlightStrategy
  /** 造一条 pass。**注入而不是自己 new**——否则「删掉 addPass」这条变异在 Node 里观测不到。 */
  readonly createPass: (scene: Scene, camera: Camera) => OutlinePassLike
  /** 文档里的描边参数（宽度 / 强度 / 遮挡边 / 选中态颜色）。 */
  readonly settings: () => { widthPx: number; strength: number; hiddenEdge: 'hide' | 'dim' | 'show'; color: string }
  readonly log?: (level: 'debug' | 'warn' | 'error', message: string, data?: unknown) => void
}

export class OutlineLayer implements HighlightStrategy {
  readonly kind = 'outline' as const

  private readonly passes = new Map<string, OutlinePassLike>()
  /** 每个节点当前落在哪个预设上；`null` 表示它走了回落。 */
  private readonly placement = new Map<string, string | null>()
  /** 已经为哪些预设报过「超限」。**每个预设一条，不是每次 apply 一条。** */
  private readonly warned = new Set<string>()

  /**
   * T-241 · 编辑器选中态那条通道，**与预设通道分开的一条独立 pass**。
   *
   * ## 为什么它不占那两个预设名额
   *
   * 占了的话，「我此刻选中了什么」会决定「我的规则高亮画成什么样」：选中一个对象，
   * 第一种规则预设就掉进自发光回落——一个用户既解释不了、也无法在播放器里复现的耦合
   * （播放器根本没有选中态）。选中态是编辑期辅助物，与 grid / gizmo 同类，走
   * `ChromeRegistry` 的可见性规矩（进预览即清空），不该跟内容抢名额。
   *
   * 代价：编辑器里最多同时三条 pass 而不是两条。这个代价只在编辑期付，且
   * **进预览时那一条一定不在**——所以出图与 parity 看到的仍然是至多两条。
   */
  private selectionPass: OutlinePassLike | null = null
  private selectionIds: readonly string[] = []

  constructor(private readonly options: OutlineLayerOptions) {}

  apply(nodeId: string, preset: string, spec: (typeof HIGHLIGHT_PRESETS)[keyof typeof HIGHLIGHT_PRESETS]): boolean {
    const object = this.options.graph.objectFor(nodeId)
    // **子树里得真有网格才算画得上。** `OutlinePass` 收下一个空 Group 不会报错、也不会画出
    // 任何东西——那就成了「返回 true 而用户什么都看不见」，正是自发光那条路早就避开的坑
    // （分组节点 / 资产没加载完的占位节点）。
    if (!object || !hasMesh(object)) return false

    // **同一节点重复设成同一预设是无操作。** 少了这一句，下面的 `clear` 会在它是该预设
    // 最后一个成员时把 pass 拆了 dispose 掉，紧接着 `ensurePass` 再造一条新的——一条
    // hover 上的高亮规则会按帧反复销毁重建一条全屏后处理通道（每条两张离屏目标）。
    if (this.placement.get(nodeId) === preset) return true

    // 先把它从旧位置摘掉：换预设时不摘，旧 pass 会一直画着它
    this.clear(nodeId)

    const pass = this.ensurePass(preset, spec)
    if (!pass) {
      const ok = this.options.fallback.apply(nodeId, preset, spec)
      if (ok) this.placement.set(nodeId, null)
      return ok
    }

    pass.selectedObjects.push(object)
    this.placement.set(nodeId, preset)
    // **描边路径不碰材质。** 这就是「unlit 材质在描边模式下高亮得起来」的原因：
    // 自发光那条路要材质有 `emissive`，而 `MeshBasicMaterial` 没有。
    return true
  }

  clear(nodeId: string): void {
    const where = this.placement.get(nodeId)
    if (where === undefined) return
    this.placement.delete(nodeId)

    if (where === null) {
      this.options.fallback.clear(nodeId)
      return
    }

    const pass = this.passes.get(where)
    const object = this.options.graph.objectFor(nodeId)
    if (!pass || !object) return
    pass.selectedObjects = pass.selectedObjects.filter((o) => o !== object)

    // 空了就拆掉，把名额还回去。**不拆的话「上限 2」会随时间单调劣化**：
    // 用过三种预设之后，前两条 pass 各自空着占着名额，第三种永远回落。
    if (pass.selectedObjects.length === 0) {
      this.options.composer.removePass(pass)
      pass.dispose()
      this.passes.delete(where)
      this.warned.delete(where)
    }
  }

  clearAll(): void {
    for (const nodeId of [...this.placement.keys()]) this.clear(nodeId)
    this.setSelection([])
  }

  /**
   * T-241 · 换一批编辑器选中态。空数组 = 拆掉这条 pass。
   *
   * 颜色取 `meta.effects.outline.color`（**只有选中态用它**——`highlight.preset` 的颜色
   * 永远来自预设表，规划 §4 的字段注释逐字写着 "Never overrides `highlight.preset`"）。
   */
  setSelection(nodeIds: readonly string[]): void {
    this.selectionIds = [...nodeIds]
    const objects = this.selectionIds
      .map((id) => this.options.graph.objectFor(id))
      .filter((object): object is Object3D => object !== undefined && hasMesh(object))

    if (objects.length === 0) {
      if (this.selectionPass) {
        this.options.composer.removePass(this.selectionPass)
        this.selectionPass.dispose()
        this.selectionPass = null
      }
      return
    }

    if (!this.selectionPass) {
      const pass = this.options.createPass(this.options.scene, this.options.camera)
      pass.pulsePeriod = 0
      this.options.composer.addPass(pass)
      this.selectionPass = pass
    }
    const settings = this.options.settings()
    this.selectionPass.edgeThickness = settings.widthPx
    this.selectionPass.edgeStrength = settings.strength
    this.selectionPass.visibleEdgeColor.set(settings.color)
    this.selectionPass.hiddenEdgeColor.set(settings.hiddenEdge === 'show' ? settings.color : '#000000')
    this.selectionPass.selectedObjects = objects
  }

  /** 选中通道当前画着的那些对象。验收断的就是它（进预览后长度为 0）。 */
  get selectionObjects(): readonly Object3D[] {
    return this.selectionPass?.selectedObjects ?? []
  }

  /** 当前活跃的 pass，按预设名。测试的观测点。 */
  get activePasses(): ReadonlyMap<string, OutlinePassLike> {
    return this.passes
  }

  private ensurePass(preset: string, spec: (typeof HIGHLIGHT_PRESETS)[keyof typeof HIGHLIGHT_PRESETS]): OutlinePassLike | null {
    const existing = this.passes.get(preset)
    if (existing) return existing

    if (this.passes.size >= MAX_ACTIVE_OUTLINE_PRESETS) {
      if (!this.warned.has(preset)) {
        this.warned.add(preset)
        this.options.log?.(
          'warn',
          `同时最多 ${MAX_ACTIVE_OUTLINE_PRESETS} 种描边预设，「${preset}」已回落为自发光高亮。` +
            `想让它也用描边，请先取消其他预设的高亮`,
        )
      }
      return null
    }

    const pass = this.options.createPass(this.options.scene, this.options.camera)
    const settings = this.options.settings()
    pass.edgeThickness = settings.widthPx
    pass.edgeStrength = settings.strength
    pass.visibleEdgeColor.set(spec.emissive)
    // 遮挡边三档：hide = 完全不画、dim = 画一条暗的、show = 与可见边同色
    pass.hiddenEdgeColor.set(settings.hiddenEdge === 'show' ? spec.emissive : '#000000')
    // **`pulsePeriod = 0`**（ADR-0021 第 7 条）。默认值让描边呼吸闪烁，那在演示视频里
    // 很好看、在盯着看一整天的工程软件里是干扰，而且它会让每一帧都不同——出图与
    // 像素对拍从此不可复现。
    pass.pulsePeriod = 0

    this.options.composer.addPass(pass)
    this.passes.set(preset, pass)
    return pass
  }
}
