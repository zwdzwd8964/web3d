import type { SceneDocument } from '@w3/schema'

/** 握手时告诉宿主「这份场景里有什么」。纯函数，零副作用。 */
export interface SceneSummary {
  readonly sceneId: string
  readonly name: string
  readonly nodeCount: number
  readonly hotspotCount: number
  readonly viewpointCount: number
  /** 变量 id 与它们的默认值。宿主据此知道有哪些开关可以拨。 */
  readonly variables: readonly { readonly id: string; readonly name: string }[]
}

/**
 * T-271 · 把一份文档摊成握手时要报的几个数。
 *
 * **只报 id 与名字，不报变量的当前值**：握手发生在场景加载完的那一刻，而值随后每一帧
 * 都可能变。报一个会立刻过期的值，宿主会理所当然地把它当成初始状态缓存起来。
 * 要值就调 `getVariable`。
 */
export function summarizeScene(doc: SceneDocument): SceneSummary {
  return {
    sceneId: doc.sceneId,
    name: doc.name,
    nodeCount: doc.nodes.length,
    hotspotCount: doc.hotspots.length,
    viewpointCount: doc.viewpoints.length,
    variables: doc.variables.map((v) => ({ id: v.id, name: v.name })),
  }
}
