import { redactWithResult } from '@apc/agents'
import { isHumanQuestionText, type AgentActivity, type AgentQuestionSummary } from '@apc/shared'
import type { AgentRuntimeCoordinator } from './agent-runtime-coordinator.js'
import type { ConfirmedConversationQuestion } from './conversation-history.js'

export const LIVE_QUESTION_MAX_CHARS = 180
export const MASKED_QUESTION_TEXT = '[민감한 질문]'

type SanitizedQuestionResult =
  | { ok: true; question: AgentQuestionSummary }
  | { ok: false; reason: 'secure-prompt' | 'empty-question' | 'approval-input' | 'internal-prompt' }

type QuestionContext = {
  askedAt: string
  source: AgentQuestionSummary['source']
  sessionId?: string
  exchangeId?: string
  securePrompt?: boolean
}

const ANSI_SEQUENCE = /\x1b(?:\[[0-?]*[ -/]*[@-~]|[@-_])/g
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f-\u009f]/g
const APPROVAL_ONLY = /^(?:y|n|yes|no|ok|okay|continue|proceed|네|아니요|승인)$/iu

function truncate(value: string, maxChars: number): string {
  const chars = Array.from(value)
  return chars.length <= maxChars ? value : `${chars.slice(0, Math.max(0, maxChars - 1)).join('')}…`
}

export function sanitizeLiveQuestion(text: string, context: QuestionContext): SanitizedQuestionResult {
  if (context.securePrompt) return { ok: false, reason: 'secure-prompt' }
  const oneLine = text
    .replace(ANSI_SEQUENCE, '')
    .replace(CONTROL_CHARACTER, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!oneLine) return { ok: false, reason: 'empty-question' }
  if (APPROVAL_ONLY.test(oneLine)) return { ok: false, reason: 'approval-input' }
  if (!isHumanQuestionText(oneLine)) return { ok: false, reason: 'internal-prompt' }

  const redacted = redactWithResult(oneLine)
  const alreadyRedacted = redacted.text.includes('[REDACTED]')
  const masked = redacted.changed || alreadyRedacted
  return {
    ok: true,
    question: {
      displayText: masked ? MASKED_QUESTION_TEXT : truncate(redacted.text, LIVE_QUESTION_MAX_CHARS),
      askedAt: context.askedAt,
      sessionId: context.sessionId,
      exchangeId: context.exchangeId,
      privacy: masked ? 'masked' : 'visible',
      source: context.source,
    },
  }
}

export type LiveQuestionSubmit = {
  paneId: string
  launchId: string
  text: string
  securePrompt?: boolean
  askedAt?: string
}

export type LiveQuestionResult =
  | { ok: true; activity: AgentActivity; question: AgentQuestionSummary }
  | { ok: false; reason: string }

type LiveQuestionDeps = {
  now?: () => string
  findConfirmedQuestion?: (sessionId: string) => Promise<ConfirmedConversationQuestion | undefined>
}

function activityHasQuestion(activity: AgentActivity | undefined, launchId: string, question: AgentQuestionSummary): activity is AgentActivity {
  const stored = activity?.lastQuestion
  return activity?.launchId === launchId
    && stored?.displayText === question.displayText
    && stored.askedAt === question.askedAt
    && stored.sessionId === question.sessionId
    && stored.exchangeId === question.exchangeId
    && stored.privacy === question.privacy
    && stored.source === question.source
}

/** Main-process privacy boundary. Raw input is neither returned nor passed to activity persistence. */
export class LiveQuestionService {
  private readonly now: () => string
  private readonly findConfirmedQuestion?: LiveQuestionDeps['findConfirmedQuestion']

  constructor(private readonly coordinator: AgentRuntimeCoordinator, deps: LiveQuestionDeps = {}) {
    this.now = deps.now ?? (() => new Date().toISOString())
    this.findConfirmedQuestion = deps.findConfirmedQuestion
  }

  submit(input: LiveQuestionSubmit): LiveQuestionResult {
    const sanitized = sanitizeLiveQuestion(input.text, {
      askedAt: input.askedAt ?? this.now(),
      source: 'pty',
      securePrompt: input.securePrompt,
    })
    if (!sanitized.ok) return sanitized
    const activity = this.coordinator.handle({
      type: 'question',
      paneId: input.paneId,
      launchId: input.launchId,
      question: sanitized.question,
    })
    if (!activityHasQuestion(activity, input.launchId, sanitized.question)) {
      return { ok: false, reason: 'stale-launch' }
    }
    return { ok: true, activity, question: sanitized.question }
  }

  async reconcile(paneId: string, launchId: string, sessionId: string): Promise<LiveQuestionResult> {
    if (!this.findConfirmedQuestion) return { ok: false, reason: 'history-unavailable' }
    const confirmed = await this.findConfirmedQuestion(sessionId)
    if (!confirmed) return { ok: false, reason: 'question-not-found' }
    const sanitized = sanitizeLiveQuestion(confirmed.text, {
      askedAt: confirmed.askedAt ?? this.now(),
      source: 'transcript',
      sessionId: confirmed.sessionId,
      exchangeId: confirmed.exchangeId,
    })
    if (!sanitized.ok) return sanitized
    const activity = this.coordinator.handle({
      type: 'question', paneId, launchId, question: sanitized.question,
    })
    if (!activityHasQuestion(activity, launchId, sanitized.question)) {
      return { ok: false, reason: 'stale-launch' }
    }
    return { ok: true, activity, question: sanitized.question }
  }

  restoreSessionQuestion(paneId: string, launchId: string, sessionId: string): Promise<LiveQuestionResult> {
    return this.reconcile(paneId, launchId, sessionId)
  }
}
