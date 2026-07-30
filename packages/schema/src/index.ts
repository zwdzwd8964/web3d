/**
 * @w3/schema — the scene document model.
 *
 * This package is the contract every other package reads. It has exactly one runtime
 * dependency (zod) and knows nothing about three.js, the DOM, React or storage.
 *
 * MVP_V0 §4: Zod is the single source of truth and TypeScript types are inferred from
 * it — never the other way round. A hand-written interface that drifts from its
 * validator is a validator that stops being enforced.
 */

export * from './animations.js'
export * from './assetPolicy.js'
export * from './assets.js'
export * from './document.js'
export * from './eca/actions.js'
export * from './eca/conditions.js'
export * from './eca/events.js'
export * from './eca/params.js'
export * from './eca/rules.js'
export * from './factory.js'
export * from './hotspots.js'
export * from './ids.js'
export * from './integrity.js'
export * from './materials.js'
export * from './migrate.js'
export * from './nodes.js'
export * from './primitives.js'
export * from './remap.js'
export * from './reserved.js'
export * from './samples.js'
export * from './tree.js'
export * from './validate.js'
export * from './variables.js'
