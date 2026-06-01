import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

// The native PTY and better-sqlite3 are required at runtime, not bundled. Both are
// rebuilt for the Electron ABI on the target machine (`electron-rebuild`) and are
// optionalDependencies (may be absent in environments without a compiler).
const EXTERNAL = ['better-sqlite3', '@homebridge/node-pty-prebuilt-multiarch']

// Electron's bundled Node may lack the built-in node:sqlite, so the main process
// resolves 'node:sqlite' to a better-sqlite3-backed shim with the same DatabaseSync API.
const sqliteShim = fileURLToPath(new URL('./src/main/sqlite-shim.ts', import.meta.url))

export default defineConfig({
  main: {
    resolve: { alias: { 'node:sqlite': sqliteShim } },
    build: { rollupOptions: { external: EXTERNAL } },
  },
  preload: {},
  renderer: {
    plugins: [react()],
  },
})
