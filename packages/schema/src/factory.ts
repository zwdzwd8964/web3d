import type { Animation, TweenTarget } from './animations.js'
import type { AssetRef } from './assets.js'
import { CURRENT_SCHEMA_VERSION } from './document.js'
import type { SceneDocument } from './document.js'
import type { Action } from './eca/actions.js'
import type { Condition } from './eca/conditions.js'
import type { EventTrigger } from './eca/events.js'
import type { ExecutionMode, ReentryPolicy, Rule } from './eca/rules.js'
import type { Hotspot, Viewpoint } from './hotspots.js'
import type { IdFactory } from './ids.js'
import { createId } from './ids.js'
import type { Material } from './materials.js'
import { DEFAULT_MATERIAL_PARAMS } from './materials.js'
import type { SceneNode } from './nodes.js'
import type { Easing, Transform, Vec3 } from './primitives.js'
import { IDENTITY_TRANSFORM } from './primitives.js'
import { DEFAULT_ENVIRONMENT } from './reserved.js'
import type { Variable, VariableType, VariableValue } from './variables.js'

/**
 * Factories, with time and id generation injected.
 *
 * Not a purity exercise: fixtures and parity traces have to be byte-identical across
 * runs, so `now` and `newId` are parameters everywhere. Production passes the real
 * clock; tests pass a fixed instant and a sequential id factory.
 */

export interface FactoryContext {
  readonly newId: IdFactory
  readonly now: () => string
}

export const defaultFactoryContext: FactoryContext = {
  newId: createId,
  now: () => new Date().toISOString(),
}

export interface CreateDocumentOptions {
  readonly name: string
  readonly description?: string
  readonly unit?: 'm' | 'cm' | 'mm'
  readonly upAxis?: 'Y' | 'Z'
  readonly ctx?: FactoryContext
}

export function createEmptyDocument(options: CreateDocumentOptions): SceneDocument {
  const ctx = options.ctx ?? defaultFactoryContext
  const stamp = ctx.now()
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    projectId: ctx.newId('project'),
    name: options.name,
    meta: {
      unit: options.unit ?? 'm',
      upAxis: options.upAxis ?? 'Y',
      createdAt: stamp,
      updatedAt: stamp,
      description: options.description ?? '',
    },
    assets: [],
    nodes: [],
    materials: [],
    animations: [],
    hotspots: [],
    viewpoints: [],
    variables: [],
    rules: [],
    environment: { ...DEFAULT_ENVIRONMENT },
    pages: [],
    media: [],
    flows: [],
    constraints: [],
  }
}

export interface CreateNodeOptions {
  readonly name: string
  readonly parent?: string | null
  readonly assetRef?: AssetRef | null
  readonly transform?: Transform
  readonly visible?: boolean
  readonly locked?: boolean
  readonly materialId?: string | null
  readonly ctx?: FactoryContext
}

export function createNode(options: CreateNodeOptions): SceneNode {
  const ctx = options.ctx ?? defaultFactoryContext
  return {
    id: ctx.newId('node'),
    name: options.name,
    parent: options.parent ?? null,
    assetRef: options.assetRef ?? null,
    transform: options.transform ?? { ...IDENTITY_TRANSFORM, p: [...IDENTITY_TRANSFORM.p], r: [...IDENTITY_TRANSFORM.r], s: [...IDENTITY_TRANSFORM.s] },
    visible: options.visible ?? true,
    locked: options.locked ?? false,
    overrides: { materialId: options.materialId ?? null },
  }
}

export function createMaterial(options: {
  name: string
  params?: Partial<Material['params']>
  ctx?: FactoryContext
}): Material {
  const ctx = options.ctx ?? defaultFactoryContext
  return {
    id: ctx.newId('material'),
    name: options.name,
    base: null,
    params: { ...DEFAULT_MATERIAL_PARAMS, ...options.params },
    maps: {},
  }
}

export function createTweenAnimation(options: {
  name: string
  targets: TweenTarget[]
  durationMs?: number
  easing?: Easing
  loop?: boolean
  ctx?: FactoryContext
}): Animation {
  const ctx = options.ctx ?? defaultFactoryContext
  return {
    id: ctx.newId('animation'),
    name: options.name,
    kind: 'tween',
    targets: options.targets,
    durationMs: options.durationMs ?? 1000,
    easing: options.easing ?? 'easeInOutCubic',
    loop: options.loop ?? false,
  }
}

export function createImportedAnimation(options: {
  name: string
  assetId: string
  clipName: string
  loop?: boolean
  speed?: number
  ctx?: FactoryContext
}): Animation {
  const ctx = options.ctx ?? defaultFactoryContext
  return {
    id: ctx.newId('animation'),
    name: options.name,
    kind: 'imported',
    assetId: options.assetId,
    clipName: options.clipName,
    loop: options.loop ?? false,
    speed: options.speed ?? 1,
  }
}

export function createHotspot(options: {
  name: string
  nodeId: string
  offset?: Vec3
  label?: string
  title?: string
  body?: string
  occlude?: boolean
  ctx?: FactoryContext
}): Hotspot {
  const ctx = options.ctx ?? defaultFactoryContext
  return {
    id: ctx.newId('hotspot'),
    name: options.name,
    anchor: { nodeId: options.nodeId, offset: options.offset ?? [0, 0, 0] },
    occlude: options.occlude ?? true,
    visible: true,
    label: options.label ?? options.name,
    content: { type: 'panel', title: options.title ?? options.name, body: options.body ?? '' },
  }
}

export function createViewpoint(options: {
  name: string
  position: Vec3
  target: Vec3
  fov?: number
  near?: number
  far?: number
  ctx?: FactoryContext
}): Viewpoint {
  const ctx = options.ctx ?? defaultFactoryContext
  return {
    id: ctx.newId('viewpoint'),
    name: options.name,
    camera: {
      position: options.position,
      target: options.target,
      fov: options.fov ?? 45,
      near: options.near ?? 0.1,
      far: options.far ?? 1000,
    },
  }
}

export function createVariable(options: {
  id: string
  name?: string
  type: VariableType
  default: VariableValue
}): Variable {
  return {
    id: options.id,
    name: options.name ?? options.id,
    type: options.type,
    default: options.default,
  }
}

export function createRule(options: {
  name: string
  when: EventTrigger
  then: Action[]
  if?: Condition[]
  mode?: ExecutionMode
  reentry?: ReentryPolicy
  enabled?: boolean
  ctx?: FactoryContext
}): Rule {
  const ctx = options.ctx ?? defaultFactoryContext
  return {
    id: ctx.newId('rule'),
    name: options.name,
    enabled: options.enabled ?? true,
    when: options.when,
    if: options.if ?? [],
    mode: options.mode ?? 'sequence',
    // D9 · restart is the default: it is the only policy that behaves sanely
    // when a user impatiently clicks the same object three times.
    reentry: options.reentry ?? 'restart',
    then: options.then,
  }
}

/** Stamps `meta.updatedAt`. Call on every persisted write, never on preview writes. */
export function touch(doc: SceneDocument, ctx: FactoryContext = defaultFactoryContext): SceneDocument {
  return { ...doc, meta: { ...doc.meta, updatedAt: ctx.now() } }
}
