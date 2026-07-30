import type { SceneDocument } from '@w3/schema'
import type { ActionDefinition } from '../types.js'

/** Identity function that pins `P` from the schema, so handlers get real parameter types. */
export function defineAction<P>(definition: ActionDefinition<P>): ActionDefinition<P> {
  return definition
}

/* Naming helpers for `describe`, which produces the acceptance-case wording (R14). */

export const nodeName = (doc: SceneDocument, id: string) => doc.nodes.find((n) => n.id === id)?.name ?? id
export const animationName = (doc: SceneDocument, id: string) => doc.animations.find((a) => a.id === id)?.name ?? id
export const materialName = (doc: SceneDocument, id: string) => doc.materials.find((m) => m.id === id)?.name ?? id
export const hotspotName = (doc: SceneDocument, id: string) => doc.hotspots.find((h) => h.id === id)?.name ?? id
export const viewpointName = (doc: SceneDocument, id: string) => doc.viewpoints.find((v) => v.id === id)?.name ?? id
export const variableName = (doc: SceneDocument, id: string) => doc.variables.find((v) => v.id === id)?.name ?? id
