import type { Animation, TweenTarget } from './animation.js'
import { CURRENT_VERSION, DEFAULT_ENVIRONMENT } from './document.js'
import type { SceneDocument } from './document.js'
import type { Hotspot } from './hotspot.js'
import type { IdFactory } from './id.js'
import { defaultIdFactory } from './id.js'
import type { Light } from './light.js'
import type { Material, MaterialParams } from './material.js'
import type { AssetRef, Node, NodeOverrides } from './node.js'
import type { Primitive } from './primitive.js'
import type { Easing, Transform, Vec3 } from './primitives.js'
import { ORDER_STEP, identityTransform } from './primitives.js'
import type { Action, Condition, EventDescriptor, ExecutionMode, OnErrorMode, ReentryPolicy, Rule } from './rule.js'
import { collectAllIds, getAppendOrder } from './selectors.js'
import type { Variable, VariableType, VariableValue } from './variable.js'
import type { Camera, Viewpoint } from './viewpoint.js'

/**
 * Factories, with id minting and the clock injected.
 *
 * Not a purity exercise: fixtures and parity traces must be byte-identical run to run,
 * so `newId` and `now` are parameters everywhere. Production passes the real clock and
 * the CSPRNG; tests pass a fixed instant and a sequential id factory.
 */

export interface FactoryContext {
  readonly newId: IdFactory
  readonly now: () => string
}

export const defaultFactoryContext: FactoryContext = {
  newId: defaultIdFactory,
  now: () => new Date().toISOString(),
}

const ctxOf = (ctx?: FactoryContext) => ctx ?? defaultFactoryContext

export interface CreateDocumentOptions {
  readonly name: string
  readonly unit?: 'm' | 'cm' | 'mm'
  readonly upAxis?: 'Y' | 'Z'
  readonly ctx?: FactoryContext
}

export function createEmptyDocument(options: CreateDocumentOptions): SceneDocument {
  const ctx = ctxOf(options.ctx)
  const stamp = ctx.now()
  return {
    schemaVersion: CURRENT_VERSION,
    projectId: ctx.newId('project'),
    name: options.name,
    meta: {
      unit: options.unit ?? 'm',
      upAxis: options.upAxis ?? 'Y',
      createdAt: stamp,
      updatedAt: stamp,
      background: { type: 'color', color: '#1a1a1a' },
      environment: { ...DEFAULT_ENVIRONMENT },
    },
    assets: [],
    nodes: [],
    materials: [],
    animations: [],
    hotspots: [],
    viewpoints: [],
    variables: [],
    rules: [],
    pages: [],
    flows: [],
    media: [],
  }
}

export interface CreateNodeOptions {
  readonly name: string
  readonly parent?: string | null
  readonly order?: number
  readonly assetRef?: AssetRef | null
  /** v2 · at most one carrier may be non-null (I11). */
  readonly primitive?: Primitive | null
  readonly light?: Light | null
  readonly transform?: Transform
  readonly visible?: boolean
  readonly locked?: boolean
  readonly overrides?: NodeOverrides
  readonly ctx?: FactoryContext
}

export function createNode(options: CreateNodeOptions): Node {
  const ctx = ctxOf(options.ctx)
  return {
    id: ctx.newId('node'),
    name: options.name,
    parent: options.parent ?? null,
    order: options.order ?? ORDER_STEP,
    assetRef: options.assetRef ?? null,
    primitive: options.primitive ?? null,
    light: options.light ?? null,
    transform: options.transform ?? identityTransform(),
    visible: options.visible ?? true,
    locked: options.locked ?? false,
    overrides: options.overrides ?? {},
  }
}

/** Appends a node as the last child of `parent`, picking the next free `order`. */
export function appendNode(doc: SceneDocument, options: CreateNodeOptions): Node {
  const ctx = ctxOf(options.ctx)
  return createNode({
    ...options,
    order: options.order ?? getAppendOrder(doc, options.parent ?? null),
    ctx: { newId: (kind) => ctx.newId(kind, collectAllIds(doc)), now: ctx.now },
  })
}

export function createMaterial(options: {
  name: string
  base?: Material['base']
  preset?: string
  params?: MaterialParams
  ctx?: FactoryContext
}): Material {
  const ctx = ctxOf(options.ctx)
  return {
    id: ctx.newId('material'),
    name: options.name,
    base: options.base ?? 'standard',
    preset: options.preset ?? 'custom',
    params: options.params ?? { maps: {} },
  }
}

export function createTweenAnimation(options: {
  name: string
  targets: TweenTarget[]
  /** Seconds. */
  duration?: number
  easing?: Easing
  loop?: boolean
  yoyo?: boolean
  ctx?: FactoryContext
}): Animation {
  const ctx = ctxOf(options.ctx)
  return {
    kind: 'tween',
    id: ctx.newId('animation'),
    name: options.name,
    duration: options.duration ?? 1,
    easing: options.easing ?? 'easeInOutCubic',
    loop: options.loop ?? false,
    yoyo: options.yoyo ?? false,
    targets: options.targets,
  }
}

export function createImportedAnimation(options: {
  name: string
  assetId: string
  clipName: string
  speed?: number
  loop?: boolean
  clampWhenFinished?: boolean
  ctx?: FactoryContext
}): Animation {
  const ctx = ctxOf(options.ctx)
  return {
    kind: 'imported',
    id: ctx.newId('animation'),
    name: options.name,
    assetId: options.assetId,
    clipName: options.clipName,
    speed: options.speed ?? 1,
    loop: options.loop ?? false,
    clampWhenFinished: options.clampWhenFinished ?? true,
  }
}

export function createHotspot(options: {
  name: string
  nodeId: string
  offset?: Vec3
  title?: string
  text?: string
  occlude?: boolean
  visible?: boolean
  fadeWithDistance?: boolean
  marker?: Hotspot['style']['marker']
  color?: string
  ctx?: FactoryContext
}): Hotspot {
  const ctx = ctxOf(options.ctx)
  return {
    id: ctx.newId('hotspot'),
    name: options.name,
    anchor: { nodeId: options.nodeId, offset: options.offset ?? [0, 0, 0] },
    occlude: options.occlude ?? true,
    visible: options.visible ?? true,
    fadeWithDistance: options.fadeWithDistance ?? false,
    content: { type: 'panel', title: options.title ?? options.name, text: options.text ?? '' },
    style: { marker: options.marker ?? 'dot', color: options.color ?? '#ffb020' },
  }
}

export function createViewpoint(options: {
  name: string
  position: Vec3
  target: Vec3
  camera?: Partial<Camera>
  ctx?: FactoryContext
}): Viewpoint {
  const ctx = ctxOf(options.ctx)
  return {
    id: ctx.newId('viewpoint'),
    name: options.name,
    camera: {
      kind: 'perspective',
      position: options.position,
      target: options.target,
      up: [0, 1, 0],
      fov: 50,
      zoom: 1,
      near: 0.1,
      far: 1000,
      ...options.camera,
    },
  }
}

export function createVariable(options: {
  id: string
  name?: string
  type: VariableType
  default: VariableValue
  options?: string[]
  persist?: boolean
}): Variable {
  return {
    id: options.id,
    name: options.name ?? options.id,
    type: options.type,
    default: options.default,
    ...(options.options ? { options: options.options } : {}),
    persist: options.persist ?? false,
  }
}

export function createRule(options: {
  name: string
  when: EventDescriptor
  then: Action[]
  if?: Condition[]
  ifAny?: Condition[]
  mode?: ExecutionMode
  reentry?: ReentryPolicy
  onError?: OnErrorMode
  enabled?: boolean
  ctx?: FactoryContext
}): Rule {
  const ctx = ctxOf(options.ctx)
  return {
    id: ctx.newId('rule'),
    name: options.name,
    enabled: options.enabled ?? true,
    when: options.when,
    if: options.if ?? [],
    ifAny: options.ifAny ?? [],
    mode: options.mode ?? 'sequence',
    // MVP_V0 D9 · restart is the only default that behaves sanely when an impatient
    // user clicks the same object three times.
    reentry: options.reentry ?? 'restart',
    onError: options.onError ?? 'abort',
    then: options.then,
  }
}

/** Stamps `meta.updatedAt`. Called on persisted writes, never on preview writes. */
export function touch(doc: SceneDocument, ctx: FactoryContext = defaultFactoryContext): SceneDocument {
  return { ...doc, meta: { ...doc.meta, updatedAt: ctx.now() } }
}
