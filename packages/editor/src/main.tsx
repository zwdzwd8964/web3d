import { createGoldenPathDocument } from '@w3/schema'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App.js'
import { StoreProvider } from './store/StoreContext.js'
import { createDocumentStore } from './store/document-store.js'
import './styles.css'

/**
 * Editor entry point.
 *
 * Opens with the golden path sample so there is something to look at before any GLB has
 * been imported. Project loading through `StorageProvider` arrives with T-066.
 */
const store = createDocumentStore(createGoldenPathDocument(), {
  onPatch: (patches) => {
    // T-062 forwards these to SceneRuntime.applyPatch for incremental application (D1).
    // Until the viewport is mounted there is nothing to update, and saying so beats a
    // silent no-op that looks like a wired-up path.
    if (import.meta.env.DEV) console.debug('[document] patches', patches.length)
  },
})

const container = document.getElementById('root')
if (!container) throw new Error('缺少 #root 挂载点')

createRoot(container).render(
  <StrictMode>
    <StoreProvider store={store}>
      <App />
    </StoreProvider>
  </StrictMode>,
)
