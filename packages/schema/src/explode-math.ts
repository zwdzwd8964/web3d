import type { SceneDocument } from './document.js'
import type { Node } from './node.js'
import type { Vec3 } from './primitives.js'

/**
 * T-238 · 爆炸位移的纯函数。**两个运行时共用这一份**。
 *
 * 返回每个成员在 `factor === 1` 时相对父节点的位移。因子由运行时逐帧叠加（D29），
 * 所以这里没有 `factor` 参数——把它放进来会让「算一次、乘很多次」变成「每帧全算一遍」，
 * 而这个函数在 1000 个零件上要跑 60 次/秒。
 *
 * 零 three、零 DOM、零 `Date.now()`：它是 C8 的一部分，得能在纯 Node 里被穷举。
 */

const ZERO: Vec3 = [0, 0, 0]

/** 轴的容差。低于它就当成零向量。 */
const EPSILON = 1e-9

/**
 * 归一化，零向量兜底成 `[0,1,0]`。
 *
 * **判零必须在除法之前。** 先归一化再判长度会得到 `0/0 = NaN`，而 NaN 沿着 transform
 * 一路传下去的表现是整个分组从画面上消失——没有报错，没有日志，就是不见了。
 * 完整性检查 I23 会在发布前把零向量拦成 error，但编辑器里改到一半的文档随时是零向量。
 */
function normalizeAxis(axis: Vec3): Vec3 {
  const [x, y, z] = axis
  const length = Math.sqrt(x * x + y * y + z * z)
  if (!Number.isFinite(length) || length < EPSILON) return [0, 1, 0]
  return [x / length, y / length, z / length]
}

const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]

/** 成员的锚点平均。空数组返回原点——调用方已经保证不会走到那里。 */
function centroidOf(members: readonly Node[]): Vec3 {
  if (members.length === 0) return ZERO
  let x = 0
  let y = 0
  let z = 0
  for (const node of members) {
    x += node.transform.p[0]
    y += node.transform.p[1]
    z += node.transform.p[2]
  }
  const n = members.length
  return [x / n, y / n, z / n]
}

/**
 * 分组的成员。
 *
 * `children` 可以由调用方传进来（运行时已经有一份按父分好的表，没必要再过一遍全量节点）。
 * 缺省时按 `parent === groupNodeId` 过滤——**按 id，不按 name**（铁律 3）。
 */
function membersOf(doc: SceneDocument, groupNodeId: string, children?: readonly Node[]): readonly Node[] {
  return children ?? doc.nodes.filter((node) => node.parent === groupNodeId)
}

/**
 * 每个成员在 `factor === 1` 时相对父的位移。
 *
 * - **radial**：`(锚点 − 质心) × gain`。两件的相对位置因此变成原来的 `1 + gain` 倍，
 *   而这正是「散开」在几何上的定义——测试断的是这个性质，不是某个具体数字。
 * - **axis**：沿轴排开，第 `k` 名（共 `n` 名）得到 `axis × spacing × (k − (n−1)/2)`。
 *   中位件恰为 0，相邻件间距恰为 `spacing`，整组以质心为中心对称。
 *
 * `explodeOffset` 非空时**整条替换**派生值，不是逐分量合并：用户钉一个零件的位置，
 * 钉的是最终位置，不是「在算出来的基础上再挪一点」。
 *
 * @param doc 文档
 * @param groupNodeId 分组节点的 id
 * @param children 成员，缺省时从 `doc.nodes` 里按 `parent` 过滤
 * @returns 成员 id → 位移。分组不存在、没有 `explode`、或没有成员时返回空 Map
 */
export function explodeOffsets(
  doc: SceneDocument,
  groupNodeId: string,
  children?: readonly Node[],
): Map<string, Vec3> {
  const out = new Map<string, Vec3>()

  const group = doc.nodes.find((node) => node.id === groupNodeId)
  const explode = group?.explode
  if (explode == null) return out

  const members = membersOf(doc, groupNodeId, children)
  if (members.length === 0) return out

  if (explode.mode === 'radial') {
    const centroid = centroidOf(members)
    for (const node of members) {
      const p = node.transform.p
      const derived: Vec3 = [
        (p[0] - centroid[0]) * explode.gain,
        (p[1] - centroid[1]) * explode.gain,
        (p[2] - centroid[2]) * explode.gain,
      ]
      out.set(node.id, node.explodeOffset ?? derived)
    }
    return out
  }

  const axis = normalizeAxis(explode.axis)

  /**
   * 三级排序：**沿轴投影 → `order` → `id`**。
   *
   * 只按投影排是不够的：一组锚点全部重合的零件（这是常态，比如同轴装配的一摞垫片）
   * 投影全相等，排序结果就交给 `Array.prototype.sort` 的实现细节了——同一份文档在两次
   * 调用之间可能给出不同的名次，而用户看到的是零件每次「散开」的顺序都不一样。
   *
   * `order` 是用户在层级树里排的顺序，是第二自然的答案；`id` 是最后的确定性兜底。
   */
  const ranked = [...members].sort((a, b) => {
    const da = dot(a.transform.p, axis)
    const db = dot(b.transform.p, axis)
    // 带容差判等：浮点噪声会让「投影相等」变成一级伪判别，后两级就永远走不到
    if (Math.abs(da - db) > EPSILON) return da - db
    if (a.order !== b.order) return a.order - b.order
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  })

  const middle = (ranked.length - 1) / 2
  ranked.forEach((node, rank) => {
    const shift = explode.spacing * (rank - middle)
    const derived: Vec3 = [axis[0] * shift, axis[1] * shift, axis[2] * shift]
    out.set(node.id, node.explodeOffset ?? derived)
  })
  return out
}
