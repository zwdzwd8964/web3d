import { measureFromHeader, readGlbHeader } from '../../src/assets/glb-header.js'
import { CURRENT_VERSION, createSequentialIdFactory, DEFAULT_FOG, DEFAULT_EFFECTS, AssetStatsSchema } from '@w3/schema'
import { Box3, Matrix4, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { auditGlb, estimateTextureBytes, grade, measure, readGlb } from '../../src/assets/audit.js'
import { instantiate, isMeaningful } from '../../src/assets/instantiate.js'
import { computeNormalization, decompose, suggestUnit } from '../../src/assets/normalize.js'
import { DEFAULT_POLICY, describePolicy, formatBytes } from '../../src/assets/policy.js'
import { AssetLoader, createMemoryResolver, indexObjects } from '../../src/runtime/loader.js'
import { SceneGraph } from '../../src/runtime/scene-graph.js'
import { buildPumpGlb } from './glb.js'

/**
 * T-050 · T-051 · T-052, end to end on real GLB bytes.
 *
 * Every byte here is produced by gltf-transform and consumed by three's GLTFLoader, in
 * plain Node. Nothing is mocked, so a change that breaks the import flow fails here
 * rather than in a browser three milestones later.
 */

const loader = () => new AssetLoader({ resolver: createMemoryResolver(new Map()) })
const at = () => '2026-08-01T02:11:03.000Z'

describe('T-032 · loading', () => {
  it('parses a GLB and indexes its objects by path', async () => {
    const loaded = await loader().parse('ast_9k2m4p7q', await buildPumpGlb())

    expect([...loaded.objects.keys()]).toEqual(['Root', 'Root/Pump', 'Root/Pump/Body', 'Root/Pump/ValveCover'])
    expect(loaded.objects.get('Root/Pump/Body')!.name).toBe('Body')
    expect(loaded.assetId).toBe('ast_9k2m4p7q')
  })

  it('does not put the scene wrapper in the path', async () => {
    // Exporters name it "Scene", "Sketchfab_Scene" or nothing; objectPath must survive
    // a re-export from a different tool.
    const loaded = await loader().parse('ast_9k2m4p7q', await buildPumpGlb())
    expect([...loaded.objects.keys()].some((p) => p.startsWith('Scene'))).toBe(false)
  })

  it('warns on a duplicate path instead of overwriting it', () => {
    const scene = new SceneGraph().root
    const warnings: string[] = []
    // Build the collision directly: glTF allows duplicate sibling names.
    const { Group } = require('three') as typeof import('three')
    const parent = new Group()
    const first = new Group()
    first.name = 'Bolt'
    const second = new Group()
    second.name = 'Bolt'
    parent.add(first, second)
    scene.add(parent)

    const objects = indexObjects(scene, (m) => warnings.push(m))
    expect(warnings.some((w) => w.includes('重名路径'))).toBe(true)
    expect(objects.get('Group/Bolt')).toBe(first)
  })

  it('serves the same asset once to concurrent callers', async () => {
    const bytes = await buildPumpGlb()
    const files = new Map([['assets/ab/12/pump.glb', bytes]])
    const l = new AssetLoader({ resolver: createMemoryResolver(files) })
    const asset = {
      id: 'ast_9k2m4p7q',
      type: 'model' as const,
      name: 'pump.glb',
      hash: `sha256:${'a'.repeat(64)}`,
      url: 'assets/ab/12/pump.glb',
      version: 1,
      lineageId: 'ast_9k2m4p7q',
      stats: {
        clipDurations: {}, tris: 0, materials: 0, textures: 0, bytes: 0, textureBytes: 0, nodes: 0, animations: [] },
    }
    const [a, b] = await Promise.all([l.load(asset), l.load(asset)])
    expect(a).toBe(b)
    expect(l.size).toBe(1)
    l.dispose()
  })

  it('refuses a non-model asset with a message naming the file', async () => {
    const l = new AssetLoader({ resolver: createMemoryResolver(new Map()) })
    await expect(
      l.load({
        id: 'ast_00000001',
        type: 'texture',
        name: 'albedo.png',
        hash: `sha256:${'a'.repeat(64)}`,
        url: 'x',
        version: 1,
        lineageId: 'ast_00000001',
        stats: {
          clipDurations: {}, tris: 0, materials: 0, textures: 0, bytes: 0, textureBytes: 0, nodes: 0, animations: [] },
      }),
    ).rejects.toThrow(/albedo\.png/)
  })

  it('reports a missing asset through the resolver rather than hanging', async () => {
    const l = new AssetLoader({ resolver: createMemoryResolver(new Map()) })
    await expect(l['options'].resolver.resolve('nope')).rejects.toThrow(/资产未找到/)
  })
})

describe('T-050 · audit', () => {
  it('counts triangles, materials, textures and nodes from real bytes', async () => {
    const bytes = await buildPumpGlb({ trianglesPerMesh: 12, extraMaterials: 2, animationName: 'Disassemble' })
    const result = await auditGlb(bytes, { now: at })

    expect(result.stats.tris).toBe(24) // two meshes, 12 triangles each
    expect(result.stats.materials).toBe(3)
    expect(result.stats.nodes).toBe(4) // Root, Pump, Body, ValveCover
    expect(result.stats.animations).toEqual(['Disassemble'])
    expect(result.stats.bytes).toBe(bytes.byteLength)
  })

  it('estimates texture VRAM from the image header, not the file size', async () => {
    const bytes = await buildPumpGlb({ withTexture: { width: 2048, height: 2048 } })
    const result = await auditGlb(bytes, { now: at })

    expect(result.stats.textures).toBe(1)
    // A 2K PNG can be a few hundred KB on disk and 22 MB once decoded — the second
    // number is the one that exhausts a GPU.
    expect(result.stats.textureBytes).toBe(estimateTextureBytes(2048, 2048))
    expect(result.measurements.maxTextureSize).toBe(2048)
  })

  it('counts no triangles for a points or lines primitive', async () => {
    const document = await readGlb(await buildPumpGlb({ trianglesPerMesh: 3 }))
    for (const mesh of document.getRoot().listMeshes()) {
      for (const primitive of mesh.listPrimitives()) primitive.setMode(0) // POINTS
    }
    expect(measure(document, 100).tris).toBe(0)
  })

  it('passes a clean asset and says so', async () => {
    const result = await auditGlb(await buildPumpGlb(), { now: at })
    expect(result.verdict).toBe('pass')
    expect(result.failing).toEqual([])
    expect(result.summary).toContain('体检通过')
    expect(result.audit.policyId).toBe('default-v1')
    expect(result.audit.checkedAt).toBe(at())
  })

  it('fails a CAD-sized export, names every offending item, and advises concretely', () => {
    const result = grade(
      {
        tris: 4_200_000,
        materials: 12,
        textures: 6,
        bytes: 260 * 1024 * 1024,
        textureBytes: 900 * 1024 * 1024,
        nodes: 34,
        animations: [],
        clipDurations: {},
        maxTextureSize: 4096,
        externalRefs: 0,
        unsupportedExtensions: 0,
        textureBytesFallback: 0,
        compressedTextureCount: 0,
      },
      { now: at },
    )

    expect(result.verdict).toBe('fail')
    expect(result.failing.map((f) => f.metric).sort()).toEqual(
      ['bytes', 'maxTextureSize', 'textureBytes', 'tris'].sort(),
    )
    expect(result.summary).toContain('体检未通过')
    for (const finding of result.failing) {
      // "请优化" would be useless to the person who has to fix the model.
      expect(finding.advice.length).toBeGreaterThan(12)
      expect(finding.advice).toMatch(/建议|超出/)
    }
    expect(result.failing.find((f) => f.metric === 'textureBytes')!.advice).toMatch(/4K.*2K|KTX2/)
  })

  it('warns before it fails, at 80% of the limit', () => {
    const result = grade(
      {
        tris: Math.floor(DEFAULT_POLICY.maxTriangles * 0.85),
        materials: 1,
        textures: 0,
        bytes: 1,
        textureBytes: 0,
        nodes: 1,
        animations: [],
        clipDurations: {},
        maxTextureSize: 0,
        externalRefs: 0,
        unsupportedExtensions: 0,
        textureBytesFallback: 0,
        compressedTextureCount: 0,
      },
      { now: at },
    )
    expect(result.verdict).toBe('warn')
    expect(result.summary).toContain('接近上限')
    expect(result.failing).toEqual([])
  })

  it('accepts a customer-specific policy, which is what Appendix A becomes', async () => {
    const strict = { ...DEFAULT_POLICY, id: 'customer-a', maxTriangles: 10 }
    const result = await auditGlb(await buildPumpGlb({ trianglesPerMesh: 50 }), { policy: strict, now: at })
    expect(result.verdict).toBe('fail')
    expect(result.audit.policyId).toBe('customer-a')
  })

  it('the stats it stores match the schema — maxTextureSize is a measurement, not a field', async () => {
    const result = await auditGlb(await buildPumpGlb(), { now: at })
    // 键集从 `AssetStatsSchema` 现读，不再手抄一份。
    //
    // 手抄那版在 T-225 加 `clipDurations` 时红了，而它红得**没有信息**——被测代码是对的，
    // 只是名单过期了。一条只会因为名单过期而红的断言，读它的人第二次就会直接改名单，
    // 于是它真正要守的东西（`maxTextureSize` 是量出来的中间量，不该被存进文档）就没人守了。
    const schemaKeys = Object.keys(
      (AssetStatsSchema as unknown as { _zod: { def: { shape: Record<string, unknown> } } })._zod.def.shape,
    )
    expect(schemaKeys, 'AssetStatsSchema 读不出字段了，这条断言已经空转').not.toHaveLength(0)
    expect(Object.keys(result.stats).sort()).toEqual(schemaKeys.sort())
    expect(schemaKeys, 'maxTextureSize 是量出来的中间量，不该进文档').not.toContain('maxTextureSize')
  })

  it('describePolicy renders the numbers Appendix A is written from', () => {
    // Scoped now (v0.5): the metric table also carries image and hdri limits, and an
    // unscoped render is every threshold in the product rather than the model's seven.
    const text = describePolicy(undefined, 'model')
    expect(text).toContain('三角面数 ≤ 300,000')
    expect(text.split('\n')).toHaveLength(7)
    expect(formatBytes(8_412_300)).toBe('8.0 MB')
  })
})

describe('T-051 · normalisation', () => {
  it('is a no-op for a conforming glTF', () => {
    const { record, matrix } = computeNormalization({ targetUnit: 'm', targetUpAxis: 'Y' })
    expect(record).toEqual({ scaleApplied: 1, axisRotated: false })
    expect(matrix.equals(new Matrix4())).toBe(true)
  })

  it('scales a millimetre model into metres', () => {
    const { record, matrix } = computeNormalization({ sourceUnit: 'mm', targetUnit: 'm', targetUpAxis: 'Y' })
    expect(record.scaleApplied).toBeCloseTo(0.001, 9)
    const point = new Vector3(1000, 0, 0).applyMatrix4(matrix)
    expect(point.x).toBeCloseTo(1, 6)
  })

  it('rotates a Z-up model the right way round', () => {
    const { record, matrix } = computeNormalization({ sourceUpAxis: 'Z', targetUnit: 'm', targetUpAxis: 'Y' })
    expect(record.axisRotated).toBe(true)
    // The source's up (+Z) must end up as the document's up (+Y). The other sign lays
    // the model on its face, which gets reported as "the model is broken".
    const up = new Vector3(0, 0, 1).applyMatrix4(matrix)
    expect(up.y).toBeCloseTo(1, 6)
    expect(Math.abs(up.z)).toBeLessThan(1e-6)
  })

  it('combines scale and rotation', () => {
    const { matrix } = computeNormalization({ sourceUnit: 'mm', sourceUpAxis: 'Z', targetUnit: 'm', targetUpAxis: 'Y' })
    const point = new Vector3(0, 0, 1000).applyMatrix4(matrix)
    expect(point.y).toBeCloseTo(1, 6)
  })

  it('suggestUnit advises but never decides', () => {
    const metres = suggestUnit(new Box3(new Vector3(0, 0, 0), new Vector3(1.2, 0.9, 1.2)))
    expect(metres).toMatchObject({ unit: 'm', confident: true })

    const millimetres = suggestUnit(new Box3(new Vector3(0, 0, 0), new Vector3(1200, 900, 1200)))
    expect(millimetres.unit).toBe('mm')
    expect(millimetres.reason).toContain('疑似毫米')

    // A genuinely 120 m site model is ambiguous, and saying so beats silently shrinking it.
    expect(suggestUnit(new Box3(new Vector3(0, 0, 0), new Vector3(120, 20, 120))).confident).toBe(false)
    expect(suggestUnit(new Box3()).confident).toBe(false)
  })

  it('decompose normalises -0 away so documents diff cleanly', () => {
    const matrix = new Matrix4().makeTranslation(-0, 1, 0)
    expect(Object.is(decompose(matrix).p[0], -0)).toBe(false)
  })
})

describe('T-052 · instantiation', () => {
  const ids = () => createSequentialIdFactory()

  it('turns a parsed scene into document nodes with full object paths', async () => {
    const loaded = await loader().parse('ast_9k2m4p7q', await buildPumpGlb())
    const { nodes } = instantiate(loaded.scene, { assetId: 'ast_9k2m4p7q', newId: ids() })

    expect(nodes.map((n) => n.name)).toEqual(['Root', 'Pump', 'Body', 'ValveCover'])
    expect(nodes.map((n) => n.assetRef!.objectPath)).toEqual([
      'Root',
      'Root/Pump',
      'Root/Pump/Body',
      'Root/Pump/ValveCover',
    ])
    expect(nodes[0]!.parent).toBeNull()
    expect(nodes[2]!.parent).toBe(nodes[1]!.id)
  })

  it('spaces `order` so a later drag can insert between siblings', async () => {
    const loaded = await loader().parse('ast_9k2m4p7q', await buildPumpGlb())
    const { nodes } = instantiate(loaded.scene, { assetId: 'ast_9k2m4p7q', newId: ids() })
    const siblings = nodes.filter((n) => n.parent === nodes[1]!.id)
    expect(siblings.map((n) => n.order)).toEqual([1000, 2000])
  })

  it('collapses an unnamed pass-through group', async () => {
    const loaded = await loader().parse('ast_9k2m4p7q', await buildPumpGlb({ transportTranslation: [0, 2, 0] }))
    const { nodes, collapsed } = instantiate(loaded.scene, { assetId: 'ast_9k2m4p7q', newId: ids() })

    expect(collapsed).toBe(1)
    expect(nodes.map((n) => n.name)).toEqual(['Root', 'Pump', 'Body', 'ValveCover'])
  })

  it('a collapsed node’s transform is absorbed — otherwise the model arrives in pieces', async () => {
    const loaded = await loader().parse('ast_9k2m4p7q', await buildPumpGlb({ transportTranslation: [0, 2, 0] }))
    const { nodes } = instantiate(loaded.scene, { assetId: 'ast_9k2m4p7q', newId: ids() })

    const body = nodes.find((n) => n.name === 'Body')!
    expect(body.transform.p).toEqual([0, 2, 0])
    // Its sibling, which was not behind the transport node, is unaffected.
    expect(nodes.find((n) => n.name === 'ValveCover')!.transform.p).toEqual([0, 0, 0])
  })

  it('§5.3 · objectPath keeps the FULL original path even when collapsing', async () => {
    const loaded = await loader().parse('ast_9k2m4p7q', await buildPumpGlb({ transportTranslation: [0, 2, 0] }))
    const { nodes } = instantiate(loaded.scene, { assetId: 'ast_9k2m4p7q', newId: ids() })

    const body = nodes.find((n) => n.name === 'Body')!
    // The collapsed group is still in the path — tier 1 of the remap ladder depends on
    // matching what the exporter actually wrote.
    expect(body.assetRef!.objectPath.split('/')).toHaveLength(4)
    expect(body.assetRef!.objectPath.startsWith('Root/Pump/')).toBe(true)
    expect(body.assetRef!.objectPath.endsWith('/Body')).toBe(true)
  })

  it('can be told not to collapse, for debugging an import', async () => {
    const loaded = await loader().parse('ast_9k2m4p7q', await buildPumpGlb({ transportTranslation: [0, 2, 0] }))
    const { nodes, collapsed } = instantiate(loaded.scene, { assetId: 'ast_9k2m4p7q', newId: ids(), collapse: false })
    expect(collapsed).toBe(0)
    expect(nodes.length).toBe(5)
  })

  it('applies the normalisation matrix to the roots', async () => {
    const loaded = await loader().parse('ast_9k2m4p7q', await buildPumpGlb())
    const { matrix } = computeNormalization({ sourceUnit: 'mm', targetUnit: 'm', targetUpAxis: 'Y' })
    const { nodes } = instantiate(loaded.scene, { assetId: 'ast_9k2m4p7q', newId: ids(), rootMatrix: matrix })
    expect(nodes[0]!.transform.s[0]).toBeCloseTo(0.001, 9)
  })

  it('never collides with ids already in the document', async () => {
    const loaded = await loader().parse('ast_9k2m4p7q', await buildPumpGlb())
    const existing = new Set(['nd_00000001', 'nd_00000002'])
    const { nodes } = instantiate(loaded.scene, { assetId: 'ast_9k2m4p7q', newId: ids(), existingIds: existing })
    for (const node of nodes) expect(existing.has(node.id)).toBe(false)
    expect(new Set(nodes.map((n) => n.id)).size).toBe(nodes.length)
  })

  it('isMeaningful keeps meshes and named nodes, drops transport groups', () => {
    const { Group, Mesh, BufferGeometry, MeshStandardMaterial } = require('three') as typeof import('three')
    expect(isMeaningful(new Mesh(new BufferGeometry(), new MeshStandardMaterial()))).toBe(true)

    const unnamedSingleChild = new Group()
    unnamedSingleChild.add(new Group())
    expect(isMeaningful(unnamedSingleChild)).toBe(false)

    const namedPivot = new Group()
    namedPivot.name = 'Pivot'
    expect(isMeaningful(namedPivot)).toBe(true)

    const namedBranch = new Group()
    namedBranch.name = 'Assembly'
    namedBranch.add(new Group(), new Group())
    expect(isMeaningful(namedBranch)).toBe(true)
  })
})

describe('the pipeline feeds the renderer', () => {
  it('audit -> instantiate -> scene graph produces a renderable tree', async () => {
    const bytes = await buildPumpGlb({ transportTranslation: [0, 2, 0], trianglesPerMesh: 4 })
    const audit = await auditGlb(bytes, { now: at })
    const loaded = await loader().parse('ast_9k2m4p7q', bytes)
    const { nodes } = instantiate(loaded.scene, { assetId: 'ast_9k2m4p7q', newId: createSequentialIdFactory() })

    const graph = new SceneGraph({ assets: { get: (id) => (id === 'ast_9k2m4p7q' ? loaded : undefined) } })
    graph.build({
      sceneId: 'scn_a1b2c3d4',
      dataSources: [],
      prefabs: [],
      schemaVersion: CURRENT_VERSION,
      projectId: 'prj_a1b2c3d4',
      name: '导入结果',
      meta: {
        fog: DEFAULT_FOG,
        effects: DEFAULT_EFFECTS,
        unit: 'm',
        upAxis: 'Y',
        createdAt: at(),
        updatedAt: at(),
        background: { type: 'color', color: '#1a1a1a' },
        environment: { hdriAssetId: null, intensity: 1, exposure: 1 },
      },
      assets: [],
      nodes,
      materials: [],
      animations: [],
      hotspots: [],
      viewpoints: [],
      variables: [],
      rules: [],
      pages: [],
      flows: [],
      media: [],
    })

    expect(audit.verdict).toBe('pass')
    expect(graph.size).toBe(nodes.length)
    // Every node resolved to real asset geometry — none fell back to a placeholder.
    for (const node of nodes) expect(graph.isPlaceholder(node.id)).toBe(false)
    expect(graph.objectFor(nodes.find((n) => n.name === 'Body')!.id)!.position.y).toBe(2)
  })
})

/* ========================================================================== */
/* T-234 · clip 时长真的被量出来了                                             */
/* ========================================================================== */

describe('T-234 · clipDurations', () => {
  it('从 sampler 的输入访问器量出时长，误差 < 0.01 秒', async () => {
    // **这条断言推翻了一句我自己写的注释。** T-225 在 audit.ts 与 glb-header.ts 两处都
    // 留了「时长要解 BIN chunk，头部拿不到」——不对：glTF 规范要求 animation 的 input
    // 访问器必须带 min/max，正是为了让播放器不读完整条轨道就能算出时长。
    const result = await auditGlb(await buildPumpGlb({ animationName: '拆装', animationSeconds: 2.4 }), { now: at })
    expect(result.stats.animations).toEqual(['拆装'])
    expect(result.stats.clipDurations['拆装']).toBeCloseTo(2.4, 2)
  })

  it('没有动画的模型，clipDurations 是空表而不是 { "": 0 }', async () => {
    const r = await auditGlb(await buildPumpGlb(), { now: at })
    expect(r.stats.clipDurations).toEqual({})
  })

  it('头部快路径（measureFromHeader）量出同一个数', async () => {
    // 两条测量路必须给出同一个答案。它们的实现完全不同——一条走 gltf-transform 的
    // 解好的 document，一条只读 JSON chunk——而消费者分不出自己拿到的是哪一条。
    const bytes = await buildPumpGlb({ animationName: '拆装', animationSeconds: 2.4 })
    const header = readGlbHeader(bytes)!
    const fromHeader = measureFromHeader(header, bytes, bytes.byteLength)
    const fromDocument = (await auditGlb(bytes, { now: at })).stats

    expect(fromHeader.clipDurations['拆装']).toBeCloseTo(fromDocument.clipDurations['拆装']!, 4)
  })
})

describe('T-234 · 四个测量键不进文档', () => {
  it('AssetStatsSchema.strict() 接受 grade 出来的 stats —— 五档 scope 都是', async () => {
    // `AssetStatsSchema` 是 `.strict()` 而 `checkIntegrity` 不重跑 schema 校验。
    // 这个组合炸过一次（T-176）：多一个测量键 → 编辑器全绿 → **发布闸门拒绝**。
    // 所以凡是往 stats 里塞新数字的卡，验收必须是「发布一次」（validate 级）。
    const bytes = await buildPumpGlb({ animationName: '拆装', animationSeconds: 1 })
    for (const scope of ['model', 'image', 'hdri', 'audio', 'video'] as const) {
      const { stats } = await auditGlb(bytes, { now: at, scope })
      expect(() => AssetStatsSchema.strict().parse(stats), scope).not.toThrow()
    }
  })

  it('measurements 上有四个新键，stats 上一个都没有', async () => {
    const { stats, measurements } = await auditGlb(await buildPumpGlb(), { now: at })
    for (const key of ['externalRefs', 'unsupportedExtensions', 'textureBytesFallback', 'compressedTextureCount']) {
      expect(measurements, `measurements 少了 ${key}`).toHaveProperty(key)
      expect(stats, `${key} 漏进了文档 —— 发布闸门会拒绝`).not.toHaveProperty(key)
    }
    expect(stats).not.toHaveProperty('maxTextureSize')
  })
})

describe('T-234 · 压缩收益那条指标的适用性', () => {
  it('没有 KTX2 时，findings 里整条不出现', async () => {
    // 不是「出现且 pass」：一份没压过的模型显示「压缩收益 1:1，通过」，读起来像
    // 「压过了但没省」，那是另一个意思。
    const { audit } = await auditGlb(await buildPumpGlb({ withTexture: { width: 32, height: 16 } }), { now: at })
    expect(audit.findings.map((f) => f.metric)).not.toContain('textureBytesFallback')
  })

  it('未压缩贴图的两个数相等 —— 比值 1:1 正是「没压过」的定义', async () => {
    const { measurements } = await auditGlb(await buildPumpGlb({ withTexture: { width: 32, height: 16 } }), { now: at })
    expect(measurements.textureBytes).toBe(measurements.textureBytesFallback)
    expect(measurements.compressedTextureCount).toBe(0)
  })

  it('estimateTextureBytes 的 rgba8 分支与旧公式逐字节相同', () => {
    // 所有历史阈值都是按旧公式 `w*h*4*(4/3)` 定的。这条对拍是加 format 参数的前提。
    for (const [w, h] of [[1, 1], [64, 64], [2048, 1024], [4096, 4096]]) {
      expect(estimateTextureBytes(w!, h!), `${w}x${h}`).toBe(Math.round(w! * h! * 4 * (4 / 3)))
    }
    // 压缩格式确实更小：etc1s 是 rgba8 的 1/8，uastc 是 1/4。
    // **比值断言不能用整数相等**：两边各自 round 过一次，先除后乘会差几个字节
    // （实测 5592408 vs 5592405）。这里断比值，不断字节。
    const rgba8 = estimateTextureBytes(1024, 1024)
    expect(rgba8 / estimateTextureBytes(1024, 1024, 'etc1s')).toBeCloseTo(8, 3)
    expect(rgba8 / estimateTextureBytes(1024, 1024, 'uastc')).toBeCloseTo(4, 3)
  })
})
