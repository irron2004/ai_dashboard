import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

const repoRoot = fileURLToPath(new URL('../../', import.meta.url))

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      {
        find: /^@apc\/graph-view\/node$/,
        replacement: `${repoRoot}packages/graph-view/src/node/index.ts`,
      },
      {
        find: '@apc/graph-view',
        replacement: `${repoRoot}packages/graph-view/src/index.ts`,
      },
    ],
  },
  test: {
    environment: 'node',
    environmentMatchGlobs: [['**/*.test.tsx', 'jsdom']],
    globals: true,
    include: ['src/**/*.test.{ts,tsx}'],
  },
})
