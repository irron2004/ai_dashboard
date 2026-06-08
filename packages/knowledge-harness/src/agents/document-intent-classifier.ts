import { KhDocumentIntentReportSchema } from '@apc/shared'
import { LlmAgent } from './llm-agent.js'

const ROLE = [
  'You are the DocumentIntentClassifier agent. Classify each input document by intent:',
  'canonical (current.md/PRD.md/ADR-*), reference, scratch, or raw.',
  'Give a confidence (low|medium|high) and a short reason for each.',
].join(' ')

export function makeDocumentIntentClassifier(preamble: string) {
  return new LlmAgent({ name: 'document-intent-classifier', role: ROLE, schema: KhDocumentIntentReportSchema, preamble })
}
