import { explodeOffsets } from '@w3/schema'
import type { Easing, SceneDocument, Vec3 } from '@w3/schema'
import { Vector3 } from 'three'
import { AbortError } from '../eca/types.js'
import { ease } from './easing.js'
import type { SceneGraph } from './scene-graph.js'

/**
 * T-244 · 爆炸视图的叠加层（D29）。
 *
 * ## 为什么是「叠加」而不是「记住原始值」
 *
 * 每帧做的是 `base = position − 上一帧我加的; position = base + 这一帧要加的`。
 * 于是：
 *
 * - **与补间 / 片段天然复合**——补间刚写完的位置就是这一帧的 `base`；
 * - **被 patch 覆盖后下一帧自动补回**——用户拖了一个零件，下一帧从新位置重新叠；
 * - **`factor → 0` 精确归位，且不需要任何「原始值」记账**。
 *
 * 记原始值那条路会在**图重建**时过期，而那正是 M9 那条灯光 helper 缺陷的形状：
 * 记下来的引用指向一批已经没人渲染的对象，症状是「退出预览之后位置对不上」。
 *
 * ## factor 不进文档
 *
 * 文档里有「这个分组怎么炸」（`node.explode`）与「这个零件炸到哪」（`node.explodeOffset`），
 * **没有**「现在炸到几成」。后者与「当前播放进度」同类，是铁律 1 明写的那条例外。
 * 「发布出去默认就是爆炸态」用一条 `sceneReady → explode(...)` 规则表达。
 */

/** 一个分组此刻的状态。 */
interface GroupState {
  /** 当前系数。0 = 完全复位。 */
  factor: number
  /** 上一帧**我加上去的**位移，按成员 id。归位靠减掉它，不靠记原始值。 */
  applied: Map<string, Vec3>
  /** 过渡中的那一次。null = 静止。 */
  transition: Transition | null
}

interface Transition {
  readonly from: number
  readonly to: number
  readonly startedAt: number
  readonly durationMs: number
  readonly easing: Easing
  readonly resolve: () => void
  readonly reject: (error: unknown) => void
  signal?: AbortSignal
  onAbort?: () => void
}

const ZERO: Vec3 = [0, 0, 0]
const _v = new Vector3()

export class ExplodeLayer {
  private groups = new Map<string, GroupState>()
  /**
   * 每个分组在 `factor === 1` 时的位移，按成员 id。
   *
   * 缓存是必须的：`explodeOffsets` 在 1000 个零件上要跑 60 次/秒。失效条件写在
   * `invalidate()` 上——**批次里出现 `nodes` 路径就整片清掉**，因为位移是全组成员
   * 锚点的函数（radial 走质心、axis 走沿轴名次），改任何一个成员都会动到其余每一个。
   */
  private offsets = new Map<string, Map<string, Vec3>>()

  constructor(private readonly graph: SceneGraph) {}

  /** 有几个分组处于非零系数。测试与「要不要每帧算」都读它。 */
  get activeCount(): number {
    let n = 0
    for (const state of this.groups.values()) if (state.factor !== 0 || state.transition) n++
    return n
  }

  /** 这个分组此刻的系数。没炸过就是 0。 */
  factorOf(groupNodeId: string): number {
    return this.groups.get(groupNodeId)?.factor ?? 0
  }

  /**
   * 把一个分组推到 `factor`。`durationS <= 0` 立即到位。
   *
   * 被打断时**冻结在当前系数**并 reject `AbortError`（ECA_SPEC §5.3：取消停在当前帧，
   * 不回到起点——回起点在用户眼里是一次闪回，读起来像 bug 而不像「停下了」）。
   */
  setExplode(
    doc: SceneDocument,
    groupNodeId: string,
    factor: number,
    nowMs: number,
    options: { durationS?: number; signal?: AbortSignal } = {},
  ): Promise<void> {
    if (options.signal?.aborted) return Promise.reject(new AbortError())

    const state = this.stateOf(groupNodeId)
    // 上一次过渡先冻结：连点两下滑块不该让两条过渡互相盖
    this.settle(state, false)

    const durationMs = Math.max(0, options.durationS ?? 0) * 1000
    if (durationMs === 0) {
      state.factor = factor
      this.applyGroup(doc, groupNodeId, state)
      return Promise.resolve()
    }

    const easing = doc.nodes.find((n) => n.id === groupNodeId)?.explode?.easing ?? 'easeInOutCubic'
    return new Promise<void>((resolve, reject) => {
      const transition: Transition = {
        from: state.factor,
        to: factor,
        startedAt: nowMs,
        durationMs,
        easing,
        resolve,
        reject,
      }
      if (options.signal) {
        const onAbort = () => this.settle(state, false)
        transition.signal = options.signal
        transition.onAbort = onAbort
        options.signal.addEventListener('abort', onAbort, { once: true })
      }
      state.transition = transition
    })
  }

  /**
   * 推进一帧。
   *
   * **每一帧都重写位置，即使系数没变。** 不这么做的话，一条补间刚把零件挪到别处、
   * 或者一条 patch 刚覆盖了 transform，爆炸偏移就丢了——而症状是「拖过的那个零件塌回去了」。
   */
  update(doc: SceneDocument, nowMs: number): void {
    for (const [groupNodeId, state] of this.groups) {
      const transition = state.transition
      if (transition) {
        const t = Math.min(1, (nowMs - transition.startedAt) / transition.durationMs)
        state.factor = transition.from + (transition.to - transition.from) * ease(transition.easing, t)
        if (t >= 1) {
          state.factor = transition.to
          this.settle(state, true)
        }
      }
      this.applyGroup(doc, groupNodeId, state)
    }
  }

  /**
   * 忘掉「我给这个节点加过多少」——**不改它此刻的位置**。
   *
   * 一条 `/nodes/{i}/transform` patch 把文档值原样写回了对象，于是对象此刻在 base 上、
   * 而账本还记着一份偏移。下一帧 `delta = wanted − previous = 0`，位置就停在 base——
   * **爆炸塌了，而没有任何报错**。把账本清成 0，下一帧 `delta = wanted`，偏移自动补回
   * （D29 逐字：「被 patch 覆盖后下一帧自动补回」）。
   *
   * 按节点清、不整片清：没被 patch 的成员仍然停在 `base + offset` 上，把它们的账本
   * 也清掉会让下一帧再叠一次，位置直接翻倍。
   */
  forgetApplied(nodeId: string): void {
    for (const state of this.groups.values()) state.applied.delete(nodeId)
  }

  /**
   * 位移缓存失效。**批次里出现任何 `nodes` 路径就整片清掉。**
   *
   * 不做逐组失效：位移是全组成员锚点的函数（radial 走质心、axis 走沿轴名次），
   * 改一个成员的 `transform.p` 会动到同组**其余每一个**成员的位移。按 nodeId 精确
   * 失效要先知道它属于哪个组，而那份归属本身也可能刚被这批 patch 改掉。
   */
  invalidate(): void {
    this.offsets.clear()
  }

  /**
   * 全部复位。`resetScene` 的第 10 步。
   *
   * **不只是把位置写回文档值**：还要把 `applied` 与系数清干净，否则下一帧 `update`
   * 会拿着上一帧的账本再减一次，位置从第二帧开始飘。「回到文档值」那条断言在
   * 只写位置的实现下也是绿的，坏的是第二帧。
   */
  reset(doc: SceneDocument): void {
    for (const [groupNodeId, state] of this.groups) {
      state.factor = 0
      this.settle(state, false)
      this.applyGroup(doc, groupNodeId, state)
    }
    this.groups.clear()
    this.offsets.clear()
  }

  /* --- 内部 --------------------------------------------------------------- */

  private stateOf(groupNodeId: string): GroupState {
    const existing = this.groups.get(groupNodeId)
    if (existing) return existing
    const created: GroupState = { factor: 0, applied: new Map(), transition: null }
    this.groups.set(groupNodeId, created)
    return created
  }

  /** 结束当前过渡。`completed` 决定 resolve 还是 reject。 */
  private settle(state: GroupState, completed: boolean): void {
    const transition = state.transition
    if (!transition) return
    state.transition = null
    if (transition.signal && transition.onAbort) {
      transition.signal.removeEventListener('abort', transition.onAbort)
    }
    if (completed) transition.resolve()
    // §5.3 · 取消不是错误，执行器会吞掉这个 rejection
    else transition.reject(new AbortError())
  }

  /** 把一个分组的当前系数写进场景图。这是那三行叠加逻辑的所在。 */
  private applyGroup(doc: SceneDocument, groupNodeId: string, state: GroupState): void {
    const offsets = this.offsetsOf(doc, groupNodeId)
    for (const [nodeId, offset] of offsets) {
      const object = this.graph.objectFor(nodeId)
      if (!object) continue
      const previous = state.applied.get(nodeId) ?? ZERO
      const wanted: Vec3 = [offset[0] * state.factor, offset[1] * state.factor, offset[2] * state.factor]
      // base = position − 上一帧我加的；position = base + 这一帧要加的
      _v.set(wanted[0] - previous[0], wanted[1] - previous[1], wanted[2] - previous[2])
      object.position.add(_v)
      object.updateMatrix()
      state.applied.set(nodeId, wanted)
    }
    // 系数归零之后账本也该空：留着它会让「这个组还在被叠加」的判断永远为真
    if (state.factor === 0) state.applied.clear()
  }

  private offsetsOf(doc: SceneDocument, groupNodeId: string): Map<string, Vec3> {
    const cached = this.offsets.get(groupNodeId)
    if (cached) return cached
    const computed = explodeOffsets(doc, groupNodeId)
    this.offsets.set(groupNodeId, computed)
    return computed
  }
}
