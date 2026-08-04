#!/usr/bin/env node
/**
 * T-145 · MVP v0.5 D17 · the built-in library's starter content, generated.
 *
 * The card's split is deliberate: this repository ships the MECHANISM (a manifest schema,
 * a validator, and an import path that reuses the normal one) plus enough content to
 * demonstrate it. Real art is a human supply item (H2), not an agent task — an agent
 * "finding some free models" is uncontrollable licensing (risk V1) and a download is a
 * network dependency where constitution C6 forbids one.
 *
 * So everything here is COMPUTED. No binary is committed that nobody can review, no byte
 * comes from the network, and `license: CC0-1.0` is true by construction because this
 * script is the author.
 *
 * Encoders are written out by hand — PNG on `node:zlib`, Radiance `.hdr` and glTF binary
 * on plain byte writing. Root-level scripts cannot import the workspace's
 * `@gltf-transform/core` (it belongs to two packages, not to the root), and adding a root
 * dependency to generate a 4 KB cube would be the wrong trade.
 *
 * T-223 · `--check` regenerates into a temp directory and compares byte for byte.
 *
 * Everything above is what makes that possible, and nothing was guarding it. The generated
 * files are committed, this script is in no npm script, and no check read their CONTENT —
 * `check-library-manifest.mjs` validates the manifest's fields and the files' sizes, and a
 * single flipped byte changes neither. Editing a PNG by hand, or changing this generator and
 * forgetting to re-run it, was green either way.
 *
 * Run: node scripts/gen-library-starter.mjs           # write into the repo
 *      node scripts/gen-library-starter.mjs --check   # compare only, never writes there
 */
import { deflateSync } from 'node:zlib'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative as relativePath, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const LIBRARY = join(ROOT, 'packages/editor/public/library')

const CHECK_ONLY = process.argv.includes('--check')

/**
 * Where this run writes.
 *
 * **`--check` must never touch `LIBRARY`.** The one destructive line in this file was
 * `rmSync(join(LIBRARY, 'manifest.json'))`; a `--check` that still ran it would delete a
 * committed file while calling itself read-only. Routing every write through one constant is
 * what makes that impossible rather than merely unlikely.
 */
const OUT = CHECK_ONLY ? mkdtempSync(join(tmpdir(), 'w3-library-check-')) : LIBRARY

/**
 * Below this the walk is broken rather than the library empty.
 *
 * The card says 「形态照抄 `sync-vendor.mjs --check`」 — and that one has **no floor at all**:
 * its verdict is `srcFiles.length === dstFiles.length && every(...)`, which is `0 === 0` plus
 * a vacuous `every` when both walks come back empty. Copying the shape verbatim would ship
 * exactly the D36 M6 guard this version keeps deleting. 17 files today; the floor sits on the
 * FILE count, on **both** sides, because the diff count is legitimately 0.
 */
const MIN_LIBRARY_FILES = 15

/* ========================================================================== */
/* PNG                                                                        */
/* ========================================================================== */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32(bytes) {
  let c = 0xffffffff
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length)
  out.writeUInt32BE(data.length, 0)
  out.write(type, 4, 'ascii')
  data.copy(out, 8)
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length)
  return out
}

/**
 * Encodes RGBA8 pixels as a PNG.
 *
 * Filter type 0 on every scanline: these are procedural images a few hundred kilobytes
 * at most, and a filter heuristic would be a hundred lines protecting nobody.
 */
function encodePng(width, height, rgba) {
  const raw = Buffer.alloc(height * (1 + width * 4))
  for (let y = 0; y < height; y++) {
    const at = y * (1 + width * 4)
    raw[at] = 0
    Buffer.from(rgba.buffer, rgba.byteOffset + y * width * 4, width * 4).copy(raw, at + 1)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // colour type: RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/** Builds RGBA pixels from a per-pixel function returning `[r, g, b]` in 0..255. */
function paint(width, height, fn) {
  const rgba = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b, a = 255] = fn(x, y)
      const at = (y * width + x) * 4
      rgba[at] = r
      rgba[at + 1] = g
      rgba[at + 2] = b
      rgba[at + 3] = a
    }
  }
  return rgba
}

/** Nearest-neighbour downscale, for previews. */
function downscale(width, height, rgba, size) {
  return paint(size, size, (x, y) => {
    const sx = Math.min(width - 1, Math.floor((x / size) * width))
    const sy = Math.min(height - 1, Math.floor((y / size) * height))
    const at = (sy * width + sx) * 4
    return [rgba[at], rgba[at + 1], rgba[at + 2], rgba[at + 3]]
  })
}

/* ========================================================================== */
/* Deterministic value noise — no Math.random, so the output is reproducible   */
/* ========================================================================== */

/** Integer hash → [0, 1). Same input, same byte, on every machine and every run. */
function hash2(x, y) {
  let h = (x * 374761393 + y * 668265263) >>> 0
  h = (h ^ (h >>> 13)) >>> 0
  h = Math.imul(h, 1274126177) >>> 0
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

const smooth = (t) => t * t * (3 - 2 * t)

function valueNoise(x, y, scale) {
  const fx = x / scale
  const fy = y / scale
  const ix = Math.floor(fx)
  const iy = Math.floor(fy)
  const tx = smooth(fx - ix)
  const ty = smooth(fy - iy)
  const a = hash2(ix, iy)
  const b = hash2(ix + 1, iy)
  const c = hash2(ix, iy + 1)
  const d = hash2(ix + 1, iy + 1)
  return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty
}

/* ========================================================================== */
/* Radiance .hdr (RGBE)                                                       */
/* ========================================================================== */

/**
 * Encodes a float RGB image as an uncompressed Radiance file.
 *
 * Flat scanlines rather than RLE. three's parser takes the uncompressed path whenever the
 * first pixel of a scanline is not the `2 2 hi lo` RLE marker, and the assertion below
 * makes sure we never accidentally emit one — a gradient whose top-left pixel happened to
 * encode as (2, 2, …) would be read as a corrupt RLE run, and the failure would look like
 * "the HDRI is broken" rather than "the writer is".
 */
function encodeHdr(width, height, fn) {
  const header = Buffer.from(`#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y ${height} +X ${width}\n`, 'ascii')
  const body = Buffer.alloc(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b] = fn(x, y)
      const max = Math.max(r, g, b)
      const at = (y * width + x) * 4
      if (max < 1e-32) continue
      const e = Math.ceil(Math.log2(max))
      const scale = 256 / Math.pow(2, e)
      body[at] = Math.min(255, Math.floor(r * scale))
      body[at + 1] = Math.min(255, Math.floor(g * scale))
      body[at + 2] = Math.min(255, Math.floor(b * scale))
      body[at + 3] = e + 128
      if (x === 0 && body[at] === 2 && body[at + 1] === 2 && (body[at + 2] & 0x80) === 0) {
        throw new Error(`scanline ${y} starts with the RLE marker; adjust the gradient`)
      }
    }
  }
  return Buffer.concat([header, body])
}

/* ========================================================================== */
/* glTF binary (.glb)                                                         */
/* ========================================================================== */

/** A unit box centred on the origin, as positions + normals + indices. */
function boxMesh(sx, sy, sz) {
  const hx = sx / 2
  const hy = sy / 2
  const hz = sz / 2
  const faces = [
    { n: [0, 0, 1], v: [[-hx, -hy, hz], [hx, -hy, hz], [hx, hy, hz], [-hx, hy, hz]] },
    { n: [0, 0, -1], v: [[hx, -hy, -hz], [-hx, -hy, -hz], [-hx, hy, -hz], [hx, hy, -hz]] },
    { n: [1, 0, 0], v: [[hx, -hy, hz], [hx, -hy, -hz], [hx, hy, -hz], [hx, hy, hz]] },
    { n: [-1, 0, 0], v: [[-hx, -hy, -hz], [-hx, -hy, hz], [-hx, hy, hz], [-hx, hy, -hz]] },
    { n: [0, 1, 0], v: [[-hx, hy, hz], [hx, hy, hz], [hx, hy, -hz], [-hx, hy, -hz]] },
    { n: [0, -1, 0], v: [[-hx, -hy, -hz], [hx, -hy, -hz], [hx, -hy, hz], [-hx, -hy, hz]] },
  ]
  const positions = []
  const normals = []
  const indices = []
  for (const face of faces) {
    const base = positions.length / 3
    for (const v of face.v) {
      positions.push(...v)
      normals.push(...face.n)
    }
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3)
  }
  return { positions, normals, indices }
}

/** A capped cylinder along Y, centred on the origin. */
function cylinderMesh(radius, height, segments = 24) {
  const positions = []
  const normals = []
  const indices = []
  const hy = height / 2

  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * Math.PI * 2
    const c = Math.cos(a)
    const s = Math.sin(a)
    positions.push(radius * c, -hy, radius * s, radius * c, hy, radius * s)
    normals.push(c, 0, s, c, 0, s)
  }
  for (let i = 0; i < segments; i++) {
    const a = i * 2
    indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3)
  }

  for (const [y, ny, flip] of [
    [hy, 1, false],
    [-hy, -1, true],
  ]) {
    const centre = positions.length / 3
    positions.push(0, y, 0)
    normals.push(0, ny, 0)
    const first = positions.length / 3
    for (let i = 0; i <= segments; i++) {
      const a = (i / segments) * Math.PI * 2
      positions.push(radius * Math.cos(a), y, radius * Math.sin(a))
      normals.push(0, ny, 0)
    }
    for (let i = 0; i < segments; i++) {
      const p = first + i
      const q = first + i + 1
      indices.push(centre, ...(flip ? [q, p] : [p, q]))
    }
  }
  return { positions, normals, indices }
}

const pad4 = (n) => (n + 3) & ~3

/**
 * Writes a `.glb` from a list of named parts.
 *
 * One buffer, one bufferView per accessor. Not the most compact encoding possible, and
 * deliberately the most readable one: these files are read by our own importer, and a
 * reviewer has to be able to check the writer by eye.
 */
function encodeGlb(parts, materials) {
  const bin = []
  const bufferViews = []
  const accessors = []
  let offset = 0

  const pushView = (buffer, target) => {
    const padded = pad4(buffer.length)
    const view = Buffer.alloc(padded)
    buffer.copy(view)
    bin.push(view)
    bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: buffer.length, target })
    offset += padded
    return bufferViews.length - 1
  }

  const pushFloats = (values, type) => {
    const buffer = Buffer.alloc(values.length * 4)
    values.forEach((v, i) => buffer.writeFloatLE(v, i * 4))
    const stride = type === 'VEC3' ? 3 : 1
    const count = values.length / stride
    const min = Array.from({ length: stride }, (_, k) => Math.min(...values.filter((_, i) => i % stride === k)))
    const max = Array.from({ length: stride }, (_, k) => Math.max(...values.filter((_, i) => i % stride === k)))
    accessors.push({ bufferView: pushView(buffer, 34962), componentType: 5126, count, type, min, max })
    return accessors.length - 1
  }

  const pushIndices = (values) => {
    const buffer = Buffer.alloc(values.length * 2)
    values.forEach((v, i) => buffer.writeUInt16LE(v, i * 2))
    accessors.push({ bufferView: pushView(buffer, 34963), componentType: 5123, count: values.length, type: 'SCALAR' })
    return accessors.length - 1
  }

  const meshes = []
  const nodes = []
  for (const part of parts) {
    const primitive = {
      attributes: { POSITION: pushFloats(part.mesh.positions, 'VEC3'), NORMAL: pushFloats(part.mesh.normals, 'VEC3') },
      indices: pushIndices(part.mesh.indices),
      material: part.material,
    }
    meshes.push({ name: part.name, primitives: [primitive] })
    nodes.push({ name: part.name, mesh: meshes.length - 1, translation: part.translation ?? [0, 0, 0] })
  }

  const root = { name: parts.rootName ?? 'Root', children: nodes.map((_, i) => i) }
  nodes.push(root)

  const binary = Buffer.concat(bin)
  const json = {
    asset: { version: '2.0', generator: 'w3 gen-library-starter' },
    scene: 0,
    scenes: [{ nodes: [nodes.length - 1] }],
    nodes,
    meshes,
    materials,
    accessors,
    bufferViews,
    buffers: [{ byteLength: binary.length }],
  }

  const jsonBuffer = Buffer.from(JSON.stringify(json), 'utf8')
  const jsonPadded = Buffer.alloc(pad4(jsonBuffer.length), 0x20)
  jsonBuffer.copy(jsonPadded)

  const header = Buffer.alloc(12)
  header.write('glTF', 0, 'ascii')
  header.writeUInt32LE(2, 4)
  header.writeUInt32LE(12 + 8 + jsonPadded.length + 8 + binary.length, 8)

  const jsonHeader = Buffer.alloc(8)
  jsonHeader.writeUInt32LE(jsonPadded.length, 0)
  jsonHeader.write('JSON', 4, 'ascii')

  const binHeader = Buffer.alloc(8)
  binHeader.writeUInt32LE(binary.length, 0)
  binHeader.write('BIN\0', 4, 'ascii')

  return Buffer.concat([header, jsonHeader, jsonPadded, binHeader, binary])
}

/* ========================================================================== */
/* The starter content                                                        */
/* ========================================================================== */

const TEX = 512
const PREVIEW = 128

const items = []
const written = []

function write(relative, buffer) {
  const path = join(OUT, relative)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, buffer)
  written.push({ relative, bytes: buffer.length })
  return buffer.length
}

function addTexture({ id, name, file, paintFn, note }) {
  const rgba = paint(TEX, TEX, paintFn)
  write(`textures/${file}`, encodePng(TEX, TEX, rgba))
  write(`previews/${id}.png`, encodePng(PREVIEW, PREVIEW, downscale(TEX, TEX, rgba, PREVIEW)))
  items.push({
    id,
    name,
    category: 'texture',
    file: `textures/${file}`,
    preview: `previews/${id}.png`,
    license: 'CC0-1.0',
    author: '本仓库程序化生成',
    note,
  })
}

// 棋盘格 — the one texture everybody reaches for to check UV scale.
addTexture({
  id: 'tex-checker',
  name: '棋盘格',
  file: 'checker.png',
  note: '校验 UV 缩放与贴图朝向用',
  paintFn: (x, y) => {
    const cell = ((x >> 6) + (y >> 6)) % 2 === 0
    const v = cell ? 210 : 60
    return [v, v, v]
  },
})

// 噪声 — a roughness/mask source.
addTexture({
  id: 'tex-noise',
  name: '噪声',
  file: 'noise.png',
  note: '可用作粗糙度或遮罩',
  paintFn: (x, y) => {
    const n = valueNoise(x, y, 24) * 0.6 + valueNoise(x, y, 6) * 0.4
    const v = Math.round(40 + n * 190)
    return [v, v, v]
  },
})

// 拉丝金属 — anisotropic streaks along X, plus its matching normal map.
const brushed = (x, y) => {
  const streak = valueNoise(x * 0.15, y * 12, 8)
  const v = Math.round(140 + streak * 70)
  return [v, Math.round(v * 0.99), Math.round(v * 0.96)]
}
addTexture({
  id: 'tex-brushed-metal',
  name: '拉丝金属',
  file: 'brushed-metal.png',
  note: '与「拉丝金属法线」配套使用',
  paintFn: brushed,
})
addTexture({
  id: 'tex-brushed-metal-normal',
  name: '拉丝金属 法线',
  file: 'brushed-metal-normal.png',
  note: '切线空间法线贴图，配「拉丝金属」',
  paintFn: (x, y) => {
    // Central difference of the same streak field: the normal map has to describe THIS
    // surface, not a generic one, or the highlight runs across the grain.
    const h = (px, py) => valueNoise(px * 0.15, py * 12, 8)
    const dx = (h(x + 1, y) - h(x - 1, y)) * 4
    const dy = (h(x, y + 1) - h(x, y - 1)) * 4
    const len = Math.hypot(-dx, -dy, 1)
    return [
      Math.round(((-dx / len) * 0.5 + 0.5) * 255),
      Math.round(((-dy / len) * 0.5 + 0.5) * 255),
      Math.round((1 / len / 2 + 0.5) * 255),
    ]
  },
})

/* --- HDRI: two gradient skies ------------------------------------------- */

const HDRI_W = 256
const HDRI_H = 128

function addHdri({ id, name, file, sky, note }) {
  write(`hdri/${file}`, encodeHdr(HDRI_W, HDRI_H, sky))
  // The preview is the same gradient tone-mapped to sRGB — an honest thumbnail of what the
  // environment looks like, at a size the panel can show.
  const rgba = paint(HDRI_W, HDRI_H, (x, y) => {
    const [r, g, b] = sky(x, y)
    const t = (v) => Math.round(Math.min(1, Math.pow(v / (v + 1), 1 / 2.2)) * 255)
    return [t(r), t(g), t(b)]
  })
  write(`previews/${id}.png`, encodePng(PREVIEW, PREVIEW, downscale(HDRI_W, HDRI_H, rgba, PREVIEW)))
  items.push({
    id,
    name,
    category: 'hdri',
    file: `hdri/${file}`,
    preview: `previews/${id}.png`,
    license: 'CC0-1.0',
    author: '本仓库程序化生成',
    note,
  })
}

addHdri({
  id: 'hdri-daylight',
  name: '正午天光',
  file: 'gradient-daylight.hdr',
  note: '程序化渐变天空，用于检验 IBL 接线；不是实拍全景',
  sky: (x, y) => {
    const t = y / HDRI_H
    const sun = Math.pow(Math.max(0, 1 - Math.hypot((x - HDRI_W * 0.3) / 18, (y - HDRI_H * 0.22) / 18)), 3) * 12
    const up = 1 - t
    return [0.55 + up * 0.35 + sun, 0.68 + up * 0.42 + sun, 0.95 + up * 0.5 + sun]
  },
})

addHdri({
  id: 'hdri-dusk',
  name: '黄昏',
  file: 'gradient-dusk.hdr',
  note: '程序化渐变天空，暖色低照度；不是实拍全景',
  sky: (x, y) => {
    const t = y / HDRI_H
    const glow = Math.pow(Math.max(0, 1 - Math.abs(x - HDRI_W * 0.75) / 60), 2) * (1 - t) * 3
    return [0.5 + glow, 0.26 + glow * 0.55, 0.18 + glow * 0.3]
  },
})

/* --- models: assembled from primitives ----------------------------------- */

const GREY = { pbrMetallicRoughness: { baseColorFactor: [0.72, 0.74, 0.77, 1], metallicFactor: 0.1, roughnessFactor: 0.65 } }
const DARK = { pbrMetallicRoughness: { baseColorFactor: [0.28, 0.3, 0.33, 1], metallicFactor: 0.3, roughnessFactor: 0.5 } }

/** A flat schematic preview. Honest about what it is: these are not renders. */
function schematicPreview(id, shapes) {
  const rgba = paint(PREVIEW, PREVIEW, (x, y) => {
    for (const [x0, y0, x1, y1, colour] of shapes) {
      if (x >= x0 && x < x1 && y >= y0 && y < y1) return colour
    }
    return [28, 33, 38]
  })
  write(`previews/${id}.png`, encodePng(PREVIEW, PREVIEW, rgba))
}

function addModel({ id, name, file, parts, materials, preview, note }) {
  write(`models/${file}`, encodeGlb(parts, materials))
  schematicPreview(id, preview)
  items.push({
    id,
    name,
    category: 'model',
    file: `models/${file}`,
    preview: `previews/${id}.png`,
    license: 'CC0-1.0',
    author: '本仓库程序化生成',
    note,
  })
}

addModel({
  id: 'model-display-stand',
  name: '展示台',
  file: 'display-stand.glb',
  note: '底座 + 立柱 + 台面，三个部件，可分别选中',
  materials: [GREY, DARK],
  parts: Object.assign(
    [
      { name: '底座', mesh: boxMesh(1.2, 0.12, 1.2), translation: [0, 0.06, 0], material: 0 },
      { name: '立柱', mesh: cylinderMesh(0.11, 0.7), translation: [0, 0.47, 0], material: 1 },
      { name: '台面', mesh: boxMesh(0.62, 0.06, 0.62), translation: [0, 0.85, 0], material: 0 },
    ],
    { rootName: '展示台' },
  ),
  preview: [
    [24, 92, 104, 108, [150, 154, 160]],
    [58, 40, 70, 92, [80, 86, 94]],
    [40, 28, 88, 40, [150, 154, 160]],
  ],
})

addModel({
  id: 'model-signpost',
  name: '指示牌',
  file: 'signpost.glb',
  note: '立杆 + 牌面，牌面适合挂材质与热点',
  materials: [DARK, GREY],
  parts: Object.assign(
    [
      { name: '立杆', mesh: cylinderMesh(0.035, 1.6), translation: [0, 0.8, 0], material: 0 },
      { name: '牌面', mesh: boxMesh(0.62, 0.4, 0.04), translation: [0, 1.5, 0], material: 1 },
    ],
    { rootName: '指示牌' },
  ),
  preview: [
    [61, 40, 67, 112, [80, 86, 94]],
    [30, 20, 98, 52, [150, 154, 160]],
  ],
})

/* ========================================================================== */
/* manifest                                                                   */
/* ========================================================================== */

const manifest = {
  /** Bumped when the SHAPE of this file changes, so a loader can refuse a future one. */
  version: 1,
  generatedBy: 'scripts/gen-library-starter.mjs',
  items: items.sort((a, b) => a.id.localeCompare(b.id)),
}

rmSync(join(OUT, 'manifest.json'), { force: true })
write('manifest.json', Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8'))

const total = written.reduce((n, f) => n + f.bytes, 0)
const kb = (n) => `${(n / 1024).toFixed(1)} KB`

if (!CHECK_ONLY) {
  console.log(`wrote ${written.length} file(s) into packages/editor/public/library`)
  for (const file of written.sort((a, b) => b.bytes - a.bytes).slice(0, 6)) {
    console.log(`  ${kb(file.bytes).padStart(10)}  ${file.relative}`)
  }
  console.log(`  total ${kb(total)} across ${items.length} library item(s)`)
  process.exit(0)
}

/* ========================================================================== */
/* --check                                                                    */
/* ========================================================================== */

/** Every file under `dir`, as repo-style relative paths. Sorted, so output is stable. */
function walk(dir, base = dir, out = []) {
  for (const entry of readdirSync(dir).sort()) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, base, out)
    else out.push(relativePath(base, full).split('\\').join('/'))
  }
  return out
}

const sha1 = (file) => createHash('sha1').update(readFileSync(file)).digest('hex')

const generated = walk(OUT)
const committed = walk(LIBRARY)
const problems = []

/**
 * Both directions, deliberately.
 *
 * The generator only knows what it wrote. A one-way comparison cannot see a file somebody
 * dropped into `library/` by hand — the immediate neighbour of the 「直接手改 png」 case this
 * gate exists for. `sync-vendor.mjs` compares both sides; this follows it there.
 */
for (const file of generated) {
  if (!committed.includes(file)) {
    problems.push(`${file} —— 生成器会写它，仓库里却没有。生成物漏提交了`)
    continue
  }
  if (sha1(join(OUT, file)) !== sha1(join(LIBRARY, file))) {
    problems.push(`${file} —— 逐字节不一致。要么手改过它，要么改了生成器忘了重跑`)
  }
}
for (const file of committed) {
  if (!generated.includes(file)) {
    problems.push(`${file} —— 仓库里有它，生成器却不会写它。手工塞进来的文件不受这道闸门保护`)
  }
}

rmSync(OUT, { recursive: true, force: true })

console.log(`  生成 ${generated.length} 个 / 已提交 ${committed.length} 个 / 不一致 ${problems.length} 处`)

if (generated.length < MIN_LIBRARY_FILES || committed.length < MIN_LIBRARY_FILES) {
  console.error(
    `FAIL  C6 + D17 · 内置库逐字节一致  — 扫描面塌了：生成 ${generated.length} / 已提交 ${committed.length}，下限 ${MIN_LIBRARY_FILES}。` +
      `多半是路径写错了，不是内置库变空了 —— 两侧同时为空时「逐字节全部相等」恒成立`,
  )
  process.exit(1)
}

if (problems.length === 0) {
  console.log(`PASS  C6 + D17 · 内置库逐字节一致  (${committed.length} file(s))`)
  process.exit(0)
}
console.error(`FAIL  C6 + D17 · 内置库逐字节一致  — ${problems.length} 处`)
for (const p of problems) console.error(`      ${p}`)
console.error('      重新生成：node scripts/gen-library-starter.mjs')
process.exit(1)
