import { useEffect, useState } from 'react'
import type { ProjectSummary } from '@w3/storage'
import { isBlankName } from '../project/project-lifecycle.js'

/**
 * T-282 · 工程列表：打开 / 重命名 / 删除。
 *
 * ## 当前打开的那一份要标出来，而且不能被「打开」
 *
 * 打开当前这一份会走一遍 `replaceDocument`，把撤销栈清掉——用户点的是「打开」，
 * 得到的是「我刚才那几步撤销不回去了」，而界面上没有任何东西预告过这件事。
 *
 * ## 删除要确认，而且要说清删的是什么
 *
 * 「删除工程」在这里是**不可撤销**的：撤销栈是本端的、属于当前文档的，删掉的是存储里的
 * 另一条记录，Ctrl+Z 够不着它。所以确认框里写的是工程名，不是「确定吗」。
 */

export interface ProjectListDialogProps {
  readonly projects: readonly ProjectSummary[]
  /** 当前打开的那一份。它在列表里被标出来且不给「打开」按钮。 */
  readonly currentProjectId: string
  readonly onOpen: (projectId: string) => Promise<void>
  readonly onRename: (projectId: string, name: string) => Promise<void>
  readonly onDelete: (projectId: string) => Promise<void>
  readonly onNew: () => void
  readonly onClose: () => void
}

export function ProjectListDialog(props: ProjectListDialogProps) {
  const [renaming, setRenaming] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // 关掉重命名输入框时把草稿一起丢掉。留着的话，下一次点另一份工程的「重命名」，
  // 输入框里是上一份的名字——而用户很可能直接按回车。
  useEffect(() => {
    if (renaming === null) setDraft('')
  }, [renaming])

  const run = (job: () => Promise<void>) => {
    setBusy(true)
    setError(null)
    void job().then(
      () => {
        setBusy(false)
        setRenaming(null)
      },
      (cause: unknown) => {
        setBusy(false)
        setError(cause instanceof Error ? cause.message : '操作失败。')
      },
    )
  }

  return (
    <div className="dialog" role="dialog" aria-label="工程列表">
      <h2>工程</h2>
      <button type="button" className="tbtn" onClick={props.onNew}>
        新建工程
      </button>

      {props.projects.length === 0 ? <p>还没有保存过的工程。</p> : null}

      <ul className="projects">
        {props.projects.map((project) => {
          const current = project.projectId === props.currentProjectId
          return (
            <li key={project.projectId} data-current={current ? 'true' : undefined}>
              {renaming === project.projectId ? (
                <>
                  <input
                    type="text"
                    value={draft}
                    aria-label={`重命名 ${project.name}`}
                    onChange={(event) => setDraft(event.target.value)}
                  />
                  <button
                    type="button"
                    className="tbtn"
                    disabled={isBlankName(draft) || busy}
                    onClick={() => run(() => props.onRename(project.projectId, draft))}
                  >
                    确定
                  </button>
                  <button type="button" className="tbtn" onClick={() => setRenaming(null)}>
                    取消
                  </button>
                </>
              ) : (
                <>
                  <b>{project.name}</b>
                  {current ? <span className="badge">当前</span> : null}
                  <span className="muted">{project.updatedAt.slice(0, 10)}</span>
                  {current ? null : (
                    <button type="button" className="tbtn" disabled={busy} onClick={() => run(() => props.onOpen(project.projectId))}>
                      打开
                    </button>
                  )}
                  <button
                    type="button"
                    className="tbtn"
                    disabled={busy}
                    onClick={() => {
                      setRenaming(project.projectId)
                      setDraft(project.name)
                    }}
                  >
                    重命名
                  </button>
                  <button
                    type="button"
                    className="tbtn"
                    disabled={busy}
                    onClick={() => {
                      // 确认框里写工程名，不是「确定吗」——删的是存储里的另一条记录，
                      // 本端的 Ctrl+Z 够不着它。
                      if (globalThis.confirm(`删除工程「${project.name}」？这一步不能撤销。`)) {
                        run(() => props.onDelete(project.projectId))
                      }
                    }}
                  >
                    删除
                  </button>
                </>
              )}
            </li>
          )
        })}
      </ul>

      {error ? <p role="alert">{error}</p> : null}
      <button type="button" className="tbtn" onClick={props.onClose}>
        关闭
      </button>
    </div>
  )
}
