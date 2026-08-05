import { appendNode, identityTransform } from '@w3/schema'
import type { Node, SceneDocument, Vec3 } from '@w3/schema'

/**
 * T-251 · 剖切平面的 commit 构造器。
 *
 * 剖切面是节点的第四种承载体（X-03），所以「新建」就是往文档里加一个 `section` 非空的
 * 节点——没有任何新集合、没有新动作。形状与 `light-edit.ts` 的 `addLight` 逐字同形。
 */

/** 平面指示矩形的默认尺寸（米）。够大能看见，够小不挡视线。 */
const DEFAULT_SIZE: [number, number] = [4, 4]

/**
 * 新建一个剖切平面。
 *
 * `position` 由调用方给（落在相机前方一段距离）：**落在原点的话，它多半正好在模型
 * 内部或脚下**，用户看不见自己刚建的东西，与「新建灯光要抬高」是同一个理由。
 *
 * 默认朝向是单位四元数——法线 +Z，切掉 z 小的那一半。**不预先倾斜**：与灯光不同，
 * 一把刀没有「朝哪一边才有用」的通用答案，而面板上的「对齐 X/Y/Z」是给这件事的入口。
 */
export function addSectionPlane(draft: SceneDocument, options: { position?: Vec3; name?: string } = {}): Node {
  const node = appendNode(draft, {
    name: options.name ?? '剖切平面',
    transform: { ...identityTransform(), p: [...(options.position ?? [0, 0, 0])] as Vec3 },
    section: { scope: 'scene', size: [...DEFAULT_SIZE] },
  })
  // `appendNode` 只**造**节点、不挂进文档（与 `addLight` 逐字同形）。漏掉这一行的表现是
  // 「点了新建、撤销栈 +1、而层级树里什么都没多」——一次成功的空提交。
  draft.nodes.push(node)
  return node
}

/** 改指示矩形的尺寸。**只影响你看得见刀在哪，不影响裁剪结果。** */
export function setSectionSize(draft: SceneDocument, nodeId: string, size: [number, number]): void {
  const node = draft.nodes.find((n) => n.id === nodeId)
  if (!node?.section) return
  node.section = { ...node.section, size }
}

/**
 * 把法线对到某条世界轴上。
 *
 * 写的是 `transform.r`，因为**平面的法线就是节点的朝向**（X-03 让剖切这么便宜的原因）。
 * 局部法线是 +Z，所以这是「把 +Z 转到目标轴」的最短弧四元数。
 */
export function alignSectionTo(draft: SceneDocument, nodeId: string, axis: 'x' | 'y' | 'z'): void {
  const node = draft.nodes.find((n) => n.id === nodeId)
  if (!node?.section) return
  node.transform = { ...node.transform, r: [...ALIGNED[axis]] as [number, number, number, number] }
}

/**
 * 把法线翻到反面。
 *
 * 绕**局部 Y 轴**转 180°：这样 +Z 变成 −Z，而平面自身所在的那个面不变。绕 X 转也能
 * 翻法线，但会把矩形上下颠倒——尺寸不是正方形时看得出来。
 */
export function flipSection(draft: SceneDocument, nodeId: string): void {
  const node = draft.nodes.find((n) => n.id === nodeId)
  if (!node?.section) return
  const [x, y, z, w] = node.transform.r
  // q' = q * (0, 1, 0, 0)   —— 右乘 = 在局部空间里转
  node.transform = { ...node.transform, r: [w!, z!, -y!, -x!] as [number, number, number, number] }
}

/**
 * 「+Z 对到这条轴」的四元数，写成字面量而不是算出来的。
 *
 * 与 `light-edit.ts` 的 `TILTED_DOWN` 同一条理由：文档的初始状态要可读，改动它应当是
 * 一处可见的 diff，而不是一个变了的公式。
 */
const ALIGNED: Record<'x' | 'y' | 'z', readonly [number, number, number, number]> = {
  // 绕 Y 转 +90°：+Z → +X
  x: [0, Math.SQRT1_2, 0, Math.SQRT1_2],
  // 绕 X 转 −90°：+Z → +Y
  y: [-Math.SQRT1_2, 0, 0, Math.SQRT1_2],
  z: [0, 0, 0, 1],
}
