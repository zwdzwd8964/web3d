/**
 * `@w3/core/eca` — the rule engine, importable without three.js.
 *
 * Constitution C8: nothing reachable from here touches WebGL, the DOM or the host
 * clock, so the whole engine runs in plain Node. `scripts/check-core-purity.mjs` fails
 * the build if anything under `src/eca/` imports three or reads `Date.now()`.
 */

export * from './eca/actions/index.js'
export * from './eca/conditions.js'
export * from './eca/engine.js'
export * from './eca/events.js'
export * from './eca/executor.js'
export * from './eca/headless.js'
export * from './eca/testgen.js'
export * from './eca/types.js'
