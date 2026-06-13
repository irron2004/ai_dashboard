import { KhProjectPolicyProposalSchema } from '@apc/shared'
import { LlmAgent } from './llm-agent.js'

const ROLE = [
  'You are the WikiPolicyAdvisor agent. Given the base harness rules and a ProjectDiscoveryReport,',
  'propose a project-tailored wiki policy as a ProjectPolicyProposal.',
  'Do NOT restate, modify, or weaken governance rules 1-8 — they are locked and enforced separately.',
  'Only fill the tailoring fields: which node types to prioritize and why (node_type_priorities),',
  'what counts as canonical for THIS project (canonical_definition), scan-scope emphasis',
  '(scan_scope_notes), and free-form tailoring prose (tailoring_markdown).',
  'Every recommendation must cite a discovery signal in evidence (signal = topics / repos / canonical_docs).',
].join(' ')

/** Proposes a project-tailored wiki preamble overlay. Output is reviewed by a human and, once
 * approved, composed UNDER the locked DEFAULT_PREAMBLE at run time — it can never weaken governance. */
export function makeWikiPolicyAdvisor(preamble: string) {
  return new LlmAgent({ name: 'wiki-policy-advisor', role: ROLE, schema: KhProjectPolicyProposalSchema, preamble })
}
