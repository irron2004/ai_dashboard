import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
  resolve: {
    alias: {
      '@apc/shared': `${root}packages/shared/src/index.ts`,
      '@apc/core': `${root}packages/core/src/index.ts`,
      '@apc/vault': `${root}packages/vault/src/index.ts`,
      '@apc/workflow': `${root}packages/workflow/src/index.ts`,
    },
  },
  test: {
    globals: true,
    include: ['packages/**/*.test.ts'],
  },
})
