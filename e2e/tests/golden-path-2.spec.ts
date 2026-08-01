import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'
import { buildTestGlb } from '../fixtures/glb.js'

/**
 * 黄金路径 II · 进化规划 §2 · the definition of v0.5.
 *
 * Twelve steps, covered in order, in one browser session — the point is the PATH, and a
 * scene assembled step by step is the only thing that catches a step which works alone and
 * breaks what came before it.
 *
 * ── What this file refuses to assert ─────────────────────────────────────────
 *
 * **The sound card.** CI has no audio device, so 「真的响了」 cannot be observed and any
 * attempt at it is a flaky test wearing a confident face (进化规划 §2 says so outright).
 * Step 11 asserts the RUNTIME's playing state instead — the same state `stopMedia('all')`
 * acts on and the same one the player reports.
 *
 * ── What it insists on asserting ─────────────────────────────────────────────
 *
 * The renderer, not the document. M11's review found a texture that the panel, the document
 * and a green E2E all agreed was applied, and which never reached the GPU. So the material
 * steps read back through `__w3DevMaterialOf`, which reports what three is actually holding.
 *
 * And `全量重建 = 0` throughout: D1's alarm going off is how 「它什么时候变慢的」 starts.
 *
 * ── ⚠ 这份文件目前覆盖 8/12 步，T-170 因此**未完成** ─────────────────────────
 *
 * 缺的是第 ⑥、⑨、⑩、⑪ 步，全部卡在同一件事上：**编辑器里没有任何创建灯光的入口**。
 * T-130 ~ T-136 在 core 里把灯光栈整个建完了（五种灯、阴影、IBL、默认灯架退场、
 * `setLight` 动作、helper 与拾取），而**没有一张卡负责"用户怎么新建一盏灯"**——台账从
 * T-136 直接跳到 T-140。`createLightNode` 在 schema 里躺着，全仓没有一个调用者。
 *
 * 于是第 ⑥ 步「新建聚光灯节点」做不出来，依赖它的第 ⑩ ⑪ 步（规则里 `setLight` 那盏灯、
 * 预览后灯回到强度 3）也做不出来。第 ⑨ 步的热点媒体内容 core 侧已完成（T-162），
 * 但把它编进这条连续剧本要等 ⑥ 通了才有意义。
 *
 * 补票卡：**T-137 · 灯光创建与灯光面板**。在它完成之前，这份文件覆盖的 8 步是真的，
 * 剩下 4 步是**明确缺口**而不是"以后再说"。
 */

const SETTLE = 400
const MEDIA = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'media')

/** Exactly what `gen-media-fixtures.mjs` wrote. Duration is samples / sampleRate. */
const ALARM_SECONDS = 1.5

test.describe.configure({ mode: 'serial' })

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (sessionStorage.getItem('w3-gp2-cleaned')) return
    sessionStorage.setItem('w3-gp2-cleaned', '1')
    void indexedDB.deleteDatabase('w3-editor')
  })
  page.on('console', (message) => {
    if (message.type() === 'error') console.log(`[browser error] ${message.text()}`)
  })
})

/* -------------------------------------------------------------------------- */
/* Readers                                                                     */
/* -------------------------------------------------------------------------- */

const statusNumber = (page: Page, label: string) =>
  page.locator('.statusbar span', { hasText: label }).locator('b').first()

const rebuilds = async (page: Page) => Number(await statusNumber(page, '全量重建').innerText())
const nodeCount = async (page: Page) => await page.locator('.tree-row__name').count()
const undoDepth = async (page: Page) => Number(await statusNumber(page, '历史').innerText())

/** The id of the node whose row carries this name. */
const nodeIdOf = (page: Page, name: string) =>
  page.evaluate((text: string) => {
    const row = [...document.querySelectorAll('.tree-row')].find((r) => r.textContent?.includes(text))
    return row?.getAttribute('data-node-id') ?? null
  }, name)

/** What the RENDERER holds for a node — not what the document says (M11's lesson). */
const renderedMaterial = (page: Page, nodeId: string) =>
  page.evaluate((id: string) => {
    const probe = (globalThis as Record<string, unknown>)['__w3DevMaterialOf'] as
      | ((nodeId: string) => Record<string, unknown> | null)
      | undefined
    return probe?.(id) ?? null
  }, nodeId)

/** The document, straight out of the store, for assertions the DOM cannot make. */
const doc = (page: Page) =>
  page.evaluate(() => {
    const store = (globalThis as Record<string, unknown>)['__w3DevDoc'] as (() => unknown) | undefined
    return store?.() ?? null
  })

const tab = (page: Page, label: string) => page.getByRole('button', { name: label, exact: true })
const tile = (page: Page, label: string): Locator =>
  page.locator('.library-grid__item', { hasText: label }).first()

async function importFile(page: Page, name: string, mimeType: string, bytes: Buffer) {
  await tab(page, '资产').click()
  await page.locator('input[type=file]').setInputFiles({ name, mimeType, buffer: bytes })
  await expect(page.locator('.report')).toBeVisible({ timeout: 20_000 })
  await page.getByRole('button', { name: '确认导入' }).click()
  await page.waitForTimeout(SETTLE)
}

/* -------------------------------------------------------------------------- */
/* The path                                                                    */
/* -------------------------------------------------------------------------- */

// `fixme` rather than `skip`: this is not a test somebody chose to turn off, it is one that
// is NOT FINISHED. ①–④ pass today (drag-place onto empty ground, import, Ctrl+D, one undo
// entry each); ⑤ still has to answer T-154's 「分离后应用 / 应用到全部」 dialog, and ⑥⑨⑩⑪
// cannot be written at all until a light can be created. Leaving it running and red would
// make `pnpm test:e2e` a thing people learn to ignore, which costs more than the missing
// coverage does.
test.fixme('黄金路径 II · 未完成（⑤ 待补共享材质二选一；⑥⑨⑩⑪ 缺灯光创建入口，见 T-137）', async ({ page }) => {
  test.setTimeout(180_000)

  /* ① 新建项目，资源库三个页签都在 ------------------------------------------ */
  await page.goto('/')
  await expect(page.locator('canvas.viewport__canvas')).toBeVisible()
  await page.waitForTimeout(SETTLE * 3)
  await tab(page, '资源库').click()

  for (const name of ['对象', '纹理', '环境']) {
    await expect(tab(page, name), `资源库缺少「${name}」页签`).toBeVisible()
  }

  /* ② 拖立方体到视口 → 落在地面 → 改尺寸 ------------------------------------ */
  const before = await nodeCount(page)
  await tile(page, '立方体').dragTo(page.locator('canvas.viewport__canvas'), {
    // A corner, deliberately: the sample pump sits in the middle of a cold-started scene,
    // and dropping onto IT is a different branch of D18 (rest on the surface you hit).
    // 「视口空白处 → 落在地面」 is the branch this step is about.
    targetPosition: { x: 90, y: 380 },
  })
  await page.waitForTimeout(SETTLE)
  expect(await nodeCount(page), '拖出来的立方体要真的进场景').toBe(before + 1)

  const standId = (await nodeIdOf(page, '立方体'))!
  expect(standId).not.toBeNull()

  // Bounding-box bottom on the ground: a 1 m cube centred on its origin sits at y = 0.5.
  const placed = (await doc(page)) as { nodes: { id: string; transform: { p: number[] } }[] }
  const stand = placed.nodes.find((n) => n.id === standId)!
  expect(stand.transform.p[1], '包围盒底面对齐地面，不是原点对齐').toBeCloseTo(0.5, 2)

  /* ③ 导入 pump.glb 并拖到展台上表面 ---------------------------------------- */
  // The golden path I fixture, imported the same way — this step is about PLACEMENT.
  const glb = await buildTestGlb({ colour: [0.6, 0.65, 0.7], size: 1, offsetX: 0 })
  await importFile(page, 'pump.glb', 'model/gltf-binary', Buffer.from(glb))
  expect(await nodeCount(page), '导入后视口里要多出对象').toBeGreaterThan(before + 1)

  /* ④ Ctrl+D 复制 + 网格吸附 ------------------------------------------------ */
  // Click the canvas first: after an import the focus can still be inside the file input,
  // and the shortcut layer deliberately ignores keys while a field has focus (T-071/T-144).
  await page.locator('canvas.viewport__canvas').click({ position: { x: 500, y: 400 } })
  await page.locator('.tree-row__name', { hasText: '立方体' }).first().click()
  await page.waitForTimeout(SETTLE)
  const undoBeforeCopy = await undoDepth(page)
  const countBeforeCopy = await nodeCount(page)

  await page.keyboard.press('Control+d')
  await page.waitForTimeout(SETTLE)

  expect(await nodeCount(page)).toBe(countBeforeCopy + 1)
  expect(await undoDepth(page), '复制在撤销栈里恰好一条').toBe(undoBeforeCopy + 1)

  /* ⑤ 材质预设 + 贴图 + uv --------------------------------------------------- */
  // The SELECTED node, which after Ctrl+D is the copy — that is what the material panel is
  // pointed at, and reading the original instead would assert against a node nobody touched.
  const targetId = (await page.evaluate(
    () => document.querySelector('.tree-row[data-selected="true"]')?.getAttribute('data-node-id') ?? null,
  ))!
  expect(targetId, 'Ctrl+D 之后副本应当被选中').not.toBeNull()

  await tab(page, '材质').click()
  await page.getByRole('button', { name: '拉丝金属', exact: true }).click()
  await page.waitForTimeout(SETTLE)

  const afterPreset = await renderedMaterial(page, targetId)
  expect(afterPreset?.['metalness'], '预设要真的到渲染器手上').toBe(1)

  await page.locator('.field', { hasText: '基础色' }).locator('button.slot').click()
  await page.locator('.picker').getByRole('button', { name: '内置纹理' }).click()
  await page.locator('.picker__item').first().click()
  await expect
    .poll(async () => (await renderedMaterial(page, targetId))?.['map'], { timeout: 20_000 })
    .not.toBeNull()

  /* ⑥ 新建聚光灯 —— 做不出来，见文件头 -------------------------------------- */
  // 编辑器里没有任何创建灯光的入口。这不是"这条断言先跳过"，是**功能缺口**，补票卡 T-137。

  /* ⑦ 环境页签选 HDRI --------------------------------------------------------- */
  await tab(page, '资源库').click()
  await tab(page, '环境').click()
  const hdris = page.locator('.library-grid__item')
  await expect(hdris.first()).toBeVisible()
  const undoBeforeEnv = await undoDepth(page)
  await hdris.first().click()

  await expect
    .poll(async () => await undoDepth(page), { timeout: 20_000 })
    .toBe(undoBeforeEnv + 1)
  await expect(page.getByRole('button', { name: '清除环境' }), 'HDRI 设上了才有得清').toBeVisible()

  const withEnv = (await doc(page)) as { meta: { background: { type: string }; environment: { hdriAssetId: string | null } } }
  expect(withEnv.meta.environment.hdriAssetId, '环境贴图要进文档').not.toBeNull()
  expect(withEnv.meta.background.type, '背景同时切成 hdri，否则物体被一片看不见的天空照着').toBe('hdri')

  /* ⑧ 导入 warning.png 与 alarm.wav ----------------------------------------- */
  await importFile(page, 'warning.png', 'image/png', readFileSync(join(MEDIA, 'warning.png')))
  await importFile(page, 'alarm.wav', 'audio/wav', readFileSync(join(MEDIA, 'alarm.wav')))

  await tab(page, '媒体').click()
  const rows = page.locator('.media-list__row')
  await expect(rows).toHaveCount(1)

  const meta = await rows.first().locator('.media-list__meta').innerText()
  const seconds = Number(/([\d.]+) 秒/.exec(meta)?.[1])
  expect(Number.isFinite(seconds), `音频时长没读出来：${meta}`).toBe(true)
  expect(Math.abs(seconds - ALARM_SECONDS), `读到 ${seconds}s，真实 ${ALARM_SECONDS}s`).toBeLessThan(0.1)

  /* ⑨⑩⑪ 热点媒体 / 规则 / 预览 —— 等 T-137，见文件头 ------------------------ */

  /* ⑫ 全程零全量重建 -------------------------------------------------------- */
  expect(await rebuilds(page), 'D1 的警报全程不许响一次').toBe(0)

  const finalDoc = (await doc(page)) as { media: unknown[]; assets: unknown[] }
  expect(finalDoc.media, '媒体记录留在文档里').toHaveLength(1)
})
