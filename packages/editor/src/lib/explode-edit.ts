import { DEFAULT_EXPLODE } from '@w3/schema'
import type { Explode, SceneDocument, Vec3 } from '@w3/schema'

/**
 * T-247 · 爆炸分组的 commit 构造器。
 *
 * 形状与 `effects-edit.ts` / `environment-edit.ts` 逐字同形：收一份 immer draft，
 * **整块替换** `node.explode`。逐字段赋值会产生一串 patch，而 `apply-patch` 的
 * `case 'explode'` 对每一条都要清一次位移缓存（拖一次滑块清几十次）。
 */

/** 找到那个节点。找不到返回 null——调用方一律先判空，不假设选择集与文档同步。 */
function nodeOf(draft: SceneDocument, nodeId: string) {
  return draft.nodes.find((n) => n.id === nodeId) ?? null
}

/**
 * 设为爆炸分组：写一份默认配置。
 *
 * 默认值取 `DEFAULT_EXPLODE`，**不在这里另抄一份**——抄一份的结果是 schema 的默认值改了
 * 而面板没跟上，两处各说各的（T-215 的高亮预设就是这么漂的）。
 */
export function makeExplodeGroup(draft: SceneDocument, nodeId: string): void {
  const node = nodeOf(draft, nodeId)
  if (!node) return
  node.explode = { ...DEFAULT_EXPLODE }
}

/**
 * 取消爆炸分组。
 *
 * **不动子件的 `explodeOffset`。** 那是用户一个一个钉出来的位置，可能花了很久；
 * 顺手删掉别人的数据，而撤销栈里只有一条「取消爆炸分组」——用户按 Ctrl+Z 会以为
 * 全都回来了。真要清理，那是另一个显式动作。
 */
export function clearExplodeGroup(draft: SceneDocument, nodeId: string): void {
  const node = nodeOf(draft, nodeId)
  if (!node) return
  node.explode = null
}

/** 改一组爆炸参数。 */
export function setExplodeParams(
  draft: SceneDocument,
  nodeId: string,
  patch: Partial<Pick<Explode, 'mode' | 'gain' | 'axis' | 'spacing' | 'easing'>>,
): void {
  const node = nodeOf(draft, nodeId)
  if (!node?.explode) return
  node.explode = { ...node.explode, ...patch }
}

/** 改排布轴的一个分量。**只写这一维**，另外两维保持用户调好的值。 */
export function setExplodeAxis(draft: SceneDocument, nodeId: string, axis: 0 | 1 | 2, value: number): void {
  const node = nodeOf(draft, nodeId)
  if (!node?.explode) return
  const next = [...node.explode.axis] as Vec3
  next[axis] = value
  node.explode = { ...node.explode, axis: next }
}
