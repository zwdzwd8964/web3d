import { useEffect, useMemo, useRef, useState } from 'react'
import { useProject } from './ProjectContext.jsx'
import { AutoSaver } from './autosave.js'
import type { SaveState } from './autosave.js'
import { useDocumentStore } from '../store/StoreContext.js'

/**
 * Wires the document store to the storage layer.
 *
 * Subscribes to the store directly rather than through `useDocumentSelector` so a save is
 * driven by the document actually changing, not by a component re-rendering — those are
 * not the same event, and tying persistence to the second one makes saves depend on which
 * panel happens to be open.
 */
export function useAutoSave(): { state: SaveState; error: string | null; saveNow: () => void } {
  const session = useProject()
  const store = useDocumentStore()
  const [state, setState] = useState<SaveState>('idle')
  const [error, setError] = useState<string | null>(null)

  // Kept in a ref so the keydown and beforeunload handlers below never close over a stale
  // saver after a re-render.
  const saverRef = useRef<AutoSaver | null>(null)

  const saver = useMemo(
    () =>
      new AutoSaver({
        save: (doc) => session.save(doc),
        onStateChange: (next, message) => {
          setState(next)
          setError(message ?? null)
        },
      }),
    [session],
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
      saver.dispose()
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
    saveNow: () => {
      saver.schedule(store.getState().doc)
      void saver.flush()
    },
  }
}
