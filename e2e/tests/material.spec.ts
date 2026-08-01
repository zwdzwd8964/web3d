import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

/**
 * v0.5 · T-152 · the material panel, at the DOM.
 *
 * Same rule as `placement.spec.ts`, for the same reason: M10's review found two features
 * that were complete on both sides and never connected, with green unit tests either side of
 * the gap. A card whose text says 「点一下槽位」 gets an assertion that starts at a click.
 */

const SETTLE = 400

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (sessionStorage.getItem('w3-e2e-cleaned')) return
    sessionStorage.setItem('w3-e2e-cleaned', '1')
    void indexedDB.deleteDatabase('w3-editor')
  })
  page.on('console', (message) => {
    if (message.type() === 'error') console.log(`[browser error] ${message.text()}`)
  })
})

/** Opens the editor and selects 阀盖, which the golden path gives a material override. */
async function selectCover(page: Page): Promise<void> {
  await page.goto('/')
  await expect(page.locator('canvas.viewport__canvas')).toBeVisible()
  await page.waitForTimeout(SETTLE * 3)
  await page.locator('.tree-row__name', { hasText: '阀盖' }).click()
  // The material panel is a bottom tab, not always on screen.
  await page.getByRole('button', { name: '材质' }).click()
  await expect(page.locator('.field', { hasText: '类型' })).toBeVisible()
}

const rebuilds = async (page: Page) =>
  Number(await page.locator('.statusbar span', { hasText: '全量重建' }).locator('b').first().innerText())

test('① 切到物理材质，玻璃参数区真的出现', async ({ page }) => {
  await selectCover(page)

  // Hidden until the base asks for them: a slider that writes a parameter the renderer
  // never reads is worse than no slider (T-153 keeps them off standard materials).
  await expect(page.getByText('物理参数')).toHaveCount(0)

  await page.locator('.field', { hasText: '类型' }).locator('select').selectOption('physical')
  await page.waitForTimeout(SETTLE)

  await expect(page.getByText('物理参数')).toBeVisible()
  await expect(page.locator('.field', { hasText: '透射' })).toBeVisible()
  await expect(page.locator('.field', { hasText: '折射率' })).toBeVisible()
})

test('② 点一下贴图槽位，选择器开出来且两个页签都在', async ({ page }) => {
  await selectCover(page)

  await page.locator('.field', { hasText: '基础色' }).locator('button.slot').click()

  const picker = page.locator('.picker')
  await expect(picker).toBeVisible()
  await expect(picker.getByRole('button', { name: '项目资产' })).toBeVisible()
  await expect(picker.getByRole('button', { name: '内置纹理' })).toBeVisible()
  // A fresh project has no textures of its own, and saying so is better than an empty box.
  await expect(picker.getByText('项目里还没有纹理', { exact: false })).toBeVisible()
})

test('③ 从内置纹理选一张：走导入管线，落进材质槽位，一条撤销', async ({ page }) => {
  // The gesture M10 would have caught if it existed for the model library: a picker that
  // shows library items and never wires the choice back to the document looks identical to
  // one that works, right up until you reload.
  await selectCover(page)
  const undoDepth = async () =>
    Number(await page.locator('.statusbar span', { hasText: '历史' }).locator('b').first().innerText())
  const before = await undoDepth()

  await page.locator('.field', { hasText: '基础色' }).locator('button.slot').click()
  await page.locator('.picker').getByRole('button', { name: '内置纹理' }).click()

  const items = page.locator('.picker__item')
  await expect(items.first()).toBeVisible()
  await items.first().click()

  // The import fetches, hashes, health-checks and stores before the slot can point at it.
  await expect
    .poll(async () => (await page.locator('.field', { hasText: '基础色' }).locator('button.slot').innerText()).trim(), {
      timeout: 20_000,
    })
    .not.toBe('（未设置）')

  // The picker closes on its own — leaving it open after a pick makes people click twice.
  await expect(page.locator('.picker')).toHaveCount(0)
  // 引入 + 设置贴图 = two entries; the point is that neither is silent.
  expect(await undoDepth()).toBeGreaterThan(before)
  expect(await rebuilds(page), '贴图落地必须走增量补丁').toBe(0)
})

test('④ 清除槽位真的清掉', async ({ page }) => {
  // The failure this guards is the one that makes people stop trusting the panel: clearing
  // a slot that stays set, so they clear it again.
  await selectCover(page)
  await page.locator('.field', { hasText: '基础色' }).locator('button.slot').click()
  await page.locator('.picker').getByRole('button', { name: '内置纹理' }).click()
  await page.locator('.picker__item').first().click()

  const slot = page.locator('.field', { hasText: '基础色' }).locator('button.slot')
  await expect.poll(async () => (await slot.innerText()).trim(), { timeout: 20_000 }).not.toBe('（未设置）')

  await page.locator('.field', { hasText: '基础色' }).getByRole('button', { name: '清除基础色贴图' }).click()
  await expect(slot).toHaveText('（未设置）')
})
