/**
 * The editor's preview surface, as the parity suite consumes it.
 *
 * A named entry point rather than a deep import so that what parity is allowed to reach
 * into is explicit: the controller and its store, and nothing else. Parity drives the
 * editor's REAL preview path — if it constructed a playback session directly it would be
 * testing the harness against itself.
 */

export { PreviewController } from './controller.js'
export { createPreviewStore } from './preview-store.js'
export type { PreviewState, PreviewActions, PreviewStore } from './preview-store.js'
