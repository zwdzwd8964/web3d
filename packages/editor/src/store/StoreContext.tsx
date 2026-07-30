import { createContext, useContext, useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import type { DocumentActions, DocumentState, DocumentStore } from './document-store.js'

/**
 * React binding for the document store.
 *
 * `useSyncExternalStore` rather than a hand-rolled subscription: it is the API React
 * provides for exactly this, and it gets tearing right during concurrent renders — which
 * a viewport reading the document mid-update would otherwise hit.
 */

const StoreContext = createContext<DocumentStore | null>(null)

export function StoreProvider({ store, children }: { store: DocumentStore; children: ReactNode }) {
  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>
}

export function useDocumentStore(): DocumentStore {
  const store = useContext(StoreContext)
  if (!store) throw new Error('useDocumentStore 必须在 <StoreProvider> 内使用')
  return store
}

/** Subscribes to one slice. The selector must return a stable reference or a primitive. */
export function useDocumentSelector<T>(selector: (state: DocumentState & DocumentActions) => T): T {
  const store = useDocumentStore()
  return useSyncExternalStore(
    store.subscribe,
    () => selector(store.getState()),
    () => selector(store.getState()),
  )
}

/** The actions object never changes identity, so this never causes a re-render. */
export function useDocumentActions(): DocumentActions {
  return useDocumentStore().getState()
}
