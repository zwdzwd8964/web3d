import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { resetStorage } from './storage-reset.js'

/**
 * v0.5 · T-152 · the material panel, at the DOM.
 *
 * Same rule as `placement.spec.ts`, for the same reason: M10's review found two features
 * that were complete on both sides and never connected, with green unit tests either side of
 * the gap. A card whose text says 「点一下槽位」 gets an assertion that starts at a click.
 */

const SETTLE = 400

test.beforeEach(async ({ page }) => {
  await resetStorage(page, 'w3-e2e-cleaned')
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

test('⑤ 预设应用到共享材质前先问，「分离后应用」只改这一个', async ({ page }) => {
  // The trap this guards is the one everyone hits first: pick 「玻璃」 on one bolt and the
  // whole pump turns to glass. The runtime's clone-on-write cannot help here — the DOCUMENT
  // has one record, and the other objects may be behind the camera.
  await page.goto('/')
  await expect(page.locator('canvas.viewport__canvas')).toBeVisible()
  await page.waitForTimeout(SETTLE * 3)

  // Put 泵体 on 阀盖's material, so the record really is shared.
  await page.locator('.tree-row__name', { hasText: '泵体' }).click()
  await page.getByRole('button', { name: '材质' }).click()
  await page.locator('.field', { hasText: '材质' }).locator('select').selectOption({ index: 1 })
  await page.waitForTimeout(SETTLE)
  await expect(page.getByText('个对象共用', { exact: false })).toBeVisible()

  const materialCount = async () =>
    await page.locator('.field', { hasText: '材质' }).locator('select option').count()
  const before = await materialCount()

  await page.getByRole('button', { name: '玻璃', exact: true }).click()
  // Asked, not applied: the question is the feature.
  await expect(page.getByText('要应用到哪里', { exact: false })).toBeVisible()
  await page.getByRole('button', { name: '分离后应用' }).click()
  await page.waitForTimeout(SETTLE)

  // A new record exists, and this node is on it alone.
  expect(await materialCount()).toBe(before + 1)
  await expect(page.getByText('个对象共用', { exact: false })).toHaveCount(0)
  await expect(page.getByText('物理参数')).toBeVisible()
})

test('⑥ 环境页签点一张 HDRI：一条撤销，整体还原', async ({ page }) => {
  // 「一条 commit」 is the card's own wording, and this is the only way to see it: the
  // environment map and the backdrop move together, and an undo that splits them leaves the
  // scene lit by a sky it is no longer showing.
  await page.goto('/')
  await expect(page.locator('canvas.viewport__canvas')).toBeVisible()
  await page.waitForTimeout(SETTLE * 3)

  await page.getByRole('button', { name: '资源库' }).click()
  await page.getByRole('button', { name: '环境' }).click()

  const items = page.locator('.library-grid__item')
  await expect(items.first()).toBeVisible()
  const undoDepth = async () =>
    Number(await page.locator('.statusbar span', { hasText: '历史' }).locator('b').first().innerText())
  const before = await undoDepth()

  await items.first().click()
  await expect.poll(async () => await undoDepth(), { timeout: 20_000 }).toBe(before + 1)
  await expect(page.getByRole('button', { name: '清除环境' })).toBeVisible()

  await page.keyboard.press('Control+z')
  await page.waitForTimeout(SETTLE)

  // Gone in one step — both halves of it.
  await expect(page.getByRole('button', { name: '清除环境' })).toHaveCount(0)
  expect(await undoDepth()).toBe(before)
  expect(await rebuilds(page), '换环境不该重建场景').toBe(0)
})

test('⑦ 纹理页签点一张：引入并挂到选中对象的基础色', async ({ page }) => {
  await selectCover(page)
  await page.getByRole('button', { name: '资源库' }).click()
  await page.getByRole('button', { name: '纹理' }).click()
  await expect(page.getByText('引入后直接挂到', { exact: false })).toBeVisible()

  await page.locator('.library-grid__item').first().click()
  await page.waitForTimeout(SETTLE)

  // Back in the material panel, the base-colour slot now names the texture.
  await page.getByRole('button', { name: '材质' }).click()
  const slot = page.locator('.field', { hasText: '基础色' }).locator('button.slot')
  await expect.poll(async () => (await slot.innerText()).trim(), { timeout: 20_000 }).not.toBe('（未设置）')
})

/** What the RENDERER is holding for a node — not what the document says (M11). */
async function renderedMaterial(page: Page, nodeName: string) {
  return page.evaluate((name: string) => {
    const row = [...document.querySelectorAll('.tree-row')].find((r) => r.textContent?.includes(name))
    const nodeId = row?.getAttribute('data-node-id')
    if (!nodeId) return null
    const probe = (globalThis as Record<string, unknown>)['__w3DevMaterialOf'] as
      | ((id: string) => { map: string | null; base: string | null; transmission: number | null } | null)
      | undefined
    return probe?.(nodeId) ?? null
  }, nodeName)
}

test('⑧ 贴图真的到了渲染器手上，不只是文档里写着（M11 审查所得）', async ({ page }) => {
  // The gap this closes: every assertion about textures so far read the DOCUMENT back — the
  // slot label, the material record. 「文档里写着一张贴图」 and 「渲染器手上有一张贴图」 are
  // two different claims, and only the second is what the user sees. This is the same shape
  // as the roughness assertion T-115 had to fix in the v0 golden path.
  await selectCover(page)
  expect((await renderedMaterial(page, '阀盖'))?.map, '前提：一开始没有贴图').toBeNull()

  await page.locator('.field', { hasText: '基础色' }).locator('button.slot').click()
  await page.locator('.picker').getByRole('button', { name: '内置纹理' }).click()
  await page.locator('.picker__item').first().click()

  await expect
    .poll(async () => (await renderedMaterial(page, '阀盖'))?.map, { timeout: 20_000 })
    .not.toBeNull()
})

test('⑨ 换成玻璃之后，渲染器手上真的是 MeshPhysicalMaterial', async ({ page }) => {
  // Same lens on T-153: the panel showing a 透射 slider proves the document changed, not
  // that the renderer built a class that can read it.
  await selectCover(page)
  expect((await renderedMaterial(page, '阀盖'))?.base).toBe('MeshStandardMaterial')

  await page.getByRole('button', { name: '玻璃', exact: true }).click()
  await page.waitForTimeout(SETTLE)

  const rendered = await renderedMaterial(page, '阀盖')
  expect(rendered?.base, '预设说这是玻璃，渲染器就得拿到玻璃').toBe('MeshPhysicalMaterial')
  expect(rendered?.transmission).toBe(1)
})
