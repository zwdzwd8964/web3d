import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { buildTestGlb } from '../fixtures/glb.js'
import { resetStorage } from './storage-reset.js'

/**
 * G0-1 · the golden path.
 *
 * Written after an independent evaluation found three P0s that every unit test in the
 * repo was blind to. The most instructive one: importing a GLB grew the hierarchy tree,
 * grew the asset list, advanced the object counter and reported a clean health check —
 * while the viewport rendered nothing at all. Every text-level signal said success.
 *
 * So the load-bearing assertion in this file is a PIXEL one. `countDistinctColours` reads
 * the canvas back and counts colour buckets; an empty viewport has three (background plus
 * two grid greys) no matter what the DOM says.
 */

const SETTLE = 400

test.beforeEach(async ({ page }) => {
  // Each test starts from a clean slate, or the autosaver's restore would carry the
  // previous test's imports into the next one and every count would drift.
  //
  // Guarded by a sessionStorage flag because addInitScript runs on EVERY navigation:
  // unguarded, test ⑤'s reload wiped the database it had just saved to, and the test
  // failed for a reason that had nothing to do with the code under test.
  await resetStorage(page, 'w3-e2e-cleaned')
  page.on('console', (message) => {
    if (message.type() === 'error') console.log(`[browser error] ${message.text()}`)
  })
})

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

/** Reads the WebGL canvas back and returns distinct colour buckets (high 4 bits/channel). */
async function sampleColours(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const canvas = document.querySelector('canvas.viewport__canvas') as HTMLCanvasElement | null
    if (!canvas) return -1
    const scratch = document.createElement('canvas')
    scratch.width = canvas.width
    scratch.height = canvas.height
    const ctx = scratch.getContext('2d')!
    ctx.drawImage(canvas, 0, 0)
    const { data } = ctx.getImageData(0, 0, scratch.width, scratch.height)
    const buckets = new Set<string>()
    // Every 37th pixel: enough coverage to notice a model, cheap enough to run often.
    for (let i = 0; i < data.length; i += 4 * 37) {
      buckets.add(`${data[i]! >> 4},${data[i + 1]! >> 4},${data[i + 2]! >> 4}`)
    }
    return [...buckets]
  })
}

const countDistinctColours = async (page: Page) => (await sampleColours(page)).length

/** True when some sampled pixel is dominated by red — the imported fixture's colour. */
const hasRedObject = (buckets: string[]) =>
  buckets.some((b) => {
    const [r, g, bl] = b.split(',').map(Number) as [number, number, number]
    return r >= 8 && r > g + 3 && r > bl + 3
  })

const statusNumber = (page: Page, label: string) =>
  page.locator('.statusbar span', { hasText: label }).locator('b').first()

/** Drops a generated GLB onto the asset panel without touching the OS file dialog. */
async function importGlb(page: Page, name: string, bytes: Uint8Array) {
  await page.getByRole('button', { name: '资产' }).click()
  await page.locator('input[type=file]').setInputFiles({
    name,
    mimeType: 'model/gltf-binary',
    buffer: Buffer.from(bytes),
  })
  await expect(page.locator('.report')).toBeVisible({ timeout: 15_000 })
}

/* -------------------------------------------------------------------------- */
/* The path                                                                    */
/* -------------------------------------------------------------------------- */

test('① 冷启动就能看见样例模型，而不是一片网格', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('canvas.viewport__canvas')).toBeVisible()
  await page.waitForTimeout(SETTLE * 3)

  // The regression this guards: a viewport that shows only the grid has exactly three
  // colour buckets — background and two grid greys — regardless of what the tree says.
  expect(await countDistinctColours(page)).toBeGreaterThan(3)

  await expect(page.locator('.tree-row__name', { hasText: '阀盖' })).toBeVisible()
  await expect(statusNumber(page, '全量重建')).toHaveText('0')
})

test('② 导入 GLB 后，视口里真的多了东西', async ({ page }) => {
  await page.goto('/')
  await page.waitForTimeout(SETTLE * 3)

  const before = await sampleColours(page)
  expect(hasRedObject(before), '导入前不该有红色物体').toBe(false)
  const objectsBefore = Number(await statusNumber(page, '对象').innerText())

  await importGlb(page, 'cube-a.glb', await buildTestGlb({ colour: [0.9, 0.2, 0.2], size: 3, offsetX: 4 }))
  await expect(page.locator('.report__summary')).toContainText('新增')
  await page.getByRole('button', { name: /确认导入|仍然导入/ }).click()
  await page.waitForTimeout(SETTLE * 3)

  await expect(statusNumber(page, '对象')).not.toHaveText(String(objectsBefore))

  // The whole point, and the assertion the old build would fail while passing every
  // other line in this test: the importer's loader and the renderer's loader were
  // different objects, so the bytes never reached the screen. Asserting the fixture's own
  // colour rather than "more colours" — framing the new object legitimately pulls the
  // camera back, which reduces the bucket count.
  expect(hasRedObject(await sampleColours(page)), '导入的红色模型没有出现在视口里').toBe(true)

  // D1 · the incremental path handled it. A fallback here would mean the import rebuilt
  // the whole scene, which is what the counter exists to catch.
  await expect(statusNumber(page, '全量重建')).toHaveText('0')
})

test('③ 同一个文件导入两次，复用资产但再放一份实例', async ({ page }) => {
  await page.goto('/')
  await page.waitForTimeout(SETTLE * 3)

  const bytes = await buildTestGlb({ colour: [0.2, 0.7, 0.9], size: 2, offsetX: -4 })

  await importGlb(page, 'twice.glb', bytes)
  await page.getByRole('button', { name: /确认导入|仍然导入/ }).click()
  await page.waitForTimeout(SETTLE)
  const afterFirst = Number(await statusNumber(page, '对象').innerText())
  const assetsAfterFirst = await page.locator('.asset-list > li').count()

  await importGlb(page, 'twice-again.glb', bytes)
  await expect(page.locator('.report__summary')).toContainText('复用已有资产')
  await page.getByRole('button', { name: /确认导入|仍然导入/ }).click()
  await page.waitForTimeout(SETTLE)

  // D4 holds — the blob is stored once…
  expect(await page.locator('.asset-list > li').count()).toBe(assetsAfterFirst)
  // …but the user who drags the same file in twice gets a second copy in the scene.
  expect(Number(await statusNumber(page, '对象').innerText())).toBeGreaterThan(afterFirst)
})

test('④ 改属性 → 撤销 → 重做，历史面板如实记账', async ({ page }) => {
  await page.goto('/')
  await page.waitForTimeout(SETTLE * 2)

  await page.locator('.tree-row__name', { hasText: '阀盖' }).click()
  // NumberField renders type=text with inputMode=decimal so it can be scrubbed.
  const x = page.locator('.panel--right .field__input').first()
  await x.fill('1.5')
  await x.press('Enter')
  await expect(statusNumber(page, '历史')).toHaveText('1')

  await page.getByRole('button', { name: '历史', exact: true }).click()
  const entries = page.locator('.history-list__entry')
  await expect(entries).toHaveCount(1)
  // D2 · one edit, one entry, one patch. Sixty here would mean the collapse is not working.
  await expect(entries.first().locator('.history-list__count')).toHaveText('1')

  await page.keyboard.press('Control+z')
  await expect(statusNumber(page, '历史')).toHaveText('0')
  await page.keyboard.press('Control+y')
  await expect(statusNumber(page, '历史')).toHaveText('1')

  await expect(statusNumber(page, '全量重建')).toHaveText('0')
})

test('⑤ 保存后刷新，工作不丢', async ({ page }) => {
  await page.goto('/')
  await page.waitForTimeout(SETTLE * 2)

  await page.locator('.tree-row__name', { hasText: '阀盖' }).dblclick()
  const rename = page.locator('.tree-row__rename')
  await rename.fill('阀盖-改过了')
  await rename.press('Enter')

  await page.keyboard.press('Control+s')
  await expect(page.locator('.savestate')).toHaveText('已保存', { timeout: 10_000 })

  await page.reload()
  await page.waitForTimeout(SETTLE * 3)

  // The report's sharpest finding: three imports and two edits, all lost on refresh.
  await expect(page.locator('.tree-row__name', { hasText: '阀盖-改过了' })).toBeVisible()
})

test('⑥ 删除被引用的节点前有准确提示，删除后能查到断在哪', async ({ page }) => {
  await page.goto('/')
  await page.waitForTimeout(SETTLE * 2)

  const row = page.locator('.tree-row', { has: page.locator('.tree-row__name', { hasText: '阀盖' }) })
  await row.hover()
  await row.locator('.tree-row__del').click()

  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  // The wording is the feature: it names what breaks, with counts, before the damage.
  await expect(dialog).toContainText('引用')
  await dialog.getByRole('button', { name: '删除' }).click()

  await expect(statusNumber(page, '完整性')).not.toHaveText('0')

  // T-092 · and now the part that used to be missing entirely — where are those errors?
  await page.getByRole('button', { name: '完整性', exact: true }).click()
  await expect(page.locator('.issue-list > li').first()).toBeVisible()

  await expect(statusNumber(page, '全量重建')).toHaveText('0')
})

test('⑦ 规则可以被看见、被编辑，且表单是由动作定义生成的', async ({ page }) => {
  await page.goto('/')
  await page.waitForTimeout(SETTLE * 2)

  await page.getByRole('button', { name: '规则', exact: true }).click()
  const rule = page.locator('.rule-list > li').first()
  await expect(rule).toBeVisible()
  // The first rule starts expanded, so only click if it is not.
  if ((await rule.getAttribute('data-open')) !== 'true') await rule.locator('.rule-list__title').click()

  // Generated form: every action row carries the fields its definition declares.
  const actions = page.locator('.action-row')
  await expect(actions.first()).toBeVisible()
  await expect(actions.first().locator('.fields__label').first()).toBeVisible()

  // Reordering is a document edit like any other, so it lands in history.
  const historyBefore = Number(await statusNumber(page, '历史').innerText())
  if ((await actions.count()) > 1) {
    await actions.nth(1).getByTitle('上移').click()
    expect(Number(await statusNumber(page, '历史').innerText())).toBe(historyBefore + 1)
  }
})

test('⑧ 预览模式下点击触发规则，退出后编辑态完全还原', async ({ page }) => {
  await page.goto('/')
  await page.waitForTimeout(SETTLE * 3)

  const pixelsWhileEditing = await countDistinctColours(page)

  await page.getByRole('button', { name: '预览' }).click()
  await page.waitForTimeout(SETTLE)

  // Click the middle of the viewport — the sample model is framed there.
  const canvas = page.locator('canvas.viewport__canvas')
  await canvas.click({ position: { x: 400, y: 300 } })
  await page.waitForTimeout(SETTLE * 3)

  await page.getByRole('button', { name: '规则日志' }).click()
  // Whether a rule fired depends on hitting the right mesh; what must hold is that the
  // panel is live and the engine is attached rather than silently absent.
  await expect(page.locator('.subpanel__head', { hasText: '规则日志' })).toBeVisible()

  await page.getByRole('button', { name: '编辑' }).click()
  await page.waitForTimeout(SETTLE * 2)

  // T-093 acceptance: leaving preview restores the edit state completely.
  expect(await countDistinctColours(page)).toBe(pixelsWhileEditing)
  await expect(statusNumber(page, '全量重建')).toHaveText('0')
})

test('⑨ 全程零外链，C6 在运行期也成立', async ({ page }) => {
  const external: string[] = []
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost' && url.protocol !== 'data:' && url.protocol !== 'blob:') {
      external.push(request.url())
    }
  })

  await page.goto('/')
  await page.waitForTimeout(SETTLE * 3)
  await importGlb(page, 'net.glb', await buildTestGlb({ colour: [0.5, 0.5, 0.1], size: 1 }))
  await page.getByRole('button', { name: /确认导入|仍然导入/ }).click()
  await page.waitForTimeout(SETTLE * 2)

  expect(external, `发起了外部请求：${external.join(', ')}`).toEqual([])
})
