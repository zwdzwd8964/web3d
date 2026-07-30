/**
 * @w3/schema — the scene document model.
 *
 * The contract every other package reads. Exactly one runtime dependency (zod); no
 * three.js, no DOM, no React, no storage.
 *
 * SCHEMA_SPEC §0.1: Zod is the single source of truth and every TypeScript type is
 * `z.infer`-ed from it. A hand-written interface next to a validator is a validator
 * that has already started to drift.
 */

export * from './animation.js'
export * from './asset.js'
export * from './deferred.js'
export * from './document.js'
export * from './factory.js'
export * from './hotspot.js'
export * from './id.js'
export * from './index-builder.js'
export * from './integrity.js'
export * from './material.js'
export * from './migrate.js'
export * from './node.js'
export * from './primitives.js'
export * from './remap.js'
export * from './rule.js'
export * from './samples.js'
export * from './selectors.js'
export * from './validate.js'
export * from './variable.js'
export * from './viewpoint.js'
