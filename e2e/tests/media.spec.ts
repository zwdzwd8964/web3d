import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { buildWav } from '../fixtures/wav.js'
import { resetStorage } from './storage-reset.js'

/**
 * v0.5 · T-160 / T-161 · media import and the media library, at the DOM.
 *
 * The load-bearing test here is ①. T-160's acceptance is 「`durationS` 与真实时长误差 < 0.1s」,
 * and the unit tests inject the reader — so they prove my code passes the browser's answer
 * through, and nothing about whether the browser's answer is right. This file feeds a real
 * browser a real file whose length is known independently (a raw-PCM WAV: duration =
 * samples / sampleRate, no encoder, no frame padding, no VBR header to guess at).
 */

const SETTLE = 400

test.beforeEach(async ({ page }) => {
  await resetStorage(page, 'w3-e2e-cleaned')
  page.on('console', (message) => {
    if (message.type() === 'error') console.log(`[browser error] ${message.text()}`)
  })
})

/** Imports a WAV of exactly `seconds` through the asset panel's file input. */
async function importWav(page: Page, name: string, seconds: number) {
  await page.goto('/')
  await expect(page.locator('canvas.viewport__canvas')).toBeVisible()
  await page.waitForTimeout(SETTLE * 3)

  await page.getByRole('button', { name: '资产' }).click()
  await page.locator('input[type=file]').setInputFiles({
    name,
    mimeType: 'audio/wav',
    buffer: Buffer.from(buildWav(seconds)),
  })
  await expect(page.locator('.report')).toBeVisible({ timeout: 15_000 })
  await page.getByRole('button', { name: '确认导入' }).click()
  await page.waitForTimeout(SETTLE)
}

test('① 导入音频后，记录的时长与真实时长误差 < 0.1s（T-160 验收）', async ({ page }) => {
  await importWav(page, '讲解.wav', 3.5)

  await page.getByRole('button', { name: '媒体' }).click()
  const meta = page.locator('.media-list__meta').first()
  await expect(meta).toBeVisible()

  const text = await meta.innerText()
  const seconds = Number(/([\d.]+) 秒/.exec(text)?.[1])
  expect(Number.isFinite(seconds), `时长没读出来：${text}`).toBe(true)
  expect(Math.abs(seconds - 3.5), `读到 ${seconds}s，真实 3.5s`).toBeLessThan(0.1)
})

test('② 媒体列表显示类型、名称、时长与大小', async ({ page }) => {
  await importWav(page, '讲解.wav', 2)
  await page.getByRole('button', { name: '媒体' }).click()

  const row = page.locator('.media-list__row').first()
  await expect(row).toBeVisible()
  await expect(row.locator('input')).toHaveValue('讲解.wav')
  await expect(row.locator('.media-list__meta')).toContainText('KB')
})

test('③ 试听能开出一个播放器，再点一下收起', async ({ page }) => {
  await importWav(page, '讲解.wav', 2)
  await page.getByRole('button', { name: '媒体' }).click()

  await page.getByRole('button', { name: '试听' }).click()
  await expect(page.locator('.media-list__player audio')).toBeVisible()

  await page.getByRole('button', { name: '停止' }).click()
  await expect(page.locator('.media-list__player audio')).toHaveCount(0)
})

test('④ 删除没人引用的媒体不啰嗦，删完记录就没了', async ({ page }) => {
  await importWav(page, '讲解.wav', 2)
  await page.getByRole('button', { name: '媒体' }).click()

  await page.getByRole('button', { name: '删除' }).click()
  // No references, so the question is a plain one rather than a warning.
  await expect(page.getByText('确认删除', { exact: false })).toBeVisible()
  await page.locator('.panel__note').getByRole('button', { name: '删除' }).click()

  await expect(page.locator('.media-list__row')).toHaveCount(0)
  await expect(page.getByText('还没有媒体', { exact: false })).toBeVisible()
})
