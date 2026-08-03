import { refOptions as coreRefOptions } from '@w3/core'
import type { FieldDescriptor, RefKind } from '@w3/core'
import type { SceneDocument, ValueExpr } from '@w3/schema'
import { NODE_PROP_KEYS } from '@w3/schema'

/**
 * T-091 · the generated action form.
 *
 * This file renders `FieldDescriptor`, and it renders NOTHING else. There is no switch on
 * action type anywhere in the rule editor, and adding one would quietly undo the thing the
 * architecture is built to prove: ECA_SPEC §10 claims a new action costs three files and
 * no UI work, and the only way that claim stays true is if this component never learns
 * what `playAnimation` is.
 *
 * The acceptance test for T-091 is exactly that — register a fake action, open the rule
 * editor, and edit it without touching a line here.
 */

export interface ActionFieldsProps {
  readonly fields: readonly FieldDescriptor[]
  readonly params: Record<string, unknown>
  readonly doc: SceneDocument
  readonly onChange: (key: string, value: unknown) => void
  /** Lets a `ref` field be filled by clicking in the viewport. */
  readonly onPickRequest?: (key: string, refKind: RefKind) => void
  readonly picking?: string | null
}

export function ActionFields({ fields, params, doc, onChange, onPickRequest, picking }: ActionFieldsProps) {
  return (
    <div className="fields">
      {fields.map((field) => (
        <label key={field.key} className="fields__row">
          <span className="fields__label">{field.label}</span>
          <FieldInput
            field={field}
            value={params[field.key]}
            doc={doc}
            onChange={(value) => onChange(field.key, value)}
            {...(onPickRequest ? { onPickRequest: () => onPickRequest(field.key, refKindOf(field)!) } : {})}
            picking={picking === field.key}
          />
        </label>
      ))}
      {fields.length === 0 && <span className="fields__none">该动作没有参数</span>}
    </div>
  )
}

const refKindOf = (field: FieldDescriptor): RefKind | null => (field.type === 'ref' ? field.refKind : null)

function FieldInput({
  field,
  value,
  doc,
  onChange,
  onPickRequest,
  picking,
}: {
  field: FieldDescriptor
  value: unknown
  doc: SceneDocument
  onChange: (value: unknown) => void
  onPickRequest?: () => void
  picking?: boolean
}) {
  switch (field.type) {
    case 'ref': {
      const options = refOptions(doc, field.refKind)
      return (
        <span className="fields__control">
          <select className="field" value={typeof value === 'string' ? value : ''} onChange={(e) => onChange(e.target.value)}>
            <option value="">（未指定）</option>
            {options.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </select>
          {/* T-091 asks for "pick in the viewport" on node targets specifically: reading a
              34-entry dropdown to find 阀盖 is exactly the workflow this tool exists to
              avoid. */}
          {field.refKind === 'node' && onPickRequest && (
            <button type="button" className="tbtn" aria-pressed={picking} onClick={onPickRequest} title="在视口中点选">
              {picking ? '点选中…' : '拾取'}
            </button>
          )}
        </span>
      )
    }

    case 'number':
      return (
        <input
          className="field field--num"
          type="number"
          value={typeof value === 'number' ? value : (field.default ?? '')}
          {...(field.min !== undefined ? { min: field.min } : {})}
          {...(field.max !== undefined ? { max: field.max } : {})}
          {...(field.step !== undefined ? { step: field.step } : {})}
          onChange={(event) => {
            if (event.target.value === '') return onChange(undefined)
            const next = Number(event.target.value)
            // ADR-0004 · NaN and Infinity never reach the document.
            if (Number.isFinite(next)) onChange(next)
          }}
        />
      )

    case 'boolean':
      return (
        <input
          type="checkbox"
          checked={typeof value === 'boolean' ? value : (field.default ?? false)}
          onChange={(event) => onChange(event.target.checked)}
        />
      )

    case 'string':
      return field.multiline ? (
        <textarea
          className="field"
          rows={3}
          value={typeof value === 'string' ? value : (field.default ?? '')}
          onChange={(event) => onChange(event.target.value)}
        />
      ) : (
        <input
          className="field"
          value={typeof value === 'string' ? value : (field.default ?? '')}
          onChange={(event) => onChange(event.target.value)}
        />
      )

    case 'enum':
      return (
        <select className="field" value={typeof value === 'string' ? value : ''} onChange={(e) => onChange(e.target.value)}>
          <option value="">（未指定）</option>
          {field.options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      )

    case 'valueExpr':
      return <ValueExprInput value={value as ValueExpr | undefined} doc={doc} onChange={onChange} />
  }
}

/**
 * ECA_SPEC §3.1's four shapes, as a kind selector plus one operand editor.
 *
 * A free-text expression box would be smaller to build and would immediately need a
 * parser, an error surface and a migration story. The closed set is the whole point.
 */
function ValueExprInput({
  value,
  doc,
  onChange,
}: {
  value: ValueExpr | undefined
  doc: SceneDocument
  onChange: (value: ValueExpr) => void
}) {
  const kind = value === undefined ? 'const' : 'const' in value ? 'const' : 'var' in value ? 'var' : 'prop' in value ? 'prop' : 'event'

  return (
    <span className="fields__control">
      <select
        className="field field--kind"
        value={kind}
        onChange={(event) => {
          switch (event.target.value) {
            case 'var':
              return onChange({ var: doc.variables[0]?.id ?? '' })
            case 'prop':
              return onChange({ prop: { nodeId: doc.nodes[0]?.id ?? '', key: 'visible' } })
            case 'event':
              return onChange({ event: 'nodeId' })
            default:
              return onChange({ const: '' })
          }
        }}
      >
        <option value="const">常量</option>
        <option value="var">变量</option>
        <option value="prop">对象属性</option>
        <option value="event">事件载荷</option>
      </select>

      {kind === 'const' && (
        <input
          className="field"
          value={value && 'const' in value ? String(value.const) : ''}
          onChange={(event) => {
            const raw = event.target.value
            // Typed as it reads: "3" is a number, "true" is a boolean, everything else is
            // a string. A number field that stores "3" would fail every gt/lt comparison.
            const parsed = raw === 'true' ? true : raw === 'false' ? false : raw !== '' && Number.isFinite(Number(raw)) ? Number(raw) : raw
            onChange({ const: parsed })
          }}
        />
      )}

      {kind === 'var' && (
        <select
          className="field"
          value={value && 'var' in value ? value.var : ''}
          onChange={(event) => onChange({ var: event.target.value })}
        >
          <option value="">（未指定）</option>
          {doc.variables.map((variable) => (
            <option key={variable.id} value={variable.id}>
              {variable.name}（{variable.id}）
            </option>
          ))}
        </select>
      )}

      {kind === 'prop' && value && 'prop' in value && (
        <>
          <select className="field" value={value.prop.nodeId} onChange={(e) => onChange({ prop: { ...value.prop, nodeId: e.target.value } })}>
            {doc.nodes.map((node) => (
              <option key={node.id} value={node.id}>
                {node.name}
              </option>
            ))}
          </select>
          <select
            className="field"
            value={value.prop.key}
            onChange={(e) => onChange({ prop: { ...value.prop, key: e.target.value as (typeof NODE_PROP_KEYS)[number] } })}
          >
            {NODE_PROP_KEYS.map((key) => (
              <option key={key} value={key}>
                {key}
              </option>
            ))}
          </select>
        </>
      )}

      {kind === 'event' && value && 'event' in value && (
        <select className="field" value={value.event} onChange={(e) => onChange({ event: e.target.value as 'nodeId' })}>
          <option value="nodeId">被点击的对象</option>
          <option value="hotspotId">被点击的热点</option>
          <option value="animationId">结束的动画</option>
        </select>
      )}
    </span>
  )
}

/**
 * The document's entities of one ref kind, as `{id, name}` for a dropdown.
 *
 * T-203 · delegates to `@w3/core`'s `REF_KINDS`. It used to be a second exhaustive
 * `switch (kind)` — the twin of the one in `executor.ts` — so adding a reference kind meant
 * editing both of the files ECA_SPEC §10 forbids touching, which made a two-line change a
 * 分诊 Q4. See ADR-0028.
 *
 * Kept as a named export rather than inlining `refOptions(doc, kind)` at the call site: it
 * is what the rule-editor tests drive, and the indirection is where the editor's contract
 * with core is stated.
 */
export function refOptions(doc: SceneDocument, kind: RefKind): { id: string; name: string }[] {
  return coreRefOptions(doc, kind)
}
