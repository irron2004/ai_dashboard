const LLM_AGENT_PROMPT_NAMES = [
  'project-discovery',
  'conversation-history-reader',
  'document-intent-classifier',
  'knowledge-node-extractor',
  'wiki-graph-lead',
  'wiki-policy-advisor',
  'paper-node-extractor',
  'session-titler',
]

function hasAnyAgentName(text: string): boolean {
  return LLM_AGENT_PROMPT_NAMES.some((name) => text.includes(`## Role: ${name}`) || text.includes(name))
}

export function isInternalMachinePrompt(text: string): boolean {
  const t = text.trim()
  if (!t) return false

  // Codex records these runtime-injected context blocks as role=user response items. They are not
  // questions typed by the user and must not appear in conversation history or question_log.
  if (t.startsWith('<environment_context>') && t.endsWith('</environment_context>')) return true
  if (t.startsWith('# AGENTS.md instructions') && t.includes('<INSTRUCTIONS>') && t.includes('</INSTRUCTIONS>')) return true
  if (t.startsWith('<codex_internal_context') && t.endsWith('</codex_internal_context>')) return true
  if (t.startsWith('<turn_aborted>')) return true
  if (t.startsWith('Error response\nError code:') && t.includes('\nMessage:') && t.includes('\nError code explanation:')) return true

  const hasLlmAgentShape = t.includes('## Role:') && t.includes('## Input') && t.includes('## Output')
  const hasJsonOnlyContract = t.includes('Respond with ONLY a single JSON object')
  if (hasLlmAgentShape && (hasJsonOnlyContract || t.includes('# Knowledge Harness Rules')) && hasAnyAgentName(t)) return true

  return t.includes('You are a PM assistant. Summarize an AI agent work session and propose project-memory updates.')
    && t.includes('## Session transcript')
}

export function isHumanQuestionText(text: string): boolean {
  return Boolean(text.trim()) && !isInternalMachinePrompt(text)
}
