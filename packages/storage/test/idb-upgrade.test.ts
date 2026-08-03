// Must come first: it installs an IndexedDB implementation onto globalThis.
import 'fake-indexeddb/auto'

import { createGoldenPathDocument } from '@w3/schema'
import { describe, expect, it } from 'vitest'
import { IndexedDbProvider, OBJECT_STORES } from '../src/idb-provider.js'

/**
 * T-202 · the second forward-compatibility chain.
 *
 * `schemaVersion` migrations have fixtures, a regression suite and a rule in 铁律 4. The
 * IndexedDB version had **none of that and no precedent**: it sat at 1 from v0 until today.
 *
 * Three v1 designs each independently planned to take it to 2 for their own object store.
 * IndexedDB's upgrade callback only fires when the version actually rises, so the first one
 * to ship would move every user's database to 2 and the second one's upgrade would never
 * run for them — permanently missing stores, no error, no warning. Each design had written
 * its own "v1 → v2" regression test and **each of those tests would have passed**, because
 * each creates its own database from scratch. The case that breaks is a database that is
 * ALREADY at 2, and nothing in the repository looked at it.
 *
 * So the tests below are about databases that already exist, which is the only place the
 * bug lives.
 */

/** Builds a database exactly as v0 left it: version 1, the original four stores. */
async function seedV1Database(name: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const request = globalThis.indexedDB.open(name, 1)
    request.onupgradeneeded = () => {
      const db = request.result
      db.createObjectStore('projects', { keyPath: 'projectId' })
      db.createObjectStore('documents', { keyPath: 'projectId' })
      db.createObjectStore('blobs')
      db.createObjectStore('snapshots', { keyPath: 'meta.snapshotId' }).createIndex('byProject', 'meta.projectId')
    }
    request.onsuccess = () => {
      request.result.close()
      resolve()
    }
    request.onerror = () => reject(request.error)
  })
}

/** Writes one document and one blob straight into a v1 database, bypassing the provider. */
async function seedV1Data(name: string, projectId: string, blobKey: string, blobBytes: Uint8Array): Promise<void> {
  const doc = { ...createGoldenPathDocument(), projectId }
  await new Promise<void>((resolve, reject) => {
    const request = globalThis.indexedDB.open(name)
    request.onsuccess = () => {
      const db = request.result
      const tx = db.transaction(['documents', 'projects', 'blobs'], 'readwrite')
      tx.objectStore('documents').put(doc)
      tx.objectStore('projects').put({ projectId, name: doc.name, updatedAt: doc.meta.updatedAt })
      tx.objectStore('blobs').put(blobBytes, blobKey)
      tx.oncomplete = () => {
        db.close()
        resolve()
      }
      tx.onerror = () => reject(tx.error)
    }
    request.onerror = () => reject(request.error)
  })
}

async function storeNamesOf(name: string): Promise<string[]> {
  return await new Promise<string[]>((resolve, reject) => {
    const request = globalThis.indexedDB.open(name)
    request.onsuccess = () => {
      const db = request.result
      const names = [...db.objectStoreNames]
      db.close()
      resolve(names)
    }
    request.onerror = () => reject(request.error)
  })
}

async function versionOf(name: string): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    const request = globalThis.indexedDB.open(name)
    request.onsuccess = () => {
      const version = request.result.version
      request.result.close()
      resolve(version)
    }
    request.onerror = () => reject(request.error)
  })
}

describe('IndexedDB 版本阶梯', () => {
  it('upgrades a real v1 database and loses nothing', async () => {
    const name = 'w3-upgrade-v1'
    const blobKey = 'sha256:' + 'a'.repeat(64)
    const bytes = new Uint8Array([7, 8, 9, 10])
    await seedV1Database(name)
    await seedV1Data(name, 'prj_a1b2c3d4', blobKey, bytes)
    expect(await versionOf(name)).toBe(1)

    const provider = new IndexedDbProvider({ databaseName: name })
    const projects = await provider.listProjects()

    // Set equality, not `toContain`: with `toContain` this test passes while one of the four
    // new stores is missing — which is the whole failure being guarded against.
    expect((await storeNamesOf(name)).sort()).toEqual([...OBJECT_STORES].sort())
    expect(await versionOf(name)).toBe(2)

    // And the old data is still there, read back through the upgraded provider.
    expect(projects.map((p) => p.projectId)).toEqual(['prj_a1b2c3d4'])
    expect((await provider.loadDocument('prj_a1b2c3d4'))?.projectId).toBe('prj_a1b2c3d4')
    expect([...(await provider.getBlob(blobKey))!]).toEqual([7, 8, 9, 10])
    await provider.destroy()
  })

  it('opens an already-current database without disturbing it', async () => {
    // The case none of the three designs tested. Opening twice must be a no-op the second
    // time: the upgrade callback does not even fire, so anything that depends on it running
    // is already broken by this point.
    const name = 'w3-upgrade-idempotent'
    const first = new IndexedDbProvider({ databaseName: name })
    await first.saveDocument(createGoldenPathDocument())
    await first.close()

    const second = new IndexedDbProvider({ databaseName: name })
    expect(await second.listProjects()).toHaveLength(1)
    expect((await storeNamesOf(name)).sort()).toEqual([...OBJECT_STORES].sort())
    await second.destroy()
  })

  it('creates the new stores empty rather than seeding them', async () => {
    // Structure now, content later. A store that arrives with rows in it would make the
    // later cards' "is there a draft?" check answer yes on a database that has never had one.
    const name = 'w3-upgrade-empty'
    const provider = new IndexedDbProvider({ databaseName: name })
    await provider.listProjects()
    await provider.close()

    for (const store of ['drafts', 'leases', 'scenes', 'revs']) {
      expect({ [store]: await countIn(name, store) }).toEqual({ [store]: 0 })
    }
    await new IndexedDbProvider({ databaseName: name }).destroy()
  })
})

async function countIn(name: string, store: string): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    const request = globalThis.indexedDB.open(name)
    request.onsuccess = () => {
      const db = request.result
      const countRequest = db.transaction(store).objectStore(store).count()
      countRequest.onsuccess = () => {
        const value = countRequest.result
        db.close()
        resolve(value)
      }
      countRequest.onerror = () => reject(countRequest.error)
    }
    request.onerror = () => reject(request.error)
  })
}
