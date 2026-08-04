import type { Animation, TweenTarget } from './animation.js'
import { CURRENT_VERSION, DEFAULT_ENVIRONMENT } from './document.js'
import type { SceneDocument } from './document.js'
import type { Hotspot } from './hotspot.js'
import type { IdFactory } from './id.js'
import { defaultIdFactory, deriveSceneId } from './id.js'
import type { Explode } from './explode.js'
import { DEFAULT_OUTLINE } from './effects.js'
import { DEFAULT_FOG } from './fog.js'
import type { PrefabRef } from './prefab-ref.js'
import type { Section } from './section.js'
import type { VariableScope } from './variable.js'
import type { Light } from './light.js'
import type { Material, MaterialParams } from './material.js'
import type { Media, MediaType } from './media.js'
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
  const projectId = ctx.newId('project')
  return {
    schemaVersion: CURRENT_VERSION,
    projectId,
    // v3 · 从 projectId 确定性派生，与迁移走同一个函数——**三处调用点共用一份实现**，
    // 否则「新建的文档」与「迁移上来的文档」会得到两套 sceneId 规则。
    sceneId: deriveSceneId(projectId),
    name: options.name,
    meta: {
      unit: options.unit ?? 'm',
      upAxis: options.upAxis ?? 'Y',
      createdAt: stamp,
      updatedAt: stamp,
      background: { type: 'color', color: '#1a1a1a' },
      environment: { ...DEFAULT_ENVIRONMENT },
      fog: { ...DEFAULT_FOG },
      effects: { outline: { ...DEFAULT_OUTLINE } },
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
    dataSources: [],
    prefabs: [],
  }
}

export interface CreateNodeOptions {
  /** v3 · 剖切平面（第四种承载体）。 */
  section?: Section | null
  /** v3 · 非空表示本节点是爆炸分组。 */
  explode?: Explode | null
  /** v3 · 本件在 factor=1 的位移；null = 由算法派生。 */
  explodeOffset?: Vec3 | null
  /** v3 · 由哪个 prefab 实例化而来。v2 才有写入路径。 */
  prefabRef?: PrefabRef | null
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
    section: options.section ?? null,
    transform: options.transform ?? identityTransform(),
    visible: options.visible ?? true,
    locked: options.locked ?? false,
    explode: options.explode ?? null,
    explodeOffset: options.explodeOffset ?? null,
    prefabRef: options.prefabRef ?? null,
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

/* -------------------------------------------------------------------------- */
/* v2 carriers — SCHEMA_SPEC §4.3 / §4.4                                      */
/* -------------------------------------------------------------------------- */

/**
 * A primitive node, appended to `doc`.
 *
 * Takes the whole `Primitive` rather than a kind plus loose numbers: the shape is a
 * discriminated union, and building it here from `kind` + optional dimensions would mean
 * re-deriving each variant's defaults in a second place. Callers pass `{ kind: 'box' }`
 * and zod's defaults fill the rest at validation, or pass explicit dimensions.
 *
 * Note what this does NOT do: attach a material. D15 requires the editor to point the
 * node at a real document material (`ensureDefaultMaterial`), and doing it here would
 * make a pure factory reach into two collections at once.
 */
export function createPrimitiveNode(
  doc: SceneDocument,
  options: Omit<CreateNodeOptions, 'assetRef' | 'primitive' | 'light'> & { primitive: Primitive },
): Node {
  return appendNode(doc, { ...options, assetRef: null, primitive: options.primitive, light: null })
}

/**
 * A light node, appended to `doc`.
 *
 * D12 · a light is a node, so it arrives through the same factory as everything else and
 * inherits the tree, the transform, undo and patching for free.
 */
export function createLightNode(
  doc: SceneDocument,
  options: Omit<CreateNodeOptions, 'assetRef' | 'primitive' | 'light'> & { light: Light },
): Node {
  return appendNode(doc, { ...options, assetRef: null, primitive: null, light: options.light })
}

/**
 * A media record for an already-imported asset.
 *
 * `durationS` is omitted rather than defaulted when unknown: absent means "the browser
 * would not tell us", and `playMedia` resolves immediately and warns instead of hanging a
 * sequence on a fabricated length (D19).
 */
export function createMediaRecord(
  doc: SceneDocument,
  options: { type: MediaType; assetId: string; name: string; durationS?: number; ctx?: FactoryContext },
): Media {
  const ctx = ctxOf(options.ctx)
  return {
    id: ctx.newId('media', collectAllIds(doc)),
    type: options.type,
    assetId: options.assetId,
    name: options.name,
    ...(options.durationS === undefined ? {} : { durationS: options.durationS }),
  }
}

/** The name every primitive's fallback material carries. User-visible, so Chinese. */
export const DEFAULT_MATERIAL_NAME = '默认材质'

/**
 * The id of the shared 「默认材质」 record, creating it if the document has none.
 *
 * MVP v0.5 D15 · a primitive's material is EXPLICIT. Core could invent a grey material
 * for an unmaterialed primitive, and it does as a last resort — but as the normal path
 * that would be a rendering state the user can see and cannot edit: the material panel
 * shows nothing while the object is clearly not default-coloured. So the editor puts a
 * real record in the document and points the node at it.
 *
 * Shared by design. Everything created with it changes together, which is what a user
 * expects from something called 默认材质; the material panel's 「分离材质」 is how you opt
 * out (D15).
 *
 * Mutates `doc` — call it inside a `commit` recipe, on the draft, never on a live document.
 */
export function ensureDefaultMaterial(doc: SceneDocument, ctx?: FactoryContext): string {
  const existing = doc.materials.find((m) => m.name === DEFAULT_MATERIAL_NAME)
  if (existing) return existing.id
  const factory = ctxOf(ctx)
  const created = createMaterial({
    name: DEFAULT_MATERIAL_NAME,
    // Neutral grey, matching core's last-resort fallback so a document that has one and a
    // document that relies on the other look the same.
    params: { color: '#b8bec4', roughness: 0.8, metalness: 0, maps: {} },
    ctx: { newId: (kind) => factory.newId(kind, collectAllIds(doc)), now: factory.now },
  })
  doc.materials.push(created)
  return created.id
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
  /** v3 · 区间播放。 */
  startS?: number
  endS?: number | null
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
    startS: options.startS ?? 0,
    endS: options.endS ?? null,
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
  /** v3 · 多场景作用域。 */
  scope?: VariableScope
}): Variable {
  return {
    id: options.id,
    name: options.name ?? options.id,
    type: options.type,
    default: options.default,
    ...(options.options ? { options: options.options } : {}),
    persist: options.persist ?? false,
    scope: options.scope ?? 'scene',
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
