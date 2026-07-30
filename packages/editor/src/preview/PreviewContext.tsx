import { createContext, useContext, useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import type { PreviewActions, PreviewState, PreviewStore } from './preview-store.js'

const Context = createContext<PreviewStore | null>(null)

export function PreviewProvider({ store, children }: { store: PreviewStore; children: ReactNode }) {
  return <Context.Provider value={store}>{children}</Context.Provider>
}

export function usePreviewStore(): PreviewStore {
  const store = useContext(Context)
  if (!store) throw new Error('usePreviewStore 必须在 <PreviewProvider> 内使用')
  return store
}

export function usePreview<T>(selector: (state: PreviewState & PreviewActions) => T): T {
  const store = usePreviewStore()
  return useSyncExternalStore(
    store.subscribe,
    () => selector(store.getState()),
    () => selector(store.getState()),
  )
}
