import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'
import { collectRequests, isRealAsset } from '../fixtures/requests.js'
import { resetStorage } from './storage-reset.js'

/**
 * T-219 · 债 U-16 · KTX2 在真浏览器里被同源取回并 transcode 出画。
 *
 * The decoder had never been **constructed**, in any build: `AssetLoader` created it inside
 * `if (options.renderer)` and neither production construction site passed one. Every KTX2
 * claim in this repository — including 附件A's promise that customers may ship `.ktx2`
 * textures — rested on a branch whose condition was permanently false.
 *
 * The Node half (`packages/core/test/runtime/ktx2-wiring.test.ts`) proves the seam is joined.
 * **Only this file can prove the transcoder works**, because that needs a real GPU context.
 */

const TRANSCODER = /basis_transcoder[\w.-]*\.(wasm|js)$/i
const ktx2 = () => readFileSync(fileURLToPath(new URL('../fixtures/ktx2/checker-etc1s.ktx2', import.meta.url)))

test.beforeEach(async ({ page }) => {
  await resetStorage(page, 'compressed-assets')
})

test('不含 KTX2 的场景，transcoder 一次都不该被取', async ({ page }) => {
  const log = collectRequests(page)
  await page.goto('/')
  await expect(page.locator('canvas.viewport__canvas')).toBeVisible()
  // Long enough for a lazy fetch to have happened if one were coming.
  await page.waitForTimeout(1500)

  // `detectSupport` reads capability flags and issues no request; the fetch lives in
  // `KTX2Loader.init()`, which only runs when a KTX2 file is actually parsed. Wiring the
  // transcoder up must therefore cost nothing on a scene that has no compressed texture —
  // otherwise every cold start pays for a decoder it will never use.
  const hits = log.matching(TRANSCODER)
  expect(hits, `无 KTX2 的场景却取了 transcoder：${hits.join(' , ')}`).toHaveLength(0)
})

test('导入独立 .ktx2 贴图，transcoder 被同源取回且贴图不是默认灰', async ({ page, baseURL }) => {
  const log = collectRequests(page)
  await page.goto('/')
  await expect(page.locator('canvas.viewport__canvas')).toBeVisible()

  await page.getByRole('button', { name: '资产' }).click()
  await page.locator('input[type=file]').setInputFiles({
    name: 'checker-etc1s.ktx2',
    mimeType: 'image/ktx2',
    buffer: Buffer.from(ktx2()),
  })

  // The texture lands in the asset panel; a `.ktx2` has no browser-displayable thumbnail
  // (`import-flow.ts` excludes it from `isBrowserDisplayable`), so the panel entry is the
  // observable outcome of the import itself.
  await expect(page.getByText('checker-etc1s.ktx2').first()).toBeVisible({ timeout: 30_000 })

  // The import is staged behind a report until confirmed — the same gate the Draco spec goes
  // through. Without this the asset never reaches the document, and the picker below (which
  // lists the DOCUMENT's textures) has nothing to offer.
  const confirm = page.getByRole('button', { name: '确认导入' })
  if (await confirm.count()) await confirm.click()

  // Assign it as the base colour map so the transcoder is actually asked to run — importing
  // alone would not: `KTX2Loader.init()` fetches on first PARSE, not on registration.
  //
  // Same gesture as `material.spec.ts` ③: select a node that HAS a material, open the
  // material panel, click the 基础色 slot, pick from the project's own textures.
  await page.locator('.tree-row__name', { hasText: '阀盖' }).click()
  await page.getByRole('button', { name: '材质' }).click()
  await page.locator('.field', { hasText: '基础色' }).locator('button.slot').click()
  await expect(page.locator('.picker')).toBeVisible()
  await page.locator('.picker__item', { hasText: 'checker-etc1s.ktx2' }).first().click()
  await expect
    .poll(async () => (await page.locator('.field', { hasText: '基础色' }).locator('button.slot').innerText()).trim(), {
      timeout: 20_000,
    })
    .not.toBe('（未设置）')

  // ── transcoder 必须被取回，且是同源的真字节 ──────────────────────────
  //
  // ⚠ **Unconditional on purpose.** The first draft wrapped these in `if (hits.length > 0)`
  // and reported 「0 条」 while passing — a test that is green when nothing happened, which is
  // the exact shape this card exists to delete. If the assign flow above stops reaching a
  // parse, this has to fail and say so, not shrug.
  await expect
    .poll(() => log.matching(TRANSCODER).length, {
      message: '挂上 KTX2 贴图之后 basis_transcoder 一次都没被取 —— 要么没在 transcode，要么装配又断了',
      timeout: 30_000,
    })
    .toBeGreaterThan(0)

  const hits = log.matching(TRANSCODER)
  console.log(`[T-219] basis transcoder 请求 ${hits.length} 条：`)
  for (const url of hits) console.log(`[T-219]   ${url}`)

  for (const url of hits) {
    expect(new URL(url).origin, `transcoder 必须同源（C6 断网能跑）：${url}`).toBe(new URL(baseURL!).origin)
  }
  const response = log.responseFor(hits[0]!)
  expect(response, `没有收到 ${hits[0]} 的响应`).toBeTruthy()
  const verdict = await isRealAsset(response!)
  console.log(`[T-219] 首条 transcoder 响应：${verdict.why}`)
  expect(verdict.ok, verdict.why).toBe(true)
})
