import { useEffect, useState } from 'react'
import { useDocumentSelector } from '../store/StoreContext.js'
import { closeExplodeTool, getExplodeTool, onExplodeToolChange, setExplodeTool } from './explode-tool.js'
import type { ExplodeToolState } from './explode-tool.js'

/**
 * T-248 · 爆炸预览的滑块。
 *
 * 与 `SnapToolbar` 同一条理由读模块级会话 store 而不是自己持有状态：属性面板要据此
 * 把 transform 变只读、T-249 的「记录当前偏移」要据此算 `位移 / factor`，而它们都不是
 * 这个组件的子树。**一个设置两个所有者**，就是「工具条上写着 0.5、拖出来却是自由」的来源。
 *
 * ⚠ 系数**不进文档、也不进 localStorage**。与吸附不同：吸附是一项偏好，用户希望跨会话
 * 记住；爆炸工具态是一次正在进行的操作，刷新之后还停在半炸开的姿态而层级树里看不出
 * 任何异常，用户会以为文档坏了。
 */
export function ExplodeToolbar() {
  const nodes = useDocumentSelector((s) => s.doc.nodes)
  const [tool, setLocal] = useState<ExplodeToolState>(getExplodeTool)
  useEffect(() => onExplodeToolChange(setLocal), [])

  const groups = nodes.filter((n) => n.explode !== null)

  // 文档里一个爆炸分组都没有时整条不渲染：一个永远只有「（无）」一项的下拉框，
  // 只会让人以为功能坏了
  if (groups.length === 0) return null

  return (
    <div className="seg" data-testid="explode-toolbar" title="爆炸预览只影响画面，不进文档">
      <select
        className="field"
        data-testid="explode-tool-group"
        value={tool.groupNodeId ?? ''}
        onChange={(e) => {
          const id = e.target.value
          if (id === '') closeExplodeTool()
          else setExplodeTool({ groupNodeId: id, factor: tool.factor || 1 })
        }}
      >
        <option value="">爆炸预览：关</option>
        {groups.map((group) => (
          <option key={group.id} value={group.id}>
            {group.name}
          </option>
        ))}
      </select>

      {tool.groupNodeId !== null && (
        <input
          type="range"
          data-testid="explode-tool-factor"
          min={0}
          max={5}
          step={0.05}
          value={tool.factor}
          onChange={(e) => setExplodeTool({ factor: Number(e.target.value) })}
        />
      )}
    </div>
  )
}
