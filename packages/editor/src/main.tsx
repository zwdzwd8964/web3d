import { registerBuiltinActions } from '@w3/core'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App.js'
import { PreviewProvider } from './preview/PreviewContext.jsx'
import { createPreviewStore } from './preview/preview-store.js'
import { ProjectProvider } from './project/ProjectContext.jsx'
import { draftsOf, runBoot, sessionIdOf, startHeartbeat } from './project/project-lifecycle.js'
import type { LeaseRequest } from '@w3/storage'
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

/**
 * T-288 · 伪造崩溃时置真：`pagehide` 里就不再释放租约了。
 *
 * 模块级，因为 `pagehide` 的监听器和 `__w3SimulateCrash` 都要看到它，而它们之间没有
 * 别的通路。运行时瞬态，不进文档。
 */
let simulatingCrash = false

/**
 * 这次开机的租约申请。
 *
 * `?w3LeaseStaleMs=` 只调**判定阈值**，不调心跳间隔：E2E 要的是「让 15 秒的过期判定
 * 在 1 秒内发生」，而不是让心跳变快——把心跳一起调快的话，租约永远不会过期，
 * 那条崩溃恢复的 E2E 会稳定地测不到它要测的东西。
 */
function leaseRequest(): LeaseRequest {
  const override = Number(new URLSearchParams(location.search).get('w3LeaseStaleMs'))
  return {
    sessionId: sessionIdOf(),
    nowMs: Date.now(),
    ...(Number.isFinite(override) && override > 0 ? { staleMs: override } : {}),
  }
}

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
  const { doc, notes, recovery, heartbeat } = await runBoot(session, leaseRequest())
  for (const note of notes) console.info('[boot]', note)

  // T-288 · 心跳 + 干净退出。两件事一起决定了下一次开机看到的是「崩了」还是「关了」。
  //
  // `pagehide` 而不是 `beforeunload`，理由与自动保存那处相同：移动端切后台与 bfcache
  // 驱逐都只发 `pagehide`。**释放租约不能等到 `unload`**——那时候写 IndexedDB 已经
  // 来不及，于是每一次正常关标签页都会在下次开机被报成崩溃。
  const drafts = draftsOf(session)
  const stopHeartbeat = heartbeat ? startHeartbeat({ beat: () => heartbeat(Date.now()) }) : null
  window.addEventListener('pagehide', () => {
    if (simulatingCrash) return
    stopHeartbeat?.()
    void drafts?.releaseLease(doc.projectId, sessionIdOf())
  })

  if (import.meta.env.DEV) {
    // E2E 用它伪造一次崩溃：停掉心跳、并且**不**在 pagehide 里释放租约，于是下一次
    // 开机看到的是一份心跳过期且没标记干净退出的租约——与真崩了逐字同形。
    //
    // 只读的 `__w3Dev*` 那一族不同，这一个会改状态，所以它带一个更直白的名字，
    // 并且只在 DEV 构建里存在。
    ;(globalThis as Record<string, unknown>)['__w3SimulateCrash'] = () => {
      simulatingCrash = true
      stopHeartbeat?.()
    }
  }

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
            <App recovery={recovery} />
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
