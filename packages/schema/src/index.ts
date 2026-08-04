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

/**
 * Zod is re-exported from here rather than depended on directly by @w3/core.
 *
 * ECA_SPEC §4.1 requires every action definition to carry a `ZodType` for its params,
 * so core needs zod — but CLAUDE.md's boundary table lists core's dependencies as
 * `three` + `@w3/schema`. Routing zod through the package that already owns it keeps
 * that table literally true and, more importantly, guarantees ONE zod instance across
 * the workspace: two copies would silently break schema composition and instanceof.
 */
export { z } from 'zod'
export type { ZodError, ZodType } from 'zod'

export * from './animation.js'
export * from './asset.js'
export * from './data-source.js'
export * from './effects.js'
export * from './explode.js'
export * from './flow.js'
export * from './fog.js'
export * from './page.js'
export * from './prefab-ref.js'
export * from './prefab.js'
export * from './section.js'
export * from './document.js'
export * from './factory.js'
export * from './hotspot.js'
export * from './id.js'
export * from './index-builder.js'
export * from './integrity.js'
export * from './light.js'
export * from './material.js'
export * from './media.js'
export * from './migrate.js'
export * from './node.js'
export * from './primitive.js'
export * from './primitives.js'
export * from './remap.js'
export * from './rule.js'
export * from './samples.js'
export * from './selectors.js'
export * from './validate.js'
export * from './variable.js'
export * from './viewpoint.js'
