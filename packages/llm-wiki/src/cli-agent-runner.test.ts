import { describe, expect, test } from 'vitest'
import { CliAgentRunner, type EngineTemplates } from './cli-agent-runner.js'

// Fake "agent": read stdin, echo it back as JSON.
const ECHO = 'let d="";process.stdin.on("data",c=>d+=c);process.stdin.on("end",()=>process.stdout.write(JSON.stringify({echo:d})))'

describe('CliAgentRunner (stdin)', () => {
  test('writes the prompt to stdin and returns stdout', async () => {
    const templates: EngineTemplates = { claude: { command: process.execPath, args: ['-e', ECHO] } }
    const res = await new CliAgentRunner(templates).run({ agent: 'claude', prompt: 'hello world', timeoutMs: 10000 })
    expect(res.ok).toBe(true)
    expect(JSON.parse(res.output).echo).toBe('hello world')
  })

  test('times out and returns ok:false when the process hangs', async () => {
    const templates: EngineTemplates = { claude: { command: process.execPath, args: ['-e', 'setTimeout(()=>{},60000)'] } }
    const res = await new CliAgentRunner(templates).run({ agent: 'claude', prompt: 'x', timeoutMs: 300 })
    expect(res.ok).toBe(false)
  })

  test('throws for an engine with no configured template', async () => {
    await expect(new CliAgentRunner({}).run({ agent: 'opencode', prompt: 'x', timeoutMs: 100 })).rejects.toThrow(/no command template/i)
  })
})
