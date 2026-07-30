import { Document, WebIO } from '@gltf-transform/core'

/**
 * A real GLB for the golden path sample, built in memory.
 *
 * Without this the editor opens on the sample document, fails to resolve its asset, and
 * shows an empty grid — the app looks broken on first run, which is the worst possible
 * first impression of a 3D tool.
 *
 * Generated rather than committed as a binary: no blob in git, no network, and the
 * object paths are guaranteed to match `createGoldenPathDocument()`'s `assetRef`s
 * because both are written here. A checked-in .glb would drift from the document the
 * first time either changed.
 *
 * The two meshes deliberately SHARE one material — that is the normal glTF situation and
 * the one R08 is about, so the sample exercises clone-on-write from the first click.
 */

/** Object paths this asset provides. Must match the golden path document's assetRefs. */
export const SAMPLE_OBJECT_PATHS = ['Root', 'Root/Pump', 'Root/Pump/Body', 'Root/Pump/ValveCover'] as const

export async function buildSamplePumpGlb(): Promise<ArrayBuffer> {
  const doc = new Document()
  const buffer = doc.createBuffer()

  const steel = doc
    .createMaterial('steel')
    .setBaseColorFactor([0.72, 0.75, 0.78, 1])
    .setMetallicFactor(0.85)
    .setRoughnessFactor(0.35)

  const body = boxPrimitive(doc, buffer, steel, { width: 0.9, height: 0.8, depth: 0.9, y: 0.4 })
  const cover = boxPrimitive(doc, buffer, steel, { width: 0.62, height: 0.16, depth: 0.62, y: 0.88 })

  const bodyNode = doc.createNode('Body').setMesh(doc.createMesh('BodyMesh').addPrimitive(body))
  const coverNode = doc.createNode('ValveCover').setMesh(doc.createMesh('CoverMesh').addPrimitive(cover))

  const pump = doc.createNode('Pump').addChild(bodyNode).addChild(coverNode)
  const root = doc.createNode('Root').addChild(pump)
  doc.createScene('Scene').addChild(root)

  const bytes = await new WebIO().writeBinary(doc)
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

interface BoxSpec {
  width: number
  height: number
  depth: number
  y: number
}

/**
 * An axis-aligned box as an indexed triangle list with flat normals.
 *
 * Written out rather than pulled from three's BoxGeometry because this module produces
 * glTF, not a three scene — and going three -> GLB would need an exporter that does not
 * run outside a browser.
 */
function boxPrimitive(
  doc: Document,
  buffer: ReturnType<Document['createBuffer']>,
  material: ReturnType<Document['createMaterial']>,
  spec: BoxSpec,
) {
  const hx = spec.width / 2
  const hy = spec.height / 2
  const hz = spec.depth / 2
  const cy = spec.y

  // Six faces, four vertices each: sharing corners would average the normals and round
  // off the edges, which reads as a melted box rather than a machined part.
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
      positions.push(x, y + cy, z)
      normals.push(...face.normal)
    }
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3)
  }

  const position = doc.createAccessor().setType('VEC3').setArray(new Float32Array(positions)).setBuffer(buffer)
  const normal = doc.createAccessor().setType('VEC3').setArray(new Float32Array(normals)).setBuffer(buffer)
  const index = doc.createAccessor().setType('SCALAR').setArray(new Uint16Array(indices)).setBuffer(buffer)

  return doc
    .createPrimitive()
    .setAttribute('POSITION', position)
    .setAttribute('NORMAL', normal)
    .setIndices(index)
    .setMaterial(material)
}
