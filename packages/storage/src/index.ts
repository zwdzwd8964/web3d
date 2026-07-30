/**
 * @w3/storage — the persistence seam (constitution C7).
 *
 * Depends on `@w3/schema`, `idb` and `fflate`. No three.js, no React.
 *
 * Everything above this package talks to `StorageProvider` and nothing else. v0 ships
 * `MemoryProvider` and `IndexedDbProvider`; v1 adds `HttpApiProvider`, and the amount
 * of business code that changes is meant to be zero — MVP_V0 §0 makes that an explicit
 * v1 acceptance item rather than an aspiration.
 */

export * from './hash.js'
export * from './idb-provider.js'
export * from './memory-provider.js'
export * from './package.js'
export * from './provider.js'
