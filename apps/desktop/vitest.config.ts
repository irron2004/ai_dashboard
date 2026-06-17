import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import type { Plugin } from 'vite'

const repoRoot = fileURLToPath(new URL('../../', import.meta.url))

const nodeSqlitePlugin: Plugin = {
  name: 'node-sqlite-shim',
  resolveId(id) { if (id === 'node:sqlite' || id === 'sqlite') return '\0virtual:node-sqlite' },
  load(id) {
    if (id === '\0virtual:node-sqlite') {
      return `
import { createRequire as _cr } from 'node:module';
const _req = _cr(import.meta.url);
const _m = _req('node:sqlite');
export const DatabaseSync = _m.DatabaseSync;
export const StatementSync = _m.StatementSync;
export default _m;
`
    }
  },
}

const pkgs = ['shared','core','vault','workflow','agents','search','llm-wiki','pm','dashboard-api','harness','knowledge-harness','app-services']
const alias = Object.fromEntries(pkgs.map((p) => [`@apc/${p}`, `${repoRoot}packages/${p}/src/index.ts`]))

export default defineConfig({
  plugins: [nodeSqlitePlugin, react()],
  resolve: { alias },
  test: {
    globals: true,
    environment: 'node',
    environmentMatchGlobs: [['**/*.test.tsx', 'jsdom']],
    include: ['src/**/*.test.{ts,tsx}'],
  },
})
