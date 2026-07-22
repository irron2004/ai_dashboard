import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './fixture',
  outputDir: './artifacts/fixture',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 30_000,
  expect: { timeout: 7_500 },
  reporter: [['list']],
  use: {
    ...devices['Desktop Chrome'],
    baseURL: 'http://127.0.0.1:4174',
    viewport: { width: 1440, height: 900 },
    colorScheme: 'dark',
    locale: 'ko-KR',
    timezoneId: 'Asia/Seoul',
    launchOptions: process.env.APC_QA_CHROME_PATH
      ? { executablePath: process.env.APC_QA_CHROME_PATH }
      : undefined,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'pnpm qa:fixture:serve',
    url: 'http://127.0.0.1:4174',
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
})
