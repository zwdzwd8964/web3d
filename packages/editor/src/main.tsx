import { createGoldenPathDocument } from '@w3/schema'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App.js'
import { StoreProvider } from './store/StoreContext.js'
import { createDocumentStore } from './store/document-store.js'
import { createPatchForwarder } from './viewport/runtime-bridge.js'
import { getActiveRuntime } from './viewport/runtime-registry.js'
import './styles.css'

/**
 * Editor entry point.
 *
 * Opens with the golden path sample so there is something to look at before any GLB has
 * been imported. Project loading through `StorageProvider` arrives with T-066.
 */
// D1 · patches reach the renderer incrementally. `load(doc)` on every edit would drop
// the frame rate to unusable while a gizmo is being dragged.
const store = createDocumentStore(createGoldenPathDocument(), {
  onPatch: createPatchForwarder(getActiveRuntime),
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
