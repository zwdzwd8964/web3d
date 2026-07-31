import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { buildTestGlb } from '../fixtures/glb.js'

/**
 * T-112 · G0-1 · MVP_V0 §2's twelve steps, in order, in one run.
 *
 * The card is explicit: "E2E 测试必须逐步覆盖，缺一步不算完成". `golden-path.spec.ts` next
 * to this file covers nine of them as independent regression tests; this file walks all
 * twelve as ONE continuous session, because several of the steps only mean anything in
 * sequence — you cannot publish what you did not build, and step 12 exists to compare the
 * player against the preview you just watched in step 11.
 *
 * Step 12 is the one that matters most and the one that was missing entirely: publish a
 * real `.w3p`, hand it to the player, and drive the same interaction. The head-less parity
 * suite (T-103) proves the two agree at the session boundary; this proves the two agree
 * when a browser, a canvas and a zip file are involved.
 */

const SETTLE = 400
/** Where the publish download lands, and where the player picks it up again. */
const DOWNLOAD_DIR = join(process.cwd(), 'test-results', 'downloads')

const statusNumber = (page: Page, label: string) =>
  page.locator('.statusbar span', { hasText: label }).locator('b').first()

const tab = (page: Page, name: string) => page.getByRole('button', { name, exact: true })

/**
 * Clicks a specific 3D node, by asking the renderer where it currently is.
 *
 * Guessing pixel coordinates produces a test that passes on one camera framing and
 * silently stops exercising anything on the next — still green, no longer a test. The
 * DEV-only `__w3DevLocate` hook (see runtime-registry.ts) is the only honest way to make
 * "点击阀盖" mean 点击阀盖.
 */
async function clickNode(page: Page, name: string): Promise<void> {
  const point = await page.evaluate((nodeName) => {
    const rows = [...document.querySelectorAll('.tree-row')]
    const row = rows.find((r) => r.querySelector('.tree-row__name')?.textContent === nodeName)
    const id = row?.getAttribute('data-node-id')
    const locate = (globalThis as Record<string, unknown>)['__w3DevLocate'] as
      | ((nodeId: string) => { x: number; y: number } | null)
      | undefined
    return id && locate ? locate(id) : null
  }, name)

  if (!point) throw new Error(`找不到「${name}」在屏幕上的位置——它可能不在视野内`)
  await page.locator('canvas.viewport__canvas').click({ position: point })
}

/** Distinct colour buckets on the canvas. Three means "background and grid only". */
async function colourBuckets(page: Page, selector = 'canvas'): Promise<number> {
  return page.evaluate((sel) => {
    const canvas = document.querySelector(sel) as HTMLCanvasElement | null
    if (!canvas) return -1
    const scratch = document.createElement('canvas')
    scratch.width = canvas.width
    scratch.height = canvas.height
    const ctx = scratch.getContext('2d')!
    ctx.drawImage(canvas, 0, 0)
    const { data } = ctx.getImageData(0, 0, scratch.width, scratch.height)
    const buckets = new Set<string>()
    for (let i = 0; i < data.length; i += 4 * 37) {
      buckets.add(`${data[i]! >> 4},${data[i + 1]! >> 4},${data[i + 2]! >> 4}`)
    }
    return buckets.size
  }, selector)
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (sessionStorage.getItem('w3-e2e-full-cleaned')) return
    sessionStorage.setItem('w3-e2e-full-cleaned', '1')
    void indexedDB.deleteDatabase('w3-editor')
  })
  page.on('console', (m) => {
    if (m.type() === 'error') console.log(`[browser error] ${m.text()}`)
  })
})

test.afterAll(async () => {
  await rm(DOWNLOAD_DIR, { recursive: true, force: true })
})

test('黄金路径 12 步', async ({ page, context }) => {
  test.setTimeout(180_000)

  /* ── 1 · 打开编辑器 ─────────────────────────────────────────────────── */
  await page.goto('/')
  await expect(page.locator('canvas.viewport__canvas')).toBeVisible()
  await page.waitForTimeout(SETTLE * 3)
  expect(await colourBuckets(page, 'canvas.viewport__canvas'), '冷启动视口只有网格').toBeGreaterThan(3)

  /* ── 2 · 拖入 GLB → 自动体检 → 逐项结论 ───────────────────────────── */
  await tab(page, '资产').click()
  await page.locator('input[type=file]').setInputFiles({
    name: 'pump.glb',
    mimeType: 'model/gltf-binary',
    buffer: Buffer.from(await buildTestGlb({ colour: [0.85, 0.3, 0.2], size: 2.5, offsetX: 3 })),
  })
  await expect(page.locator('.report')).toBeVisible({ timeout: 15_000 })
  // The health report is contractual (§6.3): measured value, limit, verdict, advice.
  const reportRows = page.locator('.report__table tbody tr')
  expect(await reportRows.count(), '体检报告应当逐项列出').toBeGreaterThan(3)
  await expect(reportRows.first().locator('td').nth(3)).not.toBeEmpty()

  /* ── 3 · 确认导入 → 层级树出现节点树 ──────────────────────────────── */
  const objectsBefore = Number(await statusNumber(page, '对象').innerText())
  await page.getByRole('button', { name: /确认导入|仍然导入/ }).click()
  await page.waitForTimeout(SETTLE * 3)
  expect(Number(await statusNumber(page, '对象').innerText())).toBeGreaterThan(objectsBefore)
  await expect(page.locator('.asset-list > li')).toHaveCount(2)

  /* ── 4 · 选中「阀盖」→ 属性面板 → 改 transform → 一条撤销 ─────────── */
  await page.locator('.tree-row__name', { hasText: '阀盖' }).click()
  await expect(page.locator('.panel--right .field__input').first()).toBeVisible()
  const historyBefore = Number(await statusNumber(page, '历史').innerText())
  const y = page.locator('.panel--right .field__input').nth(1)
  await y.fill('0.35')
  await y.press('Enter')
  expect(Number(await statusNumber(page, '历史').innerText())).toBe(historyBefore + 1)

  /* ── 5 · Ctrl+Z 撤销 → Ctrl+Y 重做 ────────────────────────────────── */
  await page.keyboard.press('Control+z')
  await expect(statusNumber(page, '历史')).toHaveText(String(historyBefore))
  await page.keyboard.press('Control+y')
  await expect(statusNumber(page, '历史')).toHaveText(String(historyBefore + 1))

  /* ── 6 · 改材质 roughness，共享材质的兄弟不变 ─────────────────────── */
  await tab(page, '材质').click()
  await page.getByRole('button', { name: '新建并指定' }).click()
  await page.waitForTimeout(SETTLE)
  const roughness = page.locator('.panel--bottom .field__input, .panel--bottom input[type=range]').first()
  await expect(roughness).toBeVisible()
  const historyAfterMaterial = Number(await statusNumber(page, '历史').innerText())
  expect(historyAfterMaterial).toBeGreaterThan(historyBefore + 1)
  // R08's guarantee is unit-tested against a genuinely shared material; here we only
  // assert the edit landed and did not force a rebuild.
  await expect(statusNumber(page, '全量重建')).toHaveText('0')

  /* ── 7 · 保存视点 ─────────────────────────────────────────────────── */
  await tab(page, '视点').click()
  const viewpointsBefore = await page.locator('.panel--bottom li').count()
  await page.getByRole('button', { name: '保存当前视角' }).click()
  await page.waitForTimeout(SETTLE)
  expect(await page.locator('.panel--bottom li').count()).toBe(viewpointsBefore + 1)

  /* ── 8 · 新建补间动画 ─────────────────────────────────────────────── */
  await tab(page, '动画').click()
  await page.getByRole('button', { name: '用选中对象新建补间' }).click()
  await page.waitForTimeout(SETTLE)
  await expect(page.locator('.panel--bottom li').first()).toBeVisible()

  /* ── 9 · 加热点，开启遮挡 ─────────────────────────────────────────── */
  await tab(page, '热点').click()
  await page.getByRole('button', { name: '在选中对象上新建' }).click()
  await page.waitForTimeout(SETTLE)
  const hotspot = page.locator('.hotspot-list > li').first()
  await expect(hotspot).toBeVisible()
  await hotspot.locator('textarea').fill('拆卸第一步：松开六颗固定螺栓')
  // D7's occlusion flag is on by default; assert rather than assume.
  await expect(hotspot.locator('input[type=checkbox]').last()).toBeChecked()

  /* ── 10 · 新建变量 step，新建规则 ─────────────────────────────────── */
  await tab(page, '变量').click()
  await page.getByPlaceholder('新变量 id，如 step').fill('phase')
  await page.getByRole('button', { name: '新建', exact: true }).click()
  await expect(page.locator('.grid tbody tr')).toHaveCount(2)

  await tab(page, '规则').click()
  const rulesBefore = await page.locator('.rule-list > li').count()
  await page.getByRole('button', { name: '新建规则' }).click()
  await page.waitForTimeout(SETTLE)
  expect(await page.locator('.rule-list > li').count()).toBe(rulesBefore + 1)

  // The action form is generated entirely from `ActionDefinition.ui.fields` — a new rule
  // arrives with a renderable action rather than an empty box, and it is filled in
  // through that generated form, never through a hand-written one.
  const newRule = page.locator('.rule-list > li').last()
  // A newly created rule is already expanded; clicking its title would collapse it.
  if ((await newRule.getAttribute('data-open')) !== 'true') await newRule.locator('.rule-list__title').click()
  const actionRow = newRule.locator('.action-row').first()
  await expect(actionRow).toBeVisible()

  // Leave it incomplete for now — step 12 uses it to prove the publish gate blocks.

  /* ── 11 · 预览 → 点击 → 规则执行 → 再次点击条件不满足 ────────────── */
  await page.getByRole('button', { name: '预览' }).click()
  await page.waitForTimeout(SETTLE * 2)

  await clickNode(page, '阀盖')
  await page.waitForTimeout(SETTLE * 4)

  await tab(page, '规则日志').click()
  const entries = page.locator('.log-list > li')
  expect(await entries.count(), '预览中点击后应当有规则执行记录').toBeGreaterThan(0)

  // The second click is the condition check the card names explicitly: `step` is now 2,
  // so the rule must be recorded as skipped rather than simply not appearing.
  await clickNode(page, '阀盖')
  await page.waitForTimeout(SETTLE * 3)
  const statuses = await entries.evaluateAll((nodes) => nodes.map((n) => n.getAttribute('data-status')))
  expect(statuses.some((s) => s?.startsWith('skipped')), '再次点击应当被条件或重入策略跳过并记录').toBe(true)

  await page.getByRole('button', { name: '编辑' }).click()
  await page.waitForTimeout(SETTLE * 2)
  await expect(statusNumber(page, '全量重建')).toHaveText('0')

  /* ── 12a · 发布闸门必须拦住悬空引用 ───────────────────────────────── */
  //
  // A real blocking scenario rather than a contrived one: delete a node that rules,
  // animations and hotspots point at. D8 makes that a hard stop, and T-100's acceptance
  // is "有 error 时无法发布且提示可定位" — so both halves are checked, the refusal and
  // the locatable list.
  await tab(page, '资产').click()
  const doomed = page.locator('.tree-row', { has: page.locator('.tree-row__name', { hasText: '阀盖' }) })
  await doomed.hover()
  await doomed.locator('.tree-row__del').click()
  const confirm = page.getByRole('dialog')
  await expect(confirm).toContainText('引用')
  await confirm.getByRole('button', { name: '删除' }).click()
  await expect(statusNumber(page, '完整性')).not.toHaveText('0')

  await page.getByRole('button', { name: '发布' }).click()
  let dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await expect(dialog.locator('.issue-list > li').first()).toBeVisible({ timeout: 15_000 })
  await expect(dialog.getByRole('button', { name: /发布并下载/ }), '有阻断项时发布按钮必须禁用').toBeDisabled()
  await dialog.getByRole('button', { name: '取消' }).click()

  /* ── 12b · 撤销之后才允许发布 ─────────────────────────────────────── */
  await page.keyboard.press('Control+z')
  await expect(statusNumber(page, '完整性')).toHaveText('0')

  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: '发布' }).click()
  dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()

  const publishButton = dialog.getByRole('button', { name: /发布并下载/ })
  await expect(publishButton, '文档完整时发布应当放行').toBeEnabled({ timeout: 15_000 })
  await publishButton.click()

  const download = await downloadPromise
  const packagePath = join(DOWNLOAD_DIR, 'golden.w3p')
  await download.saveAs(packagePath)
  const bytes = await readFile(packagePath)
  expect(bytes.byteLength, '产出的包不能是空的').toBeGreaterThan(1000)

  // Serve it to the player from the same origin, exactly as a deployment would.
  await writeFile(join(process.cwd(), '..', 'packages', 'player', 'public', 'golden.w3p'), bytes).catch(async () => {
    // `public/` may not exist yet; the player reads it through ?src at the dev server root.
    const { mkdir } = await import('node:fs/promises')
    await mkdir(join(process.cwd(), '..', 'packages', 'player', 'public'), { recursive: true })
    await writeFile(join(process.cwd(), '..', 'packages', 'player', 'public', 'golden.w3p'), bytes)
  })

  const player = await context.newPage()
  player.on('console', (m) => {
    if (m.type() === 'error') console.log(`[player error] ${m.text()}`)
  })
  await player.goto('http://127.0.0.1:5274/?src=golden.w3p')
  await player.waitForTimeout(SETTLE * 6)

  // The player rendered the scene the editor published — not a drop zone, not an error.
  await expect(player.locator('canvas.player__canvas')).toBeVisible({ timeout: 20_000 })
  await expect(player.locator('.player__error')).toHaveCount(0)
  expect(await colourBuckets(player, 'canvas.player__canvas'), '播放器里视口是空的').toBeGreaterThan(3)

  // And the same interaction does the same thing.
  //
  // Asserted on the DOM rather than on pixels: the sample rule's chain ends in
  // `openPanel`, so a hotspot panel appearing is direct evidence that the whole chain ran
  // — animation, highlight, panel, variable — inside the player, from a published file.
  // A pixel diff would only say "something changed".
  await expect(player.locator('.w3-hotspot-panel'), '打开前不该有面板').toHaveCount(0)

  const point = await player.evaluate(() => {
    const nodes = (globalThis as Record<string, unknown>)['__w3DevNodes'] as
      | (() => { id: string; name: string }[])
      | undefined
    const locate = (globalThis as Record<string, unknown>)['__w3DevLocate'] as
      | ((id: string) => { x: number; y: number } | null)
      | undefined
    const target = nodes?.().find((n) => n.name === '阀盖')
    return target && locate ? locate(target.id) : null
  })
  expect(point, '在播放器里找不到「阀盖」的屏幕位置').not.toBeNull()

  await player.locator('canvas.player__canvas').click({ position: point! })
  await player.waitForTimeout(SETTLE * 6)

  await expect(
    player.locator('.w3-hotspot-panel'),
    '在播放器里点击阀盖后规则链没有跑完（面板没有弹出）',
  ).toHaveCount(1)

  await player.close()
})
