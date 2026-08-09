import type { AuditFinding } from '@w3/schema'
import { formatBytes, readGlbHeader, suggestUnitFromHeader } from '@w3/core'
import { useMemo, useRef, useState } from 'react'
import { IMPORT_ACCEPT, applyImport, importAsset, placeInstance, summarizeImport } from '../lib/import-flow.js'
import type { ImportProgress, ImportResult } from '../lib/import-flow.js'
import { useProject } from '../project/ProjectContext.jsx'
import { useDocumentActions, useDocumentSelector } from '../store/StoreContext.js'
import { ImportDialog, declarationFrom } from './ImportDialog.jsx'
import type { ImportDeclaration } from './ImportDialog.jsx'
import { describeRemoval } from './removal.js'

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
  /** T-259 · a GLB waiting on the unit / up-axis question, or null. */
  const [declaring, setDeclaring] = useState<{
    file: { name: string; bytes: ArrayBuffer }
    suggestion: ReturnType<typeof suggestUnitFromHeader>
    value: ImportDeclaration
  } | null>(null)
  /** T-257 · the asset id awaiting a delete confirmation, or null. */
  const [removing, setRemoving] = useState<string | null>(null)
  // 重新推导而不是拍快照：对话框开着时有人删了引用方，问句要从「无法删除」变成可删。
  const removal = useMemo(() => (removing ? describeRemoval(doc, 'asset', removing) : null), [doc, removing])
  const fileInput = useRef<HTMLInputElement>(null)

  /**
   * T-259 · 先问单位与上方向，再导入。
   *
   * 只有 GLB 走这一步：贴图、环境贴图、音视频没有「单位」这件事，给它们弹一个选米还是
   * 毫米的框只是徒增一次点击。判据是**头部解析得出来**——`readGlbHeader` 对不是 glTF
   * 容器的字节返回 null，不抛。
   */
  const chooseFile = async (file: File) => {
    setError(null)
    setPending(null)
    const bytes = await file.arrayBuffer()
    const header = readGlbHeader(bytes)
    if (!header) {
      await runImport({ name: file.name, bytes })
      return
    }
    // 只读 JSON chunk 里的 POSITION 访问器 min/max，不解几何：用户刚点完文件，
    // 对话框要立刻出来，而一份 200 MB 的装配体不该被解码两遍。
    const suggestion = suggestUnitFromHeader(header)
    setDeclaring({ file: { name: file.name, bytes }, suggestion, value: declarationFrom(suggestion) })
  }

  const runImport = async (file: { name: string; bytes: ArrayBuffer }, declaration?: ImportDeclaration) => {
    setError(null)
    setPending(null)
    try {
      const result = await importAsset({
        file,
        doc,
        storage,
        loader,
        ...(declaration ?? {}),
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
          导入文件
        </button>
        <input
          ref={fileInput}
          type="file"
          accept={IMPORT_ACCEPT}
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0]
            if (file) void chooseFile(file)
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
          if (file) void chooseFile(file)
        }}
      >
        {progress && <p className="panel__note">{progress.message}</p>}
        {error && <p className="panel__note panel__note--warn">导入失败：{error}</p>}

        {doc.assets.length === 0 && !progress && !pending && (
          <p className="panel__empty">把模型（.glb）、纹理（.png/.jpg/.webp/.ktx2）或环境贴图（.hdr）拖到这里</p>
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
              {/* T-257 · 在此之前，一张导错的贴图删不掉，它的字节会一直进发布包。 */}
              <button
                type="button"
                className="tbtn"
                data-testid={`asset-remove-${asset.id}`}
                title="从文档中删除这份资产"
                onClick={() => setRemoving(asset.id)}
              >
                删除
              </button>
            </li>
          ))}
        </ul>

        {removal && (
          <div className="panel__note panel__note--warn" data-testid="asset-remove-confirm" role="alertdialog">
            {removal.question}
            <button
              type="button"
              className="tbtn"
              disabled={removal.blocked !== null}
              data-testid="asset-remove-confirm-yes"
              onClick={() => {
                setRemoving(null)
                commit(`删除资产 ${removal.name}`, (draft) => {
                  // 只动 `document.assets`。**字节不在这里删**——它们躺在 StorageProvider 的
                  // blob 表里，可能被别的项目共用（同一份 hash 只存一次）。发布包已经只写
                  // 被引用的资产（T-233），所以这一条记录消失，那份字节就不再进包。
                  const at = draft.assets.findIndex((a) => a.id === removal.id)
                  if (at >= 0) draft.assets.splice(at, 1)
                })
              }}
            >
              {removal.blocked === null ? '确认删除' : '无法删除'}
            </button>
            <button type="button" className="tbtn" onClick={() => setRemoving(null)}>
              取消
            </button>
          </div>
        )}

        {declaring && (
          <ImportDialog
            fileName={declaring.file.name}
            value={declaring.value}
            suggestion={declaring.suggestion}
            onChange={(value) => setDeclaring({ ...declaring, value })}
            onConfirm={() => {
              const { file, value } = declaring
              setDeclaring(null)
              void runImport(file, value)
            }}
            onCancel={() => {
              setDeclaring(null)
              setReplacing(null)
            }}
          />
        )}

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
