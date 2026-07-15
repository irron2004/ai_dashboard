import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './electron',
  outputDir: './artifacts/electron',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
})
