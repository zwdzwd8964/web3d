import type { BlobHash } from './provider.js'

/**
 * T-021 · MVP_V0 D4 · content-addressed assets.
 *
 * Uploading the same file twice must cost nothing and produce the same address, and an
 * asset record, once written, must never change — a published snapshot from months ago
 * may still point at it.
 */

const HASH_PATTERN = /^sha256:[0-9a-f]{64}$/

export function isBlobHash(value: unknown): value is BlobHash {
  return typeof value === 'string' && HASH_PATTERN.test(value)
}

function toHex(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let out = ''
  for (const b of bytes) out += b.toString(16).padStart(2, '0')
  return out
}

/** WebCrypto SHA-256. Available in browsers and in Node >= 20 without an import. */
export async function hashBytes(bytes: Uint8Array): Promise<BlobHash> {
  // Copy into a standalone ArrayBuffer: a Uint8Array view may be a window onto a larger
  // buffer, and digesting the whole buffer would silently hash the wrong bytes.
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  const digest = await globalThis.crypto.subtle.digest('SHA-256', copy.buffer)
  return `sha256:${toHex(digest)}`
}

export const hexOf = (hash: BlobHash): string => hash.slice('sha256:'.length)

/**
 * `sha256:ab12…` -> `assets/ab/12/ab12….glb`
 *
 * Two levels of two-hex-char sharding. Flat directories with tens of thousands of
 * entries are slow on some filesystems and unusable in a file picker, and the same
 * layout has to work inside a .w3p zip, an IndexedDB key space and an object store.
 */
export function hashToPath(hash: BlobHash, extension = ''): string {
  if (!isBlobHash(hash)) throw new TypeError(`not a content hash: ${String(hash)}`)
  const hex = hexOf(hash)
  const ext = extension === '' ? '' : extension.startsWith('.') ? extension : `.${extension}`
  return `assets/${hex.slice(0, 2)}/${hex.slice(2, 4)}/${hex}${ext}`
}

/** Recovers the hash from a path produced by `hashToPath`. Null when it does not match. */
export function pathToHash(path: string): BlobHash | null {
  const m = /(?:^|\/)assets\/[0-9a-f]{2}\/[0-9a-f]{2}\/([0-9a-f]{64})(?:\.[^/]*)?$/.exec(path)
  return m ? `sha256:${m[1]}` : null
}

/** File extension for an asset URL, including the dot. Empty when there is none. */
export function extensionOf(filename: string): string {
  const i = filename.lastIndexOf('.')
  return i <= 0 ? '' : filename.slice(i)
}
