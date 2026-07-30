import { checkIntegrity, errorsOf, warningsOf } from '@w3/schema'
import { useEffect, useMemo, useState } from 'react'
import { Splitter } from './layout/Splitter.js'
import { AnimationPanel } from './panels/AnimationPanel.js'
import { AssetPanel } from './panels/AssetPanel.js'
import { HierarchyTree } from './panels/HierarchyTree.js'
import { HistoryPanel } from './panels/HistoryPanel.js'
import { MaterialPanel } from './panels/MaterialPanel.js'
import { PropertiesPanel } from './panels/PropertiesPanel.js'
import { ViewpointPanel } from './panels/ViewpointPanel.js'
import { useDocumentActions, useDocumentSelector } from './store/StoreContext.js'
import { Viewport } from './viewport/Viewport.js'
import { fullRebuildCount } from './viewport/runtime-registry.js'

/**
 * T-060 · the editor shell.
 *
 * Four regions per MVP_V0 §1.1: hierarchy left, viewport centre, properties right,
 * assets and rules along the bottom.
 */

type BottomTab = 'assets' | 'material' | 'animation' | 'viewpoint' | 'history'

export function App() {
  useShortcuts()
  return (
    <div className="shell">
      <TopBar />
      <div className="shell__body">
        <HierarchyTree />
        <Splitter variable="--left-w" orientation="vertical" min={180} max={520} label="调整层级树宽度" />
        <div className="shell__center">
          <Viewport />
          <Splitter variable="--bottom-h" orientation="horizontal" min={80} max={480} invert label="调整下方面板高度" />
          <BottomDock />
        </div>
        <Splitter variable="--right-w" orientation="vertical" min={220} max={560} invert label="调整属性面板宽度" />
        <PropertiesPanel />
      </div>
      <StatusBar />
    </div>
  )
}

/**
 * T-071's keyboard layer, in its minimal form.
 *
 * The guard against firing while a text field has focus is not optional: without it,
 * Ctrl+Z inside the rename box undoes a scene edit instead of the typing, which is the
 * kind of bug that erodes trust in undo generally.
 */
function useShortcuts() {
  const { undo, redo } = useDocumentActions()
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return
      if (!(event.ctrlKey || event.metaKey)) return
      const key = event.key.toLowerCase()
      if (key === 'z' && !event.shiftKey) {
        event.preventDefault()
        undo()
      } else if ((key === 'z' && event.shiftKey) || key === 'y') {
        event.preventDefault()
        redo()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [undo, redo])
}

function TopBar() {
  const canUndo = useDocumentSelector((s) => s.canUndo)
  const canRedo = useDocumentSelector((s) => s.canRedo)
  const name = useDocumentSelector((s) => s.doc.name)
  const { undo, redo } = useDocumentActions()

  return (
    <header className="topbar">
      <div className="brand">
        <b>Web3D</b>
        <span>v0</span>
      </div>
      <span>{name}</span>
      <button type="button" className="tbtn" onClick={undo} disabled={!canUndo} title="Ctrl+Z">
        撤销
      </button>
      <button type="button" className="tbtn" onClick={redo} disabled={!canRedo} title="Ctrl+Y">
        重做
      </button>
      <div className="topbar__spacer" />
      <div className="seg">
        <button type="button" aria-pressed="true">
          编辑
        </button>
        {/* Preview mode arrives with T-093; the control is here so the layout is settled
            before the behaviour lands, and disabled so it cannot lie about being wired. */}
        <button type="button" aria-pressed="false" disabled title="预览模式：T-093">
          预览
        </button>
      </div>
    </header>
  )
}

function BottomDock() {
  const [tab, setTab] = useState<BottomTab>('assets')
  const rules = useDocumentSelector((s) => s.doc.rules)

  return (
    <section className="panel panel--bottom">
      <div className="panel__head">
        <div className="seg">
          {(
            [
              ['assets', '资产'],
              ['material', '材质'],
              ['animation', '动画'],
              ['viewpoint', '视点'],
              ['history', '历史'],
            ] as const
          ).map(([id, label]) => (
            <button key={id} type="button" aria-pressed={tab === id} onClick={() => setTab(id)}>
              {label}
            </button>
          ))}
        </div>
        <span className="panel__hint">
          规则编辑器：T-091 · 当前 <span className="num">{rules.length}</span> 条
        </span>
      </div>
      <div className="panel__body">
        {tab === 'assets' && <AssetPanel />}
        {tab === 'material' && <MaterialPanel />}
        {tab === 'animation' && <AnimationPanel />}
        {tab === 'viewpoint' && <ViewpointPanel />}
        {tab === 'history' && <HistoryPanel />}
      </div>
    </section>
  )
}

function StatusBar() {
  const doc = useDocumentSelector((s) => s.doc)
  const depth = useDocumentSelector((s) => s.historyDepth)
  const previewing = useDocumentSelector((s) => s.previewing)
  const revision = useDocumentSelector((s) => s.revision)

  // Cheap enough per revision at v0 sizes; T-092 turns it into a clickable issue list.
  const issues = useMemo(() => checkIntegrity(doc), [doc])
  const errors = errorsOf(issues).length
  const warnings = warningsOf(issues).length
  const rebuilds = useMemo(() => fullRebuildCount(), [revision])

  return (
    <footer className="statusbar">
      <span>
        对象 <b className="num">{doc.nodes.length}</b>
      </span>
      <span>
        历史 <b className="num">{depth}</b>
      </span>
      {previewing && <span className="statusbar__warn">拖拽中</span>}
      <span className={errors > 0 ? 'statusbar__warn' : undefined}>
        完整性 <b className="num">{errors}</b> 阻断 / <b className="num">{warnings}</b> 提示
      </span>
      {/* D1 · a fallback that nobody notices is how "it got slow and nobody knows when"
          happens. The E2E run asserts this stays at zero. */}
      <span className={rebuilds > 0 ? 'statusbar__warn' : undefined}>
        全量重建 <b className="num">{rebuilds}</b>
      </span>
    </footer>
  )
}
