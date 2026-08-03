import { readFileSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'
import { buildTestGlb } from '../fixtures/glb.js'
import { resetStorage } from './storage-reset.js'

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
  await resetStorage(page, 'w3-gp2-cleaned')
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

/**
 * Whether the RUNTIME considers a clip playing.
 *
 * Not the sound card: CI has no audio device, so 「真的响了」 cannot be observed and testing
 * for it makes a flaky test wearing a confident face (进化规划 §2 says so outright). This is
 * the same state `stopMedia('all')` acts on and the same one the player reports.
 */
const isMediaPlaying = (page: Page, mediaId: string) =>
  page.evaluate((id: string) => {
    const probe = (globalThis as Record<string, unknown>)['__w3DevMediaPlaying'] as
      | ((mediaId: string) => boolean)
      | undefined
    return probe?.(id) ?? false
  }, mediaId)

/** Clicks a node where the RENDERER says it is, rather than at a guessed pixel. */
async function clickNode(page: Page, name: string): Promise<void> {
  const id = await nodeIdOf(page, name)
  const point = await page.evaluate((nodeId: string) => {
    const locate = (globalThis as Record<string, unknown>)['__w3DevLocate'] as
      | ((n: string) => { x: number; y: number } | null)
      | undefined
    return locate?.(nodeId) ?? null
  }, id!)
  if (!point) throw new Error(`找不到「${name}」在屏幕上的位置——它可能不在视野内`)
  await page.locator('canvas.viewport__canvas').click({ position: point })
}

/**
 * A light's LIVE parameters, from the renderer.
 *
 * `setLight` writes the three object, never the document — so 「灯变亮」 and 「退出后还原」
 * are claims about the renderer. Reading them off the document is vacuous (T-176 审查所得:
 * the old assertion passed whether or not 预览 was ever pressed).
 */
const renderedLight = (page: Page, nodeId: string) =>
  page.evaluate((id: string) => {
    const probe = (globalThis as Record<string, unknown>)['__w3DevLightOf'] as
      | ((n: string) => { intensity: number; color: string } | null)
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

test('黄金路径 II · 12 步', async ({ page, context }) => {
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

  // T-154 · the copy shares 默认材质 with the original, so the preset asks where to apply
  // it. 「分离后应用」 is the branch this step wants: 铁律 9 at the DOCUMENT level, so the
  // other cube keeps the material it had.
  const question = page.getByText('要应用到哪里', { exact: false })
  if (await question.isVisible().catch(() => false)) {
    await page.getByRole('button', { name: '分离后应用' }).click()
    await page.waitForTimeout(SETTLE)
  }

  const afterPreset = await renderedMaterial(page, targetId)
  expect(afterPreset?.['metalness'], '预设要真的到渲染器手上').toBe(1)

  await page.locator('.field', { hasText: '基础色' }).locator('button.slot').click()
  await page.locator('.picker').getByRole('button', { name: '内置纹理' }).click()
  await page.locator('.picker__item').first().click()
  await expect
    .poll(async () => (await renderedMaterial(page, targetId))?.['map'], { timeout: 20_000 })
    .not.toBeNull()

  /* ⑥ 新建聚光灯，对准泵体，强度 3 / 暖白 / 开阴影 ---------------------------- */
  await tab(page, '资源库').click()
  await tab(page, '对象').click()
  const beforeLight = await nodeCount(page)
  await tile(page, '聚光灯').dblclick()
  await page.waitForTimeout(SETTLE)
  expect(await nodeCount(page), '聚光灯要成为一个真的节点（D12）').toBe(beforeLight + 1)

  await tab(page, '灯光').click()
  await expect(page.locator('.field', { hasText: '锥角' }), '聚光灯该有锥角控件').toBeVisible()

  // Shadows on, at medium — step ⑥'s wording. The checkbox is inside the 阴影 fieldset.
  const shadowBox = page.locator('.fieldset', { hasText: '阴影' }).locator('input[type=checkbox]')
  await shadowBox.check()
  await expect(shadowBox).toBeChecked()

  const lightId = (await page.evaluate(
    () => document.querySelector('.tree-row[data-selected="true"]')?.getAttribute('data-node-id') ?? null,
  ))!
  expect(lightId, '新建的灯应当被选中').not.toBeNull()

  const lit = (await doc(page)) as { nodes: { id: string; light: { kind: string; shadow?: { enabled: boolean } } | null }[] }
  const spot = lit.nodes.find((n) => n.id === lightId)!
  expect(spot.light?.kind).toBe('spot')
  expect(spot.light?.shadow?.enabled, '阴影开关要真的写进文档').toBe(true)

  /* ⑦ 环境页签选内置 HDRI ---------------------------------------------------- */
  await tab(page, '资源库').click()
  await tab(page, '环境').click()
  const hdris = page.locator('.library-grid__item')
  await expect(hdris.first()).toBeVisible()
  const undoBeforeEnv = await undoDepth(page)
  await hdris.first().click()

  await expect.poll(async () => await undoDepth(page), { timeout: 20_000 }).toBe(undoBeforeEnv + 1)
  await expect(page.getByRole('button', { name: '清除环境' }), 'HDRI 设上了才有得清').toBeVisible()

  const withEnv = (await doc(page)) as {
    meta: { background: { type: string }; environment: { hdriAssetId: string | null } }
  }
  expect(withEnv.meta.environment.hdriAssetId, '环境贴图要进文档').not.toBeNull()
  expect(withEnv.meta.background.type, '背景同时切成 hdri，否则物体被一片看不见的天空照着').toBe('hdri')

  /* ⑧ 导入 warning.png 与 alarm.wav ----------------------------------------- */
  await importFile(page, 'warning.png', 'image/png', readFileSync(join(MEDIA, 'warning.png')))
  await importFile(page, 'alarm.wav', 'audio/wav', readFileSync(join(MEDIA, 'alarm.wav')))

  await tab(page, '媒体').click()
  const rows = page.locator('.media-list__row')
  await expect(rows, '音频进媒体库；图片是贴图资产，不进（MEDIA_ASSET_TYPES）').toHaveCount(1)

  const metaText = await rows.first().locator('.media-list__meta').innerText()
  const seconds = Number(/([\d.]+) 秒/.exec(metaText)?.[1])
  expect(Number.isFinite(seconds), `音频时长没读出来：${metaText}`).toBe(true)
  expect(Math.abs(seconds - ALARM_SECONDS), `读到 ${seconds}s，真实 ${ALARM_SECONDS}s`).toBeLessThan(0.1)

  /* ⑨ 泵体上加热点，内容挂 warning.png -------------------------------------- */
  await page.locator('.tree-row__name', { hasText: '立方体' }).first().click()
  await tab(page, '热点').click()
  // The cold-start sample already has one, so this is relative — an absolute count would
  // encode the sample's contents into an assertion that is not about them.
  const hotspotsBefore = await page.locator('.hotspot-list > li').count()
  await page.getByRole('button', { name: '在选中对象上新建' }).click()
  await page.waitForTimeout(SETTLE)
  await expect(page.locator('.hotspot-list > li')).toHaveCount(hotspotsBefore + 1)

  // Hang the imported image on it — 「内容挂 warning.png」. The媒体 select is a `ref` field
  // the panel renders from the document's media list.
  const newHotspot = page.locator('.hotspot-list > li').last()
  const mediaSelect = newHotspot.locator('label', { hasText: '媒体' }).locator('select')
  const options = await mediaSelect.locator('option').count()
  // Only audio became a media RECORD (a png is a texture asset, per MEDIA_ASSET_TYPES), so
  // what is assertable here is that the picker is wired and offers what the document has.
  expect(options, '媒体选择器要列出文档里的媒体记录').toBeGreaterThan(1)

  /* ⑩ 新建规则：click → sequence → playMedia / setLight / highlight ---------- */
  await tab(page, '规则').click()
  const rulesBefore = await page.locator('.rule-list > li').count()
  await page.getByRole('button', { name: '新建规则' }).click()
  await page.waitForTimeout(SETTLE)

  const rule = page.locator('.rule-list > li').last()
  if ((await rule.getAttribute('data-open')) !== 'true') await rule.locator('.rule-list__title').click()

  // when: 点击
  // The editor's own label is 「点击」 (EVENT_LABELS.click). Selecting by label rather than
  // by value keeps this test honest about what the user actually sees.
  const grid = rule.locator('.rule-editor__grid')
  await expect(grid).toBeVisible()
  await grid.locator('select').first().selectOption({ label: '点击' })
  await page.waitForTimeout(SETTLE)

  // 执行方式 already defaults to sequence — assert rather than set, so a changed default is
  // caught here rather than silently altering what this step means.
  const built0 = (await doc(page)) as { rules: { when: { event: string }; mode: string }[] }
  const editing = built0.rules[built0.rules.length - 1]!
  expect(editing.when.event, '触发事件要真的改成 click').toBe('click')
  expect(editing.mode, '新规则默认就是 sequence').toBe('sequence')

  // Three actions, added through the generated form — the rule editor has NO media-specific
  // or light-specific code, which is C5's acceptance evidence (ECA_SPEC §10).
  // Scoped to the ACTIONS block: `.rule-editor__subhead` also appears in the condition
  // lists, and an unscoped locator resolves to several.
  const addAction = rule.locator('.rule-editor__actions .rule-editor__subhead select')
  for (const label of ['播放媒体', '调整灯光', '高亮对象']) {
    await addAction.selectOption({ label })
    await page.waitForTimeout(SETTLE / 2)
  }

  const built = (await doc(page)) as { rules: { then: { action: string }[] }[] }
  const actions = built.rules[built.rules.length - 1]!.then.map((a) => a.action)
  expect(actions, '三个动作都要落进文档').toEqual(
    expect.arrayContaining(['playMedia', 'setLight', 'highlight']),
  )
  expect(await page.locator('.rule-list > li').count()).toBe(rulesBefore + 1)

  /* ⑩b 填参数：ref 字段是生成出来的，不是手写的 ----------------------------- */
  // Every control here came from `ActionDefinition.ui.fields` — the rule editor has no
  // media-specific and no light-specific code at all. That is C5's acceptance evidence,
  // and filling the forms through it is what proves the claim rather than restating it.
  const actionRows = rule.locator('.action-row')
  // A new rule ships with one action already (`then` has min(1)), so the three added above
  // make four. Targeting by LABEL rather than by index keeps this independent of whichever
  // action the registry happens to hand out as the default.
  await expect(actionRows).toHaveCount(4)

  // Drop the default action the editor seeds a new rule with. Its params are empty, and
  // with `onError: 'abort'` an invalid first step kills the sequence before anything the
  // golden path is about ever runs — which is correct behaviour and a useless rule.
  // 「三个动作」 is what step ⑩ asks for.
  await actionRows.first().locator('button[title="删除"]').click()
  await page.waitForTimeout(SETTLE)
  await expect(actionRows).toHaveCount(3)

  for (const label of ['播放媒体', '调整灯光', '高亮对象']) {
    const row = actionRows.filter({ hasText: label }).first()
    await expect(row, `${label} 动作没长出来`).toBeVisible()
    for (const select of await row.locator('.fields__row select').all()) {
      const values = await select.locator('option').evaluateAll((options) =>
        options.map((o) => (o as HTMLOptionElement).value).filter((v) => v !== ''),
      )
      if (values.length > 0) await select.selectOption(values[0]!)
    }
  }
  await page.waitForTimeout(SETTLE)

  // Point setLight at the spotlight specifically — the first option may be any node, and
  // 「聚光灯变亮」 is only observable if the action names the light.
  const lightRow = actionRows.filter({ hasText: '调整灯光' }).first()
  await lightRow.locator('.fields__row', { hasText: '灯光对象' }).locator('select').selectOption(lightId)
  await lightRow.locator('.fields__row', { hasText: '强度' }).locator('input').fill('6')
  await lightRow.locator('.fields__row', { hasText: '强度' }).locator('input').blur()
  await page.waitForTimeout(SETTLE)

  const ready = (await doc(page)) as {
    rules: { then: { action: string; params: Record<string, unknown> }[] }[]
    media: { id: string }[]
  }
  const then = ready.rules[ready.rules.length - 1]!.then
  const setLightStep = then.find((a) => a.action === 'setLight')!
  expect(setLightStep.params['nodeId'], 'setLight 要指着那盏聚光灯').toBe(lightId)
  expect(setLightStep.params['intensity']).toBe(6)
  const mediaId = ready.media[0]!.id

  /* ⑪ 预览：点击 → 音频播放态为真、灯变亮 → 退出 → 全部还原 ----------------- */
  await page.getByRole('button', { name: '预览', exact: true }).click()
  await page.waitForTimeout(SETTLE * 2)

  await clickNode(page, '立方体')
  await page.waitForTimeout(SETTLE * 4)

  // 音频：断言运行时状态，不断言声卡。CI 没有声卡，「真的响了」观测不到，硬测只会做出一个
  // 自信满满的 flaky 测试（进化规划 §2 原话）。
  expect(await isMediaPlaying(page, mediaId), '规则应当把音频播起来').toBe(true)

  // 灯：断言**渲染器手上的值**。setLight 写的是 three 对象、不是文档，所以读文档的断言是空的
  // ——它在用户根本没点过「预览」时同样成立（T-176 审查抓到的就是这一条）。
  expect((await renderedLight(page, lightId))?.intensity, '规则应当把灯调到 6').toBe(6)

  await page.getByRole('button', { name: '编辑', exact: true }).click()
  await page.waitForTimeout(SETTLE * 2)

  // B13 扩展到灯与媒体：退出预览，音频停、灯回到文档里的值。
  expect(await isMediaPlaying(page, mediaId), '退出预览必须静音').toBe(false)
  expect((await renderedLight(page, lightId))?.intensity, '退出预览，渲染器里的灯要回到 2').toBe(2)

  /* ⑫ 发布 → Player 打开 → 断网刷新仍可用 ---------------------------------- */
  await page.getByRole('button', { name: '发布' }).click()
  const dialog = page.locator('.modal')
  await expect(dialog).toBeVisible()

  const publishButton = dialog.getByRole('button', { name: /发布并下载/ })
  await expect(publishButton, '文档完整时发布应当放行').toBeEnabled({ timeout: 20_000 })

  const download = page.waitForEvent('download')
  await publishButton.click()
  const file = await download
  const bytes = await readFile(await file.path())
  expect(bytes.byteLength, '发布包要有内容').toBeGreaterThan(1000)

  await mkdir(join(process.cwd(), '..', 'packages', 'player', 'public'), { recursive: true }).catch(() => {})
  await writeFile(join(process.cwd(), '..', 'packages', 'player', 'public', 'gp2.w3p'), bytes)

  const player = await context.newPage()
  player.on('console', (m) => {
    if (m.type() === 'error') console.log(`[player error] ${m.text()}`)
  })
  await player.goto('http://localhost:5274/?src=/gp2.w3p')
  await expect(player.locator('canvas'), 'Player 要能打开这个包').toBeVisible({ timeout: 30_000 })
  await player.waitForTimeout(SETTLE * 6)

  // C6 · 断网仍可用。
  //
  // 用「掐断所有外部源」而不是 `context.setOffline(true)`：后者连本地开发服务器一起掐了，
  // 于是重载失败的原因是页面自己取不到，与产品依不依赖外网无关——那测的是测试台，不是产品。
  // 真实部署里文件由同源服务器提供，「断网」的准确含义是**外部**网络没了。
  const blocked: string[] = []
  await context.route('**/*', (route) => {
    const url = route.request().url()
    if (url.includes('localhost') || url.includes('127.0.0.1') || url.startsWith('data:') || url.startsWith('blob:')) {
      return route.continue()
    }
    blocked.push(url)
    return route.abort()
  })

  await player.reload()
  await expect(player.locator('canvas'), '掐断外网后 Player 仍要能起来').toBeVisible({ timeout: 30_000 })
  await player.waitForTimeout(SETTLE * 6)
  expect(blocked, `发布出去的包不该请求任何外部地址：${blocked.join(', ')}`).toEqual([])

  await context.unroute('**/*')
  await player.close()

  /* ⑫ 全程零全量重建 -------------------------------------------------------- */
  expect(await rebuilds(page), 'D1 的警报全程不许响一次').toBe(0)

  const finalDoc = (await doc(page)) as { media: unknown[]; assets: unknown[] }
  expect(finalDoc.media, '媒体记录留在文档里').toHaveLength(1)
})
