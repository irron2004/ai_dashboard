import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

// node:sqlite (built-in) and the native PTY are kept external so they are required
// at runtime rather than bundled. node-pty must be rebuilt for the Electron ABI on the
// target machine (`electron-rebuild`); it is an optionalDependency and may be absent in
// environments without a compiler.
const EXTERNAL = ['node:sqlite', '@homebridge/node-pty-prebuilt-multiarch']

export default defineConfig({
  main: {
    build: { rollupOptions: { external: EXTERNAL } },
  },
  preload: {},
  renderer: {
    plugins: [react()],
  },
})
