import { checkIntegrity, errorsOf, warningsOf } from '@w3/schema'
import type { ProjectSummary } from '@w3/storage'
import { createActionRefResolver } from '@w3/core'
import { useEffect, useMemo, useState } from 'react'
import { Splitter } from './layout/Splitter.js'
import { AnimationPanel } from './panels/AnimationPanel.js'
import { AssetPanel } from './panels/AssetPanel.js'
import { HierarchyTree } from './panels/HierarchyTree.js'
import { ExportImageDialog } from './dialogs/ExportImageDialog.jsx'
import { NewProjectDialog } from './dialogs/NewProjectDialog.jsx'
import { ProjectListDialog } from './dialogs/ProjectListDialog.jsx'
import { PublishDialog } from './dialogs/PublishDialog.js'
import { HistoryPanel } from './panels/HistoryPanel.js'
import { HotspotPanel } from './panels/HotspotPanel.js'
import { IssuePanel } from './panels/IssuePanel.js'
import { LibraryPanel } from './panels/LibraryPanel.js'
import { LightPanel } from './panels/LightPanel.js'
import { SceneEffectsPanel } from './panels/SceneEffectsPanel.js'
import { SectionPanel } from './panels/SectionPanel.js'
import { MaterialPanel } from './panels/MaterialPanel.js'
import { MediaPanel } from './panels/MediaPanel.js'
import { PropertiesPanel } from './panels/PropertiesPanel.js'
import { RuleLogPanel } from './panels/RuleLogPanel.js'
import { SnapshotPanel } from './panels/SnapshotPanel.js'
import { RulePanel } from './panels/RulePanel.js'
import { VariablePanel } from './panels/VariablePanel.js'
import { ViewpointPanel } from './panels/ViewpointPanel.js'
import { usePreview } from './preview/PreviewContext.jsx'
import { useProject } from './project/ProjectContext.jsx'
import {
  createFromBuiltin,
  createProject,
  deleteProject,
  draftsOf,
  listProjects,
  openProject,
  renameStoredProject,
} from './project/project-lifecycle.js'
import type { RecoveryBanner } from './project/project-lifecycle.js'
import { useAutoSave } from './project/useAutoSave.js'
import { useDocumentActions, useDocumentSelector, useDocumentStore } from './store/StoreContext.js'
import { setUi, useUi } from './store/ui-store.js'
import { Viewport } from './viewport/Viewport.js'
import { exportImage, exportSettings, fullRebuildCount } from './viewport/runtime-registry.js'
import { useShortcuts } from './shortcuts.js'

/**
 * T-060 · the editor shell.
 *
 * Four regions per MVP_V0 §1.1: hierarchy left, viewport centre, properties right,
 * assets and rules along the bottom.
 */

type BottomTab =
  | 'library'
  | 'assets'
  | 'light'
  | 'effects'
  | 'material'
  | 'media'
  | 'animation'
  | 'viewpoint'
  | 'hotspots'
  | 'rules'
  | 'variables'
  | 'issues'
  | 'log'
  | 'history'
  | 'snapshots'

export function App({ recovery }: { recovery?: RecoveryBanner }) {
  useShortcuts()
  return (
    <div className="shell">
      <RecoveryBar recovery={recovery ?? { kind: 'none' }} />
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
      <ProjectButton />
      <button type="button" className="tbtn" onClick={undo} disabled={!canUndo} title="Ctrl+Z">
        撤销
      </button>
      <button type="button" className="tbtn" onClick={redo} disabled={!canRedo} title="Ctrl+Y">
        重做
      </button>
      <SaveControl />
      <ExportImageButton />
      <PublishButton />
      <div className="topbar__spacer" />
      <ModeSwitch />
    </header>
  )
}

/**
 * T-282 · 项目层的入口。
 *
 * ## 三个动作走三条不同的路，而它们看起来一样
 *
 * - **打开**：`openProject` → `replaceDocument(doc, { keepHistory: false })`。
 *   撤销栈**必须清掉**——保留的话，Ctrl+Z 会重放一条属于上一份文档的逆补丁，
 *   静默损坏当前文档。
 * - **重命名当前工程**：`commit('重命名工程', …)`，**落撤销**。
 * - **重命名列表里另一份**：`renameStoredProject`，读改写，**不碰本端撤销栈**——
 *   那份文档的历史不在本端。
 *
 * 三条路都会让「列表里的名字变了」，区别只在撤销栈。所以本卡的验收要求两条重命名
 * 路径各有一条断言，且其中一条断言的是撤销栈深度而不是名字。
 */
export function ProjectButton() {
  const session = useProject()
  const store = useDocumentStore()
  const { commit, replaceDocument } = useDocumentActions()
  const currentId = useDocumentSelector((s) => s.doc.projectId)

  const [view, setView] = useState<'closed' | 'list' | 'new'>('closed')
  const [projects, setProjects] = useState<readonly ProjectSummary[]>([])

  const refresh = () => listProjects(session).then(setProjects)

  const openList = () => {
    void refresh().then(() => setView('list'))
  }

  // T-288 · 第二个开启者：配额写满时那条错误旁边的「清理本地数据」。它只置一个标志位，
  // 由这里翻译成「刷新列表再打开」——否则那个入口要么重复一遍刷新逻辑，要么打开一个空列表。
  const listRequested = useUi().projectListOpen
  useEffect(() => {
    if (!listRequested) return
    setUi({ projectListOpen: false })
    openList()
    // `openList` 每次渲染都是新函数，进依赖数组会让这个 effect 每帧都跑一遍。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listRequested])

  const swapTo = async (doc: Parameters<typeof replaceDocument>[0]) => {
    // `keepHistory` 恒 false —— 由 `openProject` 返回的字段带过来，而不是在这里再写一遍
    // `false`。写两遍的话，改一处忘一处的那次不会有任何东西红。
    replaceDocument(doc, { keepHistory: false })
    setView('closed')
  }

  return (
    <>
      <button type="button" className="tbtn" onClick={openList} title="新建 / 打开 / 重命名 / 删除工程">
        项目
      </button>
      {view === 'list' ? (
        <ProjectListDialog
          projects={projects}
          currentProjectId={currentId}
          onOpen={async (projectId) => {
            const target = await openProject(session, projectId)
            await swapTo(target.doc)
          }}
          onRename={async (projectId, next) => {
            if (projectId === currentId) {
              // 当前打开的这一份：走 commit，落撤销。
              commit('重命名工程', (draft) => {
                draft.name = next.trim()
              })
              await session.save(store.getState().doc)
            } else {
              await renameStoredProject(session, projectId, next)
            }
            await refresh()
          }}
          onDelete={async (projectId) => {
            await deleteProject(session, projectId)
            await refresh()
            // 删掉的正是当前打开的那一份时，落到新建对话框——**不崩**。
            // 留在原地的话，用户面对的是一个编辑着一份已经不存在的工程的编辑器，
            // 而下一次自动保存会把它又写回去。
            if (projectId === currentId) setView('new')
          }}
          onNew={() => setView('new')}
          onClose={() => setView('closed')}
        />
      ) : null}
      {view === 'new' ? (
        <NewProjectDialog
          onCreateEmpty={async (next) => {
            await swapTo(await createProject(session, next))
          }}
          onCreateBuiltin={async (builtin) => {
            await swapTo(await createFromBuiltin(session, builtin))
          }}
          onClose={() => setView('closed')}
        />
      ) : null}
    </>
  )
}

/**
 * T-288 · 崩溃恢复与「另一个标签页」两条横幅。
 *
 * ## 三选一，而且没有默认动作
 *
 * 「恢复」「丢弃」「稍后再说」三个按钮，**没有一个是自动执行的**。恢复一份草稿是覆盖
 * 用户当前看到的文档，丢弃是删掉他仅存的那一份——两件事都不该由一个横幅替他决定。
 * 「稍后再说」只关横幅，草稿留在库里，下次开机还会问。
 *
 * ## 数字是真的
 *
 * 「有 N 处修改没保存」的 N 来自草稿记录里的 `edits`，一路从 `AutoSaver` 的编辑计数
 * 传下来。写死一句「有一些修改」的话，用户没有任何依据判断该恢复还是该丢弃。
 */
function RecoveryBar({ recovery }: { recovery: RecoveryBanner }) {
  const session = useProject()
  const { replaceDocument } = useDocumentActions()
  const [dismissed, setDismissed] = useState(false)

  if (dismissed || recovery.kind === 'none') return null

  if (recovery.kind === 'other-tab') {
    return (
      <div className="banner banner--warn" role="alert">
        <span>这份工程正在另一个标签页里编辑。在这里改动会互相覆盖，建议关掉另一个再继续。</span>
        <button type="button" className="tbtn" onClick={() => setDismissed(true)}>
          知道了
        </button>
      </div>
    )
  }

  const discard = () => {
    void draftsOf(session)?.clearDraft(recovery.draft.projectId)
    setDismissed(true)
  }

  return (
    <div className="banner banner--warn" role="alert">
      <span>
        上次没有正常关闭，有 <b>{recovery.edits}</b> 处修改没保存。
      </span>
      <button
        type="button"
        className="tbtn"
        onClick={() => {
          // 恢复 = 换文档，且**清撤销栈**：留着的话 Ctrl+Z 会重放一条属于崩溃前那份
          // 文档的逆补丁，理由与 `openProject` 那处逐字相同。
          replaceDocument(recovery.draft, { keepHistory: false })
          setDismissed(true)
        }}
      >
        恢复
      </button>
      <button type="button" className="tbtn" onClick={discard}>
        丢弃
      </button>
      <button type="button" className="tbtn" onClick={() => setDismissed(true)}>
        稍后再说
      </button>
    </div>
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
  const { state, error, errorCode, saveNow } = useAutoSave()
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
      {/*
        T-288 · 配额写满是**用户能自己解决**的唯一一种保存失败，所以它带一个入口；
        其余失败只显示文案。文案本身来自 `StorageError.userMessage`，不是浏览器抛的
        `QuotaExceededError: Failed to execute 'put' on 'IDBObjectStore'`。
      */}
      {errorCode === 'quota-exceeded' && (
        <span className="savestate savestate--error" role="alert">
          {error}
          <button type="button" className="tbtn" onClick={() => setUi({ projectListOpen: true })}>
            清理本地数据
          </button>
        </span>
      )}
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
 * T-267 · 出图入口，挨着发布。
 *
 * 没有活着的运行时时按钮禁用——而不是点开一个每个数字都是 0 的对话框。
 */
function ExportImageButton() {
  const [open, setOpen] = useState(false)
  const settings = open ? exportSettings() : null
  return (
    <>
      <button type="button" className="tbtn" onClick={() => setOpen(true)} title="把当前视角导出为图片">
        导出图片
      </button>
      {open && settings && (
        <ExportImageDialog
          viewport={settings.viewport}
          limits={settings.limits}
          fontSource={settings.fontSource}
          onExport={exportImage}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  )
}

/** T-100 · the publish gate lives in the top bar, next to save. */
function PublishButton() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" className="tbtn" onClick={() => setOpen(true)} title="检查并导出 .w3p">
        发布
      </button>
      {open && <PublishDialog onClose={() => setOpen(false)} />}
    </>
  )
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
  const [tab, setTab] = useState<BottomTab>('library')
  const rules = useDocumentSelector((s) => s.doc.rules)
  const previewActive = usePreview((s) => s.active)

  return (
    <section className="panel panel--bottom">
      <div className="panel__head">
        <div className="seg">
          {(
            [
              ['library', '资源库'],
              ['assets', '资产'],
              ['material', '材质'],
              ['light', '灯光'],
              // T-239 · 场景效果（雾）。描边段由 T-241 补进同一个面板
              ['effects', '场景效果'],
              ['media', '媒体'],
              ['animation', '动画'],
              ['viewpoint', '视点'],
              ['hotspots', '热点'],
              ['rules', '规则'],
              ['variables', '变量'],
              ['issues', '完整性'],
              ['log', '规则日志'],
              ['snapshots', '快照'],
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
        {tab === 'library' && <LibraryPanel />}
        {tab === 'assets' && <AssetPanel />}
        {tab === 'material' && <MaterialPanel />}
        {tab === 'light' && <LightPanel />}
        {tab === 'effects' && (
          <>
            <SceneEffectsPanel />
            {/* T-251 · 剖切与场景效果同属「这个场景看起来怎么样」，共用一个标签页 */}
            <SectionPanel />
          </>
        )}
        {tab === 'media' && <MediaPanel />}
        {tab === 'animation' && <AnimationPanel />}
        {tab === 'viewpoint' && <ViewpointPanel />}
        {tab === 'hotspots' && <HotspotPanel />}
        {tab === 'rules' && <RulePanel />}
        {tab === 'variables' && <VariablePanel />}
        {tab === 'issues' && <IssuePanel />}
        {tab === 'log' && <RuleLogPanel />}
        {tab === 'snapshots' && <SnapshotPanel />}
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
  // Same resolver the publish gate and the issue panel use. Without it the status bar
  // cannot see references inside rule action params, so it would read 「0 阻断」 while
  // publishing refused the document — the worst possible pair of signals.
  const issues = useMemo(() => checkIntegrity(doc, { actionRefs: createActionRefResolver() }), [doc])
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
