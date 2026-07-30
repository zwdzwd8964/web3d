import type { Asset, AssetObjectEntry } from './assets.js'
import type { SceneDocument } from './document.js'
import {
  createEmptyDocument,
  createHotspot,
  createMaterial,
  createNode,
  createRule,
  createTweenAnimation,
  createVariable,
  createViewpoint,
} from './factory.js'
import type { FactoryContext } from './factory.js'
import { createSequentialIdFactory } from './ids.js'

/**
 * The golden path document (MVP_V0 §2, steps 1-11) as a deterministic builder.
 *
 * One definition, four consumers:
 *   - @w3/schema fixtures      — the C4 forward-compatibility corpus;
 *   - @w3/core ECA tests       — a realistic rule to execute head-less;
 *   - @w3/player parity tests  — the shared input both views must agree on (C3);
 *   - @w3/editor "示例项目"     — something to look at before any GLB is imported.
 *
 * Ids and timestamps are injected, so the output is byte-identical on every run.
 * That is what makes a parity trace diffable and a fixture reviewable.
 */

const PUMP_OBJECTS: AssetObjectEntry[] = [
  { path: 'Root', name: 'Root', hasMesh: false },
  { path: 'Root/Pump', name: 'Pump', hasMesh: false },
  { path: 'Root/Pump/Body', name: 'Body', hasMesh: true },
  { path: 'Root/Pump/Valve', name: 'Valve', hasMesh: false },
  { path: 'Root/Pump/Valve/Cover', name: 'Cover', hasMesh: true },
  { path: 'Root/Pump/Valve/Bolt', name: 'Bolt', hasMesh: true },
  { path: 'Root/Pump/Valve/Gasket', name: 'Gasket', hasMesh: true },
]

export const SAMPLE_PUMP_OBJECTS: readonly AssetObjectEntry[] = PUMP_OBJECTS

export interface SampleOptions {
  /** Fixed instant, so `createdAt` / `updatedAt` never drift. */
  readonly at?: string
  readonly idStart?: number
}

export function createSampleFactoryContext(options: SampleOptions = {}): FactoryContext {
  const at = options.at ?? '2026-01-01T00:00:00.000Z'
  return { newId: createSequentialIdFactory(options.idStart ?? 1), now: () => at }
}

/**
 * Builds "泵组拆装演示": one imported model, three nodes, a material override, a
 * saved viewpoint, a tween, a hotspot, one variable and the rule from step 10 —
 *
 *     when  click on 阀盖
 *     if    step == 1
 *     mode  sequence
 *     then  playAnimation -> highlight -> openPanel -> setVariable(step, 2)
 */
export function createGoldenPathDocument(options: SampleOptions = {}): SceneDocument {
  const ctx = createSampleFactoryContext(options)
  const at = ctx.now()
  const doc = createEmptyDocument({ name: '泵组拆装演示', description: 'v0 黄金路径样例场景', ctx })

  const asset: Asset = {
    id: ctx.newId('asset'),
    type: 'model',
    filename: 'pump.glb',
    mimeType: 'model/gltf-binary',
    hash: `sha256:${'ab12'.repeat(16)}`,
    url: `assets/ab/12/${'ab12'.repeat(16)}.glb`,
    bytes: 8_412_300,
    version: 1,
    supersedes: null,
    stats: {
      bytes: 8_412_300,
      triangles: 128_400,
      drawCalls: 18,
      meshes: 3,
      materials: 12,
      textures: 6,
      textureBytes: 42_991_616,
      maxTextureSize: 1024,
      animations: 0,
      nodes: PUMP_OBJECTS.length,
      boundsMin: [-0.6, 0, -0.6],
      boundsMax: [0.6, 1.4, 0.6],
    },
    objects: PUMP_OBJECTS,
    createdAt: at,
  }

  const steel = createMaterial({ name: '不锈钢', params: { roughness: 0.35, metalness: 0.9, color: '#c3c9cf' }, ctx })
  const painted = createMaterial({ name: '漆面蓝', params: { roughness: 0.6, metalness: 0.1, color: '#3f6f97' }, ctx })

  const pump = createNode({
    name: '泵组',
    assetRef: { assetId: asset.id, objectPath: 'Root/Pump', objectName: 'Pump' },
    ctx,
  })
  const body = createNode({
    name: '泵体',
    parent: pump.id,
    assetRef: { assetId: asset.id, objectPath: 'Root/Pump/Body', objectName: 'Body' },
    materialId: painted.id,
    ctx,
  })
  const cover = createNode({
    name: '阀盖',
    parent: pump.id,
    assetRef: { assetId: asset.id, objectPath: 'Root/Pump/Valve/Cover', objectName: 'Cover' },
    materialId: steel.id,
    transform: { p: [0, 0.9, 0], r: [0, 0, 0, 1], s: [1, 1, 1] },
    ctx,
  })
  const bolt = createNode({
    name: '固定螺栓',
    parent: cover.id,
    assetRef: { assetId: asset.id, objectPath: 'Root/Pump/Valve/Bolt', objectName: 'Bolt' },
    materialId: steel.id,
    transform: { p: [0.18, 0.06, 0], r: [0, 0, 0, 1], s: [1, 1, 1] },
    ctx,
  })
  const gasket = createNode({
    name: '密封垫',
    parent: pump.id,
    assetRef: { assetId: asset.id, objectPath: 'Root/Pump/Valve/Gasket', objectName: 'Gasket' },
    materialId: painted.id,
    transform: { p: [0, 0.86, 0], r: [0, 0, 0, 1], s: [1, 1, 1] },
    ctx,
  })

  const viewpoint = createViewpoint({ name: '拆解视角', position: [2.4, 1.8, 3.2], target: [0, 0.7, 0], ctx })

  // Step 8: lift the cover 0.35 m over 1.2 s with easeInOutCubic.
  const lift = createTweenAnimation({
    name: '阀盖上移',
    targets: [{ nodeId: cover.id, from: null, to: { p: [0, 1.25, 0] } }],
    durationMs: 1200,
    easing: 'easeInOutCubic',
    ctx,
  })

  const hotspot = createHotspot({
    name: '拆卸第一步',
    nodeId: cover.id,
    offset: [0, 0.12, 0],
    label: '1',
    title: '拆卸第一步',
    body: '松开六颗固定螺栓，均匀交叉卸力，避免阀盖变形。',
    occlude: true,
    ctx,
  })

  const step = createVariable({ id: 'step', name: '当前步骤', type: 'number', default: 1 })

  const rule = createRule({
    name: '第一步：点击阀盖',
    when: { event: 'click', nodeId: cover.id },
    if: [{ op: 'eq', left: { var: step.id }, right: { const: 1 } }],
    mode: 'sequence',
    reentry: 'restart',
    then: [
      { action: 'playAnimation', animationId: lift.id, loop: null, speed: null },
      { action: 'highlight', nodeId: cover.id, preset: 'amber' },
      { action: 'openPanel', hotspotId: hotspot.id },
      { action: 'setVariable', variableId: step.id, value: { const: 2 } },
    ],
    ctx,
  })

  return {
    ...doc,
    assets: [asset],
    nodes: [pump, body, cover, bolt, gasket],
    materials: [steel, painted],
    animations: [lift],
    hotspots: [hotspot],
    viewpoints: [viewpoint],
    variables: [step],
    rules: [rule],
  }
}

/**
 * The same pump, re-exported after the valve was regrouped into a sub-assembly, a
 * second bolt was added, and the gasket was deleted. This is the scenario D5's remap
 * ladder exists for, and it exercises all four tiers against the golden path document:
 *
 *   泵组   Root/Pump                 unchanged                       -> exact
 *   泵体   Root/Pump/Body            unchanged                       -> exact
 *   阀盖   Root/Pump/Valve/Cover     moved, name still unique        -> byName
 *   固定螺栓 Root/Pump/Valve/Bolt    two "Bolt" now; one shares more
 *                                    trailing path segments          -> byPathScore
 *   密封垫 Root/Pump/Valve/Gasket    deleted from the model          -> orphaned
 */
export const SAMPLE_PUMP_OBJECTS_V2: readonly AssetObjectEntry[] = [
  { path: 'Root', name: 'Root', hasMesh: false },
  { path: 'Root/Pump', name: 'Pump', hasMesh: false },
  { path: 'Root/Pump/Body', name: 'Body', hasMesh: true },
  { path: 'Root/Pump/Assembly', name: 'Assembly', hasMesh: false },
  { path: 'Root/Pump/Assembly/Valve', name: 'Valve', hasMesh: false },
  { path: 'Root/Pump/Assembly/Valve/Cover', name: 'Cover', hasMesh: true },
  { path: 'Root/Pump/Assembly/Valve/Bolt', name: 'Bolt', hasMesh: true },
  { path: 'Root/Pump/Assembly/Flange/Bolt', name: 'Bolt', hasMesh: true },
]
