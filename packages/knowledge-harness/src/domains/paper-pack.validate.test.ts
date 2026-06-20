import { describe, expect, test, afterEach } from 'vitest'
import { KhKernelLintReportSchema, type KhKernelLintReport } from '@apc/shared'
import type { WikiSubstrate, WikiVault } from '@apc/wiki-substrate'
import { paperPack } from './paper-pack.js'
import { projectDocsPack } from './project-docs-pack.js'

const fakeSubstrate = (report: KhKernelLintReport, sink: WikiVault[]): WikiSubstrate => ({
  lint: async (v) => { sink.push(v); return report },
  rebuildIndex: async () => {},
  checkSources: async () => ({ ok: true, output: '' }),
})

afterEach(() => { delete process.env.APC_PAPER_CONTRACT_DIR })

describe('paperPack.validate', () => {
  test('lints the given wiki dir against the paper contract and returns the report', async () => {
    const seen: WikiVault[] = []
    const ok = KhKernelLintReportSchema.parse({ ok: true, exit_code: 0, issues: [] })
    const r = await paperPack.validate!('/tmp/some/wiki', { substrate: fakeSubstrate(ok, seen) })
    expect(seen).toHaveLength(1)
    expect(seen[0].wikiDir).toBe('/tmp/some/wiki')
    expect(seen[0].contractDir).toMatch(/wiki-domains[\\/]paper[\\/]runtime$/)
    expect(r.ok).toBe(true)
  })

  test('throws an actionable error (not lint) when the contract dir is missing', async () => {
    process.env.APC_PAPER_CONTRACT_DIR = '/definitely/not/here'
    const seen: WikiVault[] = []
    const ok = KhKernelLintReportSchema.parse({ ok: true, exit_code: 0, issues: [] })
    await expect(paperPack.validate!('/tmp/w', { substrate: fakeSubstrate(ok, seen) })).rejects.toThrow(/paper contract not found/i)
    expect(seen).toHaveLength(0) // never reached lint
  })

  test('project-docs pack has no validate (TS validators remain the gate)', () => {
    expect(projectDocsPack.validate).toBeUndefined()
  })
})
