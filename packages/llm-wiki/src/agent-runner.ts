import type { AgentType } from '@apc/shared'

export type RunInput = { agent: AgentType; prompt: string; timeoutMs: number; cwd?: string }
export type RunResult = { ok: boolean; output: string; raw: string }

export interface AgentRunner {
  run(input: RunInput): Promise<RunResult>
}

export class FakeAgentRunner implements AgentRunner {
  readonly calls: RunInput[] = []
  constructor(private readonly outputs: string[]) {}
  async run(input: RunInput): Promise<RunResult> {
    this.calls.push(input)
    if (this.calls.length > this.outputs.length) return { ok: false, output: '', raw: '' }
    const output = this.outputs[this.calls.length - 1]
    return { ok: true, output, raw: output }
  }
}
