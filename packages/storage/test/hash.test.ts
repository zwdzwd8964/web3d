import { describe, expect, it } from 'vitest'
import { extensionOf, hashBytes, hashToPath, hexOf, isBlobHash, pathToHash } from '../src/hash.js'

/** T-021 · MVP_V0 D4. */

const bytesOf = (text: string) => new TextEncoder().encode(text)

describe('hashBytes()', () => {
  it('produces the documented sha256:<64 hex> shape', async () => {
    const hash = await hashBytes(bytesOf('hello'))
    expect(hash).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(isBlobHash(hash)).toBe(true)
  })

  it('matches the known SHA-256 of "hello"', async () => {
    expect(await hashBytes(bytesOf('hello'))).toBe(
      'sha256:2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
    )
  })

  it('is stable: identical bytes always give the same address', async () => {
    expect(await hashBytes(bytesOf('same'))).toBe(await hashBytes(bytesOf('same')))
  })

  it('separates different content', async () => {
    expect(await hashBytes(bytesOf('a'))).not.toBe(await hashBytes(bytesOf('b')))
  })

  it('hashes an empty payload without special-casing', async () => {
    expect(await hashBytes(new Uint8Array(0))).toBe(
      'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    )
  })

  it('hashes only the view, not the whole backing buffer', async () => {
    // A Uint8Array can be a window onto a larger ArrayBuffer. Digesting the buffer
    // instead of the view would silently address the wrong bytes.
    const backing = new Uint8Array([9, 9, 1, 2, 3, 9, 9])
    const view = backing.subarray(2, 5)
    expect(await hashBytes(view)).toBe(await hashBytes(new Uint8Array([1, 2, 3])))
  })
})

describe('hashToPath() / pathToHash()', () => {
  const hash = `sha256:${'ab12cd34ef567890'.repeat(4)}`
  const hex = hexOf(hash)

  it('shards into two levels of two hex characters', () => {
    expect(hashToPath(hash, '.glb')).toBe(`assets/ab/12/${hex}.glb`)
  })

  it('accepts an extension with or without the leading dot, or none at all', () => {
    expect(hashToPath(hash, 'glb')).toBe(hashToPath(hash, '.glb'))
    expect(hashToPath(hash)).toBe(`assets/ab/12/${hex}`)
  })

  it('refuses anything that is not a content hash', () => {
    expect(() => hashToPath('not-a-hash', '.glb')).toThrow(TypeError)
    expect(() => hashToPath('sha256:XYZ', '.glb')).toThrow(TypeError)
  })

  it('round-trips back to the hash', () => {
    expect(pathToHash(hashToPath(hash, '.glb'))).toBe(hash)
    expect(pathToHash(hashToPath(hash, '.ktx2'))).toBe(hash)
    expect(pathToHash(hashToPath(hash))).toBe(hash)
  })

  it('tolerates a package-relative prefix', () => {
    expect(pathToHash(`some/prefix/${hashToPath(hash, '.glb')}`)).toBe(hash)
  })

  it('returns null for a path that is not asset-shaped', () => {
    expect(pathToHash('scene.json')).toBeNull()
    expect(pathToHash('assets/ab/12/short.glb')).toBeNull()
    expect(pathToHash('thumbnail.png')).toBeNull()
  })
})

describe('isBlobHash()', () => {
  it('rejects near-misses rather than accepting them loosely', () => {
    expect(isBlobHash(`sha256:${'a'.repeat(63)}`)).toBe(false)
    expect(isBlobHash(`sha256:${'A'.repeat(64)}`)).toBe(false)
    expect(isBlobHash(`md5:${'a'.repeat(64)}`)).toBe(false)
    expect(isBlobHash(null)).toBe(false)
    expect(isBlobHash(123)).toBe(false)
  })
})

describe('extensionOf()', () => {
  it('extracts the extension including its dot', () => {
    expect(extensionOf('pump.glb')).toBe('.glb')
    expect(extensionOf('texture.ktx2')).toBe('.ktx2')
    expect(extensionOf('archive.tar.gz')).toBe('.gz')
  })

  it('returns empty for names without one, and for dotfiles', () => {
    expect(extensionOf('README')).toBe('')
    expect(extensionOf('.gitignore')).toBe('')
  })
})
