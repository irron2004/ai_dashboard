import { KhProjectDiscoveryReportSchema } from '@apc/shared'
import { LlmAgent } from './llm-agent.js'

const ROLE = [
  'You are the ProjectDiscovery agent. Scan the project and produce a ProjectDiscoveryReport.',
  'List the repos, the canonical docs (current.md, PRD.md, ADR-*), and the main topics.',
  'Do not invent paths — only report what the input evidences.',
].join(' ')

export function makeProjectDiscovery(preamble: string) {
  return new LlmAgent({ name: 'project-discovery', role: ROLE, schema: KhProjectDiscoveryReportSchema, preamble })
}
