import { createGoldenPathDocument } from '@w3/schema'
import type { SceneDocument, Variable } from '@w3/schema'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { HeadlessRuntime } from '../../src/eca/headless.js'
import { MaterialRegistry } from '../../src/runtime/material-registry.js'
import { PatchApplier } from '../../src/runtime/apply-patch.js'
import { SceneGraph } from '../../src/runtime/scene-graph.js'
import { SceneRuntime } from '../../src/runtime/scene-runtime.js'
import { NullHotspotRenderer } from '../../src/runtime/hotspot-layer.js'
import { createMemoryResolver } from '../../src/runtime/loader.js'
import { createPumpAsset } from './fixtures.js'

/**
 * T-231 · `/variables/**` 的补丁路径，与写入未声明变量的裁决。
 *
 * ## 这条路径静默失效的形状
 *
 * 运行时把变量的**当前值**存在一个 Map 里；文档里存的是 `default`。编辑器新建一个变量
 * 时如果没人告诉运行时，那个变量在预览里就不存在——一条写它的规则会撞上「写入了未声明
 * 的变量」并被忽略。
 *
 * **而 `fullRebuildCount` 全程是 0**：`/variables` 一直被认领着，所以没有回落、没有告警，
 * 功能就是不工作。铁律 11 的告警机制对这一类失效完全看不见，这是它需要一条专门测试的
 * 全部理由。
 */

let graph: SceneGraph
let registry: MaterialRegistry

beforeEach(() => {
  const pump = createPumpAsset()
  graph = new SceneGraph({ assets: pump.source })
  graph.build(createGoldenPathDocument())
  registry = new MaterialRegistry()
})

/**
 * 最小渲染器桩，与 `scene-runtime.test.ts:55` 那份同形。
 *
 * 抄一份而不是抽公共：那份桩的 `as never` 曾让它合法地漏掉 `setPixelRatio`，
 * 而 T-214 在生产开始调它时才发现（六份桩一起补）。把它抽成公共意味着六处一起动，
 * 那是另一张卡的事；这里如实抄一份并留下这条线索。
 */
const fakeRenderer = () =>
  ({
    info: { memory: { geometries: 0, textures: 0 } },
    shadowMap: { enabled: false, type: -1 },
    render: () => {},
    setSize: () => {},
    setPixelRatio: () => {},
    dispose: () => {},
    domElement: {} as HTMLCanvasElement,
  }) as never

const canvas = () => ({ clientWidth: 800, clientHeight: 600 }) as HTMLCanvasElement

const variable = (id: string, def: string | number | boolean = 0): Variable =>
  ({ id, name: id, type: typeof def === 'number' ? 'number' : typeof def === 'boolean' ? 'boolean' : 'string', default: def, persist: false, scope: 'scene' }) as Variable

/** 黄金路径只有 1 个变量；本文件要能分辨「哪一个被动了」，所以造两个。 */
function docWithTwo(): SceneDocument {
  const base = createGoldenPathDocument()
  return { ...base, variables: [variable('a', 1), variable('b', 2)] }
}

describe('T-231 · /variables 的补丁被认领并接到钩子上', () => {
  it.each([[['variables']], [['variables', 0, 'default']], [['variables', 0, 'name']]])(
    '%s 调 applyVariables，且不回落整图重建',
    (path) => {
      const applyVariables = vi.fn()
      const applier = new PatchApplier({ graph, materials: registry, rebuild: () => {}, applyVariables })
      const doc = docWithTwo()
      const result = applier.apply([{ op: 'replace', path: [...path], value: [] }], doc, doc)

      expect(applyVariables).toHaveBeenCalledTimes(1)
      expect(applyVariables).toHaveBeenCalledWith(doc)
      // **这两条一起才有意义。** 只断 fullRebuildCount === 0 的话，把 applyVariables
      // 整个删掉它照样绿——那正是这条路径原来的样子。
      expect(result.rebuilt).toBe(false)
      expect(applier.fullRebuildCount).toBe(0)
    },
  )
})

/** 构造函数不填变量表，`load()` 才填（`resetRuntimeState`）。所以这里必须 await。 */
const runtimeWith = async (doc: SceneDocument, logs?: [string, string][]) => {
  const runtime = new SceneRuntime(doc, {
    canvas: canvas(),
    resolver: createMemoryResolver(new Map()),
    mode: 'play',
    createRenderer: () => fakeRenderer(),
    hotspotRenderer: new NullHotspotRenderer(),
    now: () => 0,
    onLog: (level, message) => logs?.push([level, message]),
  })
  await runtime.load(doc)
  return runtime
}

describe('T-231 · 同步保留当前值', () => {

  it('新建一个变量：它取 default，而**别的变量的当前值不动**', async () => {
    const doc = docWithTwo()
    const runtime = await runtimeWith(doc)
    runtime.setVar('a', 9)

    const next = { ...doc, variables: [...doc.variables, variable('c', 3)] }
    runtime.applyPatch([{ op: 'add', path: ['variables', 2], value: variable('c', 3) }], next, doc)

    expect(runtime.getVar('c'), '新变量没被同步进来').toBe(3)
    expect(runtime.getVar('a'), '**这一条才是重点**：同步不许把用户改过的值弹回 default').toBe(9)
    expect(runtime.getVar('b')).toBe(2)
  })

  it('改一个不相干的变量名，也不会把别人的当前值弹回 default', async () => {
    // immer 为「改名」发的是 /variables/1/name。若同步按 default 重建整张表，
    // 用户在预览里推到第 3 步的流程会被这一下弹回第 1 步。
    const doc = docWithTwo()
    const runtime = await runtimeWith(doc)
    runtime.setVar('a', 9)

    const next = { ...doc, variables: [doc.variables[0]!, { ...doc.variables[1]!, name: '改过的名字' }] }
    runtime.applyPatch([{ op: 'replace', path: ['variables', 1, 'name'], value: '改过的名字' }], next, doc)

    expect(runtime.getVar('a')).toBe(9)
  })

  it('删掉一个变量：运行时的值一并清除', async () => {
    const doc = docWithTwo()
    const runtime = await runtimeWith(doc)
    runtime.setVar('b', 7)

    const next = { ...doc, variables: [doc.variables[0]!] }
    runtime.applyPatch([{ op: 'replace', path: ['variables'], value: next.variables }], next, doc)

    expect(runtime.getVar('a')).toBe(1)
    // **读一个已删除的变量与读一个从未声明的变量必须同形。**
    // `getVar` 的契约是「warn 一声，返回 0」（scene-runtime.ts:786-792）——不是
    // undefined。同步删干净了，这两条路径才会重合。
    const logs: [string, string][] = []
    const probe = await runtimeWith({ ...doc, variables: [doc.variables[0]!] }, logs)
    expect(runtime.getVar('b')).toBe(probe.getVar('nevermind'))
  })
})

describe('T-231 · 写入未声明变量：两个运行时同形', () => {
  /**
   * **不能写成 `expect(headlessErrors[0]).toEqual(sceneErrors[0])`。**
   *
   * 两边都空的时候那是 `undefined === undefined`，恒过——而「两边都不说话」正是这条
   * 断言要防的失效之一。所以先各自断「恰好一条 error」，再断内容逐字相同。
   */
  const message = '写入了未声明的变量「nope」，忽略'

  it('SceneRuntime 报恰好一条 error，措辞逐字如此', async () => {
    const logs: [string, string][] = []
    const runtime = await runtimeWith(docWithTwo(), logs)
    // `load()` 自己会报一条 error（这个装配里 resolver 是空的，资产取不到）。
    // 本条断言的对象是 setVar，所以从这里开始数。
    logs.length = 0
    runtime.setVar('nope', 1)

    const only = logs.filter(([level]) => level === 'error')
    expect(only).toHaveLength(1)
    expect(only[0]![1]).toBe(message)
    // 「忽略」就是忽略：不许顺手把它创建出来。读回去仍然是「未声明」那条路径
    // （warn + 0），而不是 1。
    expect(runtime.getVar('nope')).toBe(0)
  })

  it('HeadlessRuntime 报恰好一条 error，措辞与上面逐字相同', () => {
    const runtime = new HeadlessRuntime(docWithTwo())
    runtime.setVar('nope', 1)

    const only = runtime.logs.filter((l) => l.level === 'error')
    expect(only).toHaveLength(1)
    expect(only[0]!.message).toBe(message)
    expect(runtime.getVar('nope')).toBe(0)
  })
})
