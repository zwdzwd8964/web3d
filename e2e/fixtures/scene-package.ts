import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { packScene } from '@w3/storage'

/**
 * T-278 · 一份「零资产但真的会渲染出东西」的 `.w3p`，给不需要走发布流程的 e2e 用。
 *
 * 黄金路径那两条 spec 是**从编辑器发布出来**的包——它们测的正是那条交接。而嵌入、
 * bench 这类 spec 要的只是「一个能打开的包」，为它跑一遍完整发布流程等于把两分钟的
 * 编辑器操作接在一条与编辑器无关的断言前面。
 *
 * 从 schema 的 v3 fixture 派生而不是手写：那份 fixture 有 `fixtures.test.ts` 盯着，
 * 手写一份等于在 e2e 里维护第二份文档形状。派生时只做减法（清空全部引用型集合），
 * 再加原始体——原始体不需要任何 blob，于是这个包零资产，`packScene` 不会因为缺字节
 * 而拒绝。
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

export interface ScenePackageOptions {
  readonly name: string
  /** 放几个立方体。bench 的压力爬坡要多于一个物体才量得出 drawcall 的变化。 */
  readonly boxes?: number
}

/** 一个原始体节点。摆成一排，好让相机一次看全。 */
function box(index: number): Record<string, unknown> {
  return {
    id: `nd_e2ebox${String(index).padStart(2, '0')}`,
    name: `样例立方体 ${index + 1}`,
    parent: null,
    order: 1000 + index,
    assetRef: null,
    primitive: { kind: 'box', size: [1.2, 1.2, 1.2] },
    light: null,
    section: null,
    transform: { p: [(index - 1) * 1.8, 0, 0], r: [0, 0, 0, 1], s: [1, 1, 1] },
    visible: true,
    locked: false,
    explode: null,
    explodeOffset: null,
    prefabRef: null,
    overrides: {},
  }
}

/** 打一个包。返回的是 `.w3p` 的字节，可以直接写盘或喂给文件选择器。 */
export function buildScenePackage(options: ScenePackageOptions): Uint8Array {
  const base = JSON.parse(
    readFileSync(join(ROOT, 'packages', 'schema', 'test', 'fixtures', 'v3', 'golden-path-3.json'), 'utf8'),
  ) as Record<string, unknown>
  const meta = base['meta'] as Record<string, unknown>

  const document = {
    ...base,
    name: options.name,
    meta: {
      ...meta,
      // 雾会把远处的几何体染成背景色。凡是要数「画面上有几种颜色」的断言，留着雾
      // 等于让断言去赌相机离盒子多远。
      fog: { ...(meta['fog'] as Record<string, unknown>), enabled: false },
    },
    assets: [],
    nodes: Array.from({ length: options.boxes ?? 1 }, (_, index) => box(index)),
    animations: [],
    hotspots: [],
    viewpoints: [],
    rules: [],
    pages: [],
    flows: [],
    media: [],
    dataSources: [],
    prefabs: [],
    // ADR-0042 第二轮 · **两个变量都要有，删任何一个都会让别处红。**
    //
    // - `step` 是 v3 fixture 自带的，T-276 用例 1 拿它测 getVariable / setVariable。
    //   第二轮加 `var_step` 时把整个 `variables` 覆盖掉了，用例 1 当场红在
    //   「没有名为『step』的变量」——**继承来的字段被整段替换，是这份派生夹具的固有风险**。
    // - `var_step` 是 `samples/host-demo/index.html` 快速开始（与 EMBED_API §1 逐字相同、
    //   客户照抄的就是这一段）最后一步 `setVariable('var_step', 2)` 要的。没有它，那条链
    //   **在成功路径上每一次都走 catch**，控制台稳定输出「嵌入失败[unknown-variable]」，
    //   而用例 5 的 `errors=[]` 照样绿（它只收 pageerror）。
    variables: [
      ...((base['variables'] as unknown[] | undefined) ?? []),
      { id: 'var_step', name: '当前步骤', type: 'number', default: 1, persist: false, scope: 'scene' },
    ],
  }

  return packScene({
    document: document as never,
    snapshotId: 'snp_e2e0001',
    publishedAt: '2026-08-10T00:00:00.000Z',
    coreVersion: '0.0.0-e2e',
    blobs: new Map(),
  })
}
