import type { SceneDocument } from './document.js'
import type { Quat, Transform, Vec3 } from './primitives.js'

/**
 * T-258 · 改父保持世界位姿所需的全部矩阵数学。
 *
 * **在 schema 里，不在 core 里。** 这是一份纯数学：它只读 `transform` 与 `parent` 两个字段，
 * 不需要 three、不需要场景图、不需要渲染器。放进 core 会让「拖一行改父」这件事必须先有一个
 * 运行时——而层级树在文档还没加载完的时候就已经能拖了。
 *
 * ⚠ **矩阵一律列主序**（`m[0..3]` 是第 0 列），与 three 的 `Matrix4.elements` 同序。
 * 不是为了兼容 three——schema 不许认识 three——而是因为这份实现是照着同一套推导写的，
 * 换序会让每一处下标都要重新校对一遍，而下标错位在数值上表现为「大部分情况看着对」。
 *
 * ## 为什么 `sheared` 是返回值的一部分
 *
 * `{p, r, s}` 表达不了剪切。父节点带非均匀缩放、子节点又有旋转时，改父算出来的新局部矩阵
 * **一般不能**分解成平移·旋转·缩放——强行分解会得到一个看起来合理、但世界位姿已经变了的
 * transform。这种时候必须告诉用户，而不是悄悄给一个近似值：零件在画面上会跳一下，
 * 而他刚做的操作是「拖一行」，两件事在他眼里毫无关系。
 */

/**
 * 列主序 4×4 矩阵，16 个数。
 *
 * 写成定长元组而不是 `number[]`：这个包开着 `noUncheckedIndexedAccess`，数组下标的类型是
 * `number | undefined`，而这份文件里有几百处下标。元组让「下标 0..15 一定是 number」
 * 成为类型系统知道的事，顺带把「传进来一个 15 个数的数组」挡在编译期。
 */
export type Mat4 = readonly [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
]

/** 判定正交性的容差。`invert × multiply` 之后的干净矩阵实测在 1e-12 量级。 */
const SHEAR_EPSILON = 1e-6

/** 层级链的深度上限，防一份坏文档里的父子环把这里变成死循环。 */
const MAX_DEPTH = 512

/** 单位矩阵。**每次新建**——调用方会就地改。 */
export function identityMatrix(): Mat4 {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
}

/**
 * `M = T · R · S`，列主序。
 *
 * 顺序不可换：先缩放、再旋转、最后平移，这是 `TransformSchema` 三个字段的定义本身。
 */
export function composeMatrix(t: Transform): Mat4 {
  const [x, y, z, w] = t.r
  const [sx, sy, sz] = t.s
  const x2 = x + x
  const y2 = y + y
  const z2 = z + z
  const xx = x * x2
  const xy = x * y2
  const xz = x * z2
  const yy = y * y2
  const yz = y * z2
  const zz = z * z2
  const wx = w * x2
  const wy = w * y2
  const wz = w * z2

  return [
    (1 - (yy + zz)) * sx,
    (xy + wz) * sx,
    (xz - wy) * sx,
    0,
    (xy - wz) * sy,
    (1 - (xx + zz)) * sy,
    (yz + wx) * sy,
    0,
    (xz + wy) * sz,
    (yz - wx) * sz,
    (1 - (xx + yy)) * sz,
    0,
    t.p[0],
    t.p[1],
    t.p[2],
    1,
  ]
}

/** `a · b`，两者都是列主序。 */
export function multiplyMatrices(a: Mat4, b: Mat4): Mat4 {
  // 先解构再展开写，而不是双重循环 + 算术下标：`noUncheckedIndexedAccess` 下 `b[col * 4]`
  // 的类型是 `number | undefined`（TS 证不出算出来的下标在 0..15 里），而 `aRC` 这种名字
  // 让「哪一项乘哪一项」肉眼可查——矩阵乘法写错的典型形状是某一项行列下标对调。
  const [a11, a21, a31, a41, a12, a22, a32, a42, a13, a23, a33, a43, a14, a24, a34, a44] = a
  const [b11, b21, b31, b41, b12, b22, b32, b42, b13, b23, b33, b43, b14, b24, b34, b44] = b
  return [
    a11 * b11 + a12 * b21 + a13 * b31 + a14 * b41,
    a21 * b11 + a22 * b21 + a23 * b31 + a24 * b41,
    a31 * b11 + a32 * b21 + a33 * b31 + a34 * b41,
    a41 * b11 + a42 * b21 + a43 * b31 + a44 * b41,
    a11 * b12 + a12 * b22 + a13 * b32 + a14 * b42,
    a21 * b12 + a22 * b22 + a23 * b32 + a24 * b42,
    a31 * b12 + a32 * b22 + a33 * b32 + a34 * b42,
    a41 * b12 + a42 * b22 + a43 * b32 + a44 * b42,
    a11 * b13 + a12 * b23 + a13 * b33 + a14 * b43,
    a21 * b13 + a22 * b23 + a23 * b33 + a24 * b43,
    a31 * b13 + a32 * b23 + a33 * b33 + a34 * b43,
    a41 * b13 + a42 * b23 + a43 * b33 + a44 * b43,
    a11 * b14 + a12 * b24 + a13 * b34 + a14 * b44,
    a21 * b14 + a22 * b24 + a23 * b34 + a24 * b44,
    a31 * b14 + a32 * b24 + a33 * b34 + a34 * b44,
    a41 * b14 + a42 * b24 + a43 * b34 + a44 * b44,
  ]
}

/**
 * 逆矩阵，**奇异时返回 `null`**。
 *
 * 返回 `null` 而不是单位矩阵：一个缩放为 0 的父节点是可以合法存在于文档里的（用户把
 * scale 拖到了 0），此时「保持世界位姿」这件事没有答案。给单位矩阵会把子节点弹到世界原点。
 */
export function invertMatrix(m: Mat4): Mat4 | null {
  const [n11, n21, n31, n41, n12, n22, n32, n42, n13, n23, n33, n43, n14, n24, n34, n44] = m

  const t11 = n23 * n34 * n42 - n24 * n33 * n42 + n24 * n32 * n43 - n22 * n34 * n43 - n23 * n32 * n44 + n22 * n33 * n44
  const t12 = n14 * n33 * n42 - n13 * n34 * n42 - n14 * n32 * n43 + n12 * n34 * n43 + n13 * n32 * n44 - n12 * n33 * n44
  const t13 = n13 * n24 * n42 - n14 * n23 * n42 + n14 * n22 * n43 - n12 * n24 * n43 - n13 * n22 * n44 + n12 * n23 * n44
  const t14 = n14 * n23 * n32 - n13 * n24 * n32 - n14 * n22 * n33 + n12 * n24 * n33 + n13 * n22 * n34 - n12 * n23 * n34

  const det = n11 * t11 + n21 * t12 + n31 * t13 + n41 * t14
  if (det === 0 || !Number.isFinite(det)) return null
  const d = 1 / det

  return [
    t11 * d,
    (n24 * n33 * n41 - n23 * n34 * n41 - n24 * n31 * n43 + n21 * n34 * n43 + n23 * n31 * n44 - n21 * n33 * n44) * d,
    (n22 * n34 * n41 - n24 * n32 * n41 + n24 * n31 * n42 - n21 * n34 * n42 - n22 * n31 * n44 + n21 * n32 * n44) * d,
    (n23 * n32 * n41 - n22 * n33 * n41 - n23 * n31 * n42 + n21 * n33 * n42 + n22 * n31 * n43 - n21 * n32 * n43) * d,
    t12 * d,
    (n13 * n34 * n41 - n14 * n33 * n41 + n14 * n31 * n43 - n11 * n34 * n43 - n13 * n31 * n44 + n11 * n33 * n44) * d,
    (n14 * n32 * n41 - n12 * n34 * n41 - n14 * n31 * n42 + n11 * n34 * n42 + n12 * n31 * n44 - n11 * n32 * n44) * d,
    (n12 * n33 * n41 - n13 * n32 * n41 + n13 * n31 * n42 - n11 * n33 * n42 - n12 * n31 * n43 + n11 * n32 * n43) * d,
    t13 * d,
    (n14 * n23 * n41 - n13 * n24 * n41 - n14 * n21 * n43 + n11 * n24 * n43 + n13 * n21 * n44 - n11 * n23 * n44) * d,
    (n12 * n24 * n41 - n14 * n22 * n41 + n14 * n21 * n42 - n11 * n24 * n42 - n12 * n21 * n44 + n11 * n22 * n44) * d,
    (n13 * n22 * n41 - n12 * n23 * n41 - n13 * n21 * n42 + n11 * n23 * n42 + n12 * n21 * n43 - n11 * n22 * n43) * d,
    t14 * d,
    (n13 * n24 * n31 - n14 * n23 * n31 + n14 * n21 * n33 - n11 * n24 * n33 - n13 * n21 * n34 + n11 * n23 * n34) * d,
    (n14 * n22 * n31 - n12 * n24 * n31 - n14 * n21 * n32 + n11 * n24 * n32 + n12 * n21 * n34 - n11 * n22 * n34) * d,
    (n12 * n23 * n31 - n13 * n22 * n31 + n13 * n21 * n32 - n11 * n23 * n32 - n12 * n21 * n33 + n11 * n22 * n33) * d,
  ]
}

/** 一次分解的结果。 */
export interface Decomposed {
  readonly transform: Transform
  /**
   * 这个矩阵**分解不回去**。
   *
   * `true` 表示上面那个 `transform` 是近似值：重新 compose 得不到原矩阵。成因只有一个——
   * 3×3 部分的三根列向量不再互相垂直（剪切），而 `{p,r,s}` 没有表达剪切的位置。
   */
  readonly sheared: boolean
}

/**
 * 把一个矩阵分解成 `{p, r, s}`，并说明这次分解是不是精确的。
 *
 * 负行列式（镜像）按 three 的老办法处理：把 x 轴的缩放取负。它不是剪切——镜像仍然能被
 * `{p,r,s}` 精确表达。
 */
export function decomposeMatrix(m: Mat4): Decomposed {
  const c0: Vec3 = [m[0], m[1], m[2]]
  const c1: Vec3 = [m[4], m[5], m[6]]
  const c2: Vec3 = [m[8], m[9], m[10]]

  let sx = length3(c0)
  const sy = length3(c1)
  const sz = length3(c2)

  // 判剪切在归一化之前：归一化之后每根轴长度都是 1，正交性信息还在，但零长度轴已经变成 NaN。
  const degenerate = sx < SHEAR_EPSILON || sy < SHEAR_EPSILON || sz < SHEAR_EPSILON
  const sheared = degenerate || !orthogonal(c0, c1, c2, sx, sy, sz)

  if (degenerate) {
    // 无法归一化，旋转取单位四元数。缩放照实报——它是用户真的填进去的那个 0。
    return { transform: { p: [m[12], m[13], m[14]], r: [0, 0, 0, 1], s: [sx, sy, sz] }, sheared: true }
  }

  if (determinant3(m) < 0) sx = -sx

  const r = quaternionFromBasis(
    [m[0] / sx, m[1] / sx, m[2] / sx],
    [m[4] / sy, m[5] / sy, m[6] / sy],
    [m[8] / sz, m[9] / sz, m[10] / sz],
  )
  return { transform: { p: [m[12], m[13], m[14]], r, s: [sx, sy, sz] }, sheared }
}

/**
 * 一个节点的世界矩阵，沿 `parent` 链一路乘上去。
 *
 * 节点不存在时返回单位矩阵——不抛异常：这个函数在拖拽过程中会被高频调用，而拖拽的
 * 目标随时可能已经被别处删掉了。
 */
export function worldMatrixOf(doc: SceneDocument, nodeId: string | null): Mat4 {
  if (nodeId === null) return identityMatrix()
  const byId = new Map(doc.nodes.map((n) => [n.id, n]))
  const chain: Transform[] = []
  let cursor: string | null = nodeId
  for (let depth = 0; cursor !== null && depth < MAX_DEPTH; depth++) {
    const node = byId.get(cursor)
    if (!node) break
    chain.push(node.transform)
    cursor = node.parent
  }

  // 从根往下乘：世界 = 根 · … · 自己。`chain` 是从自己往上收的，所以反着遍历。
  let out = identityMatrix()
  for (const transform of [...chain].reverse()) out = multiplyMatrices(out, composeMatrix(transform))
  return out
}

/**
 * 把 `nodeId` 挂到 `newParent` 下面，算出**世界位姿不变**所需的新局部 transform。
 *
 * 这是「拖一行改父」与「零件在画面上跳一下」之间唯一的那一步。不做这一步的话，
 * 一个原本在世界原点旁边的零件被拖进一个带偏移的分组，会瞬间跑到那个偏移量上去——
 * 而用户做的动作是「把一行拖到另一行下面」。
 *
 * @returns 新的局部 transform 与它是否只是近似值；节点不存在或新父不可逆时返回 `null`。
 */
export function reparentPreservingWorld(
  doc: SceneDocument,
  nodeId: string,
  newParent: string | null,
): Decomposed | null {
  const node = doc.nodes.find((n) => n.id === nodeId)
  if (!node) return null

  const world = worldMatrixOf(doc, nodeId)
  const parentWorld = worldMatrixOf(doc, newParent)
  const inverse = invertMatrix(parentWorld)
  // 新父的缩放里有 0：世界位姿在它下面没法表达，交给调用方决定（今天是保持原 transform）。
  if (!inverse) return null

  return decomposeMatrix(multiplyMatrices(inverse, world))
}

function length3(v: Vec3): number {
  return Math.hypot(v[0], v[1], v[2])
}

/** 三根列向量两两垂直吗。传进归一化用的长度，省三次开方。 */
function orthogonal(c0: Vec3, c1: Vec3, c2: Vec3, l0: number, l1: number, l2: number): boolean {
  const dot = (a: Vec3, b: Vec3, la: number, lb: number) =>
    Math.abs((a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / (la * lb))
  return dot(c0, c1, l0, l1) < SHEAR_EPSILON && dot(c0, c2, l0, l2) < SHEAR_EPSILON && dot(c1, c2, l1, l2) < SHEAR_EPSILON
}

/** 3×3 部分的行列式。负值 = 含镜像。 */
function determinant3(m: Mat4): number {
  return (
    m[0] * (m[5] * m[10] - m[6] * m[9]) -
    m[4] * (m[1] * m[10] - m[2] * m[9]) +
    m[8] * (m[1] * m[6] - m[2] * m[5])
  )
}

/**
 * 从三根**已归一化**的基向量取四元数。
 *
 * 走四分支的 Shepperd 法而不是单一公式：单一公式在 `trace` 接近 −1 时要除一个接近 0 的数，
 * 表现是「转到某个角度附近，零件突然乱飞」——一种只在特定朝向复现、极难归因的缺陷。
 */
function quaternionFromBasis(c0: Vec3, c1: Vec3, c2: Vec3): Quat {
  const [m11, m21, m31] = c0
  const [m12, m22, m32] = c1
  const [m13, m23, m33] = c2
  const trace = m11 + m22 + m33

  if (trace > 0) {
    const s = 0.5 / Math.sqrt(trace + 1)
    return [(m32 - m23) * s, (m13 - m31) * s, (m21 - m12) * s, 0.25 / s]
  }
  if (m11 > m22 && m11 > m33) {
    const s = 2 * Math.sqrt(1 + m11 - m22 - m33)
    return [0.25 * s, (m12 + m21) / s, (m13 + m31) / s, (m32 - m23) / s]
  }
  if (m22 > m33) {
    const s = 2 * Math.sqrt(1 + m22 - m11 - m33)
    return [(m12 + m21) / s, 0.25 * s, (m23 + m32) / s, (m13 - m31) / s]
  }
  const s = 2 * Math.sqrt(1 + m33 - m11 - m22)
  return [(m13 + m31) / s, (m23 + m32) / s, 0.25 * s, (m21 - m12) / s]
}
