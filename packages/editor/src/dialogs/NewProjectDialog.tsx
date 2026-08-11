import { useState } from 'react'
import type { BuiltinDocument } from '../project/project-lifecycle.js'
import { BUILTIN_DOCUMENTS, isBlankName } from '../project/project-lifecycle.js'

/**
 * T-282 · 新建工程。
 *
 * ## 空工程与内置文档是两个入口，不是一个下拉里的两项
 *
 * 「从零开始」与「基于泵组样例」在用户脑子里是两件事：前者要起名字，后者的名字已经有了。
 * 做成一个下拉的话，选中「空工程」时那个名字输入框是必填的，选中样例时它是可选的——
 * 一个字段两种含义，而界面上看不出来。
 *
 * ## 为什么内置那一列是从表里渲染的
 *
 * `BUILTIN_DOCUMENTS` 是判据本身（`materialiseSample` 靠它决定要不要物化）。UI 另抄一份
 * 清单的话，T-283 加泵组样板时会出现「表里有、界面上没有」或者反过来——而后者更坏：
 * 用户点得到一个打得开却发布不了的选项。
 */

export interface NewProjectDialogProps {
  /** 建一份空的。名字由用户输入。 */
  readonly onCreateEmpty: (name: string) => Promise<void>
  /** 基于内置文档建一份。 */
  readonly onCreateBuiltin: (builtin: BuiltinDocument) => Promise<void>
  readonly onClose: () => void
  /** 打桩用。生产走 `BUILTIN_DOCUMENTS` 本身。 */
  readonly builtins?: readonly BuiltinDocument[]
}

export function NewProjectDialog(props: NewProjectDialogProps) {
  const builtins = props.builtins ?? BUILTIN_DOCUMENTS
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // 空名与纯空白名走同一个判据（`isBlankName`），不是 `name === ''`：
  // 一个全是空格的名字在列表里看起来是一行没有名字的工程。
  const blank = isBlankName(name)

  const run = (job: () => Promise<void>) => {
    setBusy(true)
    setError(null)
    void job().then(
      () => setBusy(false),
      (cause: unknown) => {
        setBusy(false)
        setError(cause instanceof Error ? cause.message : '新建失败。')
      },
    )
  }

  return (
    <div className="dialog" role="dialog" aria-label="新建工程">
      <h2>新建工程</h2>

      <section>
        <h3>从零开始</h3>
        <label>
          工程名
          <input
            type="text"
            value={name}
            placeholder="例如：3 号泵房"
            aria-label="工程名"
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <button
          type="button"
          className="tbtn"
          disabled={blank || busy}
          onClick={() => run(() => props.onCreateEmpty(name))}
        >
          新建空工程
        </button>
        {blank ? <p className="hint">工程名不能为空。</p> : null}
      </section>

      <section>
        <h3>从样板开始</h3>
        {builtins.map((builtin) => (
          <div key={builtin.projectId} className="builtin">
            <b>{builtin.label}</b>
            <span>{builtin.description}</span>
            <button type="button" className="tbtn" disabled={busy} onClick={() => run(() => props.onCreateBuiltin(builtin))}>
              使用这份样板
            </button>
          </div>
        ))}
      </section>

      {error ? <p role="alert">{error}</p> : null}
      <button type="button" className="tbtn" onClick={props.onClose}>
        取消
      </button>
    </div>
  )
}
