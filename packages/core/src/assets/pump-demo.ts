import { Document, WebIO } from '@gltf-transform/core'
import type { Accessor, Buffer as GltfBuffer, Material, Node as GltfNode, Primitive } from '@gltf-transform/core'

/**
 * T-222 · the pump assembly the whole v1.0 demo stands on.
 *
 * Both golden paths already have a file called `pump.glb`. Neither is a pump: the sample is
 * two boxes and the E2E fixture is a single triangle with two meshes pointing at it. So
 * "1308 tests green" has never once meant that this engine handled anything shaped like an
 * assembly — no deep hierarchy, no shared material across ten-plus meshes, no cylinders, and
 * **no imported animation at all**. 「泵组样板工程」 has been a string.
 *
 * Sixteen parts, four materials, one real imported clip. Generated rather than committed:
 * no binary in git, no network, and `PUMP_DEMO_OBJECTS` cannot drift from what the file
 * actually contains because both come out of this function.
 *
 * ⚠ The clip is the part that is easy to get wrong and easy to not notice. The existing
 * sample document hand-writes `stats.animations: ['Disassemble']` on its asset record while
 * the GLB contains no animation channel whatsoever — the measured stats overwrite it with
 * `[]` at start-up, so the demo has never had an importable animation to show. That is the
 * exact shape T-285's registry↔demo audit would fail on.
 */

/** Radial segments for every cylinder here. Matches the primitive factory's own choice (ADR-0017). */
const CYLINDER_SEGMENTS = 24

/** The clip's name and length. `2` seconds is what the sample asset record has always claimed. */
export const PUMP_DEMO_CLIP = { name: '拆装', seconds: 2 } as const

/**
 * Every object path the asset provides, in hierarchy order.
 *
 * This is the contract the document's `assetRef.objectPath`s are written against, and it is
 * asserted three ways round: against the paths the loader actually produces, against the
 * generator's own node list, and against the demo document. Three-way, because a two-way
 * check between two things written in the same file agrees with itself by construction.
 */
export const PUMP_DEMO_OBJECTS = [
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

/** One part: where it sits in the tree, what shape it is, and which material it wears. */
interface Part {
  readonly path: string
  readonly shape: { kind: 'box'; w: number; h: number; d: number } | { kind: 'cylinder'; r: number; h: number }
  readonly at: [number, number, number]
  readonly material: 'steel' | 'brass' | 'rubber' | 'paint'
}

/**
 * The assembly.
 *
 * `steel` deliberately backs **ten** of the thirteen meshes. That is the ordinary glTF
 * situation and the one 铁律 9 is about: the first time a user recolours one part, ten
 * meshes are at risk of changing with it unless clone-on-write really works. The current
 * sample has two meshes sharing one material, which is enough to write the test and not
 * enough to make it interesting.
 */
const PARTS: readonly Part[] = [
  { path: 'Root/Pump/Base', shape: { kind: 'box', w: 1.6, h: 0.12, d: 1.0 }, at: [0, 0.06, 0], material: 'paint' },
  { path: 'Root/Pump/Casing/Volute', shape: { kind: 'cylinder', r: 0.46, h: 0.42 }, at: [0, 0.45, 0], material: 'steel' },
  { path: 'Root/Pump/Casing/SuctionFlange', shape: { kind: 'cylinder', r: 0.2, h: 0.1 }, at: [0, 0.45, 0.5], material: 'steel' },
  { path: 'Root/Pump/Casing/DischargeFlange', shape: { kind: 'cylinder', r: 0.17, h: 0.1 }, at: [0, 0.86, 0], material: 'steel' },
  { path: 'Root/Pump/Casing/Impeller', shape: { kind: 'cylinder', r: 0.34, h: 0.12 }, at: [0, 0.45, 0], material: 'brass' },
  { path: 'Root/Pump/Casing/WearRing', shape: { kind: 'cylinder', r: 0.37, h: 0.03 }, at: [0, 0.3, 0], material: 'rubber' },
  { path: 'Root/Pump/ValveCover', shape: { kind: 'cylinder', r: 0.24, h: 0.08 }, at: [0, 0.95, 0], material: 'steel' },
  { path: 'Root/Pump/ValveCover/CoverBolt1', shape: { kind: 'cylinder', r: 0.03, h: 0.09 }, at: [0.17, 1.0, 0.17], material: 'steel' },
  { path: 'Root/Pump/ValveCover/CoverBolt2', shape: { kind: 'cylinder', r: 0.03, h: 0.09 }, at: [-0.17, 1.0, 0.17], material: 'steel' },
  { path: 'Root/Pump/ValveCover/CoverBolt3', shape: { kind: 'cylinder', r: 0.03, h: 0.09 }, at: [-0.17, 1.0, -0.17], material: 'steel' },
  { path: 'Root/Pump/ValveCover/CoverBolt4', shape: { kind: 'cylinder', r: 0.03, h: 0.09 }, at: [0.17, 1.0, -0.17], material: 'steel' },
  { path: 'Root/Pump/Shaft', shape: { kind: 'cylinder', r: 0.06, h: 0.8 }, at: [0, 0.45, -0.5], material: 'steel' },
  { path: 'Root/Pump/Motor', shape: { kind: 'cylinder', r: 0.28, h: 0.6 }, at: [0, 0.45, -1.05], material: 'steel' },
]

/**
 * Builds the demo GLB.
 *
 * **Byte-identical across calls** — no timestamps, no random ids, no `Date`. That is what
 * lets a content hash be a stable asset key, and it is asserted rather than assumed.
 */
export async function buildPumpDemoGlb(): Promise<ArrayBuffer> {
  const doc = new Document()
  const buffer = doc.createBuffer()

  const materials: Record<Part['material'], Material> = {
    steel: doc.createMaterial('拉丝不锈钢').setBaseColorFactor([0.72, 0.75, 0.78, 1]).setMetallicFactor(0.85).setRoughnessFactor(0.35),
    brass: doc.createMaterial('黄铜').setBaseColorFactor([0.78, 0.62, 0.28, 1]).setMetallicFactor(0.9).setRoughnessFactor(0.28),
    rubber: doc.createMaterial('丁腈橡胶').setBaseColorFactor([0.12, 0.12, 0.13, 1]).setMetallicFactor(0).setRoughnessFactor(0.85),
    paint: doc.createMaterial('机身漆').setBaseColorFactor([0.18, 0.34, 0.5, 1]).setMetallicFactor(0.1).setRoughnessFactor(0.6),
  }

  // Structural nodes carry no mesh — they are what makes this a hierarchy rather than a bag.
  const nodes = new Map<string, GltfNode>()
  const ensure = (path: string): GltfNode => {
    const existing = nodes.get(path)
    if (existing) return existing
    const name = path.slice(path.lastIndexOf('/') + 1)
    const node = doc.createNode(name)
    nodes.set(path, node)
    const parent = path.slice(0, path.lastIndexOf('/'))
    if (parent) ensure(parent).addChild(node)
    return node
  }
  for (const path of PUMP_DEMO_OBJECTS) ensure(path)

  for (const part of PARTS) {
    const primitive =
      part.shape.kind === 'box'
        ? boxPrimitive(doc, buffer, materials[part.material], part.shape, part.at)
        : cylinderPrimitive(doc, buffer, materials[part.material], part.shape, part.at)
    const leaf = part.path.slice(part.path.lastIndexOf('/') + 1)
    nodes.get(part.path)!.setMesh(doc.createMesh(`${leaf}Mesh`).addPrimitive(primitive))
  }

  doc.createScene('Scene').addChild(nodes.get('Root')!)
  buildDisassembleClip(doc, buffer, nodes.get('Root/Pump/ValveCover')!)

  const bytes = await new WebIO().writeBinary(doc)
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

/**
 * One clip: the valve cover lifts 0.5 m over two seconds.
 *
 * `AnimationClip.duration` is derived by three from the sampler's input accessor — the
 * loader passes `undefined` for duration and `AnimationClip`'s constructor computes it from
 * the keyframes. So the last input time IS the clip length, and writing `[0, 2]` is what
 * makes `clip.duration === 2`.
 */
function buildDisassembleClip(doc: Document, buffer: GltfBuffer, target: GltfNode): void {
  const input = doc.createAccessor('拆装-时间').setType('SCALAR').setArray(new Float32Array([0, PUMP_DEMO_CLIP.seconds])).setBuffer(buffer)
  const from = target.getTranslation()
  const output = doc
    .createAccessor('拆装-位移')
    .setType('VEC3')
    .setArray(new Float32Array([from[0], from[1], from[2], from[0], from[1] + 0.5, from[2]]))
    .setBuffer(buffer)

  const sampler = doc.createAnimationSampler().setInput(input).setOutput(output).setInterpolation('LINEAR')
  const channel = doc.createAnimationChannel().setTargetNode(target).setTargetPath('translation').setSampler(sampler)
  doc.createAnimation(PUMP_DEMO_CLIP.name).addSampler(sampler).addChannel(channel)
}

/* --- primitives ----------------------------------------------------------- */

function pushPrimitive(
  doc: Document,
  buffer: GltfBuffer,
  material: Material,
  positions: number[],
  normals: number[],
  indices: number[],
): Primitive {
  // Two overloads rather than one union parameter: `setArray` is typed per element kind
  // (`Float32Array<ArrayBuffer>` / `Uint16Array<ArrayBuffer>`), and a union widens the
  // backing buffer to `ArrayBufferLike`, which includes `SharedArrayBuffer`.
  const vec3 = (name: string, values: number[]): Accessor =>
    doc.createAccessor(name).setType('VEC3').setArray(new Float32Array(values)).setBuffer(buffer)
  const scalar = (name: string, values: number[]): Accessor =>
    doc.createAccessor(name).setType('SCALAR').setArray(new Uint16Array(values)).setBuffer(buffer)
  return doc
    .createPrimitive()
    .setAttribute('POSITION', vec3('pos', positions))
    .setAttribute('NORMAL', vec3('nrm', normals))
    .setIndices(scalar('idx', indices))
    .setMaterial(material)
}

/** An axis-aligned box with flat normals — shared corners would round the edges off. */
function boxPrimitive(
  doc: Document,
  buffer: GltfBuffer,
  material: Material,
  spec: { w: number; h: number; d: number },
  at: [number, number, number],
): Primitive {
  const [hx, hy, hz] = [spec.w / 2, spec.h / 2, spec.d / 2]
  const faces: { normal: [number, number, number]; corners: [number, number, number][] }[] = [
    { normal: [0, 0, 1], corners: [[-hx, -hy, hz], [hx, -hy, hz], [hx, hy, hz], [-hx, hy, hz]] },
    { normal: [0, 0, -1], corners: [[hx, -hy, -hz], [-hx, -hy, -hz], [-hx, hy, -hz], [hx, hy, -hz]] },
    { normal: [1, 0, 0], corners: [[hx, -hy, hz], [hx, -hy, -hz], [hx, hy, -hz], [hx, hy, hz]] },
    { normal: [-1, 0, 0], corners: [[-hx, -hy, -hz], [-hx, -hy, hz], [-hx, hy, hz], [-hx, hy, -hz]] },
    { normal: [0, 1, 0], corners: [[-hx, hy, hz], [hx, hy, hz], [hx, hy, -hz], [-hx, hy, -hz]] },
    { normal: [0, -1, 0], corners: [[-hx, -hy, -hz], [hx, -hy, -hz], [hx, -hy, hz], [-hx, -hy, hz]] },
  ]
  const positions: number[] = []
  const normals: number[] = []
  const indices: number[] = []
  for (const face of faces) {
    const base = positions.length / 3
    for (const [x, y, z] of face.corners) {
      positions.push(x + at[0], y + at[1], z + at[2])
      normals.push(...face.normal)
    }
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3)
  }
  return pushPrimitive(doc, buffer, material, positions, normals, indices)
}

/** A capped cylinder along Y, `CYLINDER_SEGMENTS` around. */
function cylinderPrimitive(
  doc: Document,
  buffer: GltfBuffer,
  material: Material,
  spec: { r: number; h: number },
  at: [number, number, number],
): Primitive {
  const positions: number[] = []
  const normals: number[] = []
  const indices: number[] = []
  const [hy, r] = [spec.h / 2, spec.r]

  // Side: two rings, flat-shaded per segment so the silhouette stays crisp at 24 segments.
  for (let i = 0; i < CYLINDER_SEGMENTS; i++) {
    const a0 = (i / CYLINDER_SEGMENTS) * Math.PI * 2
    const a1 = ((i + 1) / CYLINDER_SEGMENTS) * Math.PI * 2
    const [x0, z0] = [Math.cos(a0) * r, Math.sin(a0) * r]
    const [x1, z1] = [Math.cos(a1) * r, Math.sin(a1) * r]
    const nx = Math.cos((a0 + a1) / 2)
    const nz = Math.sin((a0 + a1) / 2)
    const base = positions.length / 3
    for (const [x, y, z] of [
      [x0, -hy, z0],
      [x1, -hy, z1],
      [x1, hy, z1],
      [x0, hy, z0],
    ] as [number, number, number][]) {
      positions.push(x + at[0], y + at[1], z + at[2])
      normals.push(nx, 0, nz)
    }
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3)
  }

  // Caps: a fan per end.
  for (const [sign, ny] of [
    [1, 1],
    [-1, -1],
  ] as [number, number][]) {
    const centre = positions.length / 3
    positions.push(at[0], at[1] + hy * sign, at[2])
    normals.push(0, ny, 0)
    for (let i = 0; i <= CYLINDER_SEGMENTS; i++) {
      const a = (i / CYLINDER_SEGMENTS) * Math.PI * 2
      positions.push(at[0] + Math.cos(a) * r, at[1] + hy * sign, at[2] + Math.sin(a) * r)
      normals.push(0, ny, 0)
    }
    for (let i = 0; i < CYLINDER_SEGMENTS; i++) {
      // Winding flips with the cap so both faces point outward.
      if (sign > 0) indices.push(centre, centre + 1 + i, centre + 2 + i)
      else indices.push(centre, centre + 2 + i, centre + 1 + i)
    }
  }

  return pushPrimitive(doc, buffer, material, positions, normals, indices)
}
