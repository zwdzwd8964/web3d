import { describe, expect, it } from 'vitest'
import { IndexedDbProvider } from '../src/idb-provider.js'
import { describeProviderContract } from './contract.js'

/**
 * T-023.
 *
 * The contract suite below is the same one MemoryProvider runs. It only executes where
 * an IndexedDB implementation exists — plain Node has none. This is reported loudly
 * rather than skipped quietly: a green run that silently exercised nothing is exactly
 * how a storage adapter ships broken.
 */
const supported = IndexedDbProvider.isSupported()

describe('IndexedDbProvider', () => {
  it('knows whether this environment can host it', () => {
    expect(typeof IndexedDbProvider.isSupported()).toBe('boolean')
  })

  it('reports its kind without opening a database', () => {
    expect(new IndexedDbProvider().kind).toBe('indexeddb')
  })

  it('fails with an actionable error when IndexedDB is absent, rather than hanging', async () => {
    if (supported) return
    const provider = new IndexedDbProvider({ databaseName: 'w3-probe' })
    await expect(provider.listProjects()).rejects.toThrow(/IndexedDB is not available/)
  })

  describe.skipIf(!supported)('contract', () => {
    let counter = 0
    describeProviderContract('indexeddb', async () => {
      const provider = new IndexedDbProvider({ databaseName: `w3-test-${counter++}` })
      await provider.destroy()
      return new IndexedDbProvider({ databaseName: `w3-test-${counter}` })
    })
  })
})

if (!supported) {
  // eslint-disable-next-line no-console
  console.warn(
    '[storage] IndexedDbProvider contract tests did NOT run: no IndexedDB in this environment.\n' +
      '          They are covered by the browser E2E run (T-112). See docs/IMPL_NOTES.md.',
  )
}
