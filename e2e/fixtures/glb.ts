import { Document, NodeIO } from '@gltf-transform/core'

/**
 * A small, distinctly coloured GLB, built in memory.
 *
 * Generated rather than committed for the same reason `buildSamplePumpGlb` is: a binary
 * fixture is invisible to review, and a test that asserts "the viewport changed colour"
 * needs to control the colour.
 */
export async function buildTestGlb(options: {
  colour: [number, number, number]
  size: number
  offsetX?: number
}): Promise<Uint8Array> {
  const { colour, size, offsetX = 0 } = options
  const doc = new Document()
  const buffer = doc.createBuffer()

  const h = size / 2
  const x = offsetX
  // A single quad, two triangles. Enough to occupy pixels; small enough to import fast.
  const positions = doc
    .createAccessor()
    .setType('VEC3')
    .setArray(
      new Float32Array([
        x - h, -h, 0, x + h, -h, 0, x + h, h, 0,
        x - h, -h, 0, x + h, h, 0, x - h, h, 0,
      ]),
    )
    .setBuffer(buffer)

  const normals = doc
    .createAccessor()
    .setType('VEC3')
    .setArray(new Float32Array(Array.from({ length: 6 }, () => [0, 0, 1]).flat()))
    .setBuffer(buffer)

  const material = doc
    .createMaterial('TestMaterial')
    .setBaseColorFactor([...colour, 1])
    .setMetallicFactor(0)
    .setRoughnessFactor(0.8)
    // Unlit-ish: with SwiftShader and one directional light, a rough metal quad can read
    // as almost black, which would make the pixel assertions depend on lighting luck.
    .setEmissiveFactor(colour)

  const primitive = doc.createPrimitive().setAttribute('POSITION', positions).setAttribute('NORMAL', normals).setMaterial(material)
  const mesh = doc.createMesh('Panel').addPrimitive(primitive)
  const node = doc.createNode('Panel').setMesh(mesh)
  const root = doc.createNode('Root').addChild(node)
  doc.createScene('Scene').addChild(root)

  return new NodeIO().writeBinary(doc)
}
