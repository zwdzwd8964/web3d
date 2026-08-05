import type { Easing, Vec3 } from '@w3/schema'
import { EASINGS, createImportedAnimation, createTweenAnimation, defaultFactoryContext } from '@w3/schema'
import { useMemo, useState } from 'react'
import { useDocumentActions, useDocumentSelector } from '../store/StoreContext.js'
import { previewAnimation, stopPreviewAnimation } from '../viewport/runtime-registry.js'
import { CheckField, NumberField, TextField } from '../widgets/NumberField.js'

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
 *
 * ## T-254 · imported 那一半的断链兑现
 *
 * 整条 `ClipPlayer` 栈（含 glTF 重名对象重绑算法、完整性检查、打包收集）建得很完整而
 * **零生产调用者**——T-068 的卡面明写要做「imported 类型可选 clip 与参数 + 预览播放」，
 * 两样都没落地，卡却标了 `[x]`。本卡只兑现断链：
 *
 * - **新建导入动画**：资产里一段动画都没有时整块不出现——一个永远只有「（无）」一项的
 *   下拉框只会让人以为功能坏了；
 * - imported 行可编辑 `speed` / `loop` / `clampWhenFinished`；
 * - **编辑期预览播放 / 停止**，走 `runtime-registry` 的两个只读钩子，**不进文档**
 *   （播放进度是运行时瞬态，铁律 1 明写的那条例外）。
 *
 * ⚠ **仍然不做时间轴**：没有拖拽刻度、没有关键帧、没有曲线。区间 / 淡变的编辑控件随
 * v1.2 的 T-321。R03 把动画创作认定为合同上最容易膨胀的一项，而闭合的 `kind` 联合是
 * 工程上的防线——测试里有一条结构断言专门守着这一点。
 */
export function AnimationPanel() {
  const doc = useDocumentSelector((s) => s.doc)
  const selection = useDocumentSelector((s) => s.selection)
  const { commit } = useDocumentActions()

  const animatedAssets = useMemo(
    () => doc.assets.filter((a) => a.type === 'model' && a.stats.animations.length > 0),
    [doc.assets],
  )
  const [pick, setPick] = useState<{ assetId: string; clipName: string } | null>(null)
  const picked =
    pick ?? (animatedAssets[0] ? { assetId: animatedAssets[0].id, clipName: animatedAssets[0].stats.animations[0]! } : null)
  const pickedAsset = animatedAssets.find((a) => a.id === picked?.assetId) ?? animatedAssets[0]

  const createImported = () => {
    if (!picked || !pickedAsset) return
    const animation = createImportedAnimation({
      name: picked.clipName,
      assetId: picked.assetId,
      clipName: picked.clipName,
      ctx: defaultFactoryContext,
    })
    commit('新建导入动画', (draft) => void draft.animations.push(animation))
  }

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

      {animatedAssets.length > 0 && pickedAsset && picked ? (
        <div className="row" data-testid="imported-create-row">
          <select
            className="field"
            data-testid="imported-asset"
            value={picked.assetId}
            onChange={(e) => {
              const asset = animatedAssets.find((a) => a.id === e.target.value)
              if (asset) setPick({ assetId: asset.id, clipName: asset.stats.animations[0]! })
            }}
          >
            {animatedAssets.map((asset) => (
              <option key={asset.id} value={asset.id}>
                {asset.name}
              </option>
            ))}
          </select>
          <select
            className="field"
            data-testid="imported-clip"
            value={picked.clipName}
            onChange={(e) => setPick({ assetId: picked.assetId, clipName: e.target.value })}
          >
            {pickedAsset.stats.animations.map((clip) => (
              <option key={clip} value={clip}>
                {clip}
              </option>
            ))}
          </select>
          <button type="button" className="tbtn" data-testid="imported-create" onClick={createImported}>
            新建导入动画
          </button>
        </div>
      ) : null}

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
                <>
                  <span className="num">导入片段 · {animation.clipName}</span>
                  <NumberField
                    label="速度"
                    value={animation.speed}
                    min={0.05}
                    max={10}
                    step={0.05}
                    onCommit={(speed) =>
                      commit('调整 播放速度', (draft) => {
                        const target = draft.animations.find((a) => a.id === animation.id)
                        if (target?.kind === 'imported') target.speed = speed
                      })
                    }
                  />
                  <CheckField
                    label="循环"
                    value={animation.loop}
                    onCommit={(loop) =>
                      commit('调整 循环', (draft) => {
                        const target = draft.animations.find((a) => a.id === animation.id)
                        if (target?.kind === 'imported') target.loop = loop
                      })
                    }
                  />
                  <CheckField
                    label="停在末帧"
                    value={animation.clampWhenFinished}
                    onCommit={(clamp) =>
                      commit('调整 停在末帧', (draft) => {
                        const target = draft.animations.find((a) => a.id === animation.id)
                        if (target?.kind === 'imported') target.clampWhenFinished = clamp
                      })
                    }
                  />
                </>
              )}
              <button
                type="button"
                className="tbtn"
                data-testid={`anim-preview-${animation.id}`}
                title="在视口里试放一次，不写进文档"
                onClick={() => previewAnimation(animation.id)}
              >
                {/* **不叫「预览」**：工具栏上那个「预览」是预览**模式**的开关，两者同名会让
                    按名字找按钮的 E2E 点错人（黄金路径 II 第 ⑪ 步当场红了一次），
                    而用户读起来也分不清「预览这条动画」与「进入预览模式」。 */}
                试放
              </button>
              <button
                type="button"
                className="tbtn"
                data-testid={`anim-stop-${animation.id}`}
                onClick={() => stopPreviewAnimation(animation.id)}
              >
                停止试放
              </button>
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
