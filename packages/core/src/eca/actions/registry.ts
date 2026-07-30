import type { ActionDefinition } from '../types.js'

/**
 * T-082 · ECA_SPEC §4.1.
 *
 * The registry is the entire extension mechanism (C5). The executor knows how to look a
 * function up, hand it params and await it — and nothing else. Registration validates
 * that all five mandatory members are present, because a definition missing `refs` or
 * `describe` still *works* at runtime while quietly disabling integrity checking and
 * acceptance-case generation. Failing loudly at registration is the only moment that
 * omission is cheap to fix.
 */

export class ActionRegistry {
  private definitions = new Map<string, ActionDefinition<any>>()

  register<P>(definition: ActionDefinition<P>): void {
    const { type } = definition
    if (typeof type !== 'string' || type.length === 0) {
      throw new Error('registerAction: `type` must be a non-empty string')
    }
    if (this.definitions.has(type)) {
      throw new Error(`registerAction: action "${type}" is already registered`)
    }
    for (const key of ['schema', 'handler', 'ui', 'refs', 'describe'] as const) {
      if (definition[key] == null) {
        throw new Error(`registerAction("${type}"): missing required member \`${key}\` (ECA_SPEC §4.1)`)
      }
    }
    if (typeof definition.handler !== 'function') {
      throw new Error(`registerAction("${type}"): \`handler\` must be a function`)
    }
    if (typeof definition.refs !== 'function' || typeof definition.describe !== 'function') {
      throw new Error(`registerAction("${type}"): \`refs\` and \`describe\` must be functions`)
    }
    if (!Array.isArray(definition.ui.fields)) {
      throw new Error(`registerAction("${type}"): \`ui.fields\` must be an array`)
    }
    this.definitions.set(type, definition as ActionDefinition<any>)
  }

  get(type: string): ActionDefinition<any> | undefined {
    return this.definitions.get(type)
  }

  all(): ActionDefinition<any>[] {
    return [...this.definitions.values()]
  }

  has(type: string): boolean {
    return this.definitions.has(type)
  }

  get size(): number {
    return this.definitions.size
  }

  /** Test-only: lets a suite register a throwaway action without leaking into others. */
  clear(): void {
    this.definitions.clear()
  }
}

/** The registry the engine uses unless one is injected. */
export const defaultRegistry = new ActionRegistry()

export function registerAction<P>(definition: ActionDefinition<P>): void {
  defaultRegistry.register(definition)
}

export function getAction(type: string): ActionDefinition<any> | undefined {
  return defaultRegistry.get(type)
}

export function allActions(): ActionDefinition<any>[] {
  return defaultRegistry.all()
}

/**
 * Extracts the document ids an action's params point at, for `checkIntegrity` and the
 * reverse reference index. Unknown action types contribute nothing rather than throwing:
 * a document may name an action this build does not have, and that is I3's finding to
 * report, not a crash.
 */
export function createActionRefResolver(registry: ActionRegistry = defaultRegistry) {
  return (action: { action: string; params: Record<string, unknown> }) => {
    const definition = registry.get(action.action)
    if (!definition) return []
    const parsed = definition.schema.safeParse(action.params)
    if (!parsed.success) return []
    return definition.refs(parsed.data)
  }
}
