import { createSequentialIdFactory } from '@w3/schema'
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
      stats: { tris: 0, materials: 0, textures: 0, bytes: 0, textureBytes: 0, nodes: 0, animations: [] },
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
        stats: { tris: 0, materials: 0, textures: 0, bytes: 0, textureBytes: 0, nodes: 0, animations: [] },
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
        maxTextureSize: 4096,
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
        maxTextureSize: 0,
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
    expect(Object.keys(result.stats).sort()).toEqual(
      ['animations', 'bytes', 'materials', 'nodes', 'textureBytes', 'textures', 'tris'].sort(),
    )
  })

  it('describePolicy renders the numbers Appendix A is written from', () => {
    const text = describePolicy()
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
      schemaVersion: 1,
      projectId: 'prj_a1b2c3d4',
      name: '导入结果',
      meta: {
        unit: 'm',
        upAxis: 'Y',
        createdAt: at(),
        updatedAt: at(),
        background: { type: 'color', color: '#1a1a1a' },
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
