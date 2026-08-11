import { registerBuiltinActions } from '@w3/core'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App.js'
import { PreviewProvider } from './preview/PreviewContext.jsx'
import { createPreviewStore } from './preview/preview-store.js'
import { ProjectProvider } from './project/ProjectContext.jsx'
import { runBoot } from './project/project-lifecycle.js'
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

  // T-282 · 冷启动写成一张显式的步骤表（`BOOT_STEPS`，在 project-lifecycle.ts）。
  //
  // 这 20 行在 v1 有四个所有者（本卡 · T-288 崩溃恢复横幅 · v1.5 provider 探测 ·
  // v1.5 多场景入口场景），而**顺序在这里是有语义的**：物化必须先于 store 建好，
  // 否则视口一挂载就向 resolver 要字节，得到的是「资产加载失败：pump.glb」。
  // 后续三张卡只允许往表里加步骤、不许重排，由一条断言看着。
  const { doc, notes } = await runBoot(session)
  for (const note of notes) console.info('[boot]', note)

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

// T-229 · 只有真的有挂载点时才启动。
//
// 原来是无条件 `void boot()`，于是**任何 import 这个模块的人都会顺手启动一次编辑器**
// ——在 node 环境下 `document` 不存在，模块一加载就抛。测试要调它导出的
// `restoreLastDocument`，就必须先把这条副作用关掉。
//
// 判据用 `typeof document`：浏览器里恒真，node 里恒假，不需要任何测试专用开关。
if (typeof document !== 'undefined') void boot()
