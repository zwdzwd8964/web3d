import { getActiveRuntime } from './runtime-registry.js'

/**
 * T-251 · 「暂时关闭剖切」的会话开关（[ADR-0040](../../../../docs/adr/0040-暂时关闭剖切是渲染开关不是文档编辑.md)）。
 *
 * 它与「在层级树里隐藏一把刀」是两件事：
 *
 * | | 改 `node.visible` | 这个开关 |
 * |---|---|---|
 * | 进撤销栈 | 是 | **否** |
 * | 发布出去 | 跟着走 | **不跟** |
 * | 刷新之后 | 保留 | **丢弃** |
 *
 * 把后者做成前者，会让「看一眼」进撤销栈——用户 Ctrl+Z 撤销掉的是一次「看」，
 * 正是 D29 拒绝把爆炸系数写进文档时逐字给出的那个理由。
 *
 * 形状抄 `snap.ts` 与 `explode-tool.ts`，**包括那条 `reset*()` 测试缝**。
 */

let disabled = false
let listeners: ((disabled: boolean) => void)[] = []

/** 剖切此刻被临时关掉了吗。 */
export const isSectionViewDisabled = (): boolean => disabled

/**
 * 开 / 关。
 *
 * **推给运行时的是三态里的两态**：`false`（强制关）与 `null`（交还文档）。不推 `true`，
 * 因为「强制开」会让层级树里被隐藏的那把刀又开始切东西——用户隐藏它就是不想要它。
 */
export function setSectionViewDisabled(next: boolean): boolean {
  disabled = next
  getActiveRuntime()?.setSectionsEnabled(next ? false : null)
  for (const listener of listeners) listener(disabled)
  return disabled
}

/** 订阅。返回反订阅。 */
export function onSectionViewChange(listener: (disabled: boolean) => void): () => void {
  listeners.push(listener)
  return () => {
    listeners = listeners.filter((l) => l !== listener)
  }
}

/** 测试缝。生产代码从不需要重置一个会话设置。 */
export function resetSectionView(): void {
  disabled = false
  listeners = []
}
