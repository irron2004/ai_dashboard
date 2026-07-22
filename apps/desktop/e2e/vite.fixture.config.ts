import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

const rendererRoot = fileURLToPath(new URL('../src/renderer', import.meta.url))

export default defineConfig({
  root: rendererRoot,
  plugins: [react()],
  define: {
    'import.meta.env.VITE_APC_FIXTURE': JSON.stringify('1'),
  },
  server: {
    host: '127.0.0.1',
    port: 4174,
    strictPort: true,
  },
})
