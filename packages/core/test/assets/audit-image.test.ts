import { deflateSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { auditImage, measureImage, readImageInfo } from '../../src/assets/audit.js'
import { DEFAULT_POLICY, describePolicy, metricsFor } from '../../src/assets/policy.js'

/**
 * T-150 · the import health check for standalone images and environment maps.
 *
 * Dimensions are read from the header rather than decoded, so all of this runs in plain
 * Node (C8) and — more to the point — runs BEFORE the bytes are decoded. R01 is about
 * reporting on an asset too big to load; decoding it to find that out defeats the purpose.
 */

const bufferOf = (u8: Uint8Array): ArrayBuffer => u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer

/* --- fixtures: real headers, byte for byte ------------------------------- */

/** A genuinely valid PNG: signature, IHDR, a deflated IDAT and IEND. */
function png(width: number, height: number): ArrayBuffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    return c >>> 0
  })
  const crc = (bytes: Buffer) => {
    let c = 0xffffffff
    for (const byte of bytes) c = crcTable[(c ^ byte) & 0xff]! ^ (c >>> 8)
    return (c ^ 0xffffffff) >>> 0
  }
  const chunk = (type: string, data: Buffer) => {
    const out = Buffer.alloc(12 + data.length)
    out.writeUInt32BE(data.length, 0)
    out.write(type, 4, 'ascii')
    data.copy(out, 8)
    out.writeUInt32BE(crc(out.subarray(4, 8 + data.length)), 8 + data.length)
    return out
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  const raw = Buffer.alloc(height * (1 + width * 4))
  return bufferOf(
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', ihdr),
      chunk('IDAT', deflateSync(raw)),
      chunk('IEND', Buffer.alloc(0)),
    ]),
  )
}

/**
 * A JPEG marker chain with an APP1 block in front of the frame header.
 *
 * The padding is the point: a reader that assumed a fixed offset would report the size of
 * whatever happens to sit at byte 163 — and every photo out of a phone has EXIF here.
 */
function jpeg(width: number, height: number, { withExif = true } = {}): ArrayBuffer {
  const parts: number[] = [0xff, 0xd8]
  if (withExif) {
    const payload = 200
    parts.push(0xff, 0xe1, (payload + 2) >> 8, (payload + 2) & 0xff, ...new Array<number>(payload).fill(0x41))
  }
  parts.push(0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 0xff, width >> 8, width & 0xff, 0x03)
  parts.push(...new Array<number>(9).fill(0), 0xff, 0xd9)
  return bufferOf(new Uint8Array(parts))
}

/** WebP has three codecs and three different places to keep the size. */
function webp(width: number, height: number, codec: 'VP8 ' | 'VP8L' | 'VP8X'): ArrayBuffer {
  const out = new Uint8Array(64)
  const write = (at: number, text: string) => {
    for (let i = 0; i < text.length; i++) out[at + i] = text.charCodeAt(i)
  }
  write(0, 'RIFF')
  write(8, 'WEBP')
  write(12, codec)
  if (codec === 'VP8X') {
    const w = width - 1
    const h = height - 1
    out.set([w & 0xff, (w >> 8) & 0xff, (w >> 16) & 0xff], 24)
    out.set([h & 0xff, (h >> 8) & 0xff, (h >> 16) & 0xff], 27)
  } else if (codec === 'VP8L') {
    const bits = (width - 1) | ((height - 1) << 14)
    out.set([bits & 0xff, (bits >>> 8) & 0xff, (bits >>> 16) & 0xff, (bits >>> 24) & 0xff], 21)
  } else {
    out.set([width & 0xff, (width >> 8) & 0x3f], 26)
    out.set([height & 0xff, (height >> 8) & 0x3f], 28)
  }
  return bufferOf(out)
}

function ktx2(width: number, height: number): ArrayBuffer {
  const out = new Uint8Array(80)
  out.set([0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a], 0)
  new DataView(out.buffer).setUint32(20, width, true)
  new DataView(out.buffer).setUint32(24, height, true)
  return bufferOf(out)
}

/** A Radiance file: ASCII header, resolution line, then RGBE scanlines. */
function hdr(width: number, height: number): ArrayBuffer {
  const header = Buffer.from(`#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y ${height} +X ${width}\n`, 'ascii')
  return bufferOf(Buffer.concat([header, Buffer.alloc(width * height * 4, 0x40)]))
}

/* --- the reader ---------------------------------------------------------- */

describe('readImageInfo', () => {
  it('reads a PNG', () => {
    expect(readImageInfo(png(1024, 512))).toEqual({ format: 'png', width: 1024, height: 512 })
  })

  it('reads a JPEG past its EXIF block', () => {
    // The discriminating case. With the block removed the frame header moves, and a reader
    // using a fixed offset would still be "right" on one of these two.
    expect(readImageInfo(jpeg(800, 600))).toEqual({ format: 'jpeg', width: 800, height: 600 })
    expect(readImageInfo(jpeg(800, 600, { withExif: false }))).toEqual({ format: 'jpeg', width: 800, height: 600 })
  })

  it('reads all three WebP codecs', () => {
    expect(readImageInfo(webp(640, 480, 'VP8 '))).toEqual({ format: 'webp', width: 640, height: 480 })
    expect(readImageInfo(webp(640, 480, 'VP8L'))).toEqual({ format: 'webp', width: 640, height: 480 })
    expect(readImageInfo(webp(640, 480, 'VP8X'))).toEqual({ format: 'webp', width: 640, height: 480 })
  })

  it('reads a KTX2 header, which no browser API can', () => {
    expect(readImageInfo(ktx2(2048, 2048))).toEqual({ format: 'ktx2', width: 2048, height: 2048 })
  })

  it('reads a Radiance .hdr, where width and height are the other way round', () => {
    // `-Y <height> +X <width>`. Getting this backwards produces a plausible-looking number
    // and a 2:1 panorama reported as 1:2.
    expect(readImageInfo(hdr(2048, 1024))).toEqual({ format: 'hdr', width: 2048, height: 1024 })
  })

  it('returns null for bytes that are not an image, rather than guessing', () => {
    expect(readImageInfo(bufferOf(new TextEncoder().encode('this is not an image at all, not even close')))).toBeNull()
    expect(readImageInfo(new ArrayBuffer(4))).toBeNull()
  })
})

/* --- the grading --------------------------------------------------------- */

describe('auditImage', () => {
  it('passes a well-behaved texture with no findings above pass', () => {
    const result = auditImage(png(1024, 1024), { scope: 'image', now: () => '2026-09-01T00:00:00.000Z' })
    expect(result.verdict).toBe('pass')
    expect(result.audit.policyId).toBe(DEFAULT_POLICY.id)
  })

  it('grades ONLY the metrics that apply to an image', () => {
    // A PNG measured against `maxTriangles` reports "三角面数 0 / 300,000 通过". Not wrong,
    // and exactly the kind of noise that teaches people to stop reading the report.
    const result = auditImage(png(512, 512), { scope: 'image' })
    const graded = result.audit.findings.map((f) => f.metric).sort()
    expect(graded).toEqual(['imageBytes', 'imageSize', 'nonPowerOfTwo'])
  })

  it('grades an hdri against its own byte budget, not the texture one', () => {
    const result = auditImage(hdr(2048, 1024), { scope: 'hdri' })
    expect(result.audit.findings.map((f) => f.metric).sort()).toEqual(['hdriBytes', 'imageSize'])
  })

  it('fails an oversized image and says what to do about it, with numbers', () => {
    // 附件A's acceptance line: advice must be actionable. "请优化" is not advice.
    const result = auditImage(png(4096, 4096), { scope: 'image' })
    const size = result.audit.findings.find((f) => f.metric === 'imageSize')!
    expect(size.level).toBe('fail')
    expect(size.advice).toContain('4,096')
    expect(size.advice).toContain('2,048')
    expect(result.verdict).toBe('fail')
  })

  it('warns on a non-power-of-two size without failing it', () => {
    // WebGL2 samples NPOT fine; mipmap generation is where drivers differ. Blocking a
    // publish over it would be out of proportion, and saying nothing is how "blurry only
    // on that machine" becomes unreproducible.
    const result = auditImage(png(1000, 1000), { scope: 'image' })
    const npot = result.audit.findings.find((f) => f.metric === 'nonPowerOfTwo')!
    expect(npot.level).toBe('warn')
    expect(result.verdict).toBe('warn')
    expect(auditImage(png(1024, 1024), { scope: 'image' }).audit.findings.find((f) => f.metric === 'nonPowerOfTwo')!.level).toBe(
      'pass',
    )
  })

  it('refuses bytes it cannot identify instead of importing a mystery', () => {
    expect(() => auditImage(bufferOf(new TextEncoder().encode('nope, nothing here at all really')), { scope: 'image' })).toThrow(
      /无法识别的图片格式/,
    )
  })

  it('reports the same VRAM estimate the model path would for the same pixels', () => {
    // One budget, one scale. A 2048² texture must cost the same whether it arrived inside
    // a GLB or on its own, or the two reports cannot be compared.
    const measured = measureImage({ format: 'png', width: 2048, height: 2048 }, 1024)
    expect(measured.textureBytes).toBe(Math.round(2048 * 2048 * 4 * (4 / 3)))
    expect(measured.textures).toBe(1)
    expect(measured.tris).toBe(0)
  })
})

describe('policy scopes', () => {
  it('keeps the model metric set exactly as it was', () => {
    // Every pre-v0.5 caller passes no scope and must still grade the same seven metrics.
    expect(metricsFor('model').map((m) => m.metric)).toEqual([
      'bytes',
      'tris',
      'materials',
      'textures',
      'textureBytes',
      'maxTextureSize',
      'nodes',
    ])
  })

  it('describePolicy can render one scope at a time, and skips threshold-less checks', () => {
    expect(describePolicy(DEFAULT_POLICY, 'model').split('\n')).toHaveLength(7)
    // imageBytes + imageSize. The NPOT warning is left out: "非 2 的幂尺寸 ≤ 0" is not a
    // sentence anyone can put in a contract annex.
    expect(describePolicy(DEFAULT_POLICY, 'image').split('\n')).toHaveLength(2)
    expect(describePolicy(DEFAULT_POLICY, 'image')).not.toContain('2 的幂')
  })
})
