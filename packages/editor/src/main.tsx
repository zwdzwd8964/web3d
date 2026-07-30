import { registerBuiltinActions } from '@w3/core'
import { createGoldenPathDocument, validate } from '@w3/schema'
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
  const doc = restored ?? createGoldenPathDocument()
  await session.seedSampleAsset(doc)

  // D1 · patches reach the renderer incrementally. `load(doc)` on every edit would drop
  // the frame rate to unusable while a gizmo is being dragged.
  const store = createDocumentStore(doc, {
    onPatch: createPatchForwarder(getActiveRuntime),
  })

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
 * Loads the most recently updated project, if one validates.
 *
 * A stored document that fails validation is reported and skipped rather than thrown:
 * being unable to open the editor at all because of one bad record is far worse than
 * starting from the sample, and the record is left in place so it can still be recovered.
 */
async function restoreLastDocument(session: ProjectSession) {
  try {
    const projects = await session.storage.listProjects()
    const latest = [...projects].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]
    if (!latest) return null

    const stored = await session.load(latest.projectId)
    if (!stored) return null

    const result = validate(stored)
    if (!result.ok) {
      console.warn('[project] 上次保存的文档未通过校验，已改为打开样例场景。原文档未删除。', result.error)
      return null
    }
    return result.value
  } catch (error) {
    console.warn('[project] 读取上次的文档失败，已改为打开样例场景。', error)
    return null
  }
}

void boot()
