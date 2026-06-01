import { describe, expect, test } from 'vitest'
import { CliAgentRunner } from './cli-agent-runner.js'

describe('CliAgentRunner', () => {
  test('runs the configured command and returns stdout', async () => {
    // Fake "agent": echo the prompt back as JSON via node -e
    const runner = new CliAgentRunner({
      claude: { command: process.execPath, args: ['-e', 'process.stdout.write(JSON.stringify({echo: process.argv[1]}))', '{{PROMPT}}'] },
    } as any)
    const res = await runner.run({ agent: 'claude', prompt: 'hello', timeoutMs: 10000 })
    expect(res.ok).toBe(true)
    expect(JSON.parse(res.output).echo).toBe('hello')
  })

  test('times out and returns ok:false when the process hangs', async () => {
    const runner = new CliAgentRunner({
      claude: { command: process.execPath, args: ['-e', 'setTimeout(()=>{}, 60000)'] },
    } as any)
    const res = await runner.run({ agent: 'claude', prompt: 'x', timeoutMs: 300 })
    expect(res.ok).toBe(false)
  })

  test('throws for an engine with no configured template', async () => {
    const runner = new CliAgentRunner({} as any)
    await expect(runner.run({ agent: 'opencode', prompt: 'x', timeoutMs: 100 })).rejects.toThrow(/no command template/i)
  })
})
