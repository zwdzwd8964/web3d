import { useEffect, useMemo, useState } from 'react'
import { deleteWarning, formatBytes, formatDuration, mediaRows, removeMedia, renameMedia } from '../lib/media-edit.js'
import { useProject } from '../project/ProjectContext.jsx'
import { useDocumentActions, useDocumentSelector } from '../store/StoreContext.js'
import { TextField } from '../widgets/NumberField.js'

/**
 * T-161 · the media library.
 *
 * Playback here is a PREVIEW, deliberately outside the MediaBus (T-163): the bus is the
 * scene's audio — what a rule started, what `stopMedia('all')` stops, what leaving preview
 * mode silences. Auditioning a file in a list is not part of the scene, and routing it
 * through the bus would mean a preview clip kept playing when the user hit 停止 in the
 * viewport, or got cut off when a rule fired.
 *
 * Deleting asks first, and the question names what actually points at the record. 「确认
 * 删除？」 with no detail is a dialog people learn to click through.
 */

const TYPE_ICON = { audio: '♪', video: '▶', image: '▣' } as const

export function MediaPanel() {
  const doc = useDocumentSelector((s) => s.doc)
  const { commit } = useDocumentActions()
  const session = useProject()

  const rows = useMemo(() => mediaRows(doc), [doc])
  const [playing, setPlaying] = useState<string | null>(null)
  const [url, setUrl] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<string | null>(null)

  /**
   * Resolves the bytes for the row being auditioned.
   *
   * One object URL at a time, revoked when it changes or the panel unmounts — the leak this
   * prevents pins a whole video in memory for the life of the tab, and it is invisible until
   * someone has clicked through twenty files.
   */
  useEffect(() => {
    if (playing === null) {
      setUrl(null)
      return
    }
    const media = doc.media.find((m) => m.id === playing)
    const asset = media ? doc.assets.find((a) => a.id === media.assetId) : undefined
    if (!asset) return

    let revoked = false
    let objectUrl: string | null = null
    void session.resolver.resolve(asset.url).then((bytes) => {
      if (revoked) return
      objectUrl = URL.createObjectURL(new Blob([bytes]))
      setUrl(objectUrl)
    })
    return () => {
      revoked = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
      setUrl(null)
    }
  }, [playing, doc.media, doc.assets, session])

  return (
    <div className="subpanel">
      <div className="subpanel__head">
        媒体
        <span className="num">{rows.length}</span>
      </div>

      {rows.length === 0 ? (
        <p className="panel__empty">还没有媒体。在「资产」页签导入 mp3 / wav / ogg / mp4 / webm。</p>
      ) : (
        <ul className="media-list">
          {rows.map((row) => (
            <li key={row.media.id} className="media-list__row">
              <span className="media-list__icon" aria-hidden="true">
                {TYPE_ICON[row.media.type]}
              </span>
              <TextField
                label=""
                value={row.media.name}
                onCommit={(name) => commit('重命名媒体', (draft) => renameMedia(draft, row.media.id, name))}
              />
              <span className="media-list__meta">
                {formatDuration(row.media.durationS)} · {formatBytes(row.bytes)}
                {row.refCount > 0 && ` · 被${row.refSummary}引用`}
              </span>
              <button
                type="button"
                className="tbtn"
                aria-pressed={playing === row.media.id}
                onClick={() => setPlaying(playing === row.media.id ? null : row.media.id)}
              >
                {playing === row.media.id ? '停止' : '试听'}
              </button>
              <button type="button" className="tbtn" onClick={() => setConfirming(row.media.id)}>
                删除
              </button>

              {playing === row.media.id && url !== null && (
                <div className="media-list__player">
                  {row.media.type === 'video' ? (
                    <video src={url} controls autoPlay width={240} />
                  ) : (
                    <audio src={url} controls autoPlay />
                  )}
                </div>
              )}

              {confirming === row.media.id && (
                <p className="panel__note">
                  {deleteWarning(doc, row.media.id) ?? `确认删除「${row.media.name}」？`}
                  <button
                    type="button"
                    className="tbtn"
                    onClick={() => {
                      commit('删除媒体', (draft) => removeMedia(draft, row.media.id))
                      setConfirming(null)
                      if (playing === row.media.id) setPlaying(null)
                    }}
                  >
                    删除
                  </button>
                  <button type="button" className="tbtn" onClick={() => setConfirming(null)}>
                    取消
                  </button>
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
