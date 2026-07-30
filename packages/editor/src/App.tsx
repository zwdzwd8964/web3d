import { checkIntegrity, errorsOf, warningsOf } from '@w3/schema'
import { useMemo } from 'react'
import { Splitter } from './layout/Splitter.js'
import { useDocumentActions, useDocumentSelector } from './store/StoreContext.js'

/**
 * T-060 · the editor shell.
 *
 * Four regions, per MVP_V0 §1.1: hierarchy on the left, viewport in the middle, properties
 * on the right, assets and rules along the bottom. The panels are placeholders until their
 * own task cards (T-063 onward) land — but they read REAL document state, so the shell is
 * wired to the store from the first commit rather than being a picture of one.
 */

export function App() {
  return (
    <div className="shell">
      <TopBar />
      <div className="shell__body">
        <HierarchyPanel />
        <Splitter variable="--left-w" orientation="vertical" min={180} max={520} label="调整层级树宽度" />
        <div className="shell__center">
          <Viewport />
          <Splitter variable="--bottom-h" orientation="horizontal" min={80} max={480} invert label="调整下方面板高度" />
          <BottomPanel />
        </div>
        <Splitter variable="--right-w" orientation="vertical" min={220} max={560} invert label="调整属性面板宽度" />
        <PropertiesPanel />
      </div>
      <StatusBar />
    </div>
  )
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
      {/* Preview mode arrives with T-093; the segmented control is here so the layout
          is settled before the behaviour lands. */}
      <div className="seg">
        <button type="button" aria-pressed="true">
          编辑
        </button>
        <button type="button" aria-pressed="false" disabled title="预览模式：T-093">
          预览
        </button>
      </div>
    </header>
  )
}

function HierarchyPanel() {
  const nodes = useDocumentSelector((s) => s.doc.nodes)
  const selection = useDocumentSelector((s) => s.selection)
  const { toggleSelection } = useDocumentActions()

  return (
    <aside className="panel panel--left">
      <div className="panel__head">
        层级树<span className="num">{nodes.length}</span>
      </div>
      <div className="panel__body">
        {nodes.length === 0 ? (
          <p className="panel__empty">拖入 GLB 文件开始</p>
        ) : (
          <ul style={{ listStyle: 'none' }}>
            {nodes.map((node) => (
              <li key={node.id}>
                <button
                  type="button"
                  className="tbtn"
                  style={{
                    width: '100%',
                    textAlign: 'left',
                    background: selection.includes(node.id) ? 'var(--line2)' : 'transparent',
                    border: 0,
                    padding: '3px 6px',
                  }}
                  onClick={(event) => toggleSelection(node.id, event.ctrlKey || event.metaKey)}
                >
                  {node.assetRef?.missing ? '⚠ ' : ''}
                  {node.name}
                </button>
              </li>
            ))}
          </ul>
        )}
        {/* T-063 replaces this with a virtualised, drag-reorderable tree. */}
      </div>
    </aside>
  )
}

function Viewport() {
  return (
    <div className="viewport">
      <canvas className="viewport__canvas" />
      <div className="viewport__overlay" />
      <div className="viewport__placeholder">
        <b>视口</b>
        <span>SceneRuntime 挂载：T-062</span>
      </div>
    </div>
  )
}

function PropertiesPanel() {
  const selection = useDocumentSelector((s) => s.selection)
  const nodes = useDocumentSelector((s) => s.doc.nodes)
  const selected = useMemo(() => nodes.filter((n) => selection.includes(n.id)), [nodes, selection])

  return (
    <aside className="panel panel--right">
      <div className="panel__head">属性</div>
      <div className="panel__body">
        {selected.length === 0 ? (
          <p className="panel__empty">未选中对象</p>
        ) : selected.length > 1 ? (
          <p className="panel__empty">
            已选中 <span className="num">{selected.length}</span> 个对象 · 批量编辑：T-064
          </p>
        ) : (
          <dl>
            <dt>名称</dt>
            <dd>{selected[0]!.name}</dd>
            <dt>位置</dt>
            <dd className="num">{selected[0]!.transform.p.join(', ')}</dd>
          </dl>
        )}
      </div>
    </aside>
  )
}

function BottomPanel() {
  const assets = useDocumentSelector((s) => s.doc.assets)
  const rules = useDocumentSelector((s) => s.doc.rules)

  return (
    <section className="panel panel--bottom">
      <div className="panel__head">
        资产<span className="num">{assets.length}</span> · 规则<span className="num">{rules.length}</span>
      </div>
      <div className="panel__body">
        <p className="panel__empty">资产面板：T-066 · 规则编辑器：T-091</p>
      </div>
    </section>
  )
}

function StatusBar() {
  const doc = useDocumentSelector((s) => s.doc)
  const depth = useDocumentSelector((s) => s.historyDepth)
  const previewing = useDocumentSelector((s) => s.previewing)

  // Cheap enough to run per document revision at v0 sizes; T-092 moves it off the
  // render path and turns it into a clickable issue list.
  const issues = useMemo(() => checkIntegrity(doc), [doc])
  const errors = errorsOf(issues).length
  const warnings = warningsOf(issues).length

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
    </footer>
  )
}
