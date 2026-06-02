import { KhConversationHistoryReportSchema } from '@apc/shared'
import { LlmAgent } from './llm-agent.js'

const ROLE = [
  'You are the ConversationHistoryReader agent. Summarize the agent session into a',
  'ConversationHistoryReport: work_summary, highlights (decisions/findings), files_touched, open_problems.',
  'Every highlight MUST cite a source_path. Treat the session transcript as immutable evidence — never modify it.',
].join(' ')

export function makeConversationHistoryReader(preamble: string) {
  return new LlmAgent({ name: 'conversation-history-reader', role: ROLE, schema: KhConversationHistoryReportSchema, preamble })
}
