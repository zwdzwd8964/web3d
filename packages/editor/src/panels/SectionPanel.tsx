import { useEffect, useMemo, useState } from 'react'
import { addSectionPlane, alignSectionTo, flipSection, setSectionSize } from '../lib/section-edit.js'
import { useDocumentActions, useDocumentSelector } from '../store/StoreContext.js'
import {
  isSectionViewDisabled,
  onSectionViewChange,
  setSectionViewDisabled,
} from '../viewport/section-view.js'
import { NumberField } from '../widgets/NumberField.js'

/**
 * T-251 · 剖切平面面板。
 *
 * 三段：新建入口、选中那把刀的参数、以及「暂时关闭剖切」的会话开关。
 *
 * **新建入口放在这里，不在层级树里。** 卡面写「与『新建灯光』同位置」，而实测「新建灯光」
 * 根本不在层级树里——它在资源库面板（`LibraryPanel` 的模板格子）。层级树全文没有任何
 * 创建入口。一把刀不是「资源」，它没有可挑的模板，所以给它自己的面板段落，与
 * 「场景效果」并列。
 */
export function SectionPanel() {
  const nodes = useDocumentSelector((s) => s.doc.nodes)
  const selection = useDocumentSelector((s) => s.selection)
  const { commit, preview, previewStart, previewCommit, select } = useDocumentActions()

  const [viewDisabled, setViewDisabled] = useState(isSectionViewDisabled)
  useEffect(() => onSectionViewChange(setViewDisabled), [])

  const planes = useMemo(() => nodes.filter((n) => n.section !== null), [nodes])
  const single = useMemo(() => {
    if (selection.length !== 1) return null
    const node = nodes.find((n) => n.id === selection[0])
    return node?.section ? node : null
  }, [nodes, selection])

  const create = () => {
    let created: string | null = null
    commit('新建剖切平面', (draft) => {
      // 落在原点前方一点：落在原点的话它多半正好在模型内部或脚下，用户看不见自己
      // 刚建的东西（与「新建灯光要抬高」同一个理由）
      created = addSectionPlane(draft, { position: [0, 0.8, 0] }).id
    })
    if (created) select([created])
  }

  return (
    <div className="subpanel" data-testid="section-panel">
      <div className="subpanel__head">剖切</div>

      <button type="button" className="tbtn" data-testid="section-create" onClick={create}>
        新建剖切平面
      </button>

      {planes.length > 0 && (
        <label className="row">
          <span>暂时关闭剖切</span>
          <input
            type="checkbox"
            data-testid="section-view-disabled"
            checked={viewDisabled}
            onChange={(e) => setSectionViewDisabled(e.target.checked)}
          />
        </label>
      )}
      {viewDisabled && (
        <div className="hint" data-testid="section-view-hint">
          只影响你现在看到的画面：不进文档、不进撤销栈，刷新后自动恢复
        </div>
      )}

      {single?.section && (
        <>
          <div className="subpanel__head">选中的平面</div>
          <NumberField
            label="宽度"
            value={single.section.size[0]}
            min={0.01}
            step={0.1}
            onPreviewStart={previewStart}
            onPreview={(v) => preview((d) => setSectionSize(d, single.id, [v, single.section!.size[1]!]))}
            onCommit={(v) => commit('调整剖切面宽度', (d) => setSectionSize(d, single.id, [v, single.section!.size[1]!]))}
            onPreviewEnd={() => previewCommit('调整剖切面宽度')}
          />
          <NumberField
            label="高度"
            value={single.section.size[1]}
            min={0.01}
            step={0.1}
            onPreviewStart={previewStart}
            onPreview={(v) => preview((d) => setSectionSize(d, single.id, [single.section!.size[0]!, v]))}
            onCommit={(v) => commit('调整剖切面高度', (d) => setSectionSize(d, single.id, [single.section!.size[0]!, v]))}
            onPreviewEnd={() => previewCommit('调整剖切面高度')}
          />
          {/* 尺寸只影响你看得见刀在哪，说清楚免得用户以为它决定切多大范围 */}
          <div className="hint">尺寸只影响指示矩形的大小，不影响切到哪里</div>

          <div className="seg">
            {(['x', 'y', 'z'] as const).map((axis) => (
              <button
                key={axis}
                type="button"
                data-testid={`section-align-${axis}`}
                onClick={() => commit(`剖切面对齐 ${axis.toUpperCase()}`, (d) => alignSectionTo(d, single.id, axis))}
              >
                对齐 {axis.toUpperCase()}
              </button>
            ))}
            <button
              type="button"
              data-testid="section-flip"
              onClick={() => commit('翻转剖切面', (d) => flipSection(d, single.id))}
            >
              翻转
            </button>
          </div>
        </>
      )}
    </div>
  )
}
