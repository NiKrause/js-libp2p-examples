// The demo recording (video/): the suite's own relay and dev server, two
// browsers at 960×720 side by side, a video of each. Not part of `npm test`;
// run with `npx playwright test -c playwright.video.config.js`, then
// `video/compose.sh out`.
import { defineConfig, devices } from '@playwright/test'

export const port = Number(process.env.E2E_PORT || 5184)
process.env.E2E_PORT = String(port)

export default defineConfig({
  testDir: './video',
  outputDir: './video/results',
  timeout: 600_000,
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: 'list',
  globalSetup: './test/global-setup.js',
  globalTeardown: './test/global-teardown.js',
  webServer: {
    command: `npx vite --host 127.0.0.1 --port ${port} --strictPort`,
    port,
    reuseExistingServer: false,
    timeout: 120_000
  },
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: 'off'
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }]
})
