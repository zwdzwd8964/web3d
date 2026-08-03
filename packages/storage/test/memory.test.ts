import { describe, expect, it } from 'vitest'
import { MemoryProvider } from '../src/memory-provider.js'
import { describeProviderContract } from './contract.js'

describe('MemoryProvider', () => {
  describeProviderContract('memory', () => new MemoryProvider(), {
    // A ceiling small enough that the contract's 4 KB probe cannot fit.
    makeFull: async () => ({ provider: new MemoryProvider({ maxBytes: 512 }), done: () => {} }),
  })

  it('reports its kind', () => {
    expect(new MemoryProvider().kind).toBe('memory')
  })

  it('refuses use after close instead of silently losing writes', async () => {
    const provider = new MemoryProvider()
    await provider.close()
    await expect(provider.listProjects()).rejects.toThrow(/closed/)
  })
})
