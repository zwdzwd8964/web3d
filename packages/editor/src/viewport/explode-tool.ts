import { getActiveRuntime } from './runtime-registry.js'

/**
 * T-248 · 爆炸预览工具态。
 *
 * ## 为什么它不进文档
 *
 * 「现在炸到几成」是运行时瞬态（D29），与「当前播放进度」同类——铁律 1 明写的那条例外。
 * 进文档的话：要么它进撤销栈（用户 Ctrl+Z 撤销掉的是一次「看」），要么它绕过 commit
 * 通道（反模式 A1）；而且 B13 要求退出预览时 transform 还原，一个进了文档的 factor 会让
 * 「还原到什么」**变得没有答案**。
 *
 * ## 也不进 localStorage
 *
 * 与吸附（`snap.ts`）不同：吸附是一项**偏好**，用户希望它跨会话记住；爆炸工具态是一次
 * **正在进行的操作**。刷新之后还停在半炸开的姿态，而层级树里看不出任何异常——用户会
 * 以为文档坏了。
 *
 * 形状逐字抄 `snap.ts:35-58`，**包括那条 `reset*()` 测试缝**：模块级状态不给重置入口的话，
 * 测试之间会互相串（第二条测试拿到的是第一条留下的 factor）。
 */

export interface ExplodeToolState {
  /** 正在预览哪个爆炸分组。null = 工具态关闭。 */
  readonly groupNodeId: string | null
  /** 系数。工具态关闭时恒为 0。 */
  readonly factor: number
}

const DEFAULT: ExplodeToolState = { groupNodeId: null, factor: 0 }

let current: ExplodeToolState = DEFAULT
let listeners: ((state: ExplodeToolState) => void)[] = []

export const getExplodeTool = (): ExplodeToolState => current

/**
 * 打开工具态并把系数推给运行时。
 *
 * **`durationS: 0`**：滑块的每一帧都要立刻见效，走过渡会让拖拽变成一串互相打断的动画
 * （每一次打断还各自 reject 一个 AbortError）。
 */
export function setExplodeTool(next: Partial<ExplodeToolState>): ExplodeToolState {
  const previous = current
  current = { ...current, ...next }

  const runtime = getActiveRuntime()
  if (runtime) {
    // 换了分组：先把上一个归零，否则上一个分组停在半炸开的姿态上没人管
    if (previous.groupNodeId !== null && previous.groupNodeId !== current.groupNodeId) {
      void runtime.setExplode(previous.groupNodeId, 0, { durationS: 0 }).catch(() => undefined)
    }
    if (current.groupNodeId !== null) {
      void runtime.setExplode(current.groupNodeId, current.factor, { durationS: 0 }).catch(() => undefined)
    }
  }

  for (const listener of listeners) listener(current)
  return current
}

/**
 * 关掉工具态并归零。
 *
 * **归零走运行时，不只是清 store**：只清 store 的话渲染器上的零件停在炸开的位置，
 * 而工具条已经不见了——用户既看不出为什么，也没有任何入口把它收回去。
 * 卡面把这一点写成了「断言渲染器位置，不是断言 store 的布尔量」。
 */
export function closeExplodeTool(): ExplodeToolState {
  return setExplodeTool({ groupNodeId: null, factor: 0 })
}

/** 订阅。返回反订阅。 */
export function onExplodeToolChange(listener: (state: ExplodeToolState) => void): () => void {
  listeners.push(listener)
  return () => {
    listeners = listeners.filter((l) => l !== listener)
  }
}

/** 测试缝。生产代码从不需要重置一个会话设置。 */
export function resetExplodeTool(): void {
  current = DEFAULT
  listeners = []
}
