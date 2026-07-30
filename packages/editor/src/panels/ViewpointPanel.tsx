import { createViewpoint, defaultFactoryContext } from '@w3/schema'
import { useDocumentActions, useDocumentSelector } from '../store/StoreContext.js'
import { getActiveRuntime } from '../viewport/runtime-registry.js'

/**
 * T-069 · saved viewpoints.
 *
 * `moveCamera` can only fly to a saved viewpoint (ECA_SPEC §4.2), so this panel is what
 * makes that action usable at all — which is why it is a v0 card rather than a nicety.
 */
export function ViewpointPanel() {
  const viewpoints = useDocumentSelector((s) => s.doc.viewpoints)
  const { commit } = useDocumentActions()

  const save = () => {
    const runtime = getActiveRuntime()
    if (!runtime) return
    const camera = runtime.camera.captureViewpoint()
    const viewpoint = createViewpoint({
      name: `视点 ${viewpoints.length + 1}`,
      position: camera.position,
      target: camera.target,
      camera,
      ctx: defaultFactoryContext,
    })
    commit('保存视点', (draft) => void draft.viewpoints.push(viewpoint))
  }

  return (
    <div className="subpanel">
      <div className="subpanel__head">
        视点
        <button type="button" className="tbtn" onClick={save}>
          保存当前视角
        </button>
      </div>
      {viewpoints.length === 0 ? (
        <p className="panel__empty">转到合适角度后保存</p>
      ) : (
        <ul className="simple-list">
          {viewpoints.map((viewpoint) => (
            <li key={viewpoint.id}>
              <button
                type="button"
                className="tbtn"
                onClick={() => getActiveRuntime()?.camera.jumpTo(viewpoint)}
                title="跳转到该视点"
              >
                {viewpoint.name}
              </button>
              <button
                type="button"
                className="tbtn"
                onClick={() =>
                  commit('删除视点', (draft) => {
                    draft.viewpoints = draft.viewpoints.filter((v) => v.id !== viewpoint.id)
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
