import { BoxGeometry, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, PerspectiveCamera, Scene } from 'three'
import type { Object3D } from 'three'
import { describe, expect, it } from 'vitest'
import { HIGHLIGHT_PRESETS } from '../../src/highlight-presets.js'
import type { HighlightStrategy } from '../../src/runtime/highlight.js'
import { MAX_ACTIVE_OUTLINE_PRESETS, OutlineLayer } from '../../src/runtime/outline-layer.js'
import type { OutlinePassLike } from '../../src/runtime/outline-layer.js'

/**
 * T-240 · 后处理描边。
 *
 * 这里没有一条真 `OutlinePass`，理由与 T-235 的 composer 一样：它要 WebGL 上下文。
 * 而把工厂做成注入口的另一半价值是**「删掉 `composer.addPass(pass)`」这条变异在 Node 里
 * 观测得到**——只断 `selectedObjects` 的测试对一条从未挂进链路的 pass 同样为真，那是假绿。
 */

/* --- 替身 ----------------------------------------------------------------- */

/** 记下最后一次被 `set` 成什么颜色。真 `Color` 在这里毫无必要。 */
interface ColourSlot {
  value: string
  set(value: string): void
}
const colourSlot = (): ColourSlot => ({
  value: '',
  set(value: string) {
    this.value = value
  },
})

type FakePass = OutlinePassLike & { disposed: number; visibleEdgeColor: ColourSlot; hiddenEdgeColor: ColourSlot }

function fakePass(): FakePass {
  return {
    disposed: 0,
    selectedObjects: [],
    edgeStrength: -1,
    edgeThickness: -1,
    pulsePeriod: 3,
    visibleEdgeColor: colourSlot(),
    hiddenEdgeColor: colourSlot(),
    dispose() {
      this.disposed++
    },
  }
}

function fakeComposer() {
  const passes: unknown[] = []
  return {
    passes,
    addPass: (p: unknown) => void passes.push(p),
    removePass: (p: unknown) => {
      const i = passes.indexOf(p)
      if (i >= 0) passes.splice(i, 1)
    },
  }
}

/** 记账用的回落策略。真 `EmissiveStrategy` 要材质注册表，而这里要断的是「有没有回落」。 */
function fakeFallback(): HighlightStrategy & { applied: string[]; cleared: string[] } {
  const applied: string[] = []
  const cleared: string[] = []
  return {
    kind: 'emissive',
    applied,
    cleared,
    apply: (nodeId: string, preset: string) => {
      applied.push(`${nodeId}:${preset}`)
      return true
    },
    clear: (nodeId: string) => void cleared.push(nodeId),
    clearAll: () => {},
  }
}

const meshNode = () => new Mesh(new BoxGeometry(1, 1, 1), new MeshStandardMaterial())

function setup(objects: Record<string, Object3D>) {
  const composer = fakeComposer()
  const fallback = fakeFallback()
  const created: FakePass[] = []
  const warns: string[] = []
  const settings = { widthPx: 3, strength: 2.5, hiddenEdge: 'dim' as 'hide' | 'dim' | 'show', color: '#33ccff' }

  const layer = new OutlineLayer({
    composer,
    scene: new Scene(),
    camera: new PerspectiveCamera(),
    graph: { objectFor: (id: string) => objects[id] },
    fallback,
    createPass: () => {
      const p = fakePass()
      created.push(p)
      return p
    },
    settings: () => settings,
    log: (level, message) => {
      if (level === 'warn') warns.push(message)
    },
  })

  return { layer, composer, fallback, created, warns, settings }
}

const apply = (layer: OutlineLayer, nodeId: string, preset: string) =>
  layer.apply(nodeId, preset, HIGHLIGHT_PRESETS[preset]!)

/* --- 挂链路 --------------------------------------------------------------- */

describe('T-240 · pass 真的挂进了 composer', () => {
  it('第一次 apply 建一条 pass，并把它 addPass 进链路', () => {
    const mesh = meshNode()
    const { layer, composer, created } = setup({ nd_a: mesh })

    expect(apply(layer, 'nd_a', 'outline_amber')).toBe(true)

    expect(created).toHaveLength(1)
    // **断 composer.passes，不只断 selectedObjects。** 后者对一条造出来却没挂进链路的
    // pass 同样为真——那条 pass 一个像素都画不出来。
    expect(composer.passes).toEqual([created[0]])
    expect(created[0]!.selectedObjects).toEqual([mesh])
  })

  it('同一预设的第二个节点复用同一条 pass', () => {
    const a = meshNode()
    const b = meshNode()
    const { layer, composer, created } = setup({ nd_a: a, nd_b: b })

    apply(layer, 'nd_a', 'outline_amber')
    apply(layer, 'nd_b', 'outline_amber')

    expect(created).toHaveLength(1)
    expect(composer.passes).toHaveLength(1)
    expect(created[0]!.selectedObjects).toEqual([a, b])
  })

  it('不同预设各自一条 pass —— 描边颜色是 pass 的属性，不是对象的', () => {
    const { layer, composer, created } = setup({ nd_a: meshNode(), nd_b: meshNode() })

    apply(layer, 'nd_a', 'outline_amber')
    apply(layer, 'nd_b', 'outline_red')

    expect(created).toHaveLength(2)
    expect(composer.passes).toHaveLength(2)
  })
})

/* --- 参数 ----------------------------------------------------------------- */

describe('T-240 · pass 的参数从文档来', () => {
  it('宽度 / 强度 / 可见边颜色逐项落到 pass 上', () => {
    const { layer, created, settings } = setup({ nd_a: meshNode() })
    apply(layer, 'nd_a', 'outline_amber')

    const pass = created[0]!
    expect(pass.edgeThickness).toBe(settings.widthPx)
    expect(pass.edgeStrength).toBe(settings.strength)
    expect(pass.visibleEdgeColor.value).toBe(HIGHLIGHT_PRESETS.outline_amber!.emissive)
  })

  it('**`pulsePeriod` 被按到 0**（ADR-0021 第 7 条）', () => {
    // three 的默认值让描边呼吸闪烁：演示视频里好看，盯一整天的工程软件里是干扰，
    // 而且它让每一帧都不同 —— 出图与像素对拍从此不可复现。
    const { layer, created } = setup({ nd_a: meshNode() })
    apply(layer, 'nd_a', 'outline_amber')
    expect(created[0]!.pulsePeriod).toBe(0)
  })

  it('遮挡边三档：show 与可见边同色，其余为黑', () => {
    const shown = setup({ nd_a: meshNode() })
    shown.settings.hiddenEdge = 'show'
    apply(shown.layer, 'nd_a', 'outline_red')
    expect(shown.created[0]!.hiddenEdgeColor.value).toBe(
      HIGHLIGHT_PRESETS.outline_red!.emissive,
    )

    for (const mode of ['hide', 'dim'] as const) {
      const s = setup({ nd_a: meshNode() })
      s.settings.hiddenEdge = mode
      apply(s.layer, 'nd_a', 'outline_red')
      expect(s.created[0]!.hiddenEdgeColor.value, mode).toBe('#000000')
    }
  })
})

/* --- 上限与回落 ------------------------------------------------------------ */

describe('T-240 · 同时最多两种预设', () => {
  const three = () => ({ nd_a: meshNode(), nd_b: meshNode(), nd_c: meshNode() })

  it('前两种进 pass，第三种回落自发光 —— 且恰好一条 warn', () => {
    const { layer, fallback, created, warns } = setup(three())

    apply(layer, 'nd_a', 'outline_amber')
    apply(layer, 'nd_b', 'outline_red')
    expect(apply(layer, 'nd_c', 'outline_cyan'), '超限要回落，不是丢掉').toBe(true)

    expect(created).toHaveLength(MAX_ACTIVE_OUTLINE_PRESETS)
    expect(layer.activePasses.size).toBe(MAX_ACTIVE_OUTLINE_PRESETS)
    expect(fallback.applied).toEqual(['nd_c:outline_cyan'])
    // 报零条会让人以为描边生效了；每次 apply 报一条会在拖拽时刷屏。
    expect(warns).toHaveLength(1)
    expect(warns[0]).toContain('outline_cyan')
  })

  it('同一个被拒预设再来一次也只有那一条 warn', () => {
    const objects = { ...three(), nd_d: meshNode() }
    const { layer, warns } = setup(objects)

    apply(layer, 'nd_a', 'outline_amber')
    apply(layer, 'nd_b', 'outline_red')
    apply(layer, 'nd_c', 'outline_cyan')
    apply(layer, 'nd_d', 'outline_cyan')

    expect(warns).toHaveLength(1)
  })

  it('第四种预设是另一条 warn —— 不是「一共只报一次」', () => {
    const objects = { ...three(), nd_d: meshNode() }
    const { layer, warns } = setup(objects)

    apply(layer, 'nd_a', 'outline_amber')
    apply(layer, 'nd_b', 'outline_red')
    apply(layer, 'nd_c', 'outline_cyan')
    apply(layer, 'nd_d', 'outline_green')

    expect(warns).toHaveLength(2)
  })

  it('回落的那个取消时走的是 fallback.clear，不是 pass', () => {
    const { layer, fallback } = setup(three())
    apply(layer, 'nd_a', 'outline_amber')
    apply(layer, 'nd_b', 'outline_red')
    apply(layer, 'nd_c', 'outline_cyan')

    layer.clear('nd_c')
    expect(fallback.cleared).toEqual(['nd_c'])
  })
})

/* --- 拆卸 ----------------------------------------------------------------- */

describe('T-240 · 空掉的 pass 要拆掉', () => {
  it('最后一个节点取消后 removePass + dispose', () => {
    const { layer, composer, created } = setup({ nd_a: meshNode() })
    apply(layer, 'nd_a', 'outline_amber')

    layer.clear('nd_a')

    expect(composer.passes).toEqual([])
    expect(created[0]!.disposed).toBe(1)
    expect(layer.activePasses.size).toBe(0)
  })

  it('还有别的节点用着就不拆', () => {
    const a = meshNode()
    const b = meshNode()
    const { layer, composer, created } = setup({ nd_a: a, nd_b: b })
    apply(layer, 'nd_a', 'outline_amber')
    apply(layer, 'nd_b', 'outline_amber')

    layer.clear('nd_a')

    expect(composer.passes).toHaveLength(1)
    expect(created[0]!.disposed).toBe(0)
    expect(created[0]!.selectedObjects).toEqual([b])
  })

  it('**名额会还回来** —— 否则「上限 2」随时间单调劣化', () => {
    // 用过三种预设之后，前两条 pass 各自空着占着名额，第三种就永远只能回落。
    const { layer, fallback, created } = setup({ nd_a: meshNode(), nd_b: meshNode(), nd_c: meshNode() })
    apply(layer, 'nd_a', 'outline_amber')
    apply(layer, 'nd_b', 'outline_red')

    layer.clear('nd_a')
    apply(layer, 'nd_c', 'outline_cyan')

    expect(fallback.applied, '名额腾出来了，第三种不该回落').toEqual([])
    expect(created).toHaveLength(3)
    expect(layer.activePasses.has('outline_cyan')).toBe(true)
  })

  it('换预设时从旧 pass 上摘掉 —— 不摘的话两条 pass 会同时画它', () => {
    const a = meshNode()
    const { layer, created } = setup({ nd_a: a, nd_b: meshNode() })
    apply(layer, 'nd_a', 'outline_amber')
    apply(layer, 'nd_a', 'outline_red')

    expect(layer.activePasses.get('outline_red')!.selectedObjects).toEqual([a])
    expect(layer.activePasses.has('outline_amber'), '空掉的旧 pass 顺手拆了').toBe(false)
    expect(created[0]!.disposed).toBe(1)
  })

  it('**重复设成同一预设不重建 pass** —— 否则 hover 规则按帧拆建全屏通道', () => {
    const a = meshNode()
    const { layer, composer, created } = setup({ nd_a: a })

    for (let i = 0; i < 5; i++) apply(layer, 'nd_a', 'outline_amber')

    expect(created, '一条就够了').toHaveLength(1)
    expect(created[0]!.disposed).toBe(0)
    expect(composer.passes).toEqual([created[0]])
    expect(created[0]!.selectedObjects, '也不许被重复塞进选择集').toEqual([a])
  })

  it('clearAll 把 pass 全部摘掉、全部 dispose', () => {
    const { layer, composer, created } = setup({ nd_a: meshNode(), nd_b: meshNode() })
    apply(layer, 'nd_a', 'outline_amber')
    apply(layer, 'nd_b', 'outline_red')

    layer.clearAll()

    expect(composer.passes).toEqual([])
    expect(layer.activePasses.size).toBe(0)
    for (const p of created) expect(p.disposed).toBe(1)
  })

  it('取消一个从没高亮过的节点不抛、不动链路', () => {
    const { layer, composer } = setup({ nd_a: meshNode() })
    apply(layer, 'nd_a', 'outline_amber')
    expect(() => layer.clear('nd_zzz')).not.toThrow()
    expect(composer.passes).toHaveLength(1)
  })
})

/* --- 画得上 / 画不上 -------------------------------------------------------- */

describe('T-240 · 什么算画得上', () => {
  it('**unlit 材质在描边模式下高亮得起来** —— 这条路根本不碰材质', () => {
    // 自发光那条路要材质有 `emissive`，而 `MeshBasicMaterial` 没有，于是今天静默失败。
    const basic = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial({ color: 0x334455 }))
    const before = (basic.material as MeshBasicMaterial).color.getHexString()
    const { layer, created } = setup({ nd_a: basic })

    expect(apply(layer, 'nd_a', 'outline_amber')).toBe(true)
    expect(created[0]!.selectedObjects).toEqual([basic])
    expect((basic.material as MeshBasicMaterial).color.getHexString(), '描边不许改材质').toBe(before)
  })

  it('标准材质的 emissive 也不被写', () => {
    const mesh = meshNode()
    const before = (mesh.material as MeshStandardMaterial).emissive.getHexString()
    const { layer } = setup({ nd_a: mesh })

    apply(layer, 'nd_a', 'outline_amber')

    expect((mesh.material as MeshStandardMaterial).emissive.getHexString()).toBe(before)
  })

  it('空 Group 画不上 —— 返回 false，不建 pass', () => {
    // `OutlinePass` 收下一个空 Group 不报错也不画东西，那就成了「报成功而用户看不见」。
    const { layer, created } = setup({ nd_a: new Group() })
    expect(apply(layer, 'nd_a', 'outline_amber')).toBe(false)
    expect(created).toHaveLength(0)
  })

  it('但子树里有网格的分组节点画得上', () => {
    const group = new Group()
    group.add(meshNode())
    const { layer, created } = setup({ nd_a: group })
    expect(apply(layer, 'nd_a', 'outline_amber')).toBe(true)
    expect(created[0]!.selectedObjects).toEqual([group])
  })

  it('图里没有的节点画不上', () => {
    const { layer, created } = setup({})
    expect(apply(layer, 'nd_missing', 'outline_amber')).toBe(false)
    expect(created).toHaveLength(0)
  })
})

/* --- 选中通道（T-241）------------------------------------------------------ */

describe('T-241 · 编辑器选中态是一条独立通道', () => {
  it('setSelection 建一条自己的 pass 并挂进链路', () => {
    const a = meshNode()
    const { layer, composer, created, settings } = setup({ nd_a: a })

    layer.setSelection(['nd_a'])

    expect(created).toHaveLength(1)
    expect(composer.passes).toEqual([created[0]])
    expect(layer.selectionObjects).toEqual([a])
    // 颜色取 meta.effects.outline.color，**不是**任何一个预设的颜色
    expect(created[0]!.visibleEdgeColor.value).toBe(settings.color)
    expect(created[0]!.pulsePeriod, '与预设通道同一条纪律').toBe(0)
  })

  it('**不占那两个预设名额** —— 选中着也能有两种预设', () => {
    // 占了的话，「我此刻选中了什么」会决定「我的规则高亮画成什么样」，
    // 而播放器根本没有选中态，用户无从复现。
    const { layer, fallback, created } = setup({ nd_a: meshNode(), nd_b: meshNode(), nd_c: meshNode() })

    layer.setSelection(['nd_a'])
    apply(layer, 'nd_b', 'outline_amber')
    apply(layer, 'nd_c', 'outline_red')

    expect(fallback.applied, '两种预设都不该被挤到自发光').toEqual([])
    expect(layer.activePasses.size).toBe(MAX_ACTIVE_OUTLINE_PRESETS)
    expect(created).toHaveLength(3)
  })

  it('反过来：两种预设占满了也不影响选中通道', () => {
    const { layer, created } = setup({ nd_a: meshNode(), nd_b: meshNode(), nd_c: meshNode() })
    apply(layer, 'nd_b', 'outline_amber')
    apply(layer, 'nd_c', 'outline_red')

    layer.setSelection(['nd_a'])

    expect(layer.selectionObjects).toHaveLength(1)
    expect(created).toHaveLength(3)
  })

  it('空数组把那条 pass 拆掉并 dispose', () => {
    const { layer, composer, created } = setup({ nd_a: meshNode() })
    layer.setSelection(['nd_a'])

    layer.setSelection([])

    expect(layer.selectionObjects).toEqual([])
    expect(composer.passes).toEqual([])
    expect(created[0]!.disposed).toBe(1)
  })

  it('换一批选中复用同一条 pass，不重建', () => {
    const b = meshNode()
    const { layer, created } = setup({ nd_a: meshNode(), nd_b: b })
    layer.setSelection(['nd_a'])
    layer.setSelection(['nd_b'])

    expect(created, '一条就够了').toHaveLength(1)
    expect(layer.selectionObjects).toEqual([b])
  })

  it('画不出来的节点被滤掉 —— 空 Group 与图里没有的 id', () => {
    const a = meshNode()
    const { layer, created } = setup({ nd_a: a, nd_group: new Group() })

    layer.setSelection(['nd_a', 'nd_group', 'nd_missing'])
    expect(layer.selectionObjects).toEqual([a])

    layer.setSelection(['nd_group', 'nd_missing'])
    expect(layer.selectionObjects, '一个都画不出来就该把 pass 拆掉').toEqual([])
    expect(created[0]!.disposed).toBe(1)
  })

  it('clearAll 连选中通道一起收掉', () => {
    // 换策略（开关描边）时 HighlightLayer 会调 clearAll。漏掉选中通道的话，
    // 那条 pass 会连同它的两张离屏目标一起留在已经拆掉的 composer 上。
    const { layer, composer } = setup({ nd_a: meshNode(), nd_b: meshNode() })
    apply(layer, 'nd_b', 'outline_amber')
    layer.setSelection(['nd_a'])

    layer.clearAll()

    expect(layer.selectionObjects).toEqual([])
    expect(composer.passes).toEqual([])
  })

  it('参数跟着文档走 —— 宽度 / 强度 / 遮挡边三档', () => {
    const s = setup({ nd_a: meshNode() })
    s.settings.hiddenEdge = 'show'
    s.layer.setSelection(['nd_a'])

    expect(s.created[0]!.edgeThickness).toBe(s.settings.widthPx)
    expect(s.created[0]!.edgeStrength).toBe(s.settings.strength)
    expect(s.created[0]!.hiddenEdgeColor.value).toBe(s.settings.color)
  })
})
