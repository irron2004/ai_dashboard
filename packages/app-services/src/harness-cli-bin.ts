#!/usr/bin/env node
import { join } from 'node:path'
import { CliAgentRunner } from '@apc/llm-wiki'
import { HarnessService } from './harness-service.js'
import { runCli, type HarnessCliPort } from './harness-cli.js'

/**
 * Thin bin entry. Config comes from env so the binary stays free of a project DB:
 *   HARNESS_VAULT  — path to the Obsidian vault (default ./vault)
 *   HARNESS_RUNS   — path to the runs/ root      (default ./runs)
 *   HARNESS_GATES  — path to feature-gates.yml   (default ./harness/feature-gates.yml)
 * The real LLM backend is CliAgentRunner (claude/codex/opencode CLIs on PATH).
 */
async function main(): Promise<void> {
  const cwd = process.cwd()
  const svc = new HarnessService({
    runner: new CliAgentRunner(),
    vaultRoot: process.env.HARNESS_VAULT ?? join(cwd, 'vault'),
    runsRoot: process.env.HARNESS_RUNS ?? join(cwd, 'runs'),
    gatesPath: process.env.HARNESS_GATES ?? join(cwd, 'harness', 'feature-gates.yml'),
  })
  const port: HarnessCliPort = {
    run: (i) => svc.run(i),
    show: (i) => svc.show(i),
    promote: (i) => svc.promote(i),
  }
  process.exitCode = await runCli(process.argv.slice(2), port, (l) => console.log(l))
}

main().catch((e) => { console.error(e); process.exitCode = 1 })
