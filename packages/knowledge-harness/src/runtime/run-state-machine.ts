import type { KhState } from '@apc/shared'

/** Happy-path pipeline: each step names the target state and the feature gate (if any) that must be open. */
export type PipelineStep = { to: KhState; gate?: string }

export const PIPELINE: PipelineStep[] = [
  { to: 'PROJECT_SCANNED' },
  { to: 'SOURCES_EXTRACTED', gate: 'enable_conversation_history_reader' },
  { to: 'DOCUMENTS_CLASSIFIED', gate: 'auto_classify_documents' },
  { to: 'NODE_PROPOSALS_CREATED', gate: 'auto_create_node_proposals' },
  { to: 'LEAD_MERGED' },
  { to: 'WRITE_PLAN_CREATED', gate: 'auto_create_write_plan' },
  { to: 'STAGING_WRITTEN', gate: 'auto_write_to_staging' },
  { to: 'VALIDATED' },
  { to: 'HUMAN_REVIEW_REQUIRED' },
]

const ORDER = new Map<KhState, number>(
  (['CREATED', ...PIPELINE.map(s => s.to)] as KhState[]).map((s, i) => [s, i]),
)

/** Legal forward step along the pipeline, plus any → FAILED, and HUMAN_REVIEW_REQUIRED → MERGED. */
export function canTransition(from: KhState, to: KhState): boolean {
  if (to === 'FAILED') return true
  if (from === 'HUMAN_REVIEW_REQUIRED' && to === 'MERGED') return true
  const a = ORDER.get(from), b = ORDER.get(to)
  return a !== undefined && b !== undefined && b === a + 1
}

export function assertTransition(from: KhState, to: KhState): void {
  if (!canTransition(from, to)) throw new Error(`illegal transition ${from} -> ${to}`)
}

/** The pipeline step whose target is `to` (for gate lookup / driver dispatch). */
export function stepFor(to: KhState): PipelineStep | undefined {
  return PIPELINE.find(s => s.to === to)
}
