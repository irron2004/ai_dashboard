import { z } from 'zod'
import { AgentKind } from './schema.js'

export const KhStateSchema = z.enum([
  'CREATED', 'PROJECT_SCANNED', 'SOURCES_EXTRACTED', 'DOCUMENTS_CLASSIFIED',
  'NODE_PROPOSALS_CREATED', 'LEAD_MERGED', 'WRITE_PLAN_CREATED', 'STAGING_WRITTEN',
  'VALIDATED', 'HUMAN_REVIEW_REQUIRED', 'MERGED', 'FAILED',
])
export type KhState = z.infer<typeof KhStateSchema>

const Confidence = z.enum(['low', 'medium', 'high'])
const Risk = z.enum(['low', 'medium', 'high'])

export const KhEvidenceSchema = z.object({
  evidence_id: z.string().min(1),
  source_id: z.string().min(1),
  source_path: z.string().min(1),
  evidence_type: z.string().min(1),
  quote_or_summary: z.string().default(''),
  confidence: Confidence.default('medium'),
})
export type KhEvidence = z.infer<typeof KhEvidenceSchema>

export const KhClaimSchema = z.object({
  claim_id: z.string().min(1),
  text: z.string().min(1),
  claim_type: z.string().default('observation'),
  confidence: Confidence.default('medium'),
  inference: z.boolean().default(false),
  inference_note: z.string().optional(),
  evidence_ids: z.array(z.string()).default([]),
})
export type KhClaim = z.infer<typeof KhClaimSchema>

export const KhNodeScope = z.enum(['project', 'shared_candidate', 'shared'])
export type KhNodeScope = z.infer<typeof KhNodeScope>

export const KhNodeProposalSchema = z.object({
  proposal_id: z.string().min(1),
  proposal_type: z.string().default('create_or_update_node'),
  proposed_by: z.string().min(1),
  source_type: z.string().default('agent_session'),
  created_at: z.string().min(1),
  node: z.object({
    id: z.string().min(1),
    type: z.string().min(1),          // ConceptNode | DecisionNode | ExperimentNode | ...
    scope: KhNodeScope.default('project'),
    title: z.string().min(1),
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
  // #29: claim→evidence referential integrity (parse-level defense-in-depth for "NEVER invent evidence").
  // Every claim must cite >=1 evidence id, and each cited id must resolve to a declared evidence entry —
  // a dangling/hallucinated reference is a structural reject, not a runtime warning. NOTE: an EMPTY
  // proposal (no claims, no evidence) stays valid on purpose: PolicyGuard is the runtime evidence gate and
  // the eval report measures evidence-less proposals, so they must remain parseable.
  .superRefine((p, ctx) => {
    const declared = new Set(p.evidence.map(e => e.evidence_id))
    p.claims.forEach((c, i) => {
      if (c.evidence_ids.length === 0) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['claims', i, 'evidence_ids'],
          message: `claim ${c.claim_id} must cite at least one evidence entry` })
      }
      for (const eid of c.evidence_ids) {
        if (!declared.has(eid)) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['claims', i, 'evidence_ids'],
            message: `claim ${c.claim_id} cites unknown evidence_id "${eid}"` })
        }
      }
    })
  })
export type KhNodeProposal = z.infer<typeof KhNodeProposalSchema>

// Recognized write verbs. delete_file is recognized-but-forbidden: it parses so PolicyGuard can block it
// with a clean message; an unknown/typo'd verb fails at parse instead of being silently dropped.
export const KhWriteOpKind = z.enum(['create_file', 'update_frontmatter', 'add_backlink', 'append_section', 'delete_file'])
export type KhWriteOpKind = z.infer<typeof KhWriteOpKind>

export const KhWriteOpSchema = z.object({
  op: KhWriteOpKind,
  path: z.string().min(1),
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
  runId: z.string().min(1),
  projectId: z.string().min(1),
  engine: AgentKind,
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
    op: z.enum(['create', 'update', 'merge', 'link']),
    node_id: z.string().min(1),
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

export const KhPolicyReportSchema = z.object({
  generated_by: z.string().default('policy-guard'),
  ok: z.boolean().default(true),
  blocked_proposal_ids: z.array(z.string()).default([]),
  violations: z.array(z.object({
    proposal_id: z.string().default(''),
    rule: z.string(),    // raw_write | delete | canonical_overwrite | no_evidence | secret | shared_evidence_min
    severity: z.enum(['block', 'warn']).default('warn'),
    detail: z.string().default(''),
  })).default([]),
})
export type KhPolicyReport = z.infer<typeof KhPolicyReportSchema>

export const KhSecretScanReportSchema = z.object({
  generated_by: z.string().default('secret-scanner'),
  ok: z.boolean().default(true),
  findings: z.array(z.object({
    source: z.string().default(''),
    rule: z.string(),
    match_preview: z.string().default(''),
  })).default([]),
})
export type KhSecretScanReport = z.infer<typeof KhSecretScanReportSchema>

export const KhGraphValidationReportSchema = z.object({
  generated_by: z.string().default('graph-integrity'),
  ok: z.boolean().default(true),
  broken_links: z.array(z.object({ from: z.string(), to: z.string() })).default([]),
  duplicate_node_ids: z.array(z.object({ node_id: z.string(), paths: z.array(z.string()).default([]) })).default([]),
  orphan_nodes: z.array(z.string()).default([]),
  node_id_mismatches: z.array(z.object({ path: z.string(), node_id: z.string() })).default([]),
  missing_backlinks: z.array(z.object({ from: z.string(), to: z.string() })).default([]),
})
export type KhGraphValidationReport = z.infer<typeof KhGraphValidationReportSchema>

export const KhLinkValidationReportSchema = z.object({
  generated_by: z.string().default('obsidian-link-validator'),
  ok: z.boolean().default(true),
  broken: z.array(z.object({ path: z.string(), detail: z.string().default('') })).default([]),
})
export type KhLinkValidationReport = z.infer<typeof KhLinkValidationReportSchema>

export const KhMarkdownYamlValidationReportSchema = z.object({
  generated_by: z.string().default('markdown-yaml-validator'),
  ok: z.boolean().default(true),
  problems: z.array(z.object({ path: z.string(), kind: z.string(), detail: z.string().default('') })).default([]),
})
export type KhMarkdownYamlValidationReport = z.infer<typeof KhMarkdownYamlValidationReportSchema>

// A2 (Step 5): deterministic verification that declared evidence resolves to a real raw source.
export const KhEvidenceVerificationReportSchema = z.object({
  generated_by: z.string().default('evidence-verifier'),
  ok: z.boolean().default(true),
  unverifiable: z.array(z.object({
    proposal_id: z.string(),
    evidence_id: z.string(),
    source_path: z.string(),
    reason: z.enum(['source_not_found', 'quote_not_found', 'path_escape']),
  })).default([]),
})
export type KhEvidenceVerificationReport = z.infer<typeof KhEvidenceVerificationReportSchema>

export const KhCoverageReportSchema = z.object({
  sources: z.array(z.object({
    path: z.string(),
    status: z.enum(['covered', 'unmapped']),
    citedBy: z.array(z.string()).default([]),   // node ids that cite this source
  })).default([]),
  nodes: z.array(z.object({
    id: z.string(),
    title: z.string(),
    cites: z.array(z.string()).default([]),     // source paths this node cites
  })).default([]),
  totals: z.object({
    sourcesTotal: z.number().int().default(0),
    covered: z.number().int().default(0),
    unmapped: z.number().int().default(0),
  }),
})
export type KhCoverageReport = z.infer<typeof KhCoverageReportSchema>
