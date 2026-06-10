import type { AgentType } from '@apc/shared'

export type ChunkStream = 'stdout' | 'stderr'

export type RunInput = {
  agent: AgentType
  prompt: string
  timeoutMs: number
  cwd?: string
  /** 로그 디렉터리·진행 이벤트용 호출 식별자, 예: 'PROJECT_SCANNED-project-discovery'. */
  label?: string
  /** 하위 러너가 출력 도착 즉시 호출 (스트리밍 로그·live tail용). */
  onChunk?: (stream: ChunkStream, text: string) => void
}

export type RunResult = {
  ok: boolean
  output: string
  raw: string
  /** 프로세스 종료 코드; timeout/spawn 실패는 null. 미지원 러너(Fake 등)는 undefined. */
  exitCode?: number | null
  stderr?: string
  /** 진단용 명령 요약 (ssh의 경우 user@host 포함). */
  command?: string
  durationMs?: number
  /** LoggingAgentRunner가 채움 — 이 호출의 로그 디렉터리 절대경로. */
  logDir?: string
}

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
