import { useEffect, useMemo, useRef, useState } from 'react'
import { useProject } from './ProjectContext.jsx'
import { AutoSaver } from './autosave.js'
import type { AutoSaverOptions, SaveState } from './autosave.js'
import { crashSimulated, draftsOf, sessionIdOf } from './project-lifecycle.js'
import { useDocumentStore } from '../store/StoreContext.js'

/**
 * Wires the document store to the storage layer.
 *
 * Subscribes to the store directly rather than through `useDocumentSelector` so a save is
 * driven by the document actually changing, not by a component re-rendering — those are
 * not the same event, and tying persistence to the second one makes saves depend on which
 * panel happens to be open.
 */
export function useAutoSave(): {
  state: SaveState
  error: string | null
  /** T-288 · 存储侧的错误码。`quota-exceeded` 时界面要多给一个「清理本地数据」的入口。 */
  errorCode: string | null
  saveNow: () => void
} {
  const session = useProject()
  const store = useDocumentStore()
  const [state, setState] = useState<SaveState>('idle')
  const [error, setError] = useState<string | null>(null)
  const [errorCode, setErrorCode] = useState<string | null>(null)

  // Kept in a ref so the keydown and beforeunload handlers below never close over a stale
  // saver after a re-render.
  const saverRef = useRef<AutoSaver | null>(null)

  const saver = useMemo(
    () =>
      new AutoSaver({
        // T-286 · `save` 现在返回回执，而 AutoSaver 的钩子要的是 `Promise<void>`。
        // 显式丢掉它而不是改钩子的签名：AutoSaver 不消费修订号，让它的类型跟着变
        // 只会把一个它用不到的概念带进来。
        save: async (doc) => {
          // DEV 专用 · 「这个进程已经不在了」。**永不 resolve**，不是抛异常：
          // 抛异常会显示「保存失败」，而真崩了的时候什么都不会被显示。
          // 它的直接效果是 `clearDraft` 那一步走不到，于是草稿留在库里等下一次开机。
          if (import.meta.env.DEV && crashSimulated()) return new Promise<void>(() => {})
          await session.save(doc)
        },
        // T-288 · 草稿通道。provider 没有 `drafts` facet 时**两个钩子都不给**——
        // 给一对空函数的话，「顺序是 saveDraft → save → clearDraft」那条断言会在一个
        // 根本没有草稿的实现上照样绿。
        ...draftHooks(session, () => store.getState().doc.projectId),
        onStateChange: (next, message, code) => {
          setState(next)
          setError(message ?? null)
          setErrorCode(code ?? null)
        },
      }),
    [session, store],
  )
  saverRef.current = saver

  useEffect(() => {
    let previous = store.getState().doc
    const unsubscribe = store.subscribe((next) => {
      if (next.doc === previous) return
      previous = next.doc
      // Mid-drag documents are transient by design (D2's preview channel). Saving them
      // would write sixty documents per second and, worse, could persist a state the user
      // is about to release into something else.
      if (next.previewing) return
      saver.schedule(next.doc)
    })
    return () => {
      unsubscribe()
      // NOT `saver.dispose()`. The saver's lifetime belongs to the session (the useMemo),
      // not to this effect — and StrictMode runs effect cleanup once immediately after
      // mount. Disposing here left the one memoised saver permanently dead, so nothing
      // ever saved and the indicator sat at idle forever. Caught by the golden-path E2E,
      // which is the only place StrictMode's double-invoke meets a real browser.
      //
      // Flushing instead means a genuine unmount still persists the pending edit.
      void saver.flush()
    }
  }, [store, saver])

  // Ctrl+S. The browser's own save dialog on a canvas app is never what anyone wanted.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 's') return
      event.preventDefault()
      saverRef.current?.schedule(store.getState().doc)
      void saverRef.current?.flush()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [store])

  // A tab closed during the quiet period would otherwise lose the last edit. `pagehide`
  // rather than `beforeunload`: it also fires when a mobile browser backgrounds the page
  // and when the bfcache evicts it, neither of which `beforeunload` covers.
  useEffect(() => {
    const onHide = () => {
      if (saverRef.current?.hasPendingWork) void saverRef.current.flush()
    }
    window.addEventListener('pagehide', onHide)
    return () => window.removeEventListener('pagehide', onHide)
  }, [])

  return {
    state,
    error,
    errorCode,
    saveNow: () => {
      saver.schedule(store.getState().doc)
      void saver.flush()
    },
  }
}

/**
 * T-288 · 把 `AutoSaver` 的草稿通道接到 provider 的 `drafts` facet 上。
 *
 * 会话标识每次开机一个，来自 `sessionIdOf()`——同一个标签页刷新算新会话，这是对的：
 * 刷新之后旧的那份租约确实没人续了。
 *
 * @param projectIdOf 现读，不是构造时读一次。切换工程之后草稿要写进新工程的槽里，
 *   而 saver 是按 session 记忆化的，闭包捕获旧 id 会让草稿一直写在上一份工程上。
 */
function draftHooks(
  session: ReturnType<typeof useProject>,
  projectIdOf: () => string,
): Pick<AutoSaverOptions, 'saveDraft' | 'clearDraft'> {
  const drafts = draftsOf(session)
  if (!drafts) return {}
  return {
    saveDraft: async (doc, edits) => {
      await drafts.saveDraft({
        projectId: projectIdOf(),
        document: doc,
        edits,
        savedAt: new Date().toISOString(),
        sessionId: sessionIdOf(),
      })
    },
    clearDraft: async () => {
      await drafts.clearDraft(projectIdOf())
    },
  }
}
