/**
 * @w3/player — the read-only player.
 *
 * The SPA entry is `main.ts`; this module is the programmatic surface, used by the parity
 * suite (T-103) and by anyone embedding the player in another page.
 */

export { Player } from './app.js'
export type { PlayerOptions } from './app.js'
export { assertCompatible } from './compat.js'
export { createPlayerSession } from './session.js'
export type { PlayerSession, PlayerSessionOptions } from './session.js'
export { resolveSource } from './source.js'
