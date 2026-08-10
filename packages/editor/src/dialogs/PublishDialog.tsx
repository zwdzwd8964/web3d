import { formatBytes } from '@w3/core'
import { useEffect, useState } from 'react'
import { useProject } from '../project/ProjectContext.jsx'
import { CORE_VERSION } from '../version.js'
import { downloadPackage, precheck, publish } from '../publish/publish.js'
import type { PublishPrecheck, PublishResult } from '../publish/publish.js'
import { saveSnapshot } from '../publish/snapshots.js'
import { useDocumentActions, useDocumentSelector } from '../store/StoreContext.js'
import { captureThumbnail } from '../viewport/runtime-registry.js'

/**
 * T-100 · the publish dialog.
 *
 * Its job is to refuse. D8 makes `validate` + `checkIntegrity` a hard gate, and the value
 * of a gate is entirely in what it stops — so the failure state is the one that gets the
 * detail: every blocking issue listed, each one clickable back to the object it is about.
 *
 * The success state is deliberately dull: what was packed, how big, and a button.
 */
export function PublishDialog({ onClose }: { onClose: () => void }) {
  const doc = useDocumentSelector((s) => s.doc)
  const { select } = useDocumentActions()
  const session = useProject()

  const [check, setCheck] = useState<PublishPrecheck | null>(null)
  const [result, setResult] = useState<PublishResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [label, setLabel] = useState('')

  useEffect(() => {
    let cancelled = false
    void precheck(doc, session.storage).then((next) => {
      if (!cancelled) setCheck(next)
    })
    return () => {
      cancelled = true
    }
  }, [doc, session])

  const run = async () => {
    setBusy(true)
    setError(null)
    try {
      const produced = await publish({
        doc,
        storage: session.storage,
        coreVersion: CORE_VERSION,
        // T-269 · 接通那条铺好没人走的路： 从 T-100 起就收 ，
        //  从来就会写它，而全仓没有一个调用方传过——发布包里因此从来没有
        // 过缩略图。出图失败不阻断发布（ 内部吞掉）。
        captureThumbnail,
        ...(label.trim() ? { label: label.trim() } : {}),
      })
      // The snapshot is saved before the download: a download the user cancels still leaves
      // a recoverable record, whereas a snapshot that depended on the download succeeding
      // would silently not exist.
      await saveSnapshot(session.storage, produced.snapshot)
      setResult(produced)
      downloadPackage(produced.bytes, produced.filename)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="modal__body modal__body--wide" onClick={(event) => event.stopPropagation()}>
        <h3>发布</h3>

        {!check && <p className="panel__note">正在检查…</p>}

        {check && !check.ok && (
          <>
            <p className="panel__note panel__note--warn">
              有 {check.schemaErrors.length + check.errors.length + check.missingBlobs.length} 项问题必须先解决才能发布。
            </p>
            <ul className="issue-list">
              {check.schemaErrors.map((message, i) => (
                <li key={`schema-${i}`} data-level="error">
                  <span className="issue-list__row">
                    <span className="issue-list__code">结构</span>
                    <span className="issue-list__msg">{message}</span>
                  </span>
                </li>
              ))}
              {check.errors.map((issue, i) => (
                <li key={`issue-${i}`} data-level="error">
                  <button
                    type="button"
                    className="issue-list__row"
                    disabled={issue.refKind !== 'node' || !issue.refId}
                    onClick={() => issue.refId && select([issue.refId])}
                  >
                    <span className="issue-list__code">{issue.code}</span>
                    <span className="issue-list__msg">{issue.message}</span>
                    <code className="issue-list__path">{issue.path}</code>
                  </button>
                </li>
              ))}
              {check.missingBlobs.map((name) => (
                <li key={name} data-level="error">
                  <span className="issue-list__row">
                    <span className="issue-list__code">资产</span>
                    <span className="issue-list__msg">{name} 的文件不在本地存储中，无法打进包里</span>
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}

        {check?.ok && !result && (
          <>
            <p className="panel__note">
              将打包 <b className="num">{check.referenced.size}</b> 个被引用的资产
              {check.warnings.length > 0 && <> · {check.warnings.length} 项提示不阻断发布</>}
            </p>
            <label className="fields__row">
              <span className="fields__label">版本标签（可选）</span>
              <input
                className="field"
                value={label}
                placeholder="如：客户评审 v2"
                onChange={(event) => setLabel(event.target.value)}
              />
            </label>
          </>
        )}

        {result && (
          <p className="panel__note">
            已导出 <code>{result.filename}</code> · {formatBytes(result.bytes.byteLength)} ·{' '}
            <b className="num">{result.assetCount}</b> 个资产 · 已存为快照
          </p>
        )}

        {error && <p className="panel__note panel__note--warn">{error}</p>}

        <div className="modal__actions">
          <button type="button" className="tbtn" onClick={onClose}>
            {result ? '关闭' : '取消'}
          </button>
          {!result && (
            <button type="button" className="tbtn tbtn--primary" disabled={!check?.ok || busy} onClick={() => void run()}>
              {busy ? '打包中…' : '发布并下载 .w3p'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
