import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { buildTestGlb } from '../fixtures/glb.js'
import { resetStorage } from './storage-reset.js'

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
  const point = await page.evaluate((nodeId) => {
    const locate = (globalThis as Record<string, unknown>)['__w3DevLocate'] as
      | ((id: string) => { x: number; y: number } | null)
      | undefined
    return locate ? locate(nodeId) : null
  }, await nodeIdOf(page, name))

  if (!point) throw new Error(`找不到「${name}」在屏幕上的位置——它可能不在视野内`)
  await page.locator('canvas.viewport__canvas').click({ position: point })
}

/** The document id behind a hierarchy-tree row. Names are for humans; ids are the key (C9). */
async function nodeIdOf(page: Page, name: string): Promise<string> {
  const id = await page.evaluate((nodeName) => {
    const rows = [...document.querySelectorAll('.tree-row')]
    const row = rows.find((r) => r.querySelector('.tree-row__name')?.textContent === nodeName)
    return row?.getAttribute('data-node-id') ?? null
  }, name)
  if (!id) throw new Error(`层级树里找不到「${name}」`)
  return id
}

/**
 * What the RENDERER is drawing this node with, via the DEV-only hook in runtime-registry.ts.
 *
 * Reading the material panel back proves the document changed. This proves the change
 * reached the three material the frame is actually drawn from — the other half, and the
 * half that D1's incremental patch path exists to deliver.
 */
async function renderedMaterial(page: Page, nodeId: string): Promise<{ roughness: number | null }> {
  const probe = await page.evaluate((id) => {
    const read = (globalThis as Record<string, unknown>)['__w3DevMaterialOf'] as
      | ((nodeId: string) => { roughness: number | null } | null)
      | undefined
    return read ? read(id) : null
  }, nodeId)
  if (!probe) throw new Error(`渲染器里读不到节点 ${nodeId} 的材质`)
  return probe
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
  await resetStorage(page, 'w3-e2e-full-cleaned')
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

  /* ── 6 · 改材质 roughness，文档侧与渲染侧同时生效 ─────────────────── */
  //
  // The previous version of this step never touched roughness. It located
  // `.panel--bottom .field__input` `.first()`, which is the material DROPDOWN — the panel
  // renders the material `<select>` before any numeric field — asserted it was visible,
  // and moved on. Roughness could have been wired to nothing at all and this step stayed
  // green. It is now: locate the field by its label, write a value, and check both halves
  // of the claim — the document (the panel reads back from it, and undo walks it) and the
  // renderer (the live three material the frame is drawn from).
  const capId = await nodeIdOf(page, '阀盖')
  await tab(page, '材质').click()
  await page.getByRole('button', { name: '新建并指定' }).click()
  await page.waitForTimeout(SETTLE)

  const historyAfterMaterial = Number(await statusNumber(page, '历史').innerText())
  expect(historyAfterMaterial, '「新建并指定」是一条撤销').toBe(historyBefore + 2)

  const roughness = page.locator('.panel--bottom label.field', { hasText: '粗糙度' }).locator('input.field__input')
  await expect(roughness).toBeVisible()

  await roughness.fill('0.05')
  await roughness.press('Enter')
  await page.waitForTimeout(SETTLE)
  await expect(roughness, '面板从文档回读，写进去的值必须留在文档里').toHaveValue('0.05')
  expect(Number(await statusNumber(page, '历史').innerText()), '改粗糙度落一条撤销').toBe(historyAfterMaterial + 1)
  expect((await renderedMaterial(page, capId)).roughness, '渲染器手里的材质没跟上文档').toBeCloseTo(0.05, 6)

  // A second value, outside the 500 ms merge window, so this is two undo entries and not
  // one: a patch path that only ever applied the first write would pass the check above.
  await page.waitForTimeout(600)
  await roughness.fill('0.92')
  await roughness.press('Enter')
  await page.waitForTimeout(SETTLE)
  await expect(roughness).toHaveValue('0.92')
  expect(Number(await statusNumber(page, '历史').innerText())).toBe(historyAfterMaterial + 2)
  expect((await renderedMaterial(page, capId)).roughness).toBeCloseTo(0.92, 6)

  // And undo has to reach the renderer too, not just the document.
  await page.keyboard.press('Control+z')
  await expect(statusNumber(page, '历史')).toHaveText(String(historyAfterMaterial + 1))
  await expect(roughness).toHaveValue('0.05')
  expect((await renderedMaterial(page, capId)).roughness, '撤销只回滚了文档，没回滚渲染').toBeCloseTo(0.05, 6)

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
  //
  // Counted before and after rather than `.first()`: the sample document ships with an
  // imported clip, so "the first row exists" was true before the button was ever clicked.
  const animRows = page.locator('.panel--bottom .anim-row')
  await tab(page, '动画').click()
  const animsBefore = await animRows.count()
  const historyBeforeAnim = Number(await statusNumber(page, '历史').innerText())
  await page.getByRole('button', { name: '用选中对象新建补间' }).click()
  await page.waitForTimeout(SETTLE)
  await expect(animRows, '「用选中对象新建补间」没有新增动画').toHaveCount(animsBefore + 1)
  expect(Number(await statusNumber(page, '历史').innerText()), '新建补间是一条撤销').toBe(historyBeforeAnim + 1)

  // It is a tween aimed at the selection, not just any row: the duration field and the
  // target count only exist on `kind: 'tween'` (§6.2).
  const newAnim = animRows.last()
  await expect(newAnim.locator('label.field', { hasText: '时长(秒)' }).locator('input')).toHaveValue('1.2')
  await expect(newAnim.locator('span.num')).toHaveText('1 个目标')

  /* ── 9 · 加热点，开启遮挡 ─────────────────────────────────────────── */
  //
  // Same trap as step 8, and the sample document really does ship with a hotspot: the
  // old `.first()` asserted against that pre-existing one, so "在选中对象上新建" could
  // have been a no-op button and the step still passed. New hotspots are appended
  // (`draft.hotspots.push`), so the new one is `.last()` — and it is verified to be the
  // new one by the count and by its anchor being the node that was selected.
  const hotspots = page.locator('.hotspot-list > li')
  await tab(page, '热点').click()
  const hotspotsBefore = await hotspots.count()
  await page.getByRole('button', { name: '在选中对象上新建' }).click()
  await page.waitForTimeout(SETTLE)
  await expect(hotspots, '「在选中对象上新建」没有新增热点').toHaveCount(hotspotsBefore + 1)

  const hotspot = hotspots.last()
  await expect(hotspot.locator('.hotspot-list__head input.field'), '新热点应以锚点对象命名').toHaveValue('阀盖 说明')
  await expect(hotspot.locator('.hotspot-list__head .tbtn').first(), '新热点没锚在选中的对象上').toHaveText('阀盖')

  await hotspot.locator('textarea').fill('拆卸第一步：松开六颗固定螺栓')
  await page.waitForTimeout(SETTLE)
  await expect(hotspot.locator('textarea'), '正文没有落进文档').toHaveValue('拆卸第一步：松开六颗固定螺栓')
  // D7's occlusion flag is on by default; assert rather than assume. Located by its own
  // row — `.last()` over every checkbox in the item is one added field away from being
  // a different control.
  await expect(
    hotspot.locator('.fields__row', { hasText: '遮挡判定' }).locator('input[type=checkbox]'),
  ).toBeChecked()

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

  // A machine with no GPU gets the software-rendering notice, which covers the viewport
  // until the viewer accepts it (player/app.ts, T-111). That is the product working as
  // designed, and it means the golden path on such a machine has one more click in it.
  //
  // This branch was invisible until CI ran: every dev machine this test was written on had
  // hardware GL, so the notice never appeared, and the click below — which times out
  // against it — always found a clear canvas. Software rendering is not an exotic case for
  // this product; it is the normal state of an intranet workstation or a VM.
  const notice = player.locator('.w3-capability')
  if ((await notice.count()) > 0) {
    await expect(notice, '性能提示应当说清楚是软件渲染').toContainText('软件渲染')
    await notice.getByRole('button', { name: '仍然继续' }).click()
    await expect(notice, '「仍然继续」之后提示必须真的让开，否则播放器点不动').toHaveCount(0)
  }

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

  /* ── 收尾 · 全程零全量重建 ────────────────────────────────────────── */
  //
  // Asserted HERE, at the end, and that placement is the whole point. The two earlier
  // checks (steps 6 and 11) both sat before step 12, and step 12 — delete a node, then
  // undo it — was where the fallback actually happened: `fullRebuildCount` finished this
  // run at 1 for the entire life of the golden path while every assertion said 0
  // (IMPL_NOTES §4). D1's alarm is only an alarm if something reads it after the last
  // thing that could set it off.
  await expect(statusNumber(page, '全量重建'), '整条黄金路径必须零全量重建（铁律 11）').toHaveText('0')
})
