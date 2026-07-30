import { checkIntegrity, errorsOf, warningsOf } from '@w3/schema'
import { useEffect, useMemo, useState } from 'react'
import { Splitter } from './layout/Splitter.js'
import { AnimationPanel } from './panels/AnimationPanel.js'
import { AssetPanel } from './panels/AssetPanel.js'
import { HierarchyTree } from './panels/HierarchyTree.js'
import { HistoryPanel } from './panels/HistoryPanel.js'
import { IssuePanel } from './panels/IssuePanel.js'
import { MaterialPanel } from './panels/MaterialPanel.js'
import { PropertiesPanel } from './panels/PropertiesPanel.js'
import { RuleLogPanel } from './panels/RuleLogPanel.js'
import { RulePanel } from './panels/RulePanel.js'
import { VariablePanel } from './panels/VariablePanel.js'
import { ViewpointPanel } from './panels/ViewpointPanel.js'
import { usePreview } from './preview/PreviewContext.jsx'
import { useAutoSave } from './project/useAutoSave.js'
import { useDocumentActions, useDocumentSelector } from './store/StoreContext.js'
import { Viewport } from './viewport/Viewport.js'
import { fullRebuildCount } from './viewport/runtime-registry.js'

/**
 * T-060 · the editor shell.
 *
 * Four regions per MVP_V0 §1.1: hierarchy left, viewport centre, properties right,
 * assets and rules along the bottom.
 */

type BottomTab = 'assets' | 'material' | 'animation' | 'viewpoint' | 'rules' | 'variables' | 'issues' | 'log' | 'history'

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
      <SaveControl />
      <div className="topbar__spacer" />
      <ModeSwitch />
    </header>
  )
}

/**
 * The save button and its state.
 *
 * The state is shown rather than assumed. Autosave that gives no feedback is
 * indistinguishable from no autosave — the user refreshes, finds their work gone, and has
 * no way to know whether it was ever written.
 */
function SaveControl() {
  const { state, error, saveNow } = useAutoSave()
  return (
    <>
      <button
        type="button"
        className="tbtn"
        onClick={saveNow}
        title="Ctrl+S · 编辑后也会自动保存"
        disabled={state === 'saving'}
      >
        保存
      </button>
      <span className={`savestate savestate--${state}`} title={error ?? undefined}>
        {SAVE_LABELS[state]}
      </span>
    </>
  )
}

const SAVE_LABELS: Record<ReturnType<typeof useAutoSave>['state'], string> = {
  idle: '',
  pending: '待保存',
  saving: '保存中…',
  saved: '已保存',
  error: '保存失败',
}

/**
 * T-093 · edit / preview.
 *
 * Preview is the only place the ECA engine runs (ECA_SPEC §7). While editing, a click
 * selects — otherwise an object with a click rule could not be edited, by its own
 * configuration.
 */
function ModeSwitch() {
  const active = usePreview((s) => s.active)
  const setActive = usePreview((s) => s.setActive)
  return (
    <div className="seg">
      <button type="button" aria-pressed={!active} onClick={() => setActive(false)}>
        编辑
      </button>
      <button type="button" aria-pressed={active} onClick={() => setActive(true)} title="运行规则，退出后编辑态完全还原">
        预览
      </button>
    </div>
  )
}

function BottomDock() {
  const [tab, setTab] = useState<BottomTab>('assets')
  const rules = useDocumentSelector((s) => s.doc.rules)
  const previewActive = usePreview((s) => s.active)

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
              ['rules', '规则'],
              ['variables', '变量'],
              ['issues', '完整性'],
              ['log', '规则日志'],
              ['history', '历史'],
            ] as const
          ).map(([id, label]) => (
            <button key={id} type="button" aria-pressed={tab === id} onClick={() => setTab(id)}>
              {label}
            </button>
          ))}
        </div>
        <span className="panel__hint">
          {previewActive ? '预览中 · 点击场景会触发规则' : `规则 ${rules.length} 条`}
        </span>
      </div>
      <div className="panel__body">
        {tab === 'assets' && <AssetPanel />}
        {tab === 'material' && <MaterialPanel />}
        {tab === 'animation' && <AnimationPanel />}
        {tab === 'viewpoint' && <ViewpointPanel />}
        {tab === 'rules' && <RulePanel />}
        {tab === 'variables' && <VariablePanel />}
        {tab === 'issues' && <IssuePanel />}
        {tab === 'log' && <RuleLogPanel />}
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
  // Read straight through: this component already re-renders on every `revision` change,
  // and wrapping a mutable module read in useMemo was using memoisation as a refresh
  // trigger — which is what react-hooks/exhaustive-deps flagged the moment lint existed.
  const rebuilds = fullRebuildCount()
  void revision

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
