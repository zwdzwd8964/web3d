import type { DocIndex, EventDescriptor, EventPayloadKey, NodeTarget, Rule } from '@w3/schema'
import type { RuntimeEvent, RuntimeEventType } from './types.js'

/**
 * T-080 · ECA_SPEC §2.
 *
 * Dispatch goes through `index.rulesByEvent` and never walks the full rule list.
 * With 100 rules and a hover event firing tens of times a second, scanning everything
 * is pure waste — and it is the performance trap most likely to be missed, because it
 * only hurts once a real project has real rules.
 */

export type EventListener = (event: RuntimeEvent) => void

export class EventBus {
  private listeners = new Map<RuntimeEventType | '*', Set<EventListener>>()

  on(type: RuntimeEventType | '*', listener: EventListener): () => void {
    const set = this.listeners.get(type) ?? new Set()
    set.add(listener)
    this.listeners.set(type, set)
    return () => {
      set.delete(listener)
    }
  }

  emit(event: RuntimeEvent): void {
    // Snapshot before iterating: a listener may unsubscribe itself while handling.
    for (const listener of [...(this.listeners.get(event.event) ?? [])]) listener(event)
    for (const listener of [...(this.listeners.get('*') ?? [])]) listener(event)
  }

  clear(): void {
    this.listeners.clear()
  }
}

/** True when `nodeId` is `ancestorId` or sits underneath it. */
export function isSelfOrDescendant(index: DocIndex, nodeId: string, ancestorId: string): boolean {
  if (nodeId === ancestorId) return true
  const seen = new Set<string>([nodeId])
  let cursor = index.nodeById.get(nodeId)?.parent ?? null
  while (cursor != null && !seen.has(cursor)) {
    if (cursor === ancestorId) return true
    seen.add(cursor)
    cursor = index.nodeById.get(cursor)?.parent ?? null
  }
  return false
}

/**
 * ECA_SPEC §2.2 · target matching.
 *
 * `includeDescendants` is what makes a 34-mesh assembly configurable with one rule
 * instead of thirty-four: the user picks the group in the hierarchy tree and expects a
 * click on any part of it to count.
 */
export function matchesNodeTarget(target: NodeTarget, nodeId: string, index: DocIndex): boolean {
  if ('any' in target) return true
  if ('includeDescendants' in target) return isSelfOrDescendant(index, nodeId, target.nodeId)
  return target.nodeId === nodeId
}

/** True when a rule's `when` clause matches this concrete runtime event. */
export function triggerMatches(when: EventDescriptor, event: RuntimeEvent, index: DocIndex): boolean {
  if (when.event !== event.event) return false
  switch (when.event) {
    case 'sceneReady':
      return true
    case 'click':
    case 'hoverEnter':
    case 'hoverLeave':
      return matchesNodeTarget(when.target, (event as { nodeId: string }).nodeId, index)
    case 'hotspotClick':
      return when.hotspotId === (event as { hotspotId: string }).hotspotId
    case 'animationEnd': {
      const e = event as { animationId: string; completed: boolean }
      // §5.3: an interrupted animation must not fire animationEnd-driven rules.
      return when.animationId === e.animationId && e.completed
    }
    case 'variableChange':
      return when.variableId === (event as { variableId: string }).variableId
    case 'timer':
      // Timer rules are matched by the engine, which owns the timer -> rule mapping.
      return true
    default:
      return false
  }
}

/**
 * Candidate rules for an event, in document order.
 *
 * ECA_SPEC §2.3: when several rules match, ALL of them run, each independently — it is
 * not "first match wins". Mutual exclusion is expressed with conditions, which keeps it
 * visible in the rule table instead of hidden in dispatch order.
 */
export function candidateRules(index: DocIndex, event: RuntimeEvent): Rule[] {
  const bucket = index.rulesByEvent.get(event.event as RuntimeEventType & Rule['when']['event'])
  if (!bucket) return []
  return bucket.filter((rule) => rule.enabled && triggerMatches(rule.when, event, index))
}

/** Payload lookup for the `{ event: … }` value expression (ECA_SPEC §3.1). */
export function eventPayload(event: RuntimeEvent, key: EventPayloadKey): string | undefined {
  const value = (event as unknown as Record<string, unknown>)[key]
  return typeof value === 'string' ? value : undefined
}
