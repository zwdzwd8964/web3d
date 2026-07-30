import { describe, expect, it } from 'vitest'
import { MemoryProvider } from '../src/memory-provider.js'
import { describeProviderContract } from './contract.js'

describe('MemoryProvider', () => {
  describeProviderContract('memory', () => new MemoryProvider())

  it('reports its kind', () => {
    expect(new MemoryProvider().kind).toBe('memory')
  })

  it('refuses use after close instead of silently losing writes', async () => {
    const provider = new MemoryProvider()
    await provider.close()
    await expect(provider.listProjects()).rejects.toThrow(/closed/)
  })
})
