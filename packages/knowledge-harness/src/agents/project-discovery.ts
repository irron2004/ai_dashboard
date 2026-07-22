import { KhProjectDiscoveryReportSchema } from '@apc/shared'
import { LlmAgent } from './llm-agent.js'

const ROLE = [
  'You are the ProjectDiscovery agent. Scan the project and produce a ProjectDiscoveryReport.',
  'List the repos, the canonical docs (current.md, PRD.md, ADR-*), and the main topics.',
  'The input may contain project_context supplied by the user. Treat a non-empty projectCharacter as a',
  'high-priority description of the project. Non-empty folder descriptions are user classifications and',
  'must be respected. Blank descriptions explicitly ask you and the downstream classifier to infer the',
  'folder role from repository evidence.',
  'Do not invent paths — only report what the input evidences.',
].join(' ')

export function makeProjectDiscovery(preamble: string) {
  return new LlmAgent({ name: 'project-discovery', role: ROLE, schema: KhProjectDiscoveryReportSchema, preamble })
}
