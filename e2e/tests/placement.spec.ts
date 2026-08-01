import { expect, test } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

/**
 * v0.5 · T-146 · the placement gestures, at the DOM.
 *
 * This file exists because of what M10's review found: two features (dragging a library
 * model into the viewport, and the ghost preview) were marked done, had unit tests either
 * side of them, and **were never wired up**. The MIME the panel advertised was read by
 * nobody. Every test passed, because each one tested a function rather than a gesture.
 *
 * So the rule this file enforces: a card whose text says 「拖 / 双击 / 点击」 gets an
 * assertion that starts at a real DOM event. `dragTo` fires the browser's own dragstart /
 * dragover / drop — the same path a user's hand takes, including the protected-mode
 * `dataTransfer` that made the drag session store necessary in the first place.
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

const nodeCount = (page: Page) => page.locator('.tree-row__name').count()

/** The status bar's own history depth — visible on every screen, unlike the history panel. */
const undoDepth = async (page: Page) =>
  Number(await page.locator('.statusbar span', { hasText: '历史' }).locator('b').first().innerText())

/**
 * D1's fallback counter. Zero, on every one of these gestures.
 *
 * This is the assertion that would have caught both bugs this card fixed: a cancelled drag
 * rebuilt the whole scene (the abort's inverse patches looked unrecognised), and so did the
 * material record the ghost created and then had to un-create. Neither was visible from the
 * DOM — the object count and the undo depth were both perfectly correct.
 */
const rebuilds = async (page: Page) =>
  Number(await page.locator('.statusbar span', { hasText: '全量重建' }).locator('b').first().innerText())

async function openLibrary(page: Page): Promise<void> {
  await page.goto('/')
  await expect(page.locator('canvas.viewport__canvas')).toBeVisible()
  await page.waitForTimeout(SETTLE * 3)
  await page.getByRole('button', { name: '资源库' }).click()
}

/** The library tile for a primitive, by its Chinese label. */
const primitiveTile = (page: Page, label: string): Locator =>
  page.locator('.library-grid__item', { hasText: label }).first()

test('① 把原始体拖进视口：落在光标下，且只留一条撤销', async ({ page }) => {
  await openLibrary(page)
  const before = await nodeCount(page)
  const beforeUndo = await undoDepth(page)

  const canvas = page.locator('canvas.viewport__canvas')
  await primitiveTile(page, '立方体').dragTo(canvas, { targetPosition: { x: 300, y: 260 } })
  await page.waitForTimeout(SETTLE)

  expect(await nodeCount(page)).toBe(before + 1)
  // 一次放置 = 一条撤销。The ghost passes through the preview channel, so the frames
  // between dragover and drop must leave no trace of their own.
  expect(await undoDepth(page)).toBe(beforeUndo + 1)

  await page.keyboard.press('Control+z')
  await page.waitForTimeout(SETTLE)
  expect(await nodeCount(page), 'Ctrl+Z 要把整次放置一起拿掉').toBe(before)
  expect(await rebuilds(page), '整条路径都必须走增量补丁').toBe(0)
})

test('② 拖到一半离开视口：什么都不留下', async ({ page }) => {
  // The failure this guards is unrecoverable from the user's side: the ghost never reaches
  // the history, so a stray left behind could not be undone.
  await openLibrary(page)
  const before = await nodeCount(page)

  const tile = primitiveTile(page, '球体')
  const box = (await tile.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(400, 300, { steps: 8 })  // over the viewport — ghost appears
  await page.mouse.move(20, 20, { steps: 8 })    // back out over the panels
  await page.mouse.up()
  await page.waitForTimeout(SETTLE)

  expect(await nodeCount(page)).toBe(before)
  // 撤销一次拖拽曾经会重建整个场景：幽灵回滚的反向补丁看起来"不认识"，而幽灵顺手造出来的
  // 材质记录被撤销时又触发一次。对象数与撤销栈全都是对的，只有这个计数器能看见。
  expect(await rebuilds(page), '取消一次拖拽不该重建场景').toBe(0)
})

test('③ 把库模型拖进视口：真的多出一个对象', async ({ page }) => {
  // The exact gesture M10 found broken: the tile set a MIME type that no drop target read,
  // so the cursor showed 「禁止放置」 and nothing happened. Unit tests could not see it —
  // both halves worked, and nothing tested that they were connected.
  await openLibrary(page)
  const models = page.locator('.library-grid__item').filter({ has: page.locator('img') })
  const available = await models.count()
  test.skip(available === 0, '内置库为空（starter 未生成），此步无从验证')

  const before = await nodeCount(page)
  await models.first().dragTo(page.locator('canvas.viewport__canvas'), {
    targetPosition: { x: 320, y: 280 },
  })

  // An import: bytes are fetched, hashed, health-checked and stored before the node lands.
  await expect
    .poll(async () => await nodeCount(page), { timeout: 20_000 })
    .toBeGreaterThan(before)
})

test('④ 转过视角之后双击，物体仍落在画面里', async ({ page }) => {
  // 「双击 = 放到视口中心地面」. It used to be a constant [0,0,0]: orbit away from the
  // origin and the object landed off screen, which reads as 「双击没反应」.
  await openLibrary(page)

  const canvas = page.locator('canvas.viewport__canvas')
  const box = (await canvas.boundingBox())!
  // Orbit hard, so the origin is well outside the frame.
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2 + 420, box.y + box.height / 2 + 90, { steps: 12 })
  await page.mouse.up()
  await page.waitForTimeout(SETTLE)

  await primitiveTile(page, '圆柱').dblclick()
  await page.waitForTimeout(SETTLE)

  // The selected node is the new one; ask the runtime where it ended up on screen. The DEV
  // locator projects through the real camera, so this is the renderer's answer, not a guess.
  const selected = await page.evaluate(() => {
    const row = document.querySelector('.tree-row[data-selected="true"]')
    return row?.getAttribute('data-node-id') ?? null
  })
  expect(selected, '双击之后新对象应当被选中').not.toBeNull()

  const point = await page.evaluate((id: string) => {
    const locate = (globalThis as Record<string, unknown>)['__w3DevLocate'] as
      | ((nodeId: string) => { x: number; y: number } | null)
      | undefined
    return locate?.(id) ?? null
  }, selected!)

  expect(point, '新对象必须在画面内——落在视口外就是「双击没反应」').not.toBeNull()
  expect(point!.x).toBeGreaterThan(0)
  expect(point!.y).toBeGreaterThan(0)
})
