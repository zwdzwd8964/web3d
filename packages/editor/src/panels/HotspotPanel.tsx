import { HOTSPOT_MARKERS, buildIndex, createHotspot, describeReferences } from '@w3/schema'
import type { Hotspot } from '@w3/schema'
import { useMemo } from 'react'
import { useDocumentActions, useDocumentSelector } from '../store/StoreContext.js'

/**
 * Hotspots.
 *
 * The layer that renders these has existed since T-041 — anchor projection, occlusion
 * testing, frustum culling, throttling, 291 lines of it — and there was no way to create
 * one. The sample document's hotspot was the only one that could ever exist, because it
 * was written into the fixture by hand. Golden path step 9 is "在阀盖上加热点", and until
 * this panel it was unreachable from the UI.
 *
 * Anchoring is by node id and a local-space offset (SCHEMA_SPEC §6.4), so a hotspot
 * follows its part when the part moves — which is the entire reason it is anchored to a
 * node rather than to a world position.
 */

const MARKER_LABELS: Record<(typeof HOTSPOT_MARKERS)[number], string> = {
  dot: '圆点',
  pin: '标记针',
  number: '编号',
}

export function HotspotPanel() {
  const doc = useDocumentSelector((s) => s.doc)
  const selection = useDocumentSelector((s) => s.selection)
  const { commit, select } = useDocumentActions()

  const index = useMemo(() => buildIndex(doc), [doc])
  const selectedNode = selection.length === 1 ? doc.nodes.find((n) => n.id === selection[0]) : undefined

  const add = () => {
    if (!selectedNode) return
    commit(`新建热点 ${selectedNode.name}`, (draft) => {
      draft.hotspots.push(
        createHotspot({
          name: `${selectedNode.name} 说明`,
          nodeId: selectedNode.id,
          title: selectedNode.name,
          text: '',
          ctx: { newId: () => newHotspotId(draft.hotspots.map((h) => h.id)), now: () => new Date().toISOString() },
        }),
      )
    })
  }

  const update = (id: string, label: string, mutate: (hotspot: Hotspot) => void) => {
    commit(label, (draft) => {
      const hotspot = draft.hotspots.find((h) => h.id === id)
      if (hotspot) mutate(hotspot)
    })
  }

  return (
    <div className="subpanel">
      <div className="subpanel__head">
        热点<span className="num">{doc.hotspots.length}</span>
        <button
          type="button"
          className="tbtn"
          onClick={add}
          disabled={!selectedNode}
          title={selectedNode ? `锚定到「${selectedNode.name}」` : '先在层级树里选中一个对象'}
        >
          在选中对象上新建
        </button>
        {!selectedNode && <span className="panel__hint">先选中一个对象</span>}
      </div>

      {doc.hotspots.length === 0 ? (
        <p className="panel__empty">还没有热点。热点锚定在对象上，对象移动时跟着走。</p>
      ) : (
        <ul className="hotspot-list">
          {doc.hotspots.map((hotspot) => {
            const anchor = doc.nodes.find((n) => n.id === hotspot.anchor.nodeId)
            const uses = describeReferences(index, hotspot.id)
            return (
              <li key={hotspot.id}>
                <div className="hotspot-list__head">
                  <input
                    type="checkbox"
                    checked={hotspot.visible}
                    title="初始可见"
                    onChange={(e) => update(hotspot.id, '改热点可见性', (h) => void (h.visible = e.target.checked))}
                  />
                  <input
                    className="field"
                    value={hotspot.name}
                    onChange={(e) => update(hotspot.id, '重命名热点', (h) => void (h.name = e.target.value || h.id))}
                  />
                  <button
                    type="button"
                    className="tbtn"
                    disabled={!anchor}
                    title={anchor ? `选中锚点对象「${anchor.name}」` : '锚点对象已被删除'}
                    onClick={() => anchor && select([anchor.id])}
                  >
                    {anchor?.name ?? '锚点已失效'}
                  </button>
                  <button
                    type="button"
                    className="tbtn"
                    title={uses ? `被 ${uses} 引用` : '删除'}
                    onClick={() =>
                      commit(`删除热点 ${hotspot.name}`, (draft) => {
                        const at = draft.hotspots.findIndex((h) => h.id === hotspot.id)
                        if (at !== -1) draft.hotspots.splice(at, 1)
                      })
                    }
                  >
                    ✕
                  </button>
                </div>

                <div className="hotspot-list__body">
                  <label className="fields__row">
                    <span className="fields__label">标题</span>
                    <input
                      className="field"
                      value={hotspot.content.title}
                      onChange={(e) => update(hotspot.id, '改热点标题', (h) => void (h.content.title = e.target.value))}
                    />
                  </label>
                  <label className="fields__row fields__row--wide">
                    <span className="fields__label">正文</span>
                    <textarea
                      className="field"
                      rows={2}
                      value={hotspot.content.text}
                      onChange={(e) => update(hotspot.id, '改热点正文', (h) => void (h.content.text = e.target.value))}
                    />
                  </label>
                  <label className="fields__row fields__row--wide">
                    <span className="fields__label">媒体</span>
                    {/* T-162 · a `ref` field pointing at a media record. The panel renders
                        it (image auto-fit, video with native controls), and the PLAYER gets
                        it for free — same core renderer, C3. */}
                    <select
                      className="field"
                      value={hotspot.content.mediaId ?? ''}
                      onChange={(e) =>
                        update(hotspot.id, '改热点媒体', (h) => {
                          // Deleted rather than set to undefined: `content` is a strict
                          // object, and an explicit undefined survives a JSON round-trip as
                          // a key with no value that then fails validation on reload.
                          if (e.target.value === '') delete h.content.mediaId
                          else h.content.mediaId = e.target.value
                        })
                      }
                    >
                      <option value="">（无）</option>
                      {doc.media.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="fields__row">
                    <span className="fields__label">遮挡判定</span>
                    {/* D7 · when on, a marker behind geometry dims. Off means it always
                        shows through, which is what a callout on a hidden internal part
                        needs. */}
                    <input
                      type="checkbox"
                      checked={hotspot.occlude}
                      onChange={(e) => update(hotspot.id, '改热点遮挡', (h) => void (h.occlude = e.target.checked))}
                    />
                  </label>
                  <label className="fields__row">
                    <span className="fields__label">样式</span>
                    <select
                      className="field"
                      value={hotspot.style.marker}
                      onChange={(e) =>
                        update(hotspot.id, '改热点样式', (h) => void (h.style.marker = e.target.value as Hotspot['style']['marker']))
                      }
                    >
                      {HOTSPOT_MARKERS.map((marker) => (
                        <option key={marker} value={marker}>
                          {MARKER_LABELS[marker]}
                        </option>
                      ))}
                    </select>
                    <input
                      type="color"
                      value={hotspot.style.color}
                      onChange={(e) => update(hotspot.id, '改热点颜色', (h) => void (h.style.color = e.target.value))}
                    />
                  </label>
                  {/* T-264 · 编号。**只在「编号」标记下出现**——给一个小圆点填编号，填了也不显示。 */}
                  {hotspot.style.marker === 'number' && (
                    <label className="fields__row">
                      <span className="fields__label">编号</span>
                      <input
                        className="field"
                        type="text"
                        maxLength={8}
                        data-testid="hotspot-label"
                        placeholder={`默认 ${doc.hotspots.findIndex((h) => h.id === hotspot.id) + 1}`}
                        value={hotspot.style.label ?? ''}
                        onChange={(e) =>
                          update(hotspot.id, '改热点编号', (h) => {
                            // 空串 = 回到缺省序号，而不是存一个空字符串。存空串的话，
                            // `label ?? String(ordinal+1)` 会拿到 `''` 而不是走缺省分支，
                            // 标记上从此一个字都没有。
                            const next = e.target.value.trim()
                            if (next === '') delete h.style.label
                            else h.style.label = next
                          })
                        }
                      />
                    </label>
                  )}
                  <label className="fields__row">
                    <span className="fields__label">偏移</span>
                    {(['X', 'Y', 'Z'] as const).map((axis, i) => (
                      <input
                        key={axis}
                        className="field field--num"
                        type="number"
                        step={0.05}
                        value={hotspot.anchor.offset[i]}
                        onChange={(e) => {
                          const next = Number(e.target.value)
                          // ADR-0004 · no NaN or Infinity ever reaches the document.
                          if (Number.isFinite(next)) {
                            update(hotspot.id, '改热点偏移', (h) => void (h.anchor.offset[i] = next))
                          }
                        }}
                      />
                    ))}
                  </label>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

/** `hs_` + 8 chars, skipping anything already taken. */
function newHotspotId(existing: readonly string[]): string {
  const alphabet = '0123456789abcdefghijklmnopqrstuvwxyz'
  const taken = new Set(existing)
  for (let attempt = 0; attempt < 64; attempt++) {
    const bytes = new Uint8Array(8)
    crypto.getRandomValues(bytes)
    let id = 'hs_'
    for (const byte of bytes) id += alphabet[byte % alphabet.length]
    if (!taken.has(id)) return id
  }
  throw new Error('无法生成不重复的热点 id')
}
