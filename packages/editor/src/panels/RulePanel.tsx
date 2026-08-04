import { EVENT_TYPES, EXECUTION_MODES, ON_ERROR_MODES, REENTRY_LABELS, REENTRY_POLICIES, newId } from '@w3/schema'
import type { Action, EventDescriptor, EventType, Rule, SceneDocument } from '@w3/schema'
import { allActions, getAction } from '@w3/core'
import type { RefKind } from '@w3/core'
import { useMemo, useState } from 'react'
import { ActionFields } from '../rule-editor/ActionFields.jsx'
import { ConditionRow, newCondition } from '../rule-editor/ConditionRow.jsx'
import { useDocumentActions, useDocumentSelector } from '../store/StoreContext.js'
import { usePickRequest } from '../viewport/pick-request.js'

/**
 * T-091 · the rule editor.
 *
 * The evaluation report's most pointed observation was about this panel not existing:
 * "它告诉我这个场景有 1 条规则，但没给我任何办法看它是什么。这比不显示更让人难受。"
 *
 * The hard constraint, from the task card: the action form is generated entirely from
 * `ActionDefinition.ui.fields`. There is no per-action form here and there must never be
 * one — the acceptance check is to register a new action and edit it without changing a
 * line of UI code. That is C5's only real test.
 */

const EVENT_LABELS: Record<EventType, string> = {
  sceneReady: '场景就绪',
  click: '点击',
  hoverEnter: '悬停进入',
  hoverLeave: '悬停离开',
  hotspotClick: '热点点击',
  animationEnd: '动画结束',
  variableChange: '变量变化',
  timer: '定时器',
  // v3 冻结形状、v1.2 才通电（T-225 · X-09/X-10）。这三个在这里只为**显示**存在：
  // 一份 v1.2 存过的文档在 v1.0 编辑器里打开时，规则列表必须读得出它是什么事件。
  pageEnter: '进入页面',
  flowStepEnter: '进入流程步骤',
  overlayClick: '点击覆盖层',
}

/**
 * 新建规则时可选的事件。
 *
 * **不是 `EVENT_TYPES`**：那三个 v1.2 的事件在 v1.0 一次都不会被触发，把它们摆进下拉框
 * 等于让用户配一条永远不响的规则，然后自己去猜为什么。冻结形状与开放入口是两件事。
 *
 * v1.2 接线时删掉这个常量、把下拉框改回 `EVENT_TYPES` 即可。
 */
const CREATABLE_EVENTS = EVENT_TYPES.filter(
  (t) => t !== 'pageEnter' && t !== 'flowStepEnter' && t !== 'overlayClick',
)

export function RulePanel() {
  const doc = useDocumentSelector((s) => s.doc)
  const { commit } = useDocumentActions()
  const [openId, setOpenId] = useState<string | null>(doc.rules[0]?.id ?? null)

  const update = (ruleId: string, label: string, mutate: (rule: Rule) => void) => {
    commit(label, (draft) => {
      const rule = draft.rules.find((r) => r.id === ruleId)
      if (rule) mutate(rule)
    })
  }

  const addRule = () => {
    const id = newId('rule', doc.rules.map((r) => r.id))
    const first = firstAction()
    if (!first) return
    commit('新建规则', (draft) => {
      draft.rules.push({
        id,
        name: `规则 ${draft.rules.length + 1}`,
        enabled: true,
        when: { event: 'sceneReady' },
        if: [],
        ifAny: [],
        mode: 'sequence',
        reentry: 'restart',
        onError: 'abort',
        // `then` has a min(1), so a new rule cannot start empty. Which action it starts
        // with is taken from the registry rather than named here: a hardcoded default
        // would be this panel knowing about one specific action, which is precisely what
        // T-091's acceptance forbids.
        then: [first],
      })
    })
    setOpenId(id)
  }

  return (
    <div className="subpanel">
      <div className="subpanel__head">
        规则<span className="num">{doc.rules.length}</span>
        <button type="button" className="tbtn" onClick={addRule}>
          新建规则
        </button>
      </div>

      {doc.rules.length === 0 ? (
        <p className="panel__empty">还没有规则。规则把「点了什么」和「发生什么」连起来。</p>
      ) : (
        <ul className="rule-list">
          {doc.rules.map((rule) => (
            <li key={rule.id} data-open={openId === rule.id}>
              <div className="rule-list__head">
                <input
                  type="checkbox"
                  checked={rule.enabled}
                  title="启用"
                  onChange={(event) =>
                    update(rule.id, `${event.target.checked ? '启用' : '停用'}规则 ${rule.name}`, (r) => {
                      r.enabled = event.target.checked
                    })
                  }
                />
                <button type="button" className="rule-list__title" onClick={() => setOpenId(openId === rule.id ? null : rule.id)}>
                  {openId === rule.id ? '▾' : '▸'} {rule.name}
                  <span className="rule-list__summary">{summarize(rule, doc)}</span>
                </button>
                <button
                  type="button"
                  className="tbtn"
                  title="删除规则"
                  onClick={() =>
                    commit(`删除规则 ${rule.name}`, (draft) => {
                      const at = draft.rules.findIndex((r) => r.id === rule.id)
                      if (at !== -1) draft.rules.splice(at, 1)
                    })
                  }
                >
                  ✕
                </button>
              </div>

              {openId === rule.id && <RuleEditor rule={rule} doc={doc} onUpdate={update} />}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function RuleEditor({
  rule,
  doc,
  onUpdate,
}: {
  rule: Rule
  doc: SceneDocument
  onUpdate: (ruleId: string, label: string, mutate: (rule: Rule) => void) => void
}) {
  const { request, picking } = usePickRequest()
  const actions = useMemo(() => allActions().sort((a, b) => a.ui.group.localeCompare(b.ui.group)), [])
  const set = (label: string, mutate: (rule: Rule) => void) => onUpdate(rule.id, label, mutate)

  return (
    <div className="rule-editor">
      <div className="rule-editor__grid">
        <label>
          <span>名称</span>
          <input className="field" value={rule.name} onChange={(e) => set('重命名规则', (r) => void (r.name = e.target.value || r.id))} />
        </label>

        <label>
          <span>当</span>
          <select
            className="field"
            value={rule.when.event}
            onChange={(event) => set('改规则触发事件', (r) => void (r.when = defaultEvent(event.target.value as EventType, doc)))}
          >
            {CREATABLE_EVENTS.map((type) => (
              <option key={type} value={type}>
                {EVENT_LABELS[type]}
              </option>
            ))}
          </select>
        </label>

        <EventTarget when={rule.when} doc={doc} onChange={(when) => set('改规则触发目标', (r) => void (r.when = when))} />

        <label>
          <span>执行</span>
          <select className="field" value={rule.mode} onChange={(e) => set('改执行方式', (r) => void (r.mode = e.target.value as Rule['mode']))}>
            {EXECUTION_MODES.map((mode) => (
              <option key={mode} value={mode}>
                {mode === 'sequence' ? '顺序' : '并行'}
              </option>
            ))}
          </select>
        </label>

        <label>
          <span>重入</span>
          {/* D9 · the default is `restart`, and the labels spell out what each one does:
              a triple-click with the wrong policy is a bug that only shows up in a demo. */}
          <select className="field" value={rule.reentry} onChange={(e) => set('改重入策略', (r) => void (r.reentry = e.target.value as Rule['reentry']))}>
            {REENTRY_POLICIES.map((policy) => (
              <option key={policy} value={policy}>
                {REENTRY_LABELS[policy]}
              </option>
            ))}
          </select>
        </label>

        <label>
          <span>出错时</span>
          <select className="field" value={rule.onError} onChange={(e) => set('改出错策略', (r) => void (r.onError = e.target.value as Rule['onError']))}>
            {ON_ERROR_MODES.map((mode) => (
              <option key={mode} value={mode}>
                {mode === 'abort' ? '中止后续动作' : '继续执行'}
              </option>
            ))}
          </select>
        </label>
      </div>

      <ConditionList
        title="且满足（全部）"
        conditions={rule.if}
        doc={doc}
        onChange={(next) => set('改规则条件', (r) => void (r.if = next))}
      />
      <ConditionList
        title="或满足（任一）"
        conditions={rule.ifAny}
        doc={doc}
        onChange={(next) => set('改规则条件', (r) => void (r.ifAny = next))}
      />

      <div className="rule-editor__actions">
        <div className="rule-editor__subhead">
          则执行
          <select
            className="field"
            value=""
            onChange={(event) => {
              const type = event.target.value
              if (!type) return
              set('新增动作', (r) => void r.then.push({ action: type, params: {} }))
            }}
          >
            <option value="">＋ 添加动作…</option>
            {actions.map((definition) => (
              <option key={definition.type} value={definition.type}>
                {definition.ui.label}
              </option>
            ))}
          </select>
        </div>

        <ol className="action-list">
          {rule.then.map((action, index) => (
            <ActionRow
              key={`${action.action}-${index}`}
              action={action}
              index={index}
              total={rule.then.length}
              doc={doc}
              picking={picking?.key ?? null}
              onPickRequest={(key, refKind) =>
                request(refKind, (nodeId) =>
                  set('拾取动作目标', (r) => {
                    const target = r.then[index]
                    if (target) target.params = { ...target.params, [key]: nodeId }
                  }),
                  key,
                )
              }
              onChange={(key, value) =>
                set('改动作参数', (r) => {
                  const target = r.then[index]
                  if (!target) return
                  target.params = applyParamChange(target.params, key, value)
                })
              }
              onMove={(delta) =>
                set('调整动作顺序', (r) => {
                  const to = index + delta
                  if (to < 0 || to >= r.then.length) return
                  const [moved] = r.then.splice(index, 1)
                  if (moved) r.then.splice(to, 0, moved)
                })
              }
              onRemove={() =>
                set('删除动作', (r) => {
                  // `then` has min(1); removing the last one would make the document
                  // invalid, so the button refuses rather than the save failing later.
                  if (r.then.length > 1) r.then.splice(index, 1)
                })
              }
            />
          ))}
        </ol>
      </div>
    </div>
  )
}

function ActionRow({
  action,
  index,
  total,
  doc,
  picking,
  onChange,
  onPickRequest,
  onMove,
  onRemove,
}: {
  action: Action
  index: number
  total: number
  doc: SceneDocument
  picking: string | null
  onChange: (key: string, value: unknown) => void
  onPickRequest: (key: string, refKind: RefKind) => void
  onMove: (delta: number) => void
  onRemove: () => void
}) {
  const definition = getAction(action.action)

  if (!definition) {
    // An action type the registry does not know. Saying so beats rendering an empty box:
    // this is what a document from a newer build looks like, and the user needs to know
    // their edit will not touch it.
    return (
      <li className="action-row action-row--unknown">
        <span>
          未知动作 <code>{action.action}</code> —— 当前构建没有注册它，参数已原样保留
        </span>
      </li>
    )
  }

  return (
    <li className="action-row">
      <div className="action-row__head">
        <span className="action-row__index">{index + 1}</span>
        <b>{definition.ui.label}</b>
        <span className="action-row__desc">{safeDescribe(definition, action.params, doc)}</span>
        <button type="button" className="tbtn" disabled={index === 0} onClick={() => onMove(-1)} title="上移">
          ↑
        </button>
        <button type="button" className="tbtn" disabled={index === total - 1} onClick={() => onMove(1)} title="下移">
          ↓
        </button>
        <button type="button" className="tbtn" disabled={total === 1} onClick={onRemove} title={total === 1 ? '规则至少要有一个动作' : '删除'}>
          ✕
        </button>
      </div>
      <ActionFields
        fields={definition.ui.fields}
        params={action.params}
        doc={doc}
        onChange={onChange}
        onPickRequest={onPickRequest}
        picking={picking}
      />
    </li>
  )
}

/**
 * One edit to one action parameter, as a pure function.
 *
 * Extracted by T-215 for a reason the card names precisely: **clearing a field DELETES the
 * key**, which is the first of three defects that made 「留空取消高亮」 fail from v0 onwards
 * (the other two were `preset` not being optional in zod, and the executor reporting
 * `failed` for the resulting parse error). The behaviour is correct — an absent key is how
 * a document says "not set", and writing `''` would put an invalid value in the document —
 * but it can only be TESTED if it is reachable without a DOM, and the editor's tests run in
 * plain Node.
 *
 * Inline, this rule could be described in a test and never actually exercised, which is
 * exactly how it went unnoticed for two releases.
 */
export function applyParamChange(
  params: Record<string, unknown>,
  key: string,
  value: unknown,
): Record<string, unknown> {
  const next = { ...params }
  if (value === undefined || value === '') delete next[key]
  else next[key] = value
  return next
}

function ConditionList({
  title,
  conditions,
  doc,
  onChange,
}: {
  title: string
  conditions: Rule['if']
  doc: SceneDocument
  onChange: (next: Rule['if']) => void
}) {
  return (
    <div className="rule-editor__conds">
      <div className="rule-editor__subhead">
        {title}
        <button type="button" className="tbtn" onClick={() => onChange([...conditions, newCondition()])}>
          ＋ 条件
        </button>
      </div>
      {conditions.map((condition, index) => (
        <ConditionRow
          key={index}
          condition={condition}
          doc={doc}
          onChange={(next) => onChange(conditions.map((c, i) => (i === index ? next : c)))}
          onRemove={() => onChange(conditions.filter((_, i) => i !== index))}
        />
      ))}
    </div>
  )
}

/** The event-specific half of `when`, which varies by event type. */
function EventTarget({ when, doc, onChange }: { when: EventDescriptor; doc: SceneDocument; onChange: (when: EventDescriptor) => void }) {
  if (when.event === 'sceneReady') return null

  if (when.event === 'timer') {
    return (
      <>
        <label>
          <span>延迟（毫秒）</span>
          <input
            className="field field--num"
            type="number"
            min={0}
            value={when.delay}
            onChange={(event) => {
              const delay = Number(event.target.value)
              if (Number.isFinite(delay) && delay >= 0) onChange({ ...when, delay })
            }}
          />
        </label>
        <label>
          <span>重复</span>
          <input type="checkbox" checked={when.repeat} onChange={(event) => onChange({ ...when, repeat: event.target.checked })} />
        </label>
      </>
    )
  }

  if (when.event === 'hotspotClick') {
    return (
      <label>
        <span>热点</span>
        <select className="field" value={when.hotspotId} onChange={(e) => onChange({ ...when, hotspotId: e.target.value })}>
          {doc.hotspots.map((hotspot) => (
            <option key={hotspot.id} value={hotspot.id}>
              {hotspot.name}
            </option>
          ))}
        </select>
      </label>
    )
  }

  if (when.event === 'animationEnd') {
    return (
      <label>
        <span>动画</span>
        <select className="field" value={when.animationId} onChange={(e) => onChange({ ...when, animationId: e.target.value })}>
          {doc.animations.map((animation) => (
            <option key={animation.id} value={animation.id}>
              {animation.name}
            </option>
          ))}
        </select>
      </label>
    )
  }

  if (when.event === 'variableChange') {
    return (
      <label>
        <span>变量</span>
        <select className="field" value={when.variableId} onChange={(e) => onChange({ ...when, variableId: e.target.value })}>
          {doc.variables.map((variable) => (
            <option key={variable.id} value={variable.id}>
              {variable.name}（{variable.id}）
            </option>
          ))}
        </select>
      </label>
    )
  }

  // v3 起 `when` 的判别联合里有三支没有 `target`（pageEnter / flowStepEnter /
  // overlayClick）。它们在 v1.0 建不出来，但**打得开**——一份 v1.2 的文档进到这里时，
  // 读 `when.target` 会是 undefined，而下面整段都建立在它存在之上。
  if (!('target' in when)) {
    return (
      <label>
        <span>目标</span>
        <span className="hint">该事件在 v1.0 尚未接线，规则可保存但不会触发</span>
      </label>
    )
  }

  // click / hoverEnter / hoverLeave — all carry a NodeTarget.
  const target = when.target
  const any = 'any' in target
  return (
    <>
      <label>
        <span>目标</span>
        <select
          className="field"
          value={any ? '' : target.nodeId}
          onChange={(event) =>
            onChange({ ...when, target: event.target.value === '' ? { any: true } : { nodeId: event.target.value } })
          }
        >
          <option value="">任意对象</option>
          {doc.nodes.map((node) => (
            <option key={node.id} value={node.id}>
              {node.name}
            </option>
          ))}
        </select>
      </label>
      {!any && (
        <label>
          <span>含子对象</span>
          {/* Without this, a 34-mesh assembly needs 34 identical rules (SCHEMA_SPEC §6.6). */}
          <input
            type="checkbox"
            checked={'includeDescendants' in target}
            onChange={(event) =>
              onChange({
                ...when,
                target: event.target.checked ? { nodeId: target.nodeId, includeDescendants: true } : { nodeId: target.nodeId },
              })
            }
          />
        </label>
      )}
    </>
  )
}

function defaultEvent(type: EventType, doc: SceneDocument): EventDescriptor {
  switch (type) {
    case 'sceneReady':
      return { event: 'sceneReady' }
    case 'timer':
      return { event: 'timer', delay: 1000, repeat: false, startOn: 'sceneReady' }
    case 'hotspotClick':
      return { event: 'hotspotClick', hotspotId: doc.hotspots[0]?.id ?? '' }
    case 'animationEnd':
      return { event: 'animationEnd', animationId: doc.animations[0]?.id ?? '' }
    case 'variableChange':
      return { event: 'variableChange', variableId: doc.variables[0]?.id ?? '' }
    case 'pageEnter':
      return { event: 'pageEnter', pageId: doc.pages[0]?.id ?? '' }
    case 'flowStepEnter':
      return { event: 'flowStepEnter', flowId: doc.flows[0]?.id ?? '', stepId: doc.flows[0]?.steps[0]?.id ?? '' }
    case 'overlayClick':
      return { event: 'overlayClick', overlayId: doc.pages[0]?.overlays[0]?.id ?? '' }
    default:
      // click / hoverEnter / hoverLeave —— 只剩这三支带 NodeTarget。
      // 上面三个 case 在 v1.0 走不到（`CREATABLE_EVENTS` 把它们挡在下拉框外），写出来是为了
      // 让编译器替我们守住「`when` 又多一支时这里必须跟着改」。
      return { event: type, target: { any: true } }
  }
}

/**
 * A starter action for a brand-new rule, with every field's declared default filled in.
 *
 * Registry-driven end to end: whichever action sorts first is used, and its parameters
 * come from its own `ui.fields`.
 */
function firstAction(): Action | null {
  const definition = allActions().sort((a, b) => a.type.localeCompare(b.type))[0]
  if (!definition) return null
  const params: Record<string, unknown> = {}
  for (const field of definition.ui.fields) {
    if ('default' in field && field.default !== undefined) params[field.key] = field.default
  }
  return { action: definition.type, params }
}

/** One line per rule for the collapsed list, built from each action's own `describe`. */
function summarize(rule: Rule, doc: SceneDocument): string {
  const when = EVENT_LABELS[rule.when.event]
  const steps = rule.then.map((action) => {
    const definition = getAction(action.action)
    return definition ? safeDescribe(definition, action.params, doc) : action.action
  })
  return `${when} → ${steps.join(' · ')}`
}

/**
 * `describe` is author-written and receives params that may not have been filled in yet.
 * A throw here would blank the whole panel, which is a much worse failure than a row that
 * says it could not describe itself.
 */
function safeDescribe(definition: ReturnType<typeof getAction>, params: unknown, doc: SceneDocument): string {
  if (!definition) return ''
  try {
    return definition.describe(params, doc)
  } catch {
    return '（参数尚未填完）'
  }
}
