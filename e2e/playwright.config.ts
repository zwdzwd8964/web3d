import { defineConfig, devices } from '@playwright/test'

/**
 * G0-1 · the golden path, in a real browser.
 *
 * SwiftShader rather than the GPU: CI has no display, and every assertion here is about
 * whether the right thing was drawn, not how fast. `--use-gl=angle --use-angle=swiftshader`
 * makes WebGL work headlessly and deterministically. Performance numbers belong to G0-7
 * on real hardware, and this file deliberately measures none.
 */
export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',

  use: {
    baseURL: 'http://127.0.0.1:5273',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: {
      // SwiftShader only; no --use-gl override. Passing --use-gl=angle to the headless
      // SHELL crashes it on launch (exit 0xC000027B), and the shell is what Playwright
      // picks by default — hence `channel: 'chromium'` below, which runs the full
      // browser in new-headless mode and does support WebGL.
      args: ['--enable-unsafe-swiftshader'],
    },
  },

  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], channel: 'chromium' } }],

  // Two servers: the editor publishes, the player opens what it published. Step 12 of the
  // golden path is precisely the handover between them, so both have to be up.
  webServer: [
    {
      command: 'pnpm -F @w3/editor dev --port 5273 --strictPort',
      url: 'http://127.0.0.1:5273',
      cwd: '..',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command: 'pnpm -F @w3/player dev --port 5274 --strictPort',
      url: 'http://127.0.0.1:5274',
      cwd: '..',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
})
