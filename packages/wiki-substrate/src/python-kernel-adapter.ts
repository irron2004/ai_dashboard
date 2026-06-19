import { spawn } from 'node:child_process'
import { parseLintOutput } from './parse-lint-output.js'
import type { WikiSubstrate, WikiVault } from './wiki-substrate.js'
import type { KhKernelLintReport } from '@apc/shared'

type RunOut = { stdout: string; stderr: string; code: number | null }

/** TS→Python 경계. autosci-core를 import하지 않고 서브프로세스로만 호출한다. */
export class PythonKernelAdapter implements WikiSubstrate {
  constructor(private readonly opts: { python: string; cwd?: string; timeoutMs?: number }) {}

  private run(args: string[]): Promise<RunOut> {
    return new Promise((resolve) => {
      const child = spawn(this.opts.python, args, {
        cwd: this.opts.cwd, stdio: ['ignore', 'pipe', 'pipe'],
        shell: process.platform === 'win32',
      })
      let stdout = '', stderr = ''
      const timer = setTimeout(() => child.kill('SIGKILL'), this.opts.timeoutMs ?? 120_000)
      child.stdout.on('data', (d) => { stdout += String(d) })
      child.stderr.on('data', (d) => { stderr += String(d) })
      child.on('error', (e) => { clearTimeout(timer); resolve({ stdout, stderr: String(e), code: null }) })
      child.on('close', (code) => { clearTimeout(timer); resolve({ stdout, stderr, code }) })
    })
  }

  async lint(vault: WikiVault): Promise<KhKernelLintReport> {
    const { stdout, stderr, code } = await this.run([
      '-m', 'kernel', 'lint', '--contract-dir', vault.contractDir, '--wiki-dir', vault.wikiDir,
    ])
    // The kernel prints issue lines to stdout; stderr is only logging/tracebacks.
    // Parsing stderr risks treating log lines starting with "  - " as false issues.
    return parseLintOutput(stdout, code ?? 1)
  }

  async rebuildIndex(vault: WikiVault): Promise<void> {
    await this.run(['-m', 'kernel', 'rebuild-index', '--contract-dir', vault.contractDir, '--wiki-dir', vault.wikiDir])
  }

  async checkSources(vaultRoot: string): Promise<{ ok: boolean; output: string }> {
    const { stdout, stderr, code } = await this.run(['-m', 'autosci_core.adapters', '--vault', vaultRoot])
    return { ok: code === 0, output: `${stdout}\n${stderr}` }
  }
}
