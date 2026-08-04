import type { SceneDocument } from './document.js'
import type { AssetObject } from './remap.js'

/**
 * SCHEMA_SPEC §12 · the golden path document, transcribed literally.
 *
 * This is what the document looks like at the end of step 10 of MVP_V0 §2, and it is
 * the canonical input for four different consumers:
 *   - `test/fixtures/v1/golden-path.json` — the C4 forward-compatibility corpus (T-018);
 *   - @w3/core ECA tests — a realistic rule to execute head-less;
 *   - @w3/player parity tests — the shared input both views must agree on (C3, T-103);
 *   - the editor's sample project — something to look at before any GLB is imported.
 *
 * Ids and timestamps are literal, not generated, so every consumer sees byte-identical
 * bytes. That is what makes a parity trace diffable and a fixture reviewable.
 *
 * **It tracks CURRENT_VERSION, while the v1 fixture on disk stays frozen at v1.** The two
 * are held together by an assertion that `migrate(v1 fixture)` equals this function's
 * output (fixtures.test.ts) — which turns "the sample and the fixture are one document"
 * into a live check on the migration itself: the v2 field values below are exactly what
 * v1 → v2 has to produce, written where a reviewer can read them.
 */

const PUMP_HASH = `sha256:${'ab12cd34ef567890'.repeat(4)}`
const PUMP_HEX = PUMP_HASH.slice('sha256:'.length)
const PUMP_URL = `assets/${PUMP_HEX.slice(0, 2)}/${PUMP_HEX.slice(2, 4)}/${PUMP_HEX}.glb`
const PUMP_THUMB = `assets/${PUMP_HEX.slice(0, 2)}/${PUMP_HEX.slice(2, 4)}/${PUMP_HEX}.thumb.png`

export const GOLDEN_PATH_IDS = {
  project: 'prj_a1b2c3d4',
  asset: 'ast_9k2m4p7q',
  nodePump: 'nd_r5t8y1u3',
  nodeBody: 'nd_v7w9x2z4',
  nodeCover: 'nd_b3n5m7k9',
  material: 'mat_c4d6f8h1',
  animation: 'anm_j2l4n6p8',
  hotspot: 'hs_q1s3u5w7',
  viewpoint: 'vp_e9g1i3k5',
  rule: 'rl_m8o2q4s6',
  variable: 'step',
} as const

/** Builds the SCHEMA_SPEC §12 document. Pure — returns a fresh object every call. */
export function createGoldenPathDocument(): SceneDocument {
  return {
    schemaVersion: 3,
    projectId: GOLDEN_PATH_IDS.project,
    // v3 · 由 projectId 确定性派生（deriveSceneId），不是随便写的。
    sceneId: 'scn_a1b2c3d4',
    name: '泵组拆装演示',
    meta: {
      unit: 'm',
      upAxis: 'Y',
      createdAt: '2026-08-01T02:10:00.000Z',
      updatedAt: '2026-08-01T03:42:11.000Z',
      background: { type: 'color', color: '#1a1a1a' },
      environment: { hdriAssetId: null, intensity: 1, exposure: 1 },
      fog: { enabled: false, type: 'linear', color: '#1a1a1a', near: 10, far: 100, density: 0.02 },
      effects: { outline: { enabled: false, color: '#ffb020', widthPx: 3, strength: 3, hiddenEdge: 'dim' } },
    },

    assets: [
      {
        id: GOLDEN_PATH_IDS.asset,
        type: 'model',
        name: 'pump.glb',
        hash: PUMP_HASH,
        url: PUMP_URL,
        version: 1,
        lineageId: GOLDEN_PATH_IDS.asset,
        stats: {
          tris: 128400,
          materials: 12,
          textures: 6,
          bytes: 8412300,
          textureBytes: 220200960,
          nodes: 34,
          animations: ['Disassemble'],
          clipDurations: {},
        },
        audit: {
          checkedAt: '2026-08-01T02:11:03.000Z',
          policyId: 'default-v1',
          findings: [
            { metric: 'tris', value: 128400, limit: 300000, level: 'pass', advice: '' },
            {
              metric: 'textureBytes',
              value: 220200960,
              limit: 134217728,
              level: 'fail',
              advice: '贴图显存 210MB 超出 128MB 限制。建议将 4K 贴图降至 2K，或启用 KTX2 压缩。',
            },
          ],
        },
        thumbnailUrl: PUMP_THUMB,
      },
    ],

    nodes: [
      {
        id: GOLDEN_PATH_IDS.nodePump,
        name: '泵组',
        parent: null,
        order: 1000,
        assetRef: null,
        primitive: null,
        light: null,
        section: null,
        transform: { p: [0, 0, 0], r: [0, 0, 0, 1], s: [1, 1, 1] },
        visible: true,
        locked: false,
        explode: null,
        explodeOffset: null,
        prefabRef: null,
        overrides: {},
      },
      {
        id: GOLDEN_PATH_IDS.nodeBody,
        name: '泵体',
        parent: GOLDEN_PATH_IDS.nodePump,
        order: 1000,
        assetRef: {
          assetId: GOLDEN_PATH_IDS.asset,
          objectPath: 'Root/Pump/Body',
          objectName: 'Body',
          missing: false,
        },
        primitive: null,
        light: null,
        section: null,
        transform: { p: [0, 0, 0], r: [0, 0, 0, 1], s: [1, 1, 1] },
        visible: true,
        locked: false,
        explode: null,
        explodeOffset: null,
        prefabRef: null,
        overrides: {},
      },
      {
        id: GOLDEN_PATH_IDS.nodeCover,
        name: '阀盖',
        parent: GOLDEN_PATH_IDS.nodePump,
        order: 2000,
        assetRef: {
          assetId: GOLDEN_PATH_IDS.asset,
          objectPath: 'Root/Pump/ValveCover',
          objectName: 'ValveCover',
          missing: false,
        },
        primitive: null,
        light: null,
        section: null,
        transform: { p: [0, 0, 0], r: [0, 0, 0, 1], s: [1, 1, 1] },
        visible: true,
        locked: false,
        explode: null,
        explodeOffset: null,
        prefabRef: null,
        overrides: { materialId: GOLDEN_PATH_IDS.material },
      },
    ],

    materials: [
      {
        id: GOLDEN_PATH_IDS.material,
        name: '拉丝不锈钢',
        base: 'standard',
        preset: 'custom',
        params: { roughness: 0.4, metalness: 0.9, maps: {} },
      },
    ],

    animations: [
      {
        kind: 'tween',
        id: GOLDEN_PATH_IDS.animation,
        name: '阀盖抬起',
        duration: 1.2,
        easing: 'easeInOutCubic',
        loop: false,
        yoyo: false,
        targets: [{ nodeId: GOLDEN_PATH_IDS.nodeCover, to: { p: [0, 0.35, 0] } }],
      },
    ],

    hotspots: [
      {
        id: GOLDEN_PATH_IDS.hotspot,
        name: '拆卸提示',
        anchor: { nodeId: GOLDEN_PATH_IDS.nodeCover, offset: [0, 0.2, 0] },
        occlude: true,
        visible: true,
        fadeWithDistance: false,
        content: { type: 'panel', title: '第一步', text: '松开六颗固定螺栓后抬起阀盖。' },
        style: { marker: 'number', color: '#ffb020' },
      },
    ],

    viewpoints: [
      {
        id: GOLDEN_PATH_IDS.viewpoint,
        name: '拆解视角',
        camera: {
          kind: 'perspective',
          position: [2.4, 1.8, 3.2],
          target: [0, 0.4, 0],
          up: [0, 1, 0],
          fov: 50,
          zoom: 1,
          near: 0.1,
          far: 1000,
        },
      },
    ],

    variables: [
      { id: GOLDEN_PATH_IDS.variable, name: '当前步骤', type: 'number', default: 1, persist: false, scope: 'scene' },
    ],

    rules: [
      {
        id: GOLDEN_PATH_IDS.rule,
        name: '点击阀盖执行第一步',
        enabled: true,
        when: { event: 'click', target: { nodeId: GOLDEN_PATH_IDS.nodeCover } },
        if: [{ op: 'eq', left: { var: GOLDEN_PATH_IDS.variable }, right: { const: 1 } }],
        ifAny: [],
        mode: 'sequence',
        reentry: 'restart',
        onError: 'abort',
        then: [
          { action: 'playAnimation', params: { animationId: GOLDEN_PATH_IDS.animation, await: true } },
          { action: 'highlight', params: { nodeId: GOLDEN_PATH_IDS.nodeCover, preset: 'outline_amber' } },
          { action: 'openPanel', params: { hotspotId: GOLDEN_PATH_IDS.hotspot } },
          { action: 'setVariable', params: { variableId: GOLDEN_PATH_IDS.variable, value: { const: 2 } } },
        ],
      },
    ],

    pages: [],
    flows: [],
    media: [],
    // v3 · 两个新集合。样例文档里都是空的——这正是「升级到 v3 观感一个字节不变」的样子。
    dataSources: [],
    prefabs: [],
  }
}

/** The object index of `pump.glb` as first imported. */
export const PUMP_OBJECTS_V1: readonly AssetObject[] = [
  { path: 'Root', name: 'Root' },
  { path: 'Root/Pump', name: 'Pump' },
  { path: 'Root/Pump/Body', name: 'Body' },
  { path: 'Root/Pump/ValveCover', name: 'ValveCover' },
  { path: 'Root/Pump/Valve/Bolt', name: 'Bolt' },
  { path: 'Root/Pump/Valve/Gasket', name: 'Gasket' },
]

/**
 * The same pump re-exported after the valve was regrouped, a second bolt was added and
 * the gasket was deleted. Against a document referencing every V1 object this exercises
 * all five remap outcomes — which is what H3 asks a human to confirm by hand.
 *
 *   Root/Pump/Body          unchanged                       -> exact
 *   Root/Pump/ValveCover    moved, name still unique        -> byName
 *   Root/Pump/Valve/Bolt    two "Bolt" now, one shares more
 *                           trailing segments               -> byPathScore
 *   Root/Pump/Valve/Gasket  deleted                         -> orphaned
 */
export const PUMP_OBJECTS_V2: readonly AssetObject[] = [
  { path: 'Root', name: 'Root' },
  { path: 'Root/Pump', name: 'Pump' },
  { path: 'Root/Pump/Body', name: 'Body' },
  { path: 'Root/Pump/Assembly', name: 'Assembly' },
  { path: 'Root/Pump/Assembly/ValveCover', name: 'ValveCover' },
  { path: 'Root/Pump/Assembly/Valve/Bolt', name: 'Bolt' },
  { path: 'Root/Pump/Assembly/Flange/Bolt', name: 'Bolt' },
]
