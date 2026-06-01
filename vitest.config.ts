import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'
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
      // Re-export the real node:sqlite via createRequire at runtime
      // (vite-node can't resolve the bare specifier itself).
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
      '@apc/agents': `${root}packages/agents/src/index.ts`,
      '@apc/search': `${root}packages/search/src/index.ts`,
      '@apc/llm-wiki': `${root}packages/llm-wiki/src/index.ts`,
      '@apc/pm': `${root}packages/pm/src/index.ts`,
      '@apc/dashboard-api': `${root}packages/dashboard-api/src/index.ts`,
      '@apc/harness': `${root}packages/harness/src/index.ts`,
    },
  },
  test: {
    globals: true,
    include: ['packages/**/*.test.ts'],
  },
})
