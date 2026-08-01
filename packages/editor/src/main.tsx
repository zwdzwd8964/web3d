import { registerBuiltinActions } from '@w3/core'
import { createGoldenPathDocument, migrate } from '@w3/schema'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App.js'
import { PreviewProvider } from './preview/PreviewContext.jsx'
import { createPreviewStore } from './preview/preview-store.js'
import { ProjectProvider } from './project/ProjectContext.jsx'
import { ProjectSession } from './project/session.js'
import { StoreProvider } from './store/StoreContext.js'
import { createDocumentStore } from './store/document-store.js'
import { createPatchForwarder } from './viewport/runtime-bridge.js'
import { setActiveDocumentReader } from './viewport/runtime-registry.js'
import { getActiveRuntime } from './viewport/runtime-registry.js'
import './styles.css'

/**
 * Editor entry point.
 *
 * Boot order matters and is not obvious: the session has to exist and the sample asset
 * has to be seeded BEFORE the store is created, because creating the store mounts the
 * viewport, which immediately asks the resolver for bytes. Doing it the other way round
 * is what produced `资产加载失败：pump.glb` on every cold start.
 */

async function boot() {
  const container = document.getElementById('root')
  if (!container) throw new Error('缺少 #root 挂载点')

  // ADR-0008 · actions are exported as data and registered by the host, deliberately not
  // self-registering on import (which would make tree-shaking impossible to reason about
  // and the registry's contents depend on import order). The host has to actually do it:
  // without this line the rule editor offers nothing to add and every rule fails at
  // execution with "未注册的动作".
  registerBuiltinActions()

  const session = new ProjectSession()

  // Whatever was open last time. A refresh that silently discards the user's work is the
  // worst thing an editor can do, and it is exactly what this used to do.
  const restored = await restoreLastDocument(session)
  // The sample's asset is a placeholder until it is materialised: bytes generated, hashed,
  // stored, and the record rewritten to match. Without it the default project renders but
  // cannot be published, because the publish gate looks for a hash storage has never seen.
  const doc = await session.materialiseSample(restored ?? createGoldenPathDocument())

  // D1 · patches reach the renderer incrementally. `load(doc)` on every edit would drop
  // the frame rate to unusable while a gizmo is being dragged.
  const store = createDocumentStore(doc, {
    onPatch: createPatchForwarder(getActiveRuntime),
  })
  // DEV-only, and only ever read: the golden-path E2E asserts numbers no panel displays.
  setActiveDocumentReader(() => store.getState().doc)

  createRoot(container).render(
    <StrictMode>
      <ProjectProvider session={session}>
        <StoreProvider store={store}>
          <PreviewProvider store={createPreviewStore()}>
            <App />
          </PreviewProvider>
        </StoreProvider>
      </ProjectProvider>
    </StrictMode>,
  )
}

/**
 * Loads the most recently updated project, migrating it forward if it is older.
 *
 * `migrate`, not `validate` — and the difference is the whole of constitution C4. Because
 * `schemaVersion` is `z.literal(CURRENT_VERSION)`, a document saved by an older build
 * fails validation outright. This path used to call `validate` and fall back to the
 * sample, which was invisible while v1 was the only version in existence and became
 * "every existing project disappeared on upgrade" the moment v2 shipped — the user's work
 * is still on disk, but what they SEE is the sample scene, which is indistinguishable
 * from data loss.
 *
 * The migrated document is not written back here. It reaches storage on the first
 * autosave, so an upgrade that the user then abandons leaves the original record intact.
 *
 * A stored document that cannot be migrated at all is reported and skipped rather than
 * thrown: being unable to open the editor because of one bad record is far worse than
 * starting from the sample, and the record is left in place so it can still be recovered.
 */
async function restoreLastDocument(session: ProjectSession) {
  try {
    const projects = await session.storage.listProjects()
    const latest = [...projects].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]
    if (!latest) return null

    const stored = await session.load(latest.projectId)
    if (!stored) return null

    const result = migrate(stored)
    if (!result.ok) {
      console.warn('[project] 上次保存的文档无法打开，已改为打开样例场景。原文档未删除。', result.error)
      return null
    }
    if (result.value.applied.length > 0) {
      console.info(`[project] 文档已从 v${result.value.fromVersion} 升级到 v${result.value.toVersion}`, result.value.applied)
    }
    return result.value.document
  } catch (error) {
    console.warn('[project] 读取上次的文档失败，已改为打开样例场景。', error)
    return null
  }
}

void boot()
