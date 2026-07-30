import type { AnimationClip, Object3D } from 'three'

/**
 * Shared runtime types.
 *
 * Note what is NOT here: `WebGLRenderer`. Everything in `src/runtime/` except
 * `scene-runtime.ts` and `loader.ts` is deliberately renderer-free, because three's
 * scene graph, materials, Raycaster, camera maths and AnimationMixer all work without a
 * GL context. That is what lets the scene graph, clone-on-write, patch application,
 * picking and tweening be unit-tested in plain Node instead of "looked at" in a browser.
 */

/** Editing shows gizmos and lets the user pick; playing does not. */
export type RuntimeMode = 'edit' | 'play'

/**
 * Resolves a document's relative `asset.url` to bytes.
 *
 * Injected from outside: core never learns whether the bytes came from IndexedDB, a
 * `.w3p` zip or an HTTP endpoint (MVP_V0 §3 — this is why core sits beside @w3/storage
 * rather than above it).
 */
export interface AssetResolver {
  resolve(url: string): Promise<ArrayBuffer>
}

/** One loaded model asset, indexed the way `assetRef.objectPath` addresses it. */
export interface LoadedAsset {
  readonly assetId: string
  readonly scene: Object3D
  readonly clips: readonly AnimationClip[]
  /** `Root/Pump/Body` -> the Object3D at that path. Built once at load. */
  readonly objects: ReadonlyMap<string, Object3D>
}

/** Where the scene graph looks up already-loaded assets. */
export interface AssetSource {
  get(assetId: string): LoadedAsset | undefined
}

/** An empty source, for building a graph before anything has loaded. */
export const EMPTY_ASSET_SOURCE: AssetSource = { get: () => undefined }

/** Stored on every Object3D the scene graph owns, so a raycast hit can be traced back. */
export interface NodeUserData {
  w3NodeId?: string
  /** True for the placeholder created when an asset is missing or not yet loaded. */
  w3Placeholder?: boolean
}
