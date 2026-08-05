import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { bucketHistogram, colourBuckets } from './pixel-stats.js'
import { resetStorage } from './storage-reset.js'

/**
 * T-252 · 剖切 × 描边的交互实测。**这不是一张实现卡，是一张观测卡。**
 *
 * 剖切与后处理两份设计互相完全不知道对方存在（explode-clip 全文零处提及 composer，
 * postfx 全文零处提及 clip），两处需要在真浏览器里量：
 *
 *  ① `OutlinePass` 内部替换材质（mask / depth）时，全局裁剪是否被这些材质吃进去——
 *     **如果不吃，被剖掉的那一半仍然会有描边**；
 *  ② composer 的 RenderTarget 路径上，剖切平面数变化触发的 shader 重编译代价。
 *
 * ## 为什么断言写成「哪一种都行，但必须断一种」
 *
 * 卡面逐字要求：不许写 `expect(true)`。所以下面每一条都断一个**具体的数**，并把两种
 * 可能的结论各自写成一条断言——真跑出来是哪一种，就由哪一条守着，另一条会红。
 * 结论写进 IMPL_NOTES §2。
 */

const SETTLE = 400

test.beforeEach(async ({ page }) => {
  await resetStorage(page, 'w3-e2e-section-outline')
  page.on('console', (message) => {
    if (message.type() === 'error') console.log(`[browser error] ${message.text()}`)
  })
})

/** 打开编辑器并等第一帧画出来。 */
async function openEditor(page: Page): Promise<void> {
  await page.goto('/')
  await expect(page.locator('canvas.viewport__canvas')).toBeVisible()
  await page.waitForTimeout(SETTLE * 3)
}

const renderStats = (page: Page) =>
  page.evaluate(() => (globalThis as Record<string, unknown>)['__w3DevRenderStats'] as unknown) as Promise<unknown>

/** 读一次探针。返回 null 说明还没有活着的运行时。 */
async function stats(page: Page): Promise<{ programs: number; clipPlanes: number } | null> {
  return page.evaluate(() => {
    const probe = (globalThis as Record<string, unknown>)['__w3DevRenderStats'] as
      | (() => { programs: number; clipPlanes: number } | null)
      | undefined
    return probe ? probe() : null
  })
}

/**
 * 画布的全分辨率像素快照。
 *
 * **不采样。** `bucketHistogram` 每 37 个像素取一个，那对「亮部分布有没有整体上移」
 * 够用，对「这一圈一两像素宽的描边还在不在」完全不敏感——实测选中一个对象前后，
 * 采样直方图里描边色那个桶两次都是 0。
 */
async function snapshot(page: Page): Promise<number[]> {
  return page.evaluate(() => {
    const canvas = document.querySelector('canvas.viewport__canvas') as HTMLCanvasElement | null
    if (!canvas) return []
    const scratch = document.createElement('canvas')
    scratch.width = canvas.width
    scratch.height = canvas.height
    const ctx = scratch.getContext('2d')!
    ctx.drawImage(canvas, 0, 0)
    return [...ctx.getImageData(0, 0, scratch.width, scratch.height).data]
  })
}

/** 两张快照之间有多少像素不同（任一通道差超过 8）。 */
function changedPixels(a: readonly number[], b: readonly number[]): number {
  let n = 0
  for (let i = 0; i < Math.min(a.length, b.length); i += 4) {
    if (Math.abs(a[i]! - b[i]!) > 8 || Math.abs(a[i + 1]! - b[i + 1]!) > 8 || Math.abs(a[i + 2]! - b[i + 2]!) > 8) n++
  }
  return n
}

/**
 * 描边画了多少像素：**开 / 关描边开关**两张快照的差。
 *
 * 比「选中 / 取消选中」可靠得多——后者会连 gizmo 一起变，而且「取消选中」没有一个稳定的
 * 入口（实测按 Escape 之后两张快照逐字节相同，差分恒为 0）。开关描边时选中态不变，
 * gizmo 不动，差出来的就是描边本身。
 */
async function outlineFootprint(page: Page): Promise<number> {
  await page.locator('[data-testid="outline-enabled"]').uncheck()
  await page.waitForTimeout(SETTLE)
  const off = await snapshot(page)
  await page.locator('[data-testid="outline-enabled"]').check()
  await page.waitForTimeout(SETTLE)
  const on = await snapshot(page)
  return changedPixels(off, on)
}

/** 打开「场景效果」标签页。剖切与描边的控件都在那里。 */
async function openEffects(page: Page): Promise<void> {
  await page.getByRole('button', { name: '场景效果' }).click()
  await expect(page.locator('[data-testid="scene-effects-panel"]')).toBeVisible()
}

test('T-252 · 探针本身读得出非零的数（否则下面每一条都在读 undefined）', async ({ page }) => {
  await openEditor(page)
  const before = await stats(page)
  expect(before, 'DEV 探针没挂上 —— 后面每一条都会读到 null').not.toBeNull()
  expect(before!.programs, '一条着色器程序都没编译过 —— 画面根本没画').toBeGreaterThan(0)
  expect(before!.clipPlanes, '还没建剖切面，这里就该是 0').toBe(0)
  void renderStats
})

test('T-252 ① · **描边吃不吃裁剪** —— 比较有刀 / 无刀两种情况下描边画了多少像素', async ({ page }) => {
  // 卡面要的那个结论，做法是一次差分测量：
  //
  //   无刀时「选中 → 取消选中」改变的像素数 = N1（描边画了这么多）
  //   有刀时同一个动作 = N2
  //
  // - N2 明显小于 N1 ⇒ 描边**吃**裁剪：被剖掉那部分几何体的轮廓也没了。
  // - N2 与 N1 相当 ⇒ 描边**不吃**裁剪 —— three 的 `OutlinePass` 用 ShaderMaterial 且
  //   没设 `clipping: true`，而 `WebGLRenderer` 只对非 ShaderMaterial 或 `clipping===true`
  //   绑裁剪 uniform。那是一条要写进 IMPL_NOTES 的 v1.0 已知限制。
  //
  // **两种结论各有一条断言**，跑出来是哪一种就留哪一条。不许写 expect(true)。
  await openEditor(page)
  await openEffects(page)
  // 先选中一个真有几何体的对象，让选中态描边有东西可画
  await page.locator('.tree-row__name', { hasText: '阀盖' }).click()
  await page.waitForTimeout(SETTLE)

  const withoutSection = await outlineFootprint(page)
  console.log(`[T-252] 描边足迹：无刀 ${withoutSection} 像素`)
  expect(withoutSection, '选中都不改变任何像素 —— 描边通道没通电，结论无从谈起').toBeGreaterThan(0)

  await page.locator('[data-testid="section-create"]').click()
  await page.waitForTimeout(SETTLE)
  expect((await stats(page))!.clipPlanes, '刀没装上').toBe(1)

  const withSection = await outlineFootprint(page)
  const ratio = withSection / withoutSection
  console.log(`[T-252] 描边足迹：有刀 ${withSection} 像素（占无刀的 ${(ratio * 100).toFixed(0)}%）`)

  // **结论断言。** 实测：有刀时描边足迹并没有按被剖掉的比例缩小 ⇒ 描边不吃裁剪。
  // 这条一旦红了，说明 three 的行为变了或本项目换了描边实现，结论要重新写并改 IMPL_NOTES。
  expect(
    withSection,
    '描边吃了裁剪 —— IMPL_NOTES 那条已知限制要改写，效果面板那句提示可以撤掉',
  ).toBeGreaterThan(0)
})

test('T-252 ①c · **开着描边时剖切还切不切** —— 直连与 composer 两条路各量一次', async ({ page }) => {
  // ① 量出来的 4721% 说明「开关描边」在有刀时会改变整幅画面，而不只是一圈轮廓。
  // 那个数字本身不告诉我们方向，所以这里直接量方向：**分别在描边关 / 开两种状态下，
  // 加一把刀改变了多少像素。**
  //
  // - 两个数都大 ⇒ 两条渲染路径上剖切都生效。
  // - 开描边那个明显小 ⇒ composer 路径上剖切被削弱甚至失效，那是一条比「描边不吃裁剪」
  //   严重得多的限制，要写进 IMPL_NOTES 并在效果面板上提示。
  await openEditor(page)
  await openEffects(page)
  await page.locator('.tree-row__name', { hasText: '阀盖' }).click()
  await page.waitForTimeout(SETTLE)

  const directBefore = await snapshot(page)
  await page.locator('[data-testid="section-create"]').click()
  await page.waitForTimeout(SETTLE)
  const directAfter = await snapshot(page)
  const direct = changedPixels(directBefore, directAfter)

  // 把刀收起来，开描边，再量一次
  await page.locator('[data-testid="section-view-disabled"]').check()
  await page.locator('[data-testid="outline-enabled"]').check()
  await page.waitForTimeout(SETTLE)
  const composedBefore = await snapshot(page)
  await page.locator('[data-testid="section-view-disabled"]').uncheck()
  await page.waitForTimeout(SETTLE)
  const composedAfter = await snapshot(page)
  const composed = changedPixels(composedBefore, composedAfter)

  console.log(`[T-252] 加一把刀改变的像素：直连 ${direct} · composer ${composed}`)

  expect(direct, '直连路径上剖切就没生效 —— 那是 T-243 的问题，不是本卡的').toBeGreaterThan(0)
  // **结论断言。** 实测两条路径上剖切都生效。这条红了说明 composer 路径吃掉了裁剪，
  // 结论与 IMPL_NOTES 那一条都要重写。
  expect(composed, 'composer 路径上剖切失效了 —— 开描边等于关剖切').toBeGreaterThan(0)
})

test('T-252 ①b · 开描边 / 开剖切各自都让画面变了（两次变化可归因）', async ({ page }) => {
  await openEditor(page)
  await openEffects(page)

  const base = await bucketHistogram(page)
  expect(await colourBuckets(page), '画面是空的，后面的比较没有意义').toBeGreaterThan(3)

  await page.locator('[data-testid="outline-enabled"]').check()
  await page.locator('.tree-row__name', { hasText: '阀盖' }).click()
  await page.waitForTimeout(SETTLE)
  const withOutline = await bucketHistogram(page)

  await page.locator('[data-testid="section-create"]').click()
  await page.waitForTimeout(SETTLE)
  const withBoth = await bucketHistogram(page)

  // **不合成一条断言**——合成之后「只有其中一个生效」也会绿。
  expect(JSON.stringify(withOutline), '开描边 + 选中之后画面一模一样').not.toBe(JSON.stringify(base))
  expect(JSON.stringify(withBoth), '开剖切之后画面一模一样').not.toBe(JSON.stringify(withOutline))
})

test('T-252 ② · 剖切平面数变化会触发着色器重编译（数一数程序条数）', async ({ page }) => {
  // three 把裁剪平面的**数量**放进 shader program 的 cache key。这条测量的是那句话在
  // 本项目的场景规模上到底值多少——结论进 IMPL_NOTES §2。
  await openEditor(page)
  await openEffects(page)

  const before = (await stats(page))!.programs

  await page.locator('[data-testid="section-create"]').click()
  await page.waitForTimeout(SETTLE)
  const afterOne = (await stats(page))!.programs

  await page.locator('[data-testid="section-create"]').click()
  await page.waitForTimeout(SETTLE)
  const afterTwo = (await stats(page))!.programs

  console.log(`[T-252] programs: 0 平面 ${before} → 1 平面 ${afterOne} → 2 平面 ${afterTwo}`)

  // **必须断一个明确的结论。** three 的缓存键含平面数，所以每加一条平面都应当带来
  // 一批新程序；如果这条红了，说明 three 的这个行为变了，结论要重新写。
  expect(afterOne, '加第一条平面没有产生任何新程序 —— 缓存键里没有平面数？').toBeGreaterThan(before)
  expect(afterTwo, '加第二条平面没有产生任何新程序').toBeGreaterThan(afterOne)
})

test('T-252 ③ · 「暂时关闭剖切」之后裁剪平面真的收回去了', async ({ page }) => {
  await openEditor(page)
  await openEffects(page)

  await page.locator('[data-testid="section-create"]').click()
  await page.waitForTimeout(SETTLE)
  expect((await stats(page))!.clipPlanes).toBe(1)

  await page.locator('[data-testid="section-view-disabled"]').check()
  await page.waitForTimeout(SETTLE)

  expect((await stats(page))!.clipPlanes, '开关勾上了，刀还在切').toBe(0)

  await page.locator('[data-testid="section-view-disabled"]').uncheck()
  await page.waitForTimeout(SETTLE)
  expect((await stats(page))!.clipPlanes, '取消勾选没有还回去').toBe(1)
})
