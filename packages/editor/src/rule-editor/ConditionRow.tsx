import type { SceneDocument } from '@w3/schema'
import type { Condition } from '@w3/schema'
import { COMPARE_OPS } from '@w3/schema'
import { ActionFields } from './ActionFields.jsx'

/**
 * ECA_SPEC §3.2 · one condition row.
 *
 * SCHEMA_SPEC §6.6 chose two flat arrays over a nested boolean tree, and this row is why
 * that decision pays: every condition is one line with an operator in the middle. A tree
 * would need drag-to-nest, grouping affordances and precedence display — several times
 * the UI for the ~5% of conditions that need it.
 */

const OP_LABELS: Record<string, string> = {
  eq: '等于',
  ne: '不等于',
  gt: '大于',
  gte: '大于等于',
  lt: '小于',
  lte: '小于等于',
  in: '属于',
  isVisible: '可见性是',
  isPlaying: '播放中是',
  isPanelOpen: '面板打开是',
}

const ALL_OPS = [...COMPARE_OPS, 'in', 'isVisible', 'isPlaying', 'isPanelOpen'] as const

export function ConditionRow({
  condition,
  doc,
  onChange,
  onRemove,
}: {
  condition: Condition
  doc: SceneDocument
  onChange: (next: Condition) => void
  onRemove: () => void
}) {
  return (
    <div className="cond">
      <select className="field field--op" value={condition.op} onChange={(event) => onChange(switchOp(condition, event.target.value, doc))}>
        {ALL_OPS.map((op) => (
          <option key={op} value={op}>
            {OP_LABELS[op]}
          </option>
        ))}
      </select>

      {'left' in condition && (
        <ActionFields
          fields={[{ key: 'left', type: 'valueExpr', label: '左值' }]}
          params={{ left: condition.left }}
          doc={doc}
          onChange={(_, value) => onChange({ ...condition, left: value as Condition extends { left: infer L } ? L : never })}
        />
      )}

      {condition.op === 'in' ? (
        <input
          className="field"
          value={condition.right.map(String).join(', ')}
          title="逗号分隔"
          onChange={(event) =>
            onChange({
              ...condition,
              right: event.target.value
                .split(',')
                .map((s) => s.trim())
                .filter((s) => s !== '')
                .map((s) => (s === 'true' ? true : s === 'false' ? false : Number.isFinite(Number(s)) ? Number(s) : s)),
            })
          }
        />
      ) : 'right' in condition ? (
        <ActionFields
          fields={[{ key: 'right', type: 'valueExpr', label: '右值' }]}
          params={{ right: condition.right }}
          doc={doc}
          onChange={(_, value) => onChange({ ...condition, right: value as never })}
        />
      ) : (
        <StateCondition condition={condition} doc={doc} onChange={onChange} />
      )}

      <button type="button" className="tbtn" onClick={onRemove} title="删除条件">
        ✕
      </button>
    </div>
  )
}

/** The three ops that read scene state directly rather than comparing two expressions. */
function StateCondition({
  condition,
  doc,
  onChange,
}: {
  condition: Extract<Condition, { op: 'isVisible' | 'isPlaying' | 'isPanelOpen' }>
  doc: SceneDocument
  onChange: (next: Condition) => void
}) {
  const kind = condition.op === 'isVisible' ? 'node' : condition.op === 'isPlaying' ? 'animation' : 'hotspot'
  const idKey = condition.op === 'isVisible' ? 'nodeId' : condition.op === 'isPlaying' ? 'animationId' : 'hotspotId'

  return (
    <>
      <ActionFields
        fields={[{ key: idKey, type: 'ref', refKind: kind, label: '目标' }]}
        params={{ [idKey]: (condition as unknown as Record<string, unknown>)[idKey] }}
        doc={doc}
        onChange={(key, value) => onChange({ ...condition, [key]: value } as Condition)}
      />
      <select
        className="field field--bool"
        value={String(condition.value)}
        onChange={(event) => onChange({ ...condition, value: event.target.value === 'true' })}
      >
        <option value="true">是</option>
        <option value="false">否</option>
      </select>
    </>
  )
}

/**
 * Rebuilds a condition when the operator changes shape.
 *
 * Spreading the old condition would carry `left`/`right` into an `isVisible`, which
 * `.strict()` rejects — the user would change a dropdown and the document would silently
 * stop validating.
 */
function switchOp(previous: Condition, op: string, doc: SceneDocument): Condition {
  const carriedLeft = 'left' in previous ? previous.left : { const: '' as const }
  switch (op) {
    case 'in':
      return { op: 'in', left: carriedLeft, right: [] }
    case 'isVisible':
      return { op: 'isVisible', nodeId: doc.nodes[0]?.id ?? '', value: true }
    case 'isPlaying':
      return { op: 'isPlaying', animationId: doc.animations[0]?.id ?? '', value: true }
    case 'isPanelOpen':
      return { op: 'isPanelOpen', hotspotId: doc.hotspots[0]?.id ?? '', value: true }
    default:
      return {
        op: op as (typeof COMPARE_OPS)[number],
        left: carriedLeft,
        right: 'right' in previous && !Array.isArray(previous.right) ? previous.right : { const: '' },
      }
  }
}

/** A fresh condition for the "新增条件" button. */
export function newCondition(): Condition {
  return { op: 'eq', left: { const: '' }, right: { const: '' } }
}
