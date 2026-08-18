import { spawn as nodeSpawn } from 'node:child_process'
import { join } from 'node:path'
import { StringDecoder } from 'node:string_decoder'
import { BoundedOutputBuffer, DEFAULT_OUTPUT_CAPTURE_BYTES } from '@apc/llm-wiki'

/** CLI_CONTRACT.md 입력: ROOT(env+cwd), task_id(argv[0]), --workflow/--graph-profile(옵션). */
export type DevHarnessCliInput = {
  root: string
  taskId: string
  workflow?: string
  graphProfile?: string
  onChunk?: (stream: 'stdout' | 'stderr', text: string) => void
  timeoutMs?: number
  signal?: AbortSignal
}
/** 종료코드 0=성공, 비0=실패. error는 spawn 실패/timeout/cancel 같은 비정상 종료 사유. */
export type DevHarnessCliResult = { exitCode: number | null; stdout: string; stderr: string; error?: string }

type ChildLike = {
  stdout: { on(ev: 'data', cb: (d: unknown) => void): void } | null
  stderr: { on(ev: 'data', cb: (d: unknown) => void): void } | null
  on(ev: 'error', cb: (e: Error) => void): void
  on(ev: 'close', cb: (code: number | null) => void): void
  kill(signal?: string): boolean
}
export type SpawnFn = (command: string, args: string[], options: { cwd?: string; env?: NodeJS.ProcessEnv; shell?: boolean }) => ChildLike

const defaultSpawn: SpawnFn = (cmd, args, opts) => nodeSpawn(cmd, args, opts) as unknown as ChildLike

/**
 * Runs the multi-agent dev harness CLI once, honoring only the documented `agents_up_cli.sh`
 * contract (entry `<root>/agents_up.sh`, env ROOT, argv task_id + flags, streamed output, exit code).
 * Never depends on internal implementation (tmux panes, etc.). spawn is injectable for testing.
 * Distinct from `harness-cli.ts`, which parses argv for the wiki/knowledge-harness command.
 */
export class DevHarnessCli {
  private readonly maxOutputBytes: number

  constructor(
    private readonly spawnFn: SpawnFn = defaultSpawn,
    options: { maxOutputBytes?: number } = {},
  ) {
    this.maxOutputBytes = options.maxOutputBytes ?? DEFAULT_OUTPUT_CAPTURE_BYTES
  }

  run(input: DevHarnessCliInput): Promise<DevHarnessCliResult> {
    const entry = join(input.root, 'agents_up.sh')
    const args = [
      input.taskId,
      ...(input.workflow ? ['--workflow', input.workflow] : []),
      ...(input.graphProfile ? ['--graph-profile', input.graphProfile] : []),
    ]
    return new Promise<DevHarnessCliResult>((resolve) => {
      // shell:true on Windows so a .sh shim / bash wrapper resolves; on linux/WSL the bash script runs directly.
      const child = this.spawnFn(entry, args, {
        cwd: input.root,
        env: { ...process.env, ROOT: input.root },
        shell: process.platform === 'win32',
      })
      const stdout = new BoundedOutputBuffer(this.maxOutputBytes)
      const stderr = new BoundedOutputBuffer(this.maxOutputBytes)
      let settled = false
      const finish = (r: DevHarnessCliResult) => { if (settled) return; settled = true; cleanup(); resolve(r) }
      const result = (exitCode: number | null, error?: string): DevHarnessCliResult => ({
        exitCode,
        stdout: stdout.toString(),
        stderr: stderr.toString(),
        ...(error ? { error } : {}),
      })
      const timer = input.timeoutMs
        ? setTimeout(() => { child.kill('SIGKILL'); finish(result(null, `timeout after ${input.timeoutMs}ms`)) }, input.timeoutMs)
        : undefined
      const onAbort = () => { child.kill('SIGTERM'); finish(result(null, 'cancelled')) }
      const cleanup = () => { if (timer) clearTimeout(timer); input.signal?.removeEventListener('abort', onAbort) }
      if (input.signal) {
        if (input.signal.aborted) { onAbort(); return }
        input.signal.addEventListener('abort', onAbort)
      }
      // Decode through StringDecoder so a multibyte char (e.g. Korean, which this codebase emits) split
      // across two Buffer chunks isn't corrupted — String(buffer) decodes each chunk independently.
      const outDec = new StringDecoder('utf8'), errDec = new StringDecoder('utf8')
      const decode = (dec: StringDecoder, d: unknown) => dec.write(Buffer.isBuffer(d) ? d : Buffer.from(String(d)))
      child.stdout?.on('data', (d) => { const t = decode(outDec, d); if (t) { stdout.append(t); input.onChunk?.('stdout', t) } })
      child.stderr?.on('data', (d) => { const t = decode(errDec, d); if (t) { stderr.append(t); input.onChunk?.('stderr', t) } })
      child.on('error', (e) => finish(result(null, String(e))))
      child.on('close', (code) => {
        const to = outDec.end(); if (to) { stdout.append(to); input.onChunk?.('stdout', to) }
        const te = errDec.end(); if (te) { stderr.append(te); input.onChunk?.('stderr', te) }
        finish(result(code))
      })
    })
  }
}
