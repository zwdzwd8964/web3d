#!/usr/bin/env node
/**
 * T-218 · the Draco-compressed pump, generated once and committed.
 *
 * ⚠ **人工一次性执行。需要网络（首次装 `draco3dgltf`），产物提交进仓库。**
 * **不在任何 build / CI / `pnpm verify` 路径上**，也不许被挂进去 —— `draco3dgltf` 是
 * `packages/core` 的 devDependency，按 ADR-0030 的落地纪律它只服务于这一个脚本。
 *
 * Why a committed binary rather than a build step: the encoder is WASM that we cannot audit
 * and do not want in the test path, and a fixture regenerated on every run is a fixture whose
 * bytes nobody has ever looked at. The committed file is the thing the tests assert against;
 * `draco-fixture.test.ts` re-derives its measurements from the bytes, so a swapped or
 * corrupted file fails rather than passing quietly.
 *
 * **Every package here is resolved through `createRequire` anchored on `packages/core`.**
 * ADR-0030 puts `draco3dgltf` in that package's devDependencies, and pnpm's isolated layout
 * means a bare `import` from a root-level script resolves to nothing — measured, and it is
 * true of `@gltf-transform/core` and `/extensions` as well, not just the encoder. All three
 * expose a CJS entry, so one anchored `require` covers them. Same shape as
 * `packages/editor/vite.config.ts`. Hoisting them to ROOT devDependencies would be the easy
 * fix and the wrong one — it would put a Draco encoder in every install of this repo.
 *
 * Run: node scripts/gen-draco-fixture.mjs
 */
import { createRequire } from 'node:module'
import { writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildSamplePumpGlb } from '../packages/core/src/assets/sample.ts'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'e2e/fixtures/pump-draco.glb')

/** The card caps the fixture; a 100 KB test asset is a test asset, 10 MB is a liability. */
const MAX_BYTES = 100 * 1024

const require = createRequire(new URL('../packages/core/package.json', import.meta.url))
const { NodeIO } = require('@gltf-transform/core')
const { KHRDracoMeshCompression } = require('@gltf-transform/extensions')
const draco3d = require('draco3dgltf')

const io = new NodeIO()
  .registerExtensions([KHRDracoMeshCompression])
  .registerDependencies({
    'draco3d.encoder': await draco3d.createEncoderModule(),
    'draco3d.decoder': await draco3d.createDecoderModule(),
  })

// The uncompressed source is the repository's own sample pump — the same geometry every
// other assets test measures, so the compressed and uncompressed measurements are comparable
// by construction rather than by coincidence.
const source = await buildSamplePumpGlb()
const doc = await io.readBinary(new Uint8Array(source))

// `setRequired(true)` is the point of the whole card: it makes the file UNREADABLE without a
// decoder. A merely-`used` extension would let a loader with no DRACOLoader open the file and
// quietly show nothing, and every assertion downstream would be about an empty scene.
doc
  .createExtension(KHRDracoMeshCompression)
  .setRequired(true)
  .setEncoderOptions({ method: KHRDracoMeshCompression.EncoderMethod.EDGEBREAKER })

const bytes = await io.writeBinary(doc)

if (bytes.byteLength > MAX_BYTES) {
  console.error(`FAIL  fixture ${(bytes.byteLength / 1024).toFixed(1)} KB 超过上限 ${MAX_BYTES / 1024} KB`)
  process.exit(1)
}

writeFileSync(OUT, bytes)

const json = JSON.parse(
  new TextDecoder().decode(bytes.subarray(20, 20 + new DataView(bytes.buffer, bytes.byteOffset).getUint32(12, true))),
)
console.log(`wrote e2e/fixtures/pump-draco.glb  ${(bytes.byteLength / 1024).toFixed(1)} KB`)
console.log(`  extensionsRequired: ${JSON.stringify(json.extensionsRequired ?? [])}`)
console.log(`  meshes ${json.meshes?.length ?? 0} · accessors ${json.accessors?.length ?? 0}`)
console.log(`  未压缩同源件 ${(source.byteLength / 1024).toFixed(1)} KB`)
