import { expect, test } from '@playwright/test'
import { buildScenePackage } from '../fixtures/scene-package.js'

/**
 * T-278 · bench 页的浏览器级 e2e。
 *
 * 这一页是**交给客户工程师、在他那台机器上跑**的东西——它没有服务端，没有登录，
 * 一个 HTML 加一个文件选择框。于是它的失效方式也很朴素：某次重构把某段渲染删了，
 * 页面照样打开、照样有个表格，只是表格里少了几行、或者少了那句「软件渲染的帧率
 * 不能当验收依据」。**这两种失效在截图上都看不出来。**
 *
 * 所以四条断言全部落在**内容**上，没有一条是「页面上有一个 table」——
 * 把 `rows` 换成空数组也会有一个 table。
 *
 * `?fast=1` 把四处采样时长按同一比例缩短（6000/1200/900/600 → 600/200/200/200）。
 * 缩短的是时长，**不是表的行数与结构**，而后者正是这里断言的东西。
 */

/**
 * 强制走软件渲染。
 *
 * 断言 ③ 要证明「软渲那句警告删不掉」，而它只在 `capability.level === 'software'` 时才
 * 该出现。跟着开发机的显卡走的话，这条断言在有独显的机器上永远是空转的——而**空转的
 * 断言与不存在的断言，在测试报告上长得一模一样**。`--disable-gpu` 把它钉成确定的：
 * 这一页的失效方式与显卡无关，被测的是「报告里有没有那句话」。
 */
test.use({ launchOptions: { args: ['--enable-unsafe-swiftshader', '--disable-gpu'] } })

/** bench 页在播放器那个 dev server 上。 */
const BENCH = 'http://127.0.0.1:5274/bench.html?fast=1'

/**
 * 整条用例的墙钟上限（卡面口径）。
 *
 * ⚠ **它单独并不能证明 `?fast=1` 生效。** 实测：把 `?fast=1` 拿掉，这条用例仍然
 * 只跑 25.9 秒——因为软件渲染下两条爬坡在第一档就跌破 fail 线、直接收摊，本该最贵
 * 的那十几档根本没跑。**一条本以为在守时的断言，其实在守一个恒成立的条件。**
 *
 * 所以 `?fast=1` 由下面那条「首屏文案里的秒数」直接断言：那句话是从 `SAMPLE_MS.main`
 * 算出来的，参数认错的话它就是 6 而不是 0.6。墙钟上限保留，因为卡面要它，而且它
 * 挡得住另一类失效（某档忘了收摊、跑满 8 份副本）。
 */
const BUDGET_MS = 30_000

test.describe('T-278 · bench 页', () => {
  test.describe.configure({ timeout: 90_000 })

  test('选一个 .w3p → 出报告：表、判定、软渲警告、Markdown 四样齐全', async ({ page }) => {
    const started = Date.now()
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))

    await page.goto(BENCH)

    /* ① 页面自己起得来，且**一开始就没有报告** ------------------------------- */
    // 先钉住「没跑之前没有表」，后面「跑完有表」那条才是有信息量的。
    await expect(page.locator('#pick'), '要有文件选择框').toBeAttached()
    expect(await page.locator('table.bench__table').count(), '还没选文件时不该有报告表').toBe(0)
    // `?fast=1` 生效的直接证据：首屏那句话里的秒数是从 `SAMPLE_MS.main` 算出来的。
    // 参数认错时它是「6 秒」，而下面全部内容断言照绿——见 BUDGET_MS 的注释。
    await expect(page.locator('.bench__note'), '?fast=1 应当把主采样缩到 0.6 秒').toContainText('约需 0.6 秒')

    await page.locator('#pick').setInputFiles({
      name: 'bench-e2e.w3p',
      mimeType: 'application/zip',
      buffer: Buffer.from(buildScenePackage({ name: 'bench 用例场景', boxes: 3 })),
    })

    /* ② 报告表：行数、每行的判定、每行真的有内容 ----------------------------- */
    const table = page.locator('table.bench__table')
    await expect(table, '选完文件应当跑出一张报告表').toBeVisible({ timeout: 60_000 })

    const rows = table.locator('tbody tr')
    // 12 行的来源：帧率 3 + 场景 5 + 压力爬坡「承载上限」+ 各档 + 灯光两条上限 + 各档。
    // 爬坡会因为掉到 fail 线以下提前收摊，所以写下界而不是写死一个数。整张表由
    // `renderReport` 一次性写进 DOM，所以表可见时行就齐了，不需要再等。
    expect(await rows.count(), '报告表至少 12 行').toBeGreaterThanOrEqual(12)

    const cells = await rows.evaluateAll((list) =>
      list.map((row) => ({
        verdict: row.getAttribute('data-verdict'),
        metric: (row.querySelector('td')?.textContent ?? '').trim(),
        value: (row.querySelectorAll('td')[1]?.textContent ?? '').trim(),
      })),
    )
    // 每一行都要有判定，且判定只能是那三个值之一——`data-verdict="undefined"` 也是
    // 一个属性，只查「有没有这个属性」等于没查。
    for (const cell of cells) {
      expect(['pass', 'warn', 'fail'], `判定值非法：${cell.verdict}`).toContain(cell.verdict)
      expect(cell.metric, '每行要有指标名').not.toBe('')
      expect(cell.value, `「${cell.metric}」这一行的实测值是空的`).not.toBe('')
    }
    // 压力爬坡与灯光爬坡各自至少留下一行——少了任何一段，行数下界仍可能被另一段凑够。
    expect(cells.some((c) => c.metric.startsWith('逐级加载 ×')), '压力爬坡那一段要在').toBe(true)
    expect(cells.some((c) => c.metric.includes('动态灯上限')), '灯光爬坡那一段要在').toBe(true)

    /* ③ 软件渲染那句话 ------------------------------------------------------ */
    // e2e 全程跑在 SwiftShader 上（见 playwright.config.ts），所以这句话**必须**出现。
    // 它不是装饰：这一页的产出会被贴进验收单，而一份没标注「软渲」的帧率数据会被当成
    // 硬件读数用。删掉它的代价不在这一页上，在三个月后的验收会上。
    const env = page.locator('.bench__env')
    await expect(env, '环境行要在').toBeVisible()
    await expect(env.locator('.bench__warn'), '软件渲染时必须挂出警告').toBeVisible()
    await expect(env.locator('.bench__warn')).toContainText('不可作为验收依据')

    /* ④ 可粘贴的 Markdown --------------------------------------------------- */
    // 这一页交付的其实不是网页，是**一段能贴进工单的文本**。
    const markdown = (await page.locator('pre.bench__md').textContent()) ?? ''
    expect(markdown, 'Markdown 里要有表头').toContain('| 指标 |')
    expect(markdown, 'Markdown 里要有来源文件名').toContain('bench-e2e.w3p')
    // 表里有几行，Markdown 里就该有几行。两边由同一个 `rows` 渲染，但它们是两条路径。
    const markdownRows = markdown.split('\n').filter((line) => line.startsWith('| ') && !line.startsWith('| ---'))
    expect(markdownRows.length, 'Markdown 的行数要跟表对得上').toBeGreaterThanOrEqual(cells.length)
    await expect(page.locator('#copy'), '要有复制按钮').toBeVisible()

    /* 收尾 ------------------------------------------------------------------ */
    expect(errors, `页面不该抛异常：${errors.join(' | ')}`).toEqual([])
    expect(Date.now() - started, '整条用例要在预算内跑完（?fast=1 生效的证据）').toBeLessThan(BUDGET_MS)
  })
})
