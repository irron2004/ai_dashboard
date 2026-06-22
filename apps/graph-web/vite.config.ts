import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import { handleGraphRequest } from './src/api-graph.js'

const repoRoot = fileURLToPath(new URL('../../', import.meta.url))

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'api-graph',
      configureServer(server) {
        server.middlewares.use('/api/graph', (_req, res) => {
          const { status, body } = handleGraphRequest(process.env.WIKI_DIR)
          res.statusCode = status; res.setHeader('content-type', 'application/json')
          res.end(JSON.stringify(body))
        })
      },
    },
  ],
  resolve: {
    alias: [
      // graph-view subpath export must come before the main alias
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
})
