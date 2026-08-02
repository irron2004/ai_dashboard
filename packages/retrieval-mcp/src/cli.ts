import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { resolveRetrievalMcpConfig } from './config.js'
import { WorkspaceRetrievalRuntime } from './runtime.js'
import { createRetrievalMcpServer } from './server.js'

export async function main(argv = process.argv.slice(2)): Promise<void> {
  const [command = 'serve', ...args] = argv
  const config = resolveRetrievalMcpConfig(args)
  if (command === 'index') {
    const result = await new WorkspaceRetrievalRuntime(config).refresh()
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
    return
  }
  if (command !== 'serve') throw new TypeError(`unknown retrieval MCP command: ${command}`)
  const server = createRetrievalMcpServer(config)
  await server.connect(new StdioServerTransport())
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
