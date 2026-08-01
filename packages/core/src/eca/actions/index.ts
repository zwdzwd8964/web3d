import type { ActionRegistry } from './registry.js'
import { defaultRegistry } from './registry.js'
import { ANIMATION_ACTIONS } from './animation.js'
import { CAMERA_ACTIONS } from './camera.js'
import { LIGHT_ACTIONS } from './light.js'
import { SCENE_ACTIONS } from './scene.js'
import { STATE_ACTIONS } from './state.js'
import { UI_ACTIONS } from './ui.js'

export * from './animation.js'
export * from './camera.js'
export * from './define.js'
export * from './light.js'
export * from './registry.js'
export * from './scene.js'
export * from './state.js'
export * from './ui.js'

/** The built-in action set — ECA_SPEC §4.2, plus v0.5's 进化规划 §4.3. */
export const BUILTIN_ACTIONS = [
  ...ANIMATION_ACTIONS,
  ...SCENE_ACTIONS,
  ...LIGHT_ACTIONS,
  ...CAMERA_ACTIONS,
  ...UI_ACTIONS,
  ...STATE_ACTIONS,
]

/**
 * Registers the built-in actions.
 *
 * Definitions are exported as data and registered here rather than self-registering at
 * import time. Same three files to add an action (ECA_SPEC §10), but importing a module
 * never mutates global state, so test files cannot affect each other through import
 * order. Calling this twice on the same registry is a no-op, not an error.
 */
export function registerBuiltinActions(registry: ActionRegistry = defaultRegistry): ActionRegistry {
  for (const definition of BUILTIN_ACTIONS) {
    if (!registry.has(definition.type)) registry.register(definition)
  }
  return registry
}
