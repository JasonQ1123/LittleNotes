import { defineConfig, devices } from '@playwright/test';
import { existsSync } from 'node:fs';

const channel =
  process.env.PLAYWRIGHT_CHANNEL ||
  (process.platform === 'win32' &&
  existsSync('C:/Program Files/Google/Chrome/Application/chrome.exe')
    ? 'chrome'
    : undefined);

export default defineConfig({
  testDir: './tests',
  timeout: 120_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    channel,
    baseURL: 'http://127.0.0.1:5174',
    timezoneId: 'Asia/Shanghai',
    locale: 'zh-CN',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1000 } },
    },
    { name: 'mobile', use: { ...devices['Pixel 7'], viewport: { width: 390, height: 844 } } },
  ],
  webServer: [
    {
      command: 'node scripts/e2e-api.mjs',
      url: 'http://127.0.0.1:18081/api/health',
      timeout: 60_000,
      reuseExistingServer: false,
    },
    {
      command: 'pnpm --filter @paper/web dev --port 5174',
      url: 'http://127.0.0.1:5174',
      env: { API_PROXY: 'http://127.0.0.1:18081' },
      timeout: 60_000,
      reuseExistingServer: false,
    },
  ],
});
