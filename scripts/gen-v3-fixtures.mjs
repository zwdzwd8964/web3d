#!/usr/bin/env node
/**
 * T-225 · 生成 schema v3 的 fixture，并在生成的那一刻校验它们。
 *
 * ⚠ **人工执行，产物提交进仓库，不在任何 build / CI / verify 路径上。**
 *
 * 为什么生成而不是手写 JSON：这四份 fixture 合计上千行，而它们的**全部价值**在于
 * 「真的能 migrate、真的能 validate、真的能过 checkIntegrity」。手写的 JSON 要靠人肉
 * 保证这三件事；生成的在写盘之前就被这三条检查过一遍，写不出来就报错。
 *
 * 规划 §4.1.6 逐字规定了每一份「必须含」什么，本脚本按那张表实现，并在末尾把每一条
 * 要求的实测结果打印出来——**fixture 的价值全在覆盖面上，覆盖面必须可见**。
 *
 * Run: node scripts/gen-v3-fixtures.mjs
 */
import { readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  OVERLAY_TYPES,
  applyMigrationChain,
  checkIntegrity,
  createGoldenPathDocument,
  errorsOf,
  validate,
} from '../packages/schema/dist/index.js'
// 从 dist 而不是 src：Node 的类型剥离不会把源码内部的 `.js` 说明符改写成 `.ts`，
// 而 schema 的每一个文件都用 `.js` 互相引用（ADR-0003 的 NodeNext 约定）。
// 代价是跑之前要先 `pnpm -F @w3/schema build`——脚本头注释已写明它是人工执行的。

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'packages/schema/test/fixtures')

/**
 * `dist` 比 `src` 旧就停。
 *
 * **实测踩到的：**改完 `effects.ts` 的 `hiddenEdge` 枚举直接跑本脚本，四份 fixture 全部
 * 打印「迁移✓ 校验✓ 完整性✓」——因为它们是拿旧 `dist` 校验旧默认值，自洽得毫无破绽。
 * 生成器的全部价值是「写盘之前先验一遍」，读着过期的 dist 时它验的是上一个版本的 schema，
 * 那句 ✓ 反而成了最有说服力的假绿。
 */
function assertDistFresh() {
  const newest = (dir) => {
    let t = 0
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, e.name)
      t = Math.max(t, e.isDirectory() ? newest(full) : statSync(full).mtimeMs)
    }
    return t
  }
  const src = newest(join(ROOT, 'packages/schema/src'))
  const dist = newest(join(ROOT, 'packages/schema/dist'))
  if (src > dist) {
    console.error(
      `[gen-v3-fixtures] packages/schema/dist 比 src 旧 —— 先跑 pnpm -F @w3/schema build。\n` +
        `                  否则下面四行 ✓ 校验的是上一个版本的 schema，是假绿。`,
    )
    process.exit(1)
  }
}
assertDistFresh()

const clone = (v) => JSON.parse(JSON.stringify(v))

/* ========================================================================== */
/* v3/golden-path-3.json · 黄金路径 III 终态                                   */
/* ========================================================================== */

function goldenPathThree() {
  const doc = clone(createGoldenPathDocument())

  // 两个 enabled 都要 true —— 只用默认值的 fixture 覆盖的是「关着」那一侧，
  // 而那正是 v0.5 toneMapping 那条假绿的同形。
  doc.meta.fog.enabled = true
  doc.meta.effects.outline.enabled = true

  const node = (id, name, parent, order, extra = {}) => ({
    id,
    name,
    parent,
    order,
    assetRef: null,
    primitive: { kind: 'box', size: [0.2, 0.2, 0.2] },
    light: null,
    section: null,
    transform: { p: [0, 0, 0], r: [0, 0, 0, 1], s: [1, 1, 1] },
    visible: true,
    locked: false,
    explode: null,
    explodeOffset: null,
    prefabRef: null,
    overrides: {},
    ...extra,
  })

  // radial 分组：3 个子件，其中 1 个钉了 explodeOffset
  doc.nodes.push(
    node('nd_grp0radi', '径向分组', doc.nodes[0].id, 3000, {
      primitive: null,
      explode: { mode: 'radial', gain: 1.5, axis: [0, 1, 0], spacing: 0.5, easing: 'easeInOutCubic' },
    }),
    node('nd_radial01', '径向件 1', 'nd_grp0radi', 100),
    node('nd_radial02', '径向件 2', 'nd_grp0radi', 200, { explodeOffset: [0.3, 0, 0] }),
    node('nd_radial03', '径向件 3', 'nd_grp0radi', 300),
  )

  // axis 分组：子件 order **刻意乱序**，用来证明排布读的是 order 而不是数组下标
  doc.nodes.push(
    node('nd_grp0axis', '轴向分组', doc.nodes[0].id, 4000, {
      primitive: null,
      explode: { mode: 'axis', gain: 1, axis: [1, 0, 0], spacing: 0.4, easing: 'linear' },
    }),
    node('nd_axis0003', '轴向件 3', 'nd_grp0axis', 300),
    node('nd_axis0001', '轴向件 1', 'nd_grp0axis', 100),
    node('nd_axis0002', '轴向件 2', 'nd_grp0axis', 200),
  )

  // 剖切平面节点，**带非单位旋转**——单位旋转下法向恰好是 +Y，会掩盖「法向取错轴」的实现。
  doc.nodes.push(
    node('nd_sect0001', '剖切面', null, 5000, {
      primitive: null,
      section: { scope: 'scene', size: [4, 4] },
      transform: { p: [0, 0.5, 0], r: [0.2705981, 0, 0, 0.9627088], s: [1, 1, 1] },
    }),
  )

  // 一条带区间的 imported 动画，与一条不带的
  doc.animations.push(
    {
      kind: 'imported',
      id: 'anm_clip0001',
      name: '拆装（片段）',
      assetId: doc.assets[0].id,
      clipName: 'Disassemble',
      speed: 1,
      loop: false,
      clampWhenFinished: true,
      startS: 0.5,
      endS: 1.8,
    },
    {
      kind: 'imported',
      id: 'anm_clip0002',
      name: '拆装（整段）',
      assetId: doc.assets[0].id,
      clipName: 'Disassemble',
      speed: 1,
      loop: false,
      clampWhenFinished: true,
      startS: 0,
      endS: null,
    },
  )

  // clipDurations 非空
  doc.assets[0].stats.clipDurations = { Disassemble: 2.4 }

  // 一个带 label 的热点，与一个没有的
  doc.hotspots[0].style.label = '1'
  doc.hotspots.push({
    ...clone(doc.hotspots[0]),
    id: 'hs_nolabel0',
    name: '无编号热点',
    style: { marker: 'dot', color: '#4aa8c7' },
  })

  return doc
}

/* ========================================================================== */
/* v3/orchestration.json · 让 v1.2 才通电的编排字段被真正走过                   */
/* ========================================================================== */

function orchestration() {
  const doc = clone(createGoldenPathDocument())
  const nodeId = doc.nodes[1].id

  // I14 要求 media 的 assetId 指向类型相符的资产——指向模型资产会被完整性检查拦下，
  // 而那正是它该做的事。补一份真的 image 资产。
  doc.assets.push({
    ...clone(doc.assets[0]),
    id: 'ast_img00001',
    type: 'image',
    name: '示意图.png',
    hash: 'sha256:1111111111111111111111111111111111111111111111111111111111111111',
    url: 'blob:ast_img00001',
    lineageId: 'ast_img00001',
    stats: { tris: 0, materials: 0, textures: 1, bytes: 2048, textureBytes: 2048, nodes: 0, animations: [], clipDurations: {} },
  })
  doc.media.push({ id: 'med_img00001', type: 'image', assetId: 'ast_img00001', name: '示意图', durationS: 1 })
  doc.variables.push({
    id: 'flow_step',
    name: '流程当前步骤',
    type: 'string',
    default: 'st_00000001',
    persist: false,
    scope: 'scene',
  })

  const rect = { x: 0.1, y: 0.1, w: 0.2, h: 0.1 }
  doc.pages = [
    {
      id: 'pg_00000001',
      name: '第一页',
      overlays: [
        { id: 'ov_00000001', type: 'text', rect, anchor: 'tl', props: { text: '{stepName}', size: 18, color: '#ffffff', align: 'left', flowId: 'flw_00000001' } },
        { id: 'ov_00000002', type: 'image', rect, anchor: 'tr', props: { mediaId: 'med_img00001', fit: 'contain' } },
        { id: 'ov_00000003', type: 'button', rect, anchor: 'bl', props: { label: '下一步', variant: 'primary' } },
        { id: 'ov_00000004', type: 'panel', rect, anchor: 'br', props: { title: '进度', text: '', mediaId: null, flowId: 'flw_00000001', progress: true } },
      ],
    },
  ]

  doc.flows = [
    {
      id: 'flw_00000001',
      name: '拆装流程',
      variableId: 'flow_step',
      startStepId: 'st_00000001',
      steps: [
        { id: 'st_00000001', name: '第一步', next: 'st_00000002', onEnter: [] },
        { id: 'st_00000002', name: '第二步', next: 'st_00000003', onEnter: [] },
        // 最后一步刻意配一个 onEnter 动作。**这是 I49 唯一的真实输入**：一条永远不会在
        // 任何磁盘文档上走过的完整性规则，和没写是一样的（规划 §4.1.6 对 pages/flows 全空
        // 的批评，逐字适用于这里）。它报 warn 不报 error，所以 fixture 仍然「零 error」。
        { id: 'st_00000003', name: '第三步', next: null, onEnter: [{ action: 'setVisible', params: { nodeId, value: false } }] },
      ],
    },
  ]

  const show = { action: 'setVisible', params: { nodeId, value: true } }
  doc.rules.push(
    {
      id: 'rl_page0001',
      name: '进入第一页',
      enabled: true,
      when: { event: 'pageEnter', pageId: 'pg_00000001' },
      if: [],
      ifAny: [],
      then: [show],
      mode: 'sequence',
      reentry: 'restart',
      onError: 'continue',
    },
    {
      id: 'rl_step0001',
      name: '进入第二步',
      enabled: true,
      when: { event: 'flowStepEnter', flowId: 'flw_00000001', stepId: 'st_00000002' },
      // 一条读 { event: 'stepId' } 的条件 —— v3 新增的载荷键，没有它这个键永远没被走过
      if: [{ op: 'eq', left: { event: 'stepId' }, right: { const: 'st_00000002' } }],
      ifAny: [],
      then: [show],
      mode: 'sequence',
      reentry: 'restart',
      onError: 'continue',
    },
    {
      id: 'rl_ovcl0001',
      name: '点按钮',
      enabled: true,
      when: { event: 'overlayClick', overlayId: 'ov_00000003' },
      if: [],
      ifAny: [],
      then: [show],
      mode: 'sequence',
      reentry: 'restart',
      onError: 'continue',
    },
  )
  return doc
}

/* ========================================================================== */
/* v3/integration-placeholder.json · 让 v1.5 / v2 的 placeholder 被走过        */
/* ========================================================================== */

function integrationPlaceholder() {
  const doc = clone(createGoldenPathDocument())

  doc.variables.push(
    { id: 'temp_c', name: '温度', type: 'number', default: 0, persist: false, scope: 'project' },
    { id: 'status_t', name: '状态', type: 'string', default: '', persist: false, scope: 'scene' },
  )

  doc.dataSources = [
    {
      id: 'ds_00000001',
      name: '停用的源',
      enabled: false,
      mode: 'live',
      url: 'http://mes.internal/api/line1',
      method: 'get',
      body: null,
      auth: { kind: 'bearer', secretRef: 'MES_TOKEN', headerName: '' },
      intervalMs: 30_000,
      timeoutMs: 10_000,
      startOn: 'sceneReady',
      onError: 'keep',
      map: [],
      sample: [],
    },
    {
      id: 'ds_00000002',
      name: '样例数据源',
      enabled: true,
      mode: 'sample',
      url: '',
      method: 'get',
      body: null,
      auth: { kind: 'none', secretRef: '', headerName: '' },
      intervalMs: 60_000,
      timeoutMs: 10_000,
      startOn: 'manual',
      onError: 'default',
      map: [
        { path: 'line.temp', variableId: 'temp_c', cast: 'number' },
        { path: 'line.state[0].text', variableId: 'status_t', cast: 'string' },
      ],
      sample: ['{"line":{"temp":42,"state":[{"text":"运行"}]}}'],
    },
  ]

  doc.viewpoints[0].thumbnailAssetId = doc.assets[0].id

  doc.assets[0].origin = {
    hash: doc.assets[0].hash,
    bytes: 1_048_576,
    stats: clone(doc.assets[0].stats),
    transcode: {
      profileId: 'default-v1',
      toolchain: 'draco3dgltf@1.5.7',
      ops: [{ op: 'draco', detail: '几何压缩，EDGEBREAKER' }],
      // 非空 skipped —— 「跳过了什么、为什么」与「做了什么」一样要留痕
      skipped: [{ op: 'decimate', detail: '减面默认关闭，未执行' }],
      triangleRatio: 1,
      finishedAt: '2026-08-04T00:00:00.000Z',
    },
  }

  doc.prefabs = [
    {
      id: 'pfb_00000001',
      name: '标准法兰',
      note: '',
      version: 1,
      nodes: [
        {
          id: 'nd_pfbnode1',
          name: '法兰盘',
          parent: null,
          order: 1000,
          assetRef: null,
          primitive: { kind: 'cylinder', radiusTop: 0.2, radiusBottom: 0.2, height: 0.05 },
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
      ],
      materials: [
        { id: 'mat_pfbmat01', name: '铸铁', base: 'standard', preset: 'custom', params: { roughness: 0.8, metalness: 0.6, maps: {} } },
      ],
    },
  ]

  doc.nodes.push({
    id: 'nd_pfbinst1',
    name: '法兰实例',
    parent: doc.nodes[0].id,
    order: 6000,
    assetRef: null,
    primitive: null,
    light: null,
    section: null,
    transform: { p: [1, 0, 0], r: [0, 0, 0, 1], s: [1, 1, 1] },
    visible: true,
    locked: false,
    explode: null,
    explodeOffset: null,
    prefabRef: { prefabId: 'pfb_00000001', overridden: [] },
    overrides: {},
  })
  return doc
}

/* ========================================================================== */
/* v2/broken-v2-flows.json · 六处改写路径的唯一真实输入                        */
/* ========================================================================== */

function brokenV2() {
  const doc = clone(createGoldenPathDocument())

  // 退回 v2 的形状：删掉全部 v3 字段。这一份必须以 schemaVersion 2 进 migrate。
  doc.schemaVersion = 2
  delete doc.sceneId
  delete doc.dataSources
  delete doc.prefabs
  delete doc.meta.fog
  delete doc.meta.effects
  for (const n of doc.nodes) {
    delete n.section
    delete n.explode
    delete n.explodeOffset
    delete n.prefabRef
  }
  for (const a of doc.animations) {
    delete a.startS
    delete a.endS
  }
  for (const a of doc.assets) delete a.stats.clipDurations
  for (const v of doc.variables) delete v.scope

  // ① 带 thumbnailUrl 的视点（非增量-2 的输入）
  doc.viewpoints[0].thumbnailUrl = 'blob:legacy-thumb'

  // ② 空的 page.name（非增量-3）· ③ 非法 overlay id（非增量-4）· ④ props 里的野键（更重-2）
  doc.pages = [
    {
      id: 'pg_00000001',
      name: '',
      // 三个覆盖层，**三种 id 情形各一个**，缺一个就有一条变异检验杀不掉：
      //   BAD-ID       完全不像 id            → 必须重铸
      //   ov_SHORT     `ov_` 前缀但形状不对    → 必须重铸。**这一个专治「把 OVERLAY_ID_RE
      //                放宽成 /^ov_/」那条变异**——放宽之后它会被判合法而逃过重铸
      //   ov_legal001 合法                   → 必须逐字保留
      // 两个待重铸的 id 还负责另一条：`deterministicOverlayId` 若返回常量，它俩会撞成同一个。
      overlays: [
        { id: 'BAD-ID', type: 'text', rect: { x: 0, y: 0, w: 0.2, h: 0.1 }, anchor: 'tl', props: { text: '你好', bogusKey: 1 } },
        { id: 'ov_SHORT', type: 'button', rect: { x: 0, y: 0.2, w: 0.2, h: 0.1 }, anchor: 'tl', props: { label: '确定' } },
        { id: 'ov_legal001', type: 'panel', rect: { x: 0, y: 0.4, w: 0.3, h: 0.2 }, anchor: 'tl', props: { title: '说明' } },
      ],
    },
  ]

  // 一条 v2 形状的 imported 动画（没有 startS / endS）。
  //
  // **不是为了「坏」，是为了让加法那一半有输入。**两份 v2 fixture 的 animations 一个
  // imported 都没有，于是 `startS`/`endS` 的迁移分支从来没有被任何一份磁盘上的 v2 文档走过
  // ——与规划 §4.1.6 点名的 `pages`/`flows` 全空是同一件事。本份 fixture 的职责是「改写路径
  // 的唯一真实输入」，顺带把这块也补上，比再造一份 fixture 便宜。
  doc.animations.push({
    kind: 'imported',
    id: 'anm_v2clip01',
    name: '拆装（v2 形状）',
    assetId: doc.assets[0].id,
    clipName: 'Disassemble',
    speed: 1,
    loop: false,
    clampWhenFinished: true,
  })

  // ⑤ 裸 flow.variableId（更重-1）
  doc.flows = [
    {
      id: 'flw_00000001',
      name: '坏流程',
      variableId: '不是合法变量名',
      steps: [
        { id: 'st_00000001', name: '第一步', next: 'st_00000002', onEnter: [] },
        { id: 'st_00000002', name: '第二步', next: null, onEnter: [] },
      ],
    },
  ]
  return doc
}

/* ========================================================================== */

const FIXTURES = [
  ['v3/golden-path-3.json', goldenPathThree(), 3],
  ['v3/orchestration.json', orchestration(), 3],
  ['v3/integration-placeholder.json', integrationPlaceholder(), 3],
  ['v2/broken-v2-flows.json', brokenV2(), 2],
]

let failed = 0
for (const [rel, doc, version] of FIXTURES) {
  const label = rel.padEnd(36)

  // v2 的那份要先迁移再校验；v3 的直接校验。
  const target = version === 3 ? doc : (() => {
    const chain = applyMigrationChain(doc)
    if (!chain.ok) {
      console.error(`FAIL ${label} 迁移失败：${JSON.stringify(chain.error).slice(0, 200)}`)
      failed++
      return null
    }
    return chain.value.raw
  })()
  if (target === null) continue

  const parsed = validate(target)
  if (!parsed.ok) {
    console.error(`FAIL ${label} 校验失败：${JSON.stringify(parsed.error.slice(0, 3))}`)
    failed++
    continue
  }
  const issues = errorsOf(checkIntegrity(parsed.value))
  if (issues.length > 0) {
    console.error(`FAIL ${label} 完整性 error ${issues.length} 条：${issues.map((i) => `${i.code} ${i.path}`).slice(0, 5).join(' · ')}`)
    failed++
    continue
  }
  writeFileSync(join(OUT, rel), `${JSON.stringify(doc, null, 2)}\n`)
  console.log(`ok   ${label} schemaVersion ${doc.schemaVersion} · 迁移✓ 校验✓ 完整性✓`)
}

if (failed > 0) process.exit(1)

/* --- 覆盖面必须可见，否则「有 fixture」与「fixture 覆盖到了」分不开 --- */
const gp3 = FIXTURES[0][1]
const orc = FIXTURES[1][1]
const ipl = FIXTURES[2][1]
console.log('')
console.log('覆盖面实测：')
console.log(`  fog.enabled / outline.enabled     ${gp3.meta.fog.enabled} / ${gp3.meta.effects.outline.enabled}`)
console.log(`  radial / axis 分组                ${gp3.nodes.filter((n) => n.explode?.mode === 'radial').length} / ${gp3.nodes.filter((n) => n.explode?.mode === 'axis').length}`)
console.log(`  带 explodeOffset 的子件           ${gp3.nodes.filter((n) => n.explodeOffset !== null).length}`)
console.log(`  section 节点（非单位旋转）         ${gp3.nodes.filter((n) => n.section !== null).length}`)
console.log(`  带区间 / 不带区间的 imported      ${gp3.animations.filter((a) => a.kind === 'imported' && a.endS !== null).length} / ${gp3.animations.filter((a) => a.kind === 'imported' && a.endS === null).length}`)
console.log(`  clipDurations 非空的资产          ${gp3.assets.filter((a) => Object.keys(a.stats.clipDurations ?? {}).length > 0).length}`)
console.log(`  带 label / 不带 label 的热点      ${gp3.hotspots.filter((h) => h.style.label !== undefined).length} / ${gp3.hotspots.filter((h) => h.style.label === undefined).length}`)
console.log(`  overlay 四种 type 齐全            ${JSON.stringify(orc.pages[0].overlays.map((o) => o.type).sort()) === JSON.stringify([...OVERLAY_TYPES].sort())}`)
console.log(`  flow 步骤链 / startStepId         ${orc.flows[0].steps.length} 步 / ${orc.flows[0].startStepId}`)
console.log(`  三个新事件的规则                  ${orc.rules.filter((r) => ['pageEnter', 'flowStepEnter', 'overlayClick'].includes(r.when.event)).length}`)
console.log(`  dataSources / prefabs            ${ipl.dataSources.length} / ${ipl.prefabs.length}`)
console.log(`  origin.transcode.skipped 非空     ${ipl.assets[0].origin.transcode.skipped.length > 0}`)
console.log(`  thumbnailAssetId / prefabRef      ${ipl.viewpoints[0].thumbnailAssetId !== undefined} / ${ipl.nodes.some((n) => n.prefabRef !== null)}`)
