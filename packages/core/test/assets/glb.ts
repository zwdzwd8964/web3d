import { Document, WebIO } from '@gltf-transform/core'

/**
 * Builds real GLB bytes in memory.
 *
 * This is what makes the whole import pipeline testable in plain Node: gltf-transform
 * writes a genuine binary glTF, and three's GLTFLoader parses it without a GL context.
 * No checked-in binary fixture, no browser, and the bytes under test are the same shape
 * a customer's exporter produces.
 */

export interface BuildGlbOptions {
  /** Wrap the meshes in an unnamed pass-through Group carrying this translation. */
  readonly transportTranslation?: [number, number, number]
  readonly withTexture?: { width: number; height: number }
  readonly extraMaterials?: number
  /** Adds a clip of this name that translates Body upward over `animationSeconds`. */
  readonly animationName?: string
  readonly animationSeconds?: number
  /** Triangles per mesh. Default 1. */
  readonly trianglesPerMesh?: number
}

/**
 * Root
 *  └ Pump                       named, 2 children -> meaningful
 *      ├ (unnamed transport)    collapsed when transportTranslation is set
 *      │   └ Body               mesh
 *      └ ValveCover             mesh, shares Body's material
 */
export async function buildPumpGlb(options: BuildGlbOptions = {}): Promise<ArrayBuffer> {
  const doc = new Document()
  const buffer = doc.createBuffer()

  const tris = options.trianglesPerMesh ?? 1
  const vertices = new Float32Array(tris * 9)
  for (let i = 0; i < tris; i++) {
    vertices.set([0, 0, 0, 1, 0, 0, 0, 1, 0], i * 9)
  }
  const position = doc.createAccessor().setType('VEC3').setArray(vertices).setBuffer(buffer)

  const steel = doc.createMaterial('steel')
  for (let i = 0; i < (options.extraMaterials ?? 0); i++) doc.createMaterial(`extra_${i}`)

  if (options.withTexture) {
    const { width, height } = options.withTexture
    const texture = doc.createTexture('albedo').setImage(pngBytes(width, height)).setMimeType('image/png')
    steel.setBaseColorTexture(texture)
  }

  const primitive = doc.createPrimitive().setAttribute('POSITION', position).setMaterial(steel)
  const body = doc.createNode('Body').setMesh(doc.createMesh('BodyMesh').addPrimitive(primitive))
  const cover = doc.createNode('ValveCover').setMesh(doc.createMesh('CoverMesh').addPrimitive(primitive))

  const pump = doc.createNode('Pump')
  if (options.transportTranslation) {
    // An unnamed single-child group — exactly what exporters emit by the hundred.
    const transport = doc.createNode('').setTranslation(options.transportTranslation).addChild(body)
    pump.addChild(transport)
  } else {
    pump.addChild(body)
  }
  pump.addChild(cover)

  const root = doc.createNode('Root').addChild(pump)
  doc.createScene('Scene').addChild(root)

  if (options.animationName) {
    // A real sampler + channel, not an empty Animation: the binding logic under test
    // resolves track names, and a clip with no tracks would exercise none of it.
    const seconds = options.animationSeconds ?? 1
    const time = doc.createAccessor().setType('SCALAR').setArray(new Float32Array([0, seconds])).setBuffer(buffer)
    const values = doc
      .createAccessor()
      .setType('VEC3')
      .setArray(new Float32Array([0, 0, 0, 0, 1, 0]))
      .setBuffer(buffer)
    const sampler = doc.createAnimationSampler().setInput(time).setOutput(values).setInterpolation('LINEAR')
    const channel = doc.createAnimationChannel().setTargetNode(body).setTargetPath('translation').setSampler(sampler)
    doc.createAnimation(options.animationName).addSampler(sampler).addChannel(channel)
  }

  const bytes = await new WebIO().writeBinary(doc)
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

/**
 * A minimal valid PNG of the requested size.
 *
 * gltf-transform reads the IHDR chunk for dimensions, so the pixel data can be a single
 * empty IDAT — the audit only needs width and height to estimate VRAM.
 */
function pngBytes(width: number, height: number): Uint8Array {
  const chunks: number[] = []
  const push = (...bytes: number[]) => chunks.push(...bytes)

  push(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a) // signature

  const ihdr = [
    ...int32(width),
    ...int32(height),
    8, // bit depth
    6, // colour type RGBA
    0,
    0,
    0,
  ]
  push(...int32(ihdr.length), ...ascii('IHDR'), ...ihdr, ...int32(crc32([...ascii('IHDR'), ...ihdr])))

  const idat = [0x78, 0x9c, 0x03, 0x00, 0x00, 0x00, 0x00, 0x01] // empty zlib stream
  push(...int32(idat.length), ...ascii('IDAT'), ...idat, ...int32(crc32([...ascii('IDAT'), ...idat])))
  push(...int32(0), ...ascii('IEND'), ...int32(crc32(ascii('IEND'))))

  return new Uint8Array(chunks)
}

const int32 = (n: number) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0))

const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return table
})()

function crc32(bytes: number[]): number {
  let c = 0xffffffff
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
