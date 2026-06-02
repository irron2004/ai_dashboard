import { z } from 'zod'

export const KhStateSchema = z.enum([
  'CREATED', 'PROJECT_SCANNED', 'SOURCES_EXTRACTED', 'DOCUMENTS_CLASSIFIED',
  'NODE_PROPOSALS_CREATED', 'LEAD_MERGED', 'WRITE_PLAN_CREATED', 'STAGING_WRITTEN',
  'VALIDATED', 'HUMAN_REVIEW_REQUIRED', 'MERGED', 'FAILED',
])
export type KhState = z.infer<typeof KhStateSchema>

const Confidence = z.enum(['low', 'medium', 'high'])
const Risk = z.enum(['low', 'medium', 'high'])

export const KhEvidenceSchema = z.object({
  evidence_id: z.string(),
  source_id: z.string(),
  source_path: z.string(),
  evidence_type: z.string(),
  quote_or_summary: z.string().default(''),
  confidence: Confidence.default('medium'),
})
export type KhEvidence = z.infer<typeof KhEvidenceSchema>

export const KhClaimSchema = z.object({
  claim_id: z.string(),
  text: z.string(),
  claim_type: z.string().default('observation'),
  confidence: Confidence.default('medium'),
  inference: z.boolean().default(false),
  inference_note: z.string().optional(),
  evidence_ids: z.array(z.string()).default([]),
})
export type KhClaim = z.infer<typeof KhClaimSchema>

export const KhNodeProposalSchema = z.object({
  proposal_id: z.string(),
  proposal_type: z.string().default('create_or_update_node'),
  proposed_by: z.string(),
  source_type: z.string().default('agent_session'),
  created_at: z.string(),
  node: z.object({
    id: z.string(),
    type: z.string(),                 // ConceptNode | DecisionNode | ExperimentNode | ...
    scope: z.string().default('project'),  // project | shared_candidate | shared
    title: z.string(),
    summary: z.string().default(''),
    project_ids: z.array(z.string()).default([]),
    tags: z.array(z.string()).default([]),
  }),
  claims: z.array(KhClaimSchema).default([]),
  evidence: z.array(KhEvidenceSchema).default([]),
  claim_policy: z.object({
    minimum_evidence_count: z.number().int().default(1),
    requires_direct_source: z.boolean().default(true),
    allow_inference: z.boolean().default(true),
    inference_note_required: z.boolean().default(true),
  }).default({}),
  actions: z.array(z.object({
    action_type: z.string(),
    target_path: z.string(),
    link: z.string().optional(),
  })).default([]),
  risk: z.object({ level: Risk.default('low'), reason: z.string().default('') }).default({}),
  review: z.object({ requires_human_review: z.boolean().default(true), reviewer_question: z.string().default('') }).default({}),
})
export type KhNodeProposal = z.infer<typeof KhNodeProposalSchema>

export const KhWriteOpSchema = z.object({
  op: z.string(),                     // create_file | update_frontmatter | add_backlink | append_section
  path: z.string(),
  source_proposal: z.string().optional(),
  content_template: z.string().optional(),
  content: z.string().optional(),
  changes: z.record(z.unknown()).optional(),
  link: z.string().optional(),
  mode: z.enum(['apply', 'proposal_only']).default('apply'),
  risk: Risk.default('low'),
  reason: z.string().optional(),
})
export type KhWriteOp = z.infer<typeof KhWriteOpSchema>

export const KhWritePlanSchema = z.object({
  write_plan_id: z.string(),
  created_by: z.string(),
  based_on_proposals: z.array(z.string()).default([]),
  target_vault: z.string().default('vault-staging'),
  requires_human_approval: z.boolean().default(true),
  operations: z.array(KhWriteOpSchema).default([]),
  forbidden_operations_checked: z.object({
    raw_modified: z.boolean().default(false),
    delete_operation: z.boolean().default(false),
    canonical_direct_overwrite: z.boolean().default(false),
  }).default({}),
  validation_required: z.array(z.string()).default([]),
})
export type KhWritePlan = z.infer<typeof KhWritePlanSchema>

export const KhEvalReportSchema = z.object({
  coverage: z.object({
    raw_sources_total: z.number().default(0),
    raw_sources_classified: z.number().default(0),
    task_mapped_sources: z.number().default(0),
    unmapped_sources: z.number().default(0),
  }).default({}),
  evidence_quality: z.object({
    node_proposals_total: z.number().default(0),
    proposals_without_evidence: z.number().default(0),
    proposals_with_minimum_evidence: z.number().default(0),
    inference_without_note: z.number().default(0),
  }).default({}),
  graph_quality: z.object({
    orphan_nodes: z.number().default(0),
    duplicate_candidates: z.number().default(0),
    broken_links: z.number().default(0),
    missing_backlinks: z.number().default(0),
  }).default({}),
  safety: z.object({
    raw_modified: z.boolean().default(false),
    secret_warnings: z.number().default(0),
    canonical_direct_overwrite_attempts: z.number().default(0),
    delete_attempts: z.number().default(0),
  }).default({}),
  usefulness: z.object({
    current_update_proposals: z.number().default(0),
    next_task_candidates: z.number().default(0),
    shared_promotion_candidates: z.number().default(0),
  }).default({}),
})
export type KhEvalReport = z.infer<typeof KhEvalReportSchema>

export const RunStateSchema = z.object({
  runId: z.string(),
  projectId: z.string(),
  engine: z.string(),
  state: KhStateSchema,
  history: z.array(z.object({ state: KhStateSchema, at: z.string() })).default([]),
  artifacts: z.record(z.array(z.string())).default({}),  // state -> relative artifact paths under the run dir
  error: z.string().optional(),
})
export type RunState = z.infer<typeof RunStateSchema>

export const KhProjectDiscoveryReportSchema = z.object({
  project_id: z.string(),
  generated_by: z.string(),
  summary: z.string().default(''),
  repos: z.array(z.object({ path: z.string(), kind: z.string().default('repo') })).default([]),
  canonical_docs: z.array(z.object({ path: z.string(), role: z.string().default('canonical') })).default([]),
  topics: z.array(z.string()).default([]),
})
export type KhProjectDiscoveryReport = z.infer<typeof KhProjectDiscoveryReportSchema>

export const KhSourceInventoryReportSchema = z.object({
  generated_by: z.string(),
  sources: z.array(z.object({
    source_id: z.string(), source_path: z.string(), source_kind: z.string().default('agent_session'),
    mtime: z.string().default(''),
  })).default([]),
})
export type KhSourceInventoryReport = z.infer<typeof KhSourceInventoryReportSchema>

export const KhConversationHistoryReportSchema = z.object({
  generated_by: z.string(),
  session_id: z.string(),
  work_summary: z.string().default(''),
  highlights: z.array(z.object({
    text: z.string(), kind: z.string().default('decision'), source_path: z.string().default(''),
  })).default([]),
  files_touched: z.array(z.string()).default([]),
  open_problems: z.array(z.string()).default([]),
})
export type KhConversationHistoryReport = z.infer<typeof KhConversationHistoryReportSchema>

export const KhDocumentIntentReportSchema = z.object({
  generated_by: z.string(),
  documents: z.array(z.object({
    path: z.string(),
    intent: z.string(),                 // canonical | reference | scratch | raw
    confidence: z.enum(['low', 'medium', 'high']).default('medium'),
    reason: z.string().default(''),
  })).default([]),
})
export type KhDocumentIntentReport = z.infer<typeof KhDocumentIntentReportSchema>

export const KhGraphUpdatePlanSchema = z.object({
  created_by: z.string(),
  node_ops: z.array(z.object({
    op: z.string(),                     // create | update | merge | link
    node_id: z.string(),
    based_on_proposals: z.array(z.string()).default([]),
    note: z.string().default(''),
  })).default([]),
})
export type KhGraphUpdatePlan = z.infer<typeof KhGraphUpdatePlanSchema>

export const KhSharedPromotionPlanSchema = z.object({
  created_by: z.string(),
  candidates: z.array(z.object({
    node_id: z.string(), reason: z.string().default(''),
    evidence_count: z.number().int().default(0), requires_human_review: z.boolean().default(true),
  })).default([]),
})
export type KhSharedPromotionPlan = z.infer<typeof KhSharedPromotionPlanSchema>

export const KhStaleDocReportSchema = z.object({
  generated_by: z.string(),
  stale: z.array(z.object({
    path: z.string(), reason: z.string().default(''),
    suggested_status: z.enum(['deprecated', 'superseded', 'review']).default('review'),
  })).default([]),
})
export type KhStaleDocReport = z.infer<typeof KhStaleDocReportSchema>
