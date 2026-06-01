import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import type { Plugin } from 'vite'

const root = fileURLToPath(new URL('.', import.meta.url))

/**
 * Vite plugin: make node:sqlite (Node 24 experimental builtin) available in
 * vite-node / Vitest. vite-node 2.1.9 strips the "node:" prefix via
 * normalizeModuleId, leaving bare "sqlite" which Vite cannot resolve.
 * We intercept both "node:sqlite" and "sqlite" at the load hook and return
 * a thin proxy that re-exports the real module via createRequire.
 */
const nodeSqlitePlugin: Plugin = {
  name: 'node-sqlite-shim',
  resolveId(id) {
    if (id === 'node:sqlite' || id === 'sqlite') {
      return '\0virtual:node-sqlite'
    }
  },
  load(id) {
    if (id === '\0virtual:node-sqlite') {
      const req = createRequire(import.meta.url)
      // Use JSON.stringify so the path is properly escaped in the generated code
      const modPath = JSON.stringify(
        fileURLToPath(new URL('node_modules/.pnpm/vite@5.4.21_@types+node@24.12.4/node_modules/vite/dist/node/index.js', import.meta.url))
      )
      // Return CJS-style proxy that loads node:sqlite via require
      return `
import { createRequire as _cr } from 'node:module';
const _req = _cr(import.meta.url);
const _m = _req('node:sqlite');
export const DatabaseSync = _m.DatabaseSync;
export const StatementSync = _m.StatementSync;
export const Session = _m.Session;
export const backup = _m.backup;
export const constants = _m.constants;
export default _m;
`
    }
  },
}

export default defineConfig({
  plugins: [nodeSqlitePlugin],
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
