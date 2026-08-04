import { RESERVED_VARIABLE_IDS, VARIABLE_ID_PATTERN, VARIABLE_TYPES, buildIndex, referencesTo } from '@w3/schema'
import type { Variable, VariableType, VariableValue } from '@w3/schema'
import { useMemo, useState } from 'react'
import { usePreview } from '../preview/PreviewContext.jsx'
import { useDocumentActions, useDocumentSelector } from '../store/StoreContext.js'

/**
 * T-090 · variables.
 *
 * SCHEMA_SPEC §6.3 gives variables a human-authored id (`step`, not `var_a1b2c3d4`)
 * because they are typed by hand into value expressions. That makes this the one panel
 * where the id is user input, so it is the one panel that has to validate ids — pattern,
 * reserved words, and uniqueness — at the point of entry rather than at save time.
 *
 * The golden path's step 10 is "create a `step` variable", and the acceptance bar is that
 * it can be done here without leaving the editor.
 */

const TYPE_LABELS: Record<VariableType, string> = {
  number: '数字',
  string: '文本',
  boolean: '布尔',
  enum: '枚举',
}

export function VariablePanel() {
  const doc = useDocumentSelector((s) => s.doc)
  const previewing = usePreview((s) => s.active)
  const liveValues = usePreview((s) => s.variables)
  const { commit } = useDocumentActions()

  const [draftId, setDraftId] = useState('')
  const index = useMemo(() => buildIndex(doc), [doc])

  const taken = useMemo(() => new Set(doc.variables.map((v) => v.id)), [doc.variables])
  const idError = validateVariableId(draftId, taken)

  const add = () => {
    if (draftId === '' || idError) return
    commit(`新建变量 ${draftId}`, (draft) => {
      draft.variables.push({
        scope: 'scene' as const, id: draftId, name: draftId, type: 'number', default: 0, persist: false })
    })
    setDraftId('')
  }

  const update = (id: string, patch: Partial<Variable>, label: string) => {
    commit(label, (draft) => {
      const variable = draft.variables.find((v) => v.id === id)
      if (variable) Object.assign(variable, patch)
    })
  }

  const remove = (id: string) => {
    commit(`删除变量 ${id}`, (draft) => {
      const at = draft.variables.findIndex((v) => v.id === id)
      if (at !== -1) draft.variables.splice(at, 1)
    })
  }

  return (
    <div className="subpanel">
      <div className="subpanel__head">
        变量<span className="num">{doc.variables.length}</span>
        <input
          className="field field--id"
          placeholder="新变量 id，如 step"
          value={draftId}
          onChange={(event) => setDraftId(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') add()
          }}
        />
        <button type="button" className="tbtn" onClick={add} disabled={draftId === '' || idError !== null}>
          新建
        </button>
        {draftId !== '' && idError && <span className="panel__note panel__note--warn">{idError}</span>}
      </div>

      {doc.variables.length === 0 ? (
        <p className="panel__empty">还没有变量。规则的条件判断和 v1 的流程都建立在变量上。</p>
      ) : (
        <table className="grid">
          <thead>
            <tr>
              <th>id</th>
              <th>名称</th>
              <th>类型</th>
              <th>默认值</th>
              {previewing && <th>当前值</th>}
              <th>引用</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {doc.variables.map((variable) => {
              const uses = referencesTo(index, variable.id).length
              return (
                <tr key={variable.id}>
                  <td>
                    <code>{variable.id}</code>
                  </td>
                  <td>
                    <input
                      className="field"
                      value={variable.name}
                      onChange={(event) =>
                        update(variable.id, { name: event.target.value || variable.id }, `重命名变量 ${variable.id}`)
                      }
                    />
                  </td>
                  <td>
                    <select
                      className="field"
                      value={variable.type}
                      onChange={(event) => {
                        const type = event.target.value as VariableType
                        // The default has to move with the type or the document is
                        // instantly invalid — I5 would flag it and the user would have no
                        // idea why changing a dropdown broke their scene.
                        update(
                          variable.id,
                          {
                            type,
                            default: coerceDefault(variable.default, type, variable.options),
                            ...(type === 'enum' ? { options: variable.options ?? ['A', 'B'] } : { options: undefined }),
                          },
                          `变量 ${variable.id} 改类型`,
                        )
                      }}
                    >
                      {VARIABLE_TYPES.map((type) => (
                        <option key={type} value={type}>
                          {TYPE_LABELS[type]}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <DefaultEditor
                      variable={variable}
                      onChange={(value) => update(variable.id, { default: value }, `变量 ${variable.id} 改默认值`)}
                      onOptionsChange={(options) =>
                        update(
                          variable.id,
                          {
                            options,
                            // Keep the default pointing at something that still exists.
                            default: options.includes(String(variable.default)) ? variable.default : (options[0] ?? ''),
                          },
                          `变量 ${variable.id} 改选项`,
                        )
                      }
                    />
                  </td>
                  {previewing && (
                    <td>
                      <b className="num">{formatValue(liveValues[variable.id])}</b>
                    </td>
                  )}
                  <td className="num">{uses}</td>
                  <td>
                    <button
                      type="button"
                      className="tbtn"
                      title={uses > 0 ? `被 ${uses} 处引用，删除后这些引用会失效` : '删除'}
                      onClick={() => remove(variable.id)}
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </div>
  )
}

function DefaultEditor({
  variable,
  onChange,
  onOptionsChange,
}: {
  variable: Variable
  onChange: (value: VariableValue) => void
  onOptionsChange: (options: string[]) => void
}) {
  if (variable.type === 'boolean') {
    return (
      <input type="checkbox" checked={variable.default === true} onChange={(event) => onChange(event.target.checked)} />
    )
  }
  if (variable.type === 'number') {
    return (
      <input
        className="field field--num"
        type="number"
        value={typeof variable.default === 'number' ? variable.default : 0}
        onChange={(event) => {
          const value = Number(event.target.value)
          // C-level rule: no NaN or Infinity ever reaches the document (ADR-0004).
          if (Number.isFinite(value)) onChange(value)
        }}
      />
    )
  }
  if (variable.type === 'enum') {
    const options = variable.options ?? []
    return (
      <div className="stack">
        <select className="field" value={String(variable.default)} onChange={(event) => onChange(event.target.value)}>
          {options.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
        <input
          className="field"
          value={options.join(', ')}
          title="逗号分隔的选项"
          onChange={(event) =>
            onOptionsChange(
              event.target.value
                .split(',')
                .map((s) => s.trim())
                .filter((s) => s !== ''),
            )
          }
        />
      </div>
    )
  }
  return <input className="field" value={String(variable.default)} onChange={(event) => onChange(event.target.value)} />
}

/**
 * SCHEMA_SPEC §6.3's three rules, checked while typing.
 *
 * Exported so a test can pin them: this is validation the user sees before committing,
 * and getting it wrong means either a rejected valid id or a document that fails
 * `validate()` after it was accepted here.
 */
export function validateVariableId(id: string, taken: ReadonlySet<string>): string | null {
  if (id === '') return null
  if (!VARIABLE_ID_PATTERN.test(id)) return 'id 只能是字母、数字、下划线，且不能以数字开头，最长 32 位'
  if (RESERVED_VARIABLE_IDS.includes(id)) return `「${id}」是保留字，值表达式里已有别的含义`
  if (taken.has(id)) return '已有同名变量'
  return null
}

/** Moves a default across a type change without ever producing an invalid document. */
function coerceDefault(value: VariableValue, type: VariableType, options?: readonly string[]): VariableValue {
  switch (type) {
    case 'number': {
      const n = Number(value)
      return Number.isFinite(n) ? n : 0
    }
    case 'boolean':
      return value === true || value === 'true' || value === 1
    case 'enum':
      return options?.includes(String(value)) ? String(value) : (options?.[0] ?? 'A')
    default:
      return String(value)
  }
}

const formatValue = (value: VariableValue | undefined) =>
  value === undefined ? '—' : typeof value === 'boolean' ? (value ? '真' : '假') : String(value)
