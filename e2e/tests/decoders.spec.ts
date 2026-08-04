import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'
import { collectRequests, isRealAsset } from '../fixtures/requests.js'
import { resetStorage } from './storage-reset.js'

/**
 * T-218 · 债 H · Draco 在真浏览器里被同源加载并解出几何。
 *
 * Draco has been wired into `AssetLoader` since v0 and had **never once been exercised on a
 * compressed asset** — `IMPL_NOTES` U-15 recorded it as unverified, and the repository had no
 * Draco-compressed file at all, so no test could have changed that. G1.0-10 is this file.
 *
 * The Node half lives in `packages/core/test/assets/draco-fixture.test.ts` and proves the
 * fixture decodes. **It cannot prove the browser path**: three's `DRACOLoader` needs `fetch`
 * over http and `new Worker`, neither of which Node has. That is why this file exists rather
 * than one more unit test.
 */

const DRACO_ASSET = /draco[\w.-]*\.(wasm|js)$/i
const fixture = () =>
  new Uint8Array(readFileSync(fileURLToPath(new URL('../fixtures/pump-draco.glb', import.meta.url))))

test.beforeEach(async ({ page }) => {
  await resetStorage(page, 'decoders')
})

test('Draco 压缩件导入后，解码器被同源取回并解出几何', async ({ page, baseURL }) => {
  const log = collectRequests(page)
  await page.goto('/')
  await expect(page.locator('canvas.viewport__canvas')).toBeVisible()

  const before = await page.locator('.tree-row').count()

  await page.getByRole('button', { name: '资产' }).click()
  await page.locator('input[type=file]').setInputFiles({
    name: 'pump-draco.glb',
    mimeType: 'model/gltf-binary',
    buffer: Buffer.from(fixture()),
  })
  await expect(page.locator('.report')).toBeVisible({ timeout: 30_000 })

  // ── 1 · 解码器真的被请求了，而且是同源 ──────────────────────────────
  const hits = log.matching(DRACO_ASSET)
  // T-220 裁决 vendor/ 去留时要用这几条 URL 当依据，所以打印出来而不是只断言。
  console.log(`[T-218] Draco 解码器请求 ${hits.length} 条：`)
  for (const url of hits) console.log(`[T-218]   ${url}`)

  expect(hits.length, '一条 draco 解码器请求都没有 —— 要么没在解，要么解码器被内联了').toBeGreaterThan(0)

  for (const url of hits) {
    expect(new URL(url).origin, `解码器必须同源（C6 断网能跑）：${url}`).toBe(new URL(baseURL!).origin)
  }

  // ── 2 · 请求回来的是真字节，不是 dev server 的兜底页 ─────────────────
  // `status() === 200` is worthless here: vite dev answers any unmatched path with 200 +
  // index.html. Measured on a path this repo does not serve: 200 OK, text/html, 751 bytes.
  const response = log.responseFor(hits[0]!)
  expect(response, `没有收到 ${hits[0]} 的响应`).toBeTruthy()
  const verdict = await isRealAsset(response!)
  console.log(`[T-218] 首条解码器响应：${verdict.why}`)
  expect(verdict.ok, verdict.why).toBe(true)

  // ── 3 · 几何真的进来了 ──────────────────────────────────────────────
  // Not 「导入后有网格」 — that is the false green the card names. Without a DRACOLoader,
  // `GLTFLoader.parseAsync` throws on a file whose extension is REQUIRED, so the import
  // never reaches this point at all.
  //
  // The report row is keyed `tris`, and the number has to be the uncompressed twin's: the
  // fixture is the repository's own sample pump, 2 boxes × 12 triangles. Asserting the exact
  // figure rather than 「> 0」 is what makes a half-decoded file fail.
  const report = page.locator('.report')
  await expect(report).toContainText('tris')
  await expect(report).toContainText('24')
  await expect(report).toContainText('新增 4 个对象')

  await page.getByRole('button', { name: '确认导入' }).click()
  await expect(report).toBeHidden({ timeout: 15_000 })

  const after = await page.locator('.tree-row').count()
  expect(after, '导入之后层级树没有多出节点').toBeGreaterThan(before)
})
