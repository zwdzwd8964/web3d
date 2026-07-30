import type { AuditFinding } from '@w3/schema'
import { formatBytes } from '@w3/core'
import { useRef, useState } from 'react'
import { applyImport, importModel, placeInstance, summarizeImport } from '../lib/import-flow.js'
import type { ImportProgress, ImportResult } from '../lib/import-flow.js'
import { useProject } from '../project/ProjectContext.jsx'
import { useDocumentActions, useDocumentSelector } from '../store/StoreContext.js'

/**
 * T-066 · the asset panel and its import flow.
 *
 * The health report is not decoration. R01 says a customer's CAD export is the one
 * problem no architecture solves, and this dialog is where that gets said out loud —
 * with numbers, a limit, and a concrete next step per failing item. It is simultaneously
 * the technical safeguard and the contractual one (§6.3).
 *
 * The second upload of the same model is the case R02 is about, and it lands in the same
 * dialog: "已迁移 N 项 / 需确认 M 项 / 失效 K 项", with the orphans listed for re-pointing.
 */

export function AssetPanel() {
  // One session for the whole editor. A second storage/loader pair lived here once, and
  // the result was an import that reported success everywhere except the viewport.
  const { storage, loader } = useProject()
  const doc = useDocumentSelector((s) => s.doc)
  const { commit } = useDocumentActions()

  const [progress, setProgress] = useState<ImportProgress | null>(null)
  const [pending, setPending] = useState<ImportResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [replacing, setReplacing] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  const runImport = async (file: File) => {
    setError(null)
    setPending(null)
    try {
      const result = await importModel({
        file: { name: file.name, bytes: await file.arrayBuffer() },
        doc,
        storage,
        loader,
        ...(replacing ? { replacesAssetId: replacing } : {}),
        onProgress: setProgress,
      })
      setProgress(null)
      setPending(result)
    } catch (cause) {
      setProgress(null)
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  const addInstance = async (assetId: string, name: string) => {
    setError(null)
    try {
      const nodes = await placeInstance({ doc, assetId, loader })
      // One undo entry for the whole placement, not one per node.
      commit(`放置实例 ${name}`, (draft) => {
        draft.nodes.push(...nodes.map((n) => ({ ...n })))
      })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  const confirmImport = () => {
    if (!pending) return
    // The whole import is one undo entry, not one per node.
    commit(pending.remap ? `更新资产 ${pending.asset.name}` : `导入 ${pending.asset.name}`, (draft) =>
      applyImport(draft, pending),
    )
    setPending(null)
    setReplacing(null)
  }

  return (
    <section className="panel panel--bottom">
      <div className="panel__head">
        资产<span className="num">{doc.assets.length}</span>
        <button type="button" className="tbtn" onClick={() => fileInput.current?.click()}>
          导入 GLB
        </button>
        <input
          ref={fileInput}
          type="file"
          accept=".glb,.gltf,model/gltf-binary"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0]
            if (file) void runImport(file)
            event.target.value = ''
          }}
        />
      </div>

      <div
        className="panel__body"
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault()
          const file = event.dataTransfer.files[0]
          if (file) void runImport(file)
        }}
      >
        {progress && <p className="panel__note">{progress.message}</p>}
        {error && <p className="panel__note panel__note--warn">导入失败：{error}</p>}

        {doc.assets.length === 0 && !progress && !pending && (
          <p className="panel__empty">把 GLB 文件拖到这里，或点「导入 GLB」</p>
        )}

        <ul className="asset-list">
          {doc.assets.map((asset) => (
            <li key={asset.id}>
              <b>{asset.name}</b>
              <span className="num">v{asset.version}</span>
              <span className="num">{formatBytes(asset.stats.bytes)}</span>
              <span className="num">{asset.stats.tris.toLocaleString('en-US')} 面</span>
              {asset.audit && <AuditBadge findings={asset.audit.findings} />}
              <button
                type="button"
                className="tbtn"
                title="在场景中再放一份该资产的实例"
                onClick={() => void addInstance(asset.id, asset.name)}
              >
                放置实例
              </button>
              <button
                type="button"
                className="tbtn"
                title="上传新版本并迁移已有配置"
                onClick={() => {
                  setReplacing(asset.id)
                  fileInput.current?.click()
                }}
              >
                更新
              </button>
            </li>
          ))}
        </ul>

        {pending && (
          <ImportReport result={pending} onConfirm={confirmImport} onCancel={() => setPending(null)} />
        )}
      </div>
    </section>
  )
}

function AuditBadge({ findings }: { findings: readonly AuditFinding[] }) {
  const failed = findings.filter((f) => f.level === 'fail').length
  const warned = findings.filter((f) => f.level === 'warn').length
  if (failed > 0) return <span className="badge badge--fail">{failed} 项超标</span>
  if (warned > 0) return <span className="badge badge--warn">{warned} 项接近上限</span>
  return <span className="badge badge--ok">体检通过</span>
}

function ImportReport({
  result,
  onConfirm,
  onCancel,
}: {
  result: ImportResult
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <div className="report">
      <h3>{result.asset.name}</h3>
      <p className="report__summary">{summarizeImport(result)}</p>

      <table className="report__table">
        <thead>
          <tr>
            <th>项目</th>
            <th>实测</th>
            <th>上限</th>
            <th>结论</th>
            <th>建议</th>
          </tr>
        </thead>
        <tbody>
          {result.audit.audit.findings.map((finding) => (
            <tr key={finding.metric} data-level={finding.level}>
              <td>{finding.metric}</td>
              <td className="num">{finding.value.toLocaleString('en-US')}</td>
              <td className="num">{finding.limit.toLocaleString('en-US')}</td>
              <td>{finding.level === 'pass' ? '通过' : finding.level === 'warn' ? '接近上限' : '超标'}</td>
              <td>{finding.advice}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {result.remap && (
        <>
          <h4>资产映射</h4>
          {/* D5 · orphans are listed, never silently dropped. */}
          {result.remap.orphaned.length > 0 && (
            <ul className="report__orphans">
              {result.remap.orphaned.map((entry) => (
                <li key={entry.nodeId}>
                  <b>{entry.nodeName}</b> · 原路径 <code>{entry.from}</code> 在新资产中已不存在，配置已保留，需人工重新指定
                </li>
              ))}
            </ul>
          )}
          {result.remap.ambiguous.map((entry) => (
            <div key={entry.nodeId} className="report__ambiguous">
              <b>{entry.nodeName}</b> 有 {entry.candidates.length} 个同名候选，需人工选择：
              <ul>
                {entry.candidates.map((candidate) => (
                  <li key={candidate}>
                    <code>{candidate}</code>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </>
      )}

      <div className="report__actions">
        <button type="button" className="tbtn" onClick={onCancel}>
          取消
        </button>
        <button type="button" className="tbtn tbtn--primary" onClick={onConfirm}>
          {result.audit.verdict === 'fail' ? '仍然导入' : '确认导入'}
        </button>
      </div>
      {result.audit.verdict === 'fail' && (
        <p className="panel__note panel__note--warn">
          该资产未通过体检。仍可导入，但性能验收以《附件A》规格为前提，超标资产的表现不作为验收依据。
        </p>
      )}
    </div>
  )
}
