// Must come first: it installs an IndexedDB implementation onto globalThis, and
// `IndexedDbProvider.isSupported()` is evaluated at module scope below.
import 'fake-indexeddb/auto'

import { describe, expect, it } from 'vitest'
import { IndexedDbProvider } from '../src/idb-provider.js'
import { describeProviderContract } from './contract.js'

/**
 * T-023.
 *
 * The suite below is the exact one MemoryProvider runs. Without a shim it would be
 * skipped in Node, and a storage adapter that never executed its own contract is how
 * "works in the tests, loses data in the browser" ships. `fake-indexeddb` is a real
 * IndexedDB implementation over an in-memory B-tree, so transactions, key ranges and
 * the upgrade path are all genuinely exercised — it is not a stub.
 *
 * What it still does NOT prove: quota limits, cross-tab locking, and browser-specific
 * behaviour around large blobs. Those belong to the E2E run (T-112).
 */
describe('IndexedDbProvider', () => {
  it('detects that this environment can host it', () => {
    expect(IndexedDbProvider.isSupported()).toBe(true)
  })

  it('reports its kind without opening a database', () => {
    expect(new IndexedDbProvider().kind).toBe('indexeddb')
  })

  let counter = 0
  describeProviderContract('indexeddb', () => new IndexedDbProvider({ databaseName: `w3-test-${counter++}` }))

  it('creates its four object stores on first open', async () => {
    const provider = new IndexedDbProvider({ databaseName: 'w3-test-stores' })
    // Any call forces the upgrade transaction to run.
    await provider.listProjects()
    await provider.close()

    const names = await new Promise<string[]>((resolve, reject) => {
      const request = globalThis.indexedDB.open('w3-test-stores')
      request.onsuccess = () => {
        const db = request.result
        const out = [...db.objectStoreNames]
        db.close()
        resolve(out)
      }
      request.onerror = () => reject(request.error)
    })
    expect(names.sort()).toEqual(['blobs', 'documents', 'projects', 'snapshots'])
  })

  it('survives a close-and-reopen with its data intact — the point of persistence', async () => {
    const name = 'w3-test-reopen'
    const first = new IndexedDbProvider({ databaseName: name })
    const { createGoldenPathDocument } = await import('@w3/schema')
    const doc = createGoldenPathDocument()
    await first.saveDocument(doc)
    const hash = await first.putBlob(new TextEncoder().encode('payload'))
    await first.close()

    const second = new IndexedDbProvider({ databaseName: name })
    expect(await second.loadDocument(doc.projectId)).toEqual(doc)
    expect(await second.hasBlob(hash)).toBe(true)
    await second.destroy()
  })

  it('destroy() removes the database', async () => {
    const name = 'w3-test-destroy'
    const provider = new IndexedDbProvider({ databaseName: name })
    const { createGoldenPathDocument } = await import('@w3/schema')
    await provider.saveDocument(createGoldenPathDocument())
    await provider.destroy()

    const fresh = new IndexedDbProvider({ databaseName: name })
    expect(await fresh.listProjects()).toEqual([])
    await fresh.destroy()
  })
})
