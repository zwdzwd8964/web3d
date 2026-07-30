import type { Easing, Vec3 } from '@w3/schema'
import { EASINGS, createTweenAnimation, defaultFactoryContext } from '@w3/schema'
import { useDocumentActions, useDocumentSelector } from '../store/StoreContext.js'
import { NumberField, TextField } from '../widgets/NumberField.js'

/**
 * T-068 · the animation panel.
 *
 * Deliberately NOT a timeline with curve editing. R03 identifies animation authoring as
 * the single most inflatable line item on the contract, and the closed `kind` union is
 * the engineering defence: adding a third kind requires a schema change, which
 * mechanically triggers triage Q3 instead of a quiet weekend of scope creep.
 *
 * So the panel offers exactly what SCHEMA_SPEC §6.2 defines: pick targets, record an end
 * state, set a duration and an easing.
 */
export function AnimationPanel() {
  const doc = useDocumentSelector((s) => s.doc)
  const selection = useDocumentSelector((s) => s.selection)
  const { commit } = useDocumentActions()

  const create = () => {
    if (selection.length === 0) return
    const animation = createTweenAnimation({
      name: `动画 ${doc.animations.length + 1}`,
      // `from` omitted on purpose: capture the live state at playback start (§6.2), which
      // is what almost every authored tween actually wants.
      targets: selection.map((nodeId) => {
        const node = doc.nodes.find((n) => n.id === nodeId)
        return { nodeId, to: { p: (node ? [...node.transform.p] : [0, 0, 0]) as Vec3 } }
      }),
      duration: 1.2,
      easing: 'easeInOutCubic',
      ctx: defaultFactoryContext,
    })
    commit('新建补间动画', (draft) => void draft.animations.push(animation))
  }

  return (
    <div className="subpanel">
      <div className="subpanel__head">
        动画
        <button type="button" className="tbtn" disabled={selection.length === 0} onClick={create}>
          用选中对象新建补间
        </button>
      </div>
      {doc.animations.length === 0 ? (
        <p className="panel__empty">选中对象后新建补间动画</p>
      ) : (
        <ul className="simple-list">
          {doc.animations.map((animation) => (
            <li key={animation.id} className="anim-row">
              <TextField
                label=""
                value={animation.name}
                onCommit={(name) =>
                  commit('重命名动画', (draft) => {
                    const target = draft.animations.find((a) => a.id === animation.id)
                    if (target) target.name = name
                  })
                }
              />
              {animation.kind === 'tween' ? (
                <>
                  <NumberField
                    label="时长(秒)"
                    value={animation.duration}
                    step={0.1}
                    min={0.01}
                    onCommit={(duration) =>
                      commit('调整 动画时长', (draft) => {
                        const target = draft.animations.find((a) => a.id === animation.id)
                        if (target?.kind === 'tween') target.duration = duration
                      })
                    }
                  />
                  <select
                    className="field__input"
                    value={animation.easing}
                    onChange={(event) =>
                      commit('调整 缓动', (draft) => {
                        const target = draft.animations.find((a) => a.id === animation.id)
                        if (target?.kind === 'tween') target.easing = event.target.value as Easing
                      })
                    }
                  >
                    {EASINGS.map((easing) => (
                      <option key={easing} value={easing}>
                        {easing}
                      </option>
                    ))}
                  </select>
                  <span className="num">{animation.targets.length} 个目标</span>
                  <button
                    type="button"
                    className="tbtn"
                    title="把目标对象的当前位置记为终点"
                    onClick={() =>
                      commit('记录动画终点', (draft) => {
                        const target = draft.animations.find((a) => a.id === animation.id)
                        if (target?.kind !== 'tween') return
                        for (const t of target.targets) {
                          const node = draft.nodes.find((n) => n.id === t.nodeId)
                          if (node) t.to = { p: [...node.transform.p] as Vec3 }
                        }
                      })
                    }
                  >
                    记为终点
                  </button>
                </>
              ) : (
                <span className="num">导入片段 · {animation.clipName}</span>
              )}
              <button
                type="button"
                className="tbtn"
                onClick={() =>
                  commit('删除动画', (draft) => {
                    draft.animations = draft.animations.filter((a) => a.id !== animation.id)
                  })
                }
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
