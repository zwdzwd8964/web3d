/**
 * T-170 · generates the two media fixtures golden path II imports.
 *
 * Generated rather than committed as binaries, for the same reason the starter library is
 * (D17): bytes in a repo have a licence question attached, and a `.wav` whose length nobody
 * can verify is a poor thing to assert 「时长误差 < 0.1s」 against.
 *
 *   warning.png  256×256 hazard triangle — visible in a hotspot panel at a glance
 *   alarm.wav    exactly 1.5 s of raw PCM — duration = samples / sampleRate, no encoder,
 *                no frame padding, no VBR header to guess at
 *
 * Run: `node e2e/fixtures/gen-media-fixtures.mjs`
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deflateSync } from 'node:zlib'

const OUT = join(dirname(fileURLToPath(import.meta.url)), 'media')

/* -------------------------------------------------------------------------- */
/* PNG                                                                         */
/* -------------------------------------------------------------------------- */

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

/** Encodes RGBA8 pixels as a PNG. */
function encodePng(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0 // filter: none
    Buffer.from(rgba.buffer, rgba.byteOffset + y * width * 4, width * 4).copy(raw, y * (width * 4 + 1) + 1)
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = 8 // bit depth
  header[9] = 6 // colour type: RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/** A hazard triangle: amber on dark, recognisable at panel size. */
function warningImage(size = 256) {
  const rgba = new Uint8Array(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4
      // Triangle with apex at the top centre and a base across the bottom eighth.
      const t = y / size
      const halfWidth = t * 0.44 * size
      const inside = y > size * 0.12 && y < size * 0.88 && Math.abs(x - size / 2) < halfWidth
      const bar = inside && Math.abs(x - size / 2) < size * 0.035 && y > size * 0.3 && y < size * 0.68
      const dot = inside && Math.abs(x - size / 2) < size * 0.035 && y > size * 0.74 && y < size * 0.81
      const [r, g, b] = inside ? (bar || dot ? [26, 26, 26] : [255, 176, 32]) : [18, 22, 26]
      rgba[i] = r
      rgba[i + 1] = g
      rgba[i + 2] = b
      rgba[i + 3] = 255
    }
  }
  return rgba
}

/* -------------------------------------------------------------------------- */
/* WAV                                                                         */
/* -------------------------------------------------------------------------- */

/**
 * A mono 16-bit PCM WAV of exactly `seconds`.
 *
 * A two-tone alarm rather than silence: the file is meant to be recognisable if a human
 * ever opens it, and a pure zero buffer compresses to nothing in a way that makes 「文件
 * 大小」 assertions meaningless.
 */
function buildWav(seconds, sampleRate = 8000) {
  const samples = Math.round(seconds * sampleRate)
  const buffer = Buffer.alloc(44 + samples * 2)

  buffer.write('RIFF', 0, 'ascii')
  buffer.writeUInt32LE(36 + samples * 2, 4)
  buffer.write('WAVE', 8, 'ascii')
  buffer.write('fmt ', 12, 'ascii')
  buffer.writeUInt32LE(16, 16)
  buffer.writeUInt16LE(1, 20) // PCM
  buffer.writeUInt16LE(1, 22) // mono
  buffer.writeUInt32LE(sampleRate, 24)
  buffer.writeUInt32LE(sampleRate * 2, 28)
  buffer.writeUInt16LE(2, 32)
  buffer.writeUInt16LE(16, 34)
  buffer.write('data', 36, 'ascii')
  buffer.writeUInt32LE(samples * 2, 40)

  for (let i = 0; i < samples; i++) {
    // 660 Hz / 880 Hz alternating every quarter second, at a third of full scale.
    const hz = Math.floor((i / sampleRate) * 4) % 2 === 0 ? 660 : 880
    const value = Math.round(Math.sin((2 * Math.PI * hz * i) / sampleRate) * 10000)
    buffer.writeInt16LE(value, 44 + i * 2)
  }
  return buffer
}

/* -------------------------------------------------------------------------- */

mkdirSync(OUT, { recursive: true })

const png = encodePng(256, 256, warningImage(256))
writeFileSync(join(OUT, 'warning.png'), png)

/** 1.5 s exactly. The E2E asserts the imported `durationS` against this number. */
export const ALARM_SECONDS = 1.5
const wav = buildWav(ALARM_SECONDS)
writeFileSync(join(OUT, 'alarm.wav'), wav)

console.log(`warning.png  ${png.length} bytes`)
console.log(`alarm.wav    ${wav.length} bytes  (${ALARM_SECONDS}s)`)
