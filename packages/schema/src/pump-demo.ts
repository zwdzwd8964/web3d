import type { SceneDocument } from './document.js'

/**
 * T-283 · 泵组样板工程的**文档**。
 *
 * ## 它与 `samples.ts` 的黄金路径样例是两件事
 *
 * `createGoldenPathDocument` 是 SCHEMA_SPEC §12 的逐字转录：三个节点、一条补间、一条规则。
 * 它的用途是**规范的可执行副本**——迁移链、parity 轨迹、fixture 回归都比对它，所以它必须
 * 小到能被人逐行读完，而且不许因为「让样例好看一点」而变。
 *
 * 这一份不一样：它是**拿给客户看的那个工程**。16 个零件、4 条材质、一条真的从 GLB 导入的
 * 「拆装」动画、一个爆炸分组、一条剖切平面、3 个视点、5 个热点。
 *
 * ## 路径不是抄的，是从生成器读的
 *
 * 每一个 `assetRef.objectPath` 都取自 `PUMP_DEMO_OBJECTS`（`@w3/core` 的
 * `assets/pump-demo.ts`，与 GLB 出自同一个函数）。**手抄一份的话，改一次模型就要改两处，
 * 而漏掉的那一处的症状是「这个零件在层级树里在，在画面上不在」**——remap 阶梯会把它判成
 * orphaned，而用户只看到少了一块。
 *
 * ⚠ `@w3/schema` 不许依赖 `@w3/core`（包边界），所以路径在这里**再声明一次**，
 * 由 `packages/core/test/assets/pump-demo.test.ts` 的三方断言看着：生成器的节点表、
 * 加载器实际产出的路径、以及本文件的这份清单，三者必须一致。**两方比对会自己同意自己。**
 */

/** 稳定 id。与黄金路径样例一样写死——fixture 要逐字节可比。 */
export const PUMP_DEMO_IDS = {
  project: 'prj_pump0001',
  scene: 'scn_pump0001',
  asset: 'ast_pumpdemo',
  animation: 'anm_pumpdis1',
  variable: 'step',
} as const

/**
 * 16 个零件的对象路径，与 `@w3/core` 的 `PUMP_DEMO_OBJECTS` 逐字相同。
 *
 * 顺序 = 层级顺序，父一定排在子前面——下面按它建树时直接依赖这一点。
 */
export const PUMP_DEMO_PATHS = [
  'Root',
  'Root/Pump',
  'Root/Pump/Base',
  'Root/Pump/Casing',
  'Root/Pump/Casing/Volute',
  'Root/Pump/Casing/SuctionFlange',
  'Root/Pump/Casing/DischargeFlange',
  'Root/Pump/Casing/Impeller',
  'Root/Pump/Casing/WearRing',
  'Root/Pump/ValveCover',
  'Root/Pump/ValveCover/CoverBolt1',
  'Root/Pump/ValveCover/CoverBolt2',
  'Root/Pump/ValveCover/CoverBolt3',
  'Root/Pump/ValveCover/CoverBolt4',
  'Root/Pump/Shaft',
  'Root/Pump/Motor',
] as const

/** 中文名。面向用户的字符串一律中文（命名规范），而路径是英文的资产内部结构。 */
const LABELS: Record<string, string> = {
  Root: '泵组总成',
  'Root/Pump': '离心泵',
  'Root/Pump/Base': '底座',
  'Root/Pump/Casing': '泵壳组',
  'Root/Pump/Casing/Volute': '蜗壳',
  'Root/Pump/Casing/SuctionFlange': '进水法兰',
  'Root/Pump/Casing/DischargeFlange': '出水法兰',
  'Root/Pump/Casing/Impeller': '叶轮',
  'Root/Pump/Casing/WearRing': '口环',
  'Root/Pump/ValveCover': '阀盖',
  'Root/Pump/ValveCover/CoverBolt1': '盖螺栓 1',
  'Root/Pump/ValveCover/CoverBolt2': '盖螺栓 2',
  'Root/Pump/ValveCover/CoverBolt3': '盖螺栓 3',
  'Root/Pump/ValveCover/CoverBolt4': '盖螺栓 4',
  'Root/Pump/Shaft': '泵轴',
  'Root/Pump/Motor': '电机',
}

/**
 * 路径 → 节点 id。**确定性派生**，不是随手编的。
 *
 * 取路径最后一段的小写字母数字、截到 8 位、不足补 `0`。写死一张表也行，但那张表会在
 * 加零件时被人忘掉一行，而症状是一个 id 冲突——`ID_COLLECTIONS` 的完整性检查会报，
 * 只是报在离成因很远的地方。
 */
function nodeIdOf(path: string): string {
  const leaf = path.slice(path.lastIndexOf('/') + 1).toLowerCase().replace(/[^a-z0-9]/g, '')
  // 长的取**后** 8 位。取前 8 位的话 CoverBolt1..4 会全部撞成 `coverbol` ——
  // 而 id 冲突的症状是四颗螺栓在层级树里变成一颗，成因离现场很远。
  const eight = leaf.length >= 8 ? leaf.slice(-8) : leaf.padEnd(8, '0')
  return `nd_${eight}`
}

/** 爆炸分组挂在阀盖上：它的四颗盖螺栓是**直接子节点**，正好是要拆下来的那一组。 */
const EXPLODE_GROUP_PATH = 'Root/Pump/ValveCover'

/**
 * 四颗盖螺栓在 `factor = 1` 时各自的去处（分组根的局部空间）。
 *
 * 方向与它们在 GLB 里的实际位置一致（±0.17 的四角），放大到 2 倍并抬高 0.25——
 * 拆螺栓的动作就是「向外、向上」。
 */
const BOLT_OFFSETS: Record<string, [number, number, number]> = {
  'Root/Pump/ValveCover/CoverBolt1': [0.34, 0.25, 0.34],
  'Root/Pump/ValveCover/CoverBolt2': [-0.34, 0.25, 0.34],
  'Root/Pump/ValveCover/CoverBolt3': [-0.34, 0.25, -0.34],
  'Root/Pump/ValveCover/CoverBolt4': [0.34, 0.25, -0.34],
}

const MATERIAL_IDS = {
  steel: 'mat_pumpstl1',
  brass: 'mat_pumpbrs1',
  rubber: 'mat_pumprub1',
  paint: 'mat_pumppnt1',
} as const

/** 哪个零件穿哪件材质。与 GLB 里的四种材质一一对应（`assets/pump-demo.ts` 的 PARTS）。 */
const MATERIAL_OF: Record<string, string> = {
  'Root/Pump/Base': MATERIAL_IDS.paint,
  'Root/Pump/Casing/Impeller': MATERIAL_IDS.brass,
  'Root/Pump/Casing/WearRing': MATERIAL_IDS.rubber,
}

const HOTSPOT_IDS = ['hs_pump0001', 'hs_pump0002', 'hs_pump0003', 'hs_pump0004', 'hs_pump0005'] as const
const VIEWPOINT_IDS = ['vp_pump0001', 'vp_pump0002', 'vp_pump0003'] as const
const RULE_IDS = ['rl_pump0001', 'rl_pump0002', 'rl_pump0003', 'rl_pump0004', 'rl_pump0005', 'rl_pump0006'] as const

/** 剖切平面节点。规则里要按 id 指它，所以提出来。 */
const SECTION_NODE_ID = 'nd_sect0001'

/** 剖面扫掠动画：一条**目标是剖切平面节点**的补间。 */
const SWEEP_ANIMATION_ID = 'anm_pumpswp1'

/** 剖开 / 合上的开关变量。两条互斥规则靠它分岔。 */
const CUT_VARIABLE = 'cut'

const PUMP_HASH = `sha256:${'0'.repeat(64)}`

/**
 * 建一份泵组样板工程。纯函数，每次返回一份新的。
 *
 * `hash` 是**占位**（全 0），资产要经 `materialiseSample` 物化：生成字节、哈希、存进
 * storage、把记录改成实际的。不物化就打开的话，画面画得出来而**发布闸门会正确地拒绝**
 * ——storage 里没有这个 hash。这正是 v0 栽过的坑（`session.ts` 的文件头记着）。
 */
export function createPumpDemoDocument(): SceneDocument {
  const nodes = PUMP_DEMO_PATHS.map((path, index) => {
    const parentPath = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : null
    const materialId = MATERIAL_OF[path]
    return {
      id: nodeIdOf(path),
      name: LABELS[path] ?? path,
      parent: parentPath === null ? null : nodeIdOf(parentPath),
      order: (index + 1) * 1000,
      assetRef: {
        assetId: PUMP_DEMO_IDS.asset,
        objectPath: path,
        objectName: path.slice(path.lastIndexOf('/') + 1),
        missing: false,
      },
      primitive: null,
      light: null,
      section: null,
      transform: { p: [0, 0, 0] as [number, number, number], r: [0, 0, 0, 1] as [number, number, number, number], s: [1, 1, 1] as [number, number, number] },
      visible: true,
      locked: false,
      // 爆炸分组与承载体正交（integrity 的 carrier 阶梯写着这件事）：阀盖既是一个
      // assetRef 节点，又是一个爆炸分组。
      explode:
        path === EXPLODE_GROUP_PATH
          ? { mode: 'radial' as const, gain: 1.6, axis: [0, 1, 0] as [number, number, number], spacing: 0.5, easing: 'easeInOutCubic' as const }
          : null,
      // **四颗盖螺栓各钉一个爆炸偏移。**
      //
      // 不钉的话 I22 会红——而且它是对的：`assetRef` 节点的 `transform` 存的是**相对
      // 源资产的增量**（SCHEMA_SPEC §4），四颗螺栓在文档里的 transform 都是
      // `[0,0,0]`，真实位置在 GLB 里。于是径向爆炸拿不到质心方向，四颗螺栓会原地不动，
      // 而「爆炸分组」这个功能在样板里等于没有。
      //
      // 钉死的偏移同时也是这份样板要演示的东西之一：`explodeOffset` 在此之前
      // **全仓没有任何一份真文档用过**。
      explodeOffset: BOLT_OFFSETS[path] ?? null,
      prefabRef: null,
      overrides: materialId ? { materialId } : {},
    }
  })

  return {
    schemaVersion: 3,
    projectId: PUMP_DEMO_IDS.project,
    sceneId: PUMP_DEMO_IDS.scene,
    name: '泵组拆装样板',
    meta: {
      unit: 'm',
      upAxis: 'Y',
      createdAt: '2026-08-11T00:00:00.000Z',
      updatedAt: '2026-08-11T00:00:00.000Z',
      background: { type: 'color', color: '#15191c' },
      // T-285 查出来的：这份样板一度**只动过 3 个可编辑字段**，其余全是默认值——
      // 一份「一堆几何」的样板，在能力覆盖体检的前两条（动作 / 事件）下照样全绿。
      // 下面这些不是为了凑数：车间照明偏冷偏亮、远处有轻微空气感、描边要在深色背景上
      // 看得清，都是这台泵在演示现场该有的样子。
      environment: { hdriAssetId: null, intensity: 1.15, exposure: 1.05 },
      fog: { enabled: true, type: 'linear', color: '#15191c', near: 4, far: 18, density: 0.02 },
      // 描边开着，而下面的规则里真的有 highlight 动作——I20 查的正是这一对。
      effects: { outline: { enabled: true, color: '#ffc24d', widthPx: 4, strength: 2.5, hiddenEdge: 'hide' } },
    },

    assets: [
      {
        id: PUMP_DEMO_IDS.asset,
        type: 'model',
        name: 'pump-demo.glb',
        hash: PUMP_HASH,
        url: `assets/00/00/${'0'.repeat(64)}.glb`,
        version: 1,
        lineageId: PUMP_DEMO_IDS.asset,
        // 占位统计。物化时会被**实测值**覆盖——一个报着假体积的资产面板是误导，
        // 无论那个假数字是大是小。
        stats: { tris: 0, materials: 4, textures: 0, bytes: 0, textureBytes: 0, nodes: 16, animations: ['拆装'], clipDurations: {} },
        audit: { checkedAt: '2026-08-11T00:00:00.000Z', policyId: 'default-v1', findings: [] },
      },
    ],

    nodes: [
      ...nodes,
      // 剖切平面。**默认关着**（T-284）：样板的开场是一台完整的泵，用户点蜗壳才剖开。
      // T-283 一度让它默认可见（为了让 bench 的剖切档量得到东西），而 T-284 的验收要的是
      // 「剖开 → 合上」两次往返后 `clippingPlanes.length` 回到 0 —— 静息态必须是 0 条平面。
      // bench 那一档在这份文档上会如实报「未测到（剖切平面都是关的）」，那正是 ADR-0042
      // 决策 3 造出来的那个形态，不是缺陷。
      // 摆在泵壳中心偏下，法向 +Y —— 往上扫掠时逐步切开，正好露出叶轮。
      {
        id: 'nd_sect0001',
        name: '水平剖切面',
        parent: null,
        order: 90_000,
        assetRef: null,
        primitive: null,
        light: null,
        section: { scope: 'scene' as const, size: [2.4, 2.4] as [number, number] },
        transform: {
          p: [0, 0.28, 0] as [number, number, number],
          // 绕 X 轴 -90°，让平面法向从 +Z 转到 +Y。**非单位旋转**是刻意的：
          // 单位旋转下「有没有把节点的世界矩阵算进法向」这件事没有观测后果。
          r: [-Math.SQRT1_2, 0, 0, Math.SQRT1_2] as [number, number, number, number],
          s: [1, 1, 1] as [number, number, number],
        },
        visible: false,
        locked: false,
        explode: null,
        explodeOffset: null,
        prefabRef: null,
        overrides: {},
      },
    ],

    materials: [
      { id: MATERIAL_IDS.steel, name: '拉丝不锈钢', base: 'standard', preset: 'custom', params: { roughness: 0.35, metalness: 0.85, maps: {} } },
      { id: MATERIAL_IDS.brass, name: '黄铜', base: 'standard', preset: 'custom', params: { roughness: 0.28, metalness: 0.9, maps: {} } },
      { id: MATERIAL_IDS.rubber, name: '丁腈橡胶', base: 'standard', preset: 'custom', params: { roughness: 0.85, metalness: 0, maps: {} } },
      { id: MATERIAL_IDS.paint, name: '机身漆', base: 'standard', preset: 'custom', params: { roughness: 0.6, metalness: 0.1, maps: {} } },
    ],

    animations: [
      // **imported，不是 tween。** 全仓第一条真的从 GLB 里来的动画：黄金路径样例的资产
      // 记录手写着 `animations: ['Disassemble']`，而那个 GLB 里一条动画通道都没有，
      // 实测统计在启动时把它覆盖成 `[]`——这个演示从来没有可导入的动画可放。
      {
        kind: 'imported' as const,
        id: PUMP_DEMO_IDS.animation,
        name: '拆装',
        assetId: PUMP_DEMO_IDS.asset,
        clipName: '拆装',
        speed: 1,
        loop: false,
        clampWhenFinished: true,
        startS: 0,
        endS: null,
      },
      // T-284 ⑥ · **剖面扫掠**：一条普通的补间，目标就是剖切平面那个节点。
      //
      // 这是「剖切作为第四种承载体」（X-03 / T-243）最有说服力的一行：补间系统不知道
      // 「剖切」这回事，它只是在移动一个节点——而那个节点恰好是一把刀。换成一个
      // `setSection` 动作的话，这条扫掠得再写一套动画通道。
      {
        kind: 'tween' as const,
        id: SWEEP_ANIMATION_ID,
        name: '剖面扫掠',
        duration: 2.4,
        easing: 'easeInOutCubic' as const,
        loop: false,
        yoyo: true,
        targets: [{ nodeId: SECTION_NODE_ID, to: { p: [0, 0.95, 0] as [number, number, number] } }],
      },
    ],

    hotspots: HOTSPOT_CONTENT.map((entry, index) => ({
      id: HOTSPOT_IDS[index]!,
      name: entry.name,
      anchor: { nodeId: nodeIdOf(entry.path), offset: entry.offset },
      occlude: true,
      visible: true,
      fadeWithDistance: false,
      content: { type: 'panel' as const, title: entry.title, text: entry.text },
      // 编号写死，不取下标：删掉一个热点会让它后面的**全部改号**，而热点编号是印在
      // 客户的作业指导书上的（X-07）。
      style: { marker: 'number' as const, color: '#ffb020', label: String(index + 1) },
    })),

    viewpoints: [
      {
        id: VIEWPOINT_IDS[0],
        name: '整机全览',
        camera: { kind: 'perspective' as const, position: [2.6, 1.9, 3.0] as [number, number, number], target: [0, 0.5, 0] as [number, number, number], up: [0, 1, 0] as [number, number, number], fov: 50, zoom: 1, near: 0.1, far: 1000 },
      },
      {
        id: VIEWPOINT_IDS[1],
        name: '阀盖特写',
        camera: { kind: 'perspective' as const, position: [0.9, 1.5, 1.1] as [number, number, number], target: [0, 0.95, 0] as [number, number, number], up: [0, 1, 0] as [number, number, number], fov: 40, zoom: 1, near: 0.1, far: 1000 },
      },
      {
        id: VIEWPOINT_IDS[2],
        name: '剖面视角',
        camera: { kind: 'perspective' as const, position: [0, 1.2, 2.4] as [number, number, number], target: [0, 0.5, 0] as [number, number, number], up: [0, 1, 0] as [number, number, number], fov: 45, zoom: 1, near: 0.1, far: 1000 },
      },
    ],

    variables: [
      { id: PUMP_DEMO_IDS.variable, name: '当前步骤', type: 'number' as const, default: 1, persist: false, scope: 'scene' as const },
      // 剖开 / 合上是两条互斥规则，靠它分岔。做成变量而不是一个 toggle 动作，是因为
      // **规则的条件是可读的**：作者在规则编辑器里看到「当 cut = 1 时……」，而一个
      // toggle 动作的当前状态藏在运行时里，谁都读不到。
      { id: CUT_VARIABLE, name: '剖面已打开', type: 'number' as const, default: 0, persist: false, scope: 'scene' as const },
    ],

    rules: [
      // ① 开场飞位。`sceneReady` 是全仓第一条真用上它的规则——在此之前它只在事件枚举里。
      {
        id: RULE_IDS[0],
        name: '开场飞到整机全览',
        enabled: true,
        when: { event: 'sceneReady' as const },
        if: [],
        ifAny: [],
        mode: 'sequence' as const,
        reentry: 'ignore' as const,
        onError: 'continue' as const,
        then: [{ action: 'moveCamera', params: { viewpointId: VIEWPOINT_IDS[0], duration: 0.8, await: false } }],
      },

      // ② 点泵组 → 三级拆开。
      //
      // `reentry: 'ignore'` 而不是默认的 `restart`：这是一段**有先后的工艺动作**，连点两下
      // 应当把第二下丢掉，而不是从头再来一遍——restart 会让已经散开的零件瞬间弹回去再散一次。
      {
        id: RULE_IDS[1],
        name: '点泵组 → 三级拆开',
        enabled: true,
        when: { event: 'click' as const, target: { nodeId: nodeIdOf(EXPLODE_GROUP_PATH) } },
        if: [{ op: 'eq' as const, left: { var: PUMP_DEMO_IDS.variable }, right: { const: 1 } }],
        ifAny: [],
        mode: 'sequence' as const,
        reentry: 'ignore' as const,
        onError: 'abort' as const,
        then: [
          { action: 'highlight', params: { nodeId: nodeIdOf(EXPLODE_GROUP_PATH), preset: 'outline_amber' } },
          { action: 'explode', params: { nodeId: nodeIdOf(EXPLODE_GROUP_PATH), factor: 0.35, durationS: 0.5, await: true } },
          { action: 'openPanel', params: { hotspotId: HOTSPOT_IDS[0] } },
          { action: 'explode', params: { nodeId: nodeIdOf(EXPLODE_GROUP_PATH), factor: 0.7, durationS: 0.5, await: true } },
          { action: 'openPanel', params: { hotspotId: HOTSPOT_IDS[1] } },
          { action: 'explode', params: { nodeId: nodeIdOf(EXPLODE_GROUP_PATH), factor: 1, durationS: 0.6, await: true } },
          { action: 'playAnimation', params: { animationId: PUMP_DEMO_IDS.animation, await: false } },
          { action: 'setVariable', params: { variableId: PUMP_DEMO_IDS.variable, value: { const: 2 } } },
        ],
      },

      // ③ 复原。`factor: 0` 就是复原——动作自己的 `describe` 里写着「复原分组」。
      {
        id: RULE_IDS[2],
        name: '点泵组 → 复原',
        enabled: true,
        when: { event: 'click' as const, target: { nodeId: nodeIdOf(EXPLODE_GROUP_PATH) } },
        if: [{ op: 'eq' as const, left: { var: PUMP_DEMO_IDS.variable }, right: { const: 2 } }],
        ifAny: [],
        mode: 'sequence' as const,
        reentry: 'ignore' as const,
        onError: 'abort' as const,
        then: [
          { action: 'stopAnimation', params: { animationId: PUMP_DEMO_IDS.animation } },
          { action: 'explode', params: { nodeId: nodeIdOf(EXPLODE_GROUP_PATH), factor: 0, durationS: 0.5, await: true } },
          { action: 'closePanel', params: {} },
          { action: 'setVariable', params: { variableId: PUMP_DEMO_IDS.variable, value: { const: 1 } } },
        ],
      },

      // ④ 剖开看内部。
      //
      // **零新增动作**：`setVisible(剖切面, true)` 就是「打开剖切」。这是「剖切作为第四种
      // 承载体」（X-03 / T-243）整条成本论证的兑现——它自动继承了变换手柄、层级树、撤销、
      // `setVisible` 动作、退出预览还原，一条新代码都没有。
      //
      // ⚠ 代价写在明处：**自动生成的验收用例措辞会是「显示对象「水平剖切面」」**，
      // 而不是「打开剖切」。这一句要不要接受，是合同措辞层面的事（见台账 T-284 的 ⚠）。
      {
        id: RULE_IDS[3],
        name: '剖开看内部',
        enabled: true,
        when: { event: 'click' as const, target: { nodeId: nodeIdOf('Root/Pump/Casing/Volute') } },
        if: [{ op: 'eq' as const, left: { var: CUT_VARIABLE }, right: { const: 0 } }],
        ifAny: [],
        mode: 'sequence' as const,
        reentry: 'ignore' as const,
        onError: 'abort' as const,
        then: [
          { action: 'setVisible', params: { nodeId: SECTION_NODE_ID, visible: true } },
          { action: 'moveCamera', params: { viewpointId: VIEWPOINT_IDS[2], duration: 0.6, await: true } },
          { action: 'playAnimation', params: { animationId: SWEEP_ANIMATION_ID, await: false } },
          { action: 'openPanel', params: { hotspotId: HOTSPOT_IDS[2] } },
          { action: 'setVariable', params: { variableId: CUT_VARIABLE, value: { const: 1 } } },
        ],
      },

      // ⑤ 合上。与 ④ 互斥：同一个触发点，靠 `cut` 变量分岔，两条规则组成一个开关。
      //
      // 一个开关做成两条互斥规则而不是一个 toggle 动作，是因为**规则的条件是可读的**：
      // 作者在规则编辑器里看到的是「当 cut = 1 时……」，而一个 toggle 动作的当前状态
      // 藏在运行时里，谁都读不到。
      {
        id: RULE_IDS[4],
        name: '合上剖面',
        enabled: true,
        when: { event: 'click' as const, target: { nodeId: nodeIdOf('Root/Pump/Casing/Volute') } },
        if: [{ op: 'eq' as const, left: { var: CUT_VARIABLE }, right: { const: 1 } }],
        ifAny: [],
        mode: 'sequence' as const,
        reentry: 'ignore' as const,
        onError: 'abort' as const,
        then: [
          { action: 'stopAnimation', params: { animationId: SWEEP_ANIMATION_ID } },
          { action: 'setVisible', params: { nodeId: SECTION_NODE_ID, visible: false } },
          { action: 'closePanel', params: {} },
          { action: 'moveCamera', params: { viewpointId: VIEWPOINT_IDS[0], duration: 0.6, await: false } },
          { action: 'setVariable', params: { variableId: CUT_VARIABLE, value: { const: 0 } } },
        ],
      },

      // ⑥ 剖面扫掠。**这一条是本卡最有说服力的一行**：
      //
      // 补间动画的 `targets[].nodeId` 直接指向剖切平面节点，把它从 y=0.28 推到 y=0.95。
      // 剖切平面是节点，所以补间系统不需要知道「剖切」这回事——**一行新代码都不需要**。
      // 换成一个 `setSection` 动作的话，这条扫掠就得再写一套动画通道。
      {
        id: RULE_IDS[5],
        name: '点叶轮 → 扫掠剖面',
        enabled: true,
        when: { event: 'click' as const, target: { nodeId: nodeIdOf('Root/Pump/Casing/Impeller') } },
        if: [{ op: 'eq' as const, left: { var: CUT_VARIABLE }, right: { const: 1 } }],
        ifAny: [],
        mode: 'sequence' as const,
        reentry: 'restart' as const,
        onError: 'continue' as const,
        then: [
          { action: 'playAnimation', params: { animationId: SWEEP_ANIMATION_ID, await: true } },
          { action: 'openPanel', params: { hotspotId: HOTSPOT_IDS[2] } },
        ],
      },
    ],

    // v1.0 不含 flows / pages —— 随 v1.2 的 T-328 增补（A1 的版本切分，不是遗漏）。
    pages: [],
    flows: [],
    media: [],
    dataSources: [],
    prefabs: [],
  } as SceneDocument
}

/** 五个热点的内容。抽出来是为了让上面那段 map 读得下去。 */
const HOTSPOT_CONTENT: readonly {
  readonly name: string
  readonly path: string
  readonly offset: [number, number, number]
  readonly title: string
  readonly text: string
}[] = [
  { name: '第一步 · 拆盖螺栓', path: 'Root/Pump/ValveCover', offset: [0, 0.18, 0], title: '第一步', text: '对角松开四颗盖螺栓，每颗分两次卸力，避免阀盖翘曲。' },
  { name: '第二步 · 取下阀盖', path: 'Root/Pump/ValveCover/CoverBolt1', offset: [0, 0.1, 0], title: '第二步', text: '垂直抬起阀盖。卡住时用铜棒轻敲盖沿，不要撬密封面。' },
  { name: '叶轮', path: 'Root/Pump/Casing/Impeller', offset: [0, 0.2, 0], title: '叶轮', text: '检查叶片有无汽蚀麻点。口环间隙超过 0.8 mm 时应一并更换。' },
  { name: '口环', path: 'Root/Pump/Casing/WearRing', offset: [0, 0.12, 0], title: '口环', text: '易损件。丁腈橡胶材质，随每次大修更换。' },
  { name: '电机', path: 'Root/Pump/Motor', offset: [0, 0.35, 0], title: '电机', text: '拆泵前先断电挂牌。联轴器对中偏差应小于 0.05 mm。' },
]
