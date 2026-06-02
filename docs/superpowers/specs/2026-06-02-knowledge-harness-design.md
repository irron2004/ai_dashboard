# Evidence-based Knowledge Harness (PM Memory Consolidation Harness) Design

- **Date:** 2026-06-02
- **Version:** 0.1
- **Status:** Draft

---

## 1. 정체성과 목적

> **Knowledge Harness는 자동 문서 작성기가 아니다.**
> **Knowledge Harness는 evidence-based proposal system이다.**

기존 이름이 단순히 *Knowledge Harness*였다면, 이제는 더 정확히:

- **Evidence-based Knowledge Harness**
- 또는 **PM Memory Consolidation Harness**

라고 볼 수 있습니다.

이 하네스의 목적은 단순 정리가 아닙니다.

```
agent와 함께 일한 흔적
→ evidence 기반 proposal
→ Lead 병합
→ staging vault 반영
→ 검증
→ human approval
→ canonical/shared/wiki 승격
```

즉, **agent 작업 이력을 프로젝트 기억으로 승격시키는 운영 시스템**입니다.

핵심 원칙은 이 문장으로 요약됩니다.

> **Worker agent는 지식을 쓰지 않는다. Worker agent는 evidence가 붙은 proposal만 만든다. Lead agent만 병합 판단을 하고, Writer는 승인된 plan만 실행한다.**

---

## 2. 최상위 아키텍처

아키텍처는 기존 agent 중심 설계에서 **runtime / policy / verification 중심 설계**로 변경됩니다.

```
Knowledge Harness
├── 1. Runtime Layer
│   ├── RunStateMachine
│   ├── RunLock
│   ├── Checkpoint
│   ├── FeatureGate
│   └── RunArtifactStore
├── 2. Source Layer
│   ├── raw/claude
│   ├── raw/codex
│   ├── raw/opencode
│   ├── raw/code-diffs
│   ├── raw/papers
│   └── raw/experiments
├── 3. Worker Layer
│   ├── ProjectDiscoveryAgent
│   ├── DocumentIntentClassifierAgent
│   ├── ConversationHistoryReaderAgent
│   ├── KnowledgeNodeExtractorAgent
│   ├── CodeChangeHistoryAgent
│   └── ExperimentAndPaperAgent
├── 4. Lead / Coordinator Layer
│   ├── WikiGraphLeadAgent
│   ├── TaskMapperAgent
│   ├── SharedKnowledgePromoterAgent
│   └── ConflictResolverAgent
├── 5. Policy Layer
│   ├── PolicyGuard
│   ├── EvidenceRequirementChecker
│   ├── SecretAndPrivacyScanner
│   ├── SharedPromotionPolicy
│   └── ProtectedDocumentPolicy
├── 6. Write Layer
│   ├── WritePlanGenerator
│   ├── StagingVaultApplier
│   ├── ObsidianWikiWriterAgent
│   └── GraphIndexWriter
├── 7. Verification Layer
│   ├── GraphIntegrityAgent
│   ├── MarkdownYamlValidator
│   ├── ObsidianLinkValidator
│   ├── DuplicateNodeDetector
│   ├── DiffReviewer
│   └── SafetyReportGenerator
└── 8. Memory Consolidation Layer
    ├── KnowledgeConsolidationAgent
    ├── StaleMemoryPruner
    ├── LearnedPatternPromoter
    └── CurrentStateUpdater
```

---

## 3. MVP Agent 구성

처음부터 Claude/Codex/OpenCode 전용 reader를 분리하지 않고, **하나의 범용 reader로 통합**합니다.

### 기존 후보

- `ClaudeHistoryAgent`
- `CodexHistoryAgent`
- `OpenCodeHistoryAgent`

### MVP 추천

- **`ConversationHistoryReaderAgent`**

내부 필드로 구분:

```yaml
source_agent: claude | codex | opencode
source_format: transcript | jsonl | markdown | terminal_log
source_path: raw/claude/...
```

이렇게 하면 초반 복잡도가 줄어듭니다.

---

## 4. MVP에 반드시 필요한 8개 구성

1. **WikiGraphLeadAgent**
2. **ProjectDiscoveryAgent**
3. **DocumentIntentClassifierAgent**
4. **ConversationHistoryReaderAgent**
5. **KnowledgeNodeExtractorAgent**
6. **ObsidianWikiWriterAgent**
7. **GraphIntegrityAgent**
8. **PolicyGuard**

특히 `PolicyGuard`와 `GraphIntegrityAgent`는 **MVP부터 반드시 필요**합니다.

- **PolicyGuard**
  - `raw/` 수정 방지
  - `canonical/` 직접 수정 방지
  - `shared/` 자동 승격 방지
  - `evidence` 없는 node 차단
  - secret 포함 내용 승격 차단

- **GraphIntegrityAgent**
  - broken link 검사
  - duplicate node 검사
  - orphan node 검사
  - `node_id` / `frontmatter` 불일치 검사
  - backlink 누락 검사

이 둘이 없으면 초반부터 위키가 오염됩니다.

---

## 5. 가장 먼저 파일로 만들어야 하는 것

프롬프트보다 **먼저 규칙 파일과 스키마**를 만듭니다.

```
harness/
  harness-rules.md
  feature-gates.yml
  run-state-machine.yml
  schemas/
    node-proposal.schema.yml
    write-plan.schema.yml
    document-intent-report.schema.yml
    task-mapping-report.schema.yml
    validation-report.schema.yml
  prompts/
    wiki-graph-lead.md
    project-discovery.md
    document-intent-classifier.md
    conversation-history-reader.md
    knowledge-node-extractor.md
    obsidian-wiki-writer.md
    graph-integrity.md
    policy-guard.md
```

**우선순위 1:**

1. `harness-rules.md`
2. `node-proposal.schema.yml`
3. `write-plan.schema.yml`
4. `feature-gates.yml`
5. `run-state-machine.yml`

Agent 프롬프트는 그 다음입니다.

---

## 6. Harness Rules (`harness-rules.md` 초안)

이 파일은 **모든 agent가 공통으로 읽어야** 합니다.

```markdown
# Knowledge Harness Rules

## 1. Immutable Sources
- `raw/` 아래 원본은 절대 수정하지 않는다.
- `raw/` 아래 원본은 삭제하지 않는다.
- raw source는 evidence로만 사용한다.
- 민감정보가 포함된 raw source를 그대로 wiki/shared/canonical 문서로 승격하지 않는다.

## 2. Proposal First
- 모든 worker agent는 직접 문서를 수정하지 않는다.
- worker agent는 `NodeProposal`, `DocumentIntentReport`, `TaskMappingReport`만 생성한다.
- worker agent의 출력은 모두 `inbox/proposals/`에 저장한다.
- proposal에는 반드시 evidence가 있어야 한다.

## 3. Lead Merge
- `WikiGraphLeadAgent`만 proposal을 병합할 수 있다.
- Lead는 기존 node와 중복 여부를 반드시 확인한다.
- Lead는 기존 canonical 문서와 충돌 여부를 확인한다.
- Lead는 직접 문서를 쓰지 않고 `WritePlan`을 생성한다.

## 4. Shared Promotion
- shared 승격은 최소 2개 이상의 evidence 또는 2개 이상의 project relevance가 있어야 한다.
- shared 승격은 자동 적용하지 않는다.
- shared 승격은 human review가 필요하다.
- 프로젝트 특수 결정은 shared로 승격하지 않는다.

## 5. Safe Write
- `ObsidianWikiWriterAgent`는 승인된 `WritePlan`만 실행한다.
- `current.md`, `PRD.md`, `ADR-*` 문서는 직접 덮어쓰지 않고 diff proposal을 만든다.
- 삭제는 금지한다.
- 삭제가 필요하면 `deprecated` 또는 `superseded` 상태로 표시한다.

## 6. Evidence
- 모든 `ConceptNode`, `DecisionNode`, `ExperimentNode`는 source reference를 가져야 한다.
- 추론은 `inference_note`에 명시한다.
- evidence 없는 node는 canonical/shared/wiki에 반영하지 않고 proposal 상태로 둔다.
- evidence는 source path와 source id를 포함해야 한다.

## 7. Validation
- write 후 Markdown/YAML validation을 수행한다.
- Obsidian `[[wiki-link]]`가 깨졌는지 확인한다.
- graph node id와 문서 frontmatter의 `node_id`가 일치해야 한다.
- duplicate node, orphan node, broken backlink를 report로 남긴다.

## 8. Human Review
- shared 승격은 human review가 필요하다.
- canonical 문서 수정은 human review가 필요하다.
- secret/privacy 경고가 있는 proposal은 human review 전까지 적용하지 않는다.
```

---

## 7. Feature Gates (`feature-gates.yml` 초안)

초기에는 **자동화를 최대한 막아야** 합니다.

```yaml
features:
  auto_classify_documents: true
  auto_create_node_proposals: true
  auto_create_write_plan: true
  auto_write_to_staging: true
  auto_write_to_real_vault: false
  auto_shared_promotion: false
  auto_deprecate: false
  auto_delete: false
  auto_graph_update: false
  auto_update_current: false
  auto_update_adr: false
  enable_conversation_history_reader: true
  enable_claude_history_reader: false
  enable_codex_history_reader: false
  enable_opencode_history_reader: false
  enable_policy_guard: true
  enable_secret_scan: true
  enable_evidence_required: true
  enable_human_review_for_shared: true
  enable_human_review_for_canonical: true
  use_staging_vault: true
  require_git_diff_before_merge: true
```

**초기 정책 요약:**

| 구분 | 정책 |
|------|------|
| 자동 분류 | 허용 |
| 자동 proposal 생성 | 허용 |
| 자동 staging 반영 | 허용 |
| 실제 vault 자동 반영 | **금지** |
| shared 자동 승격 | **금지** |
| 삭제 | **금지** |
| canonical 자동 수정 | **금지** |

---

## 8. Run State Machine

이제 하네스는 단발성 agent 실행이 아니라 **stateful pipeline**이어야 합니다.

```yaml
run_state_machine:
  states:
    - CREATED
    - PROJECT_SCANNED
    - SOURCES_EXTRACTED
    - DOCUMENTS_CLASSIFIED
    - NODE_PROPOSALS_CREATED
    - LEAD_MERGED
    - WRITE_PLAN_CREATED
    - STAGING_WRITTEN
    - VALIDATED
    - HUMAN_REVIEW_REQUIRED
    - MERGED
    - FAILED
  artifacts:
    PROJECT_SCANNED:
      - ProjectDiscoveryReport
    SOURCES_EXTRACTED:
      - SourceInventoryReport
      - ConversationHistoryReport
    DOCUMENTS_CLASSIFIED:
      - DocumentIntentReport
    NODE_PROPOSALS_CREATED:
      - NodeProposal[]
    LEAD_MERGED:
      - GraphUpdatePlan
      - SharedPromotionPlan
      - StaleDocReport
    WRITE_PLAN_CREATED:
      - WritePlan
    STAGING_WRITTEN:
      - AppliedWriteReport
      - GitDiffReport
    VALIDATED:
      - GraphValidationReport
      - LinkValidationReport
      - SecretScanReport
      - MarkdownYamlValidationReport
```

### 장점

- 실패한 단계부터 재실행 가능
- agent output을 artifact로 추적 가능
- PM dashboard에서 run 상태 표시 가능
- 나중에 Temporal workflow로 옮기기 쉬움

---

## 9. 핵심 Schema

### 9.1 NodeProposal Schema

`NodeProposal`은 단순 요약이 아니라 **claim + evidence 묶음**이어야 합니다.

```yaml
proposal_id: NP-20260602-001
proposal_type: create_or_update_node
proposed_by: conversation-history-reader
source_type: agent_session
created_at: 2026-06-02T00:00:00+09:00
node:
  id: transcript-log-resolver
  type: ConceptNode
  scope: shared_candidate
  title: Transcript/Log Resolver
  summary: >
    Agent별 공식 transcript/log를 찾아 NormalizedSession으로 변환하는 모듈.
  project_ids:
    - ai-pm-workbench
  tags:
    - agent-session
    - llm-wiki
    - evidence-based-ingest
claims:
  - claim_id: CL-001
    text: >
      LLM Wiki ingest는 terminal 화면 출력보다 agent별 transcript/log를 기준으로 해야 한다.
    claim_type: design_principle
    confidence: high
    inference: false
    evidence_ids:
      - EV-001
      - EV-002
evidence:
  - evidence_id: EV-001
    source_id: claude-session-20260602-001
    source_path: raw/claude/session-001.jsonl
    evidence_type: decision
    quote_or_summary: >
      terminal output보다 transcript_path를 사용하는 방향이 논의됨.
    confidence: high
  - evidence_id: EV-002
    source_id: docs-agent-session-manager
    source_path: projects/ai-pm-workbench/wiki/agent-session-manager.md
    evidence_type: existing_doc
    quote_or_summary: >
      Agent Session Manager 설계에 transcript/log resolver가 포함됨.
    confidence: medium
claim_policy:
  minimum_evidence_count: 2
  requires_direct_source: true
  allow_inference: true
  inference_note_required: true
actions:
  - action_type: create_or_update
    target_path: _shared/concepts/transcript-log-resolver.md
  - action_type: add_backlink
    target_path: projects/ai-pm-workbench/current.md
risk:
  level: low
  reason: 새 shared concept 생성이며 raw source 수정 없음.
review:
  requires_human_review: true
  reviewer_question: shared 승격이 맞는가?
```

이 정도 schema를 고정해야 **hallucination wiki**를 막을 수 있습니다.

### 9.2 WritePlan Schema

Writer는 아무 판단도 하면 안 됩니다. Writer는 `WritePlan`만 실행해야 합니다.

```yaml
write_plan_id: WP-20260602-001
created_by: wiki-graph-lead
based_on_proposals:
  - NP-20260602-001
  - NP-20260602-002
target_vault: vault-staging
requires_human_approval: true
operations:
  - op: create_file
    path: _shared/concepts/transcript-log-resolver.md
    source_proposal: NP-20260602-001
    content_template: concept_node
    risk: medium
  - op: update_frontmatter
    path: projects/ai-pm-workbench/wiki/agent-session-manager.md
    changes:
      related:
        add:
          - "[[transcript-log-resolver]]"
    risk: low
  - op: add_backlink
    path: projects/ai-pm-workbench/current.md
    link: "[[transcript-log-resolver]]"
    mode: proposal_only
    risk: high
    reason: current.md is canonical
forbidden_operations_checked:
  raw_modified: false
  delete_operation: false
  canonical_direct_overwrite: false
validation_required:
  - markdown_yaml_validation
  - obsidian_link_validation
  - graph_integrity_validation
  - secret_scan
  - git_diff_review
```

이렇게 해야 Writer가 안전하게 동작합니다.

---

## 10. Staging Vault 구조

실제 vault에 바로 쓰지 않는 구조는 **꼭 필요**합니다.

```
workspace/
  vault/
    실제 Obsidian vault
  vault-staging/
    agent가 write plan을 적용하는 임시 vault
  runs/
    RUN-20260602-001/
      inputs/
      artifacts/
      proposals/
      write-plan.yml
      validation/
      diff.patch
      final-report.md
  raw/
    claude/
    codex/
    opencode/
```

### 실행 흐름

1. 실제 vault를 staging으로 복사하거나 git worktree 생성
2. writer는 **staging에만** write
3. validator 실행
4. git diff 생성
5. 사람이 확인
6. merge 또는 폐기

이렇게 해야 안전합니다.

---

## 11. Eval Harness 지표

처음부터 복잡한 평가 시스템은 아니어도, 아래 지표는 **자동으로 뽑아야** 합니다.

```yaml
eval_report:
  coverage:
    raw_sources_total: 42
    raw_sources_classified: 31
    task_mapped_sources: 18
    unmapped_sources: 11
  evidence_quality:
    node_proposals_total: 20
    proposals_without_evidence: 2
    proposals_with_minimum_evidence: 15
    inference_without_note: 1
  graph_quality:
    orphan_nodes: 3
    duplicate_candidates: 4
    broken_links: 2
    missing_backlinks: 5
  safety:
    raw_modified: false
    secret_warnings: 1
    canonical_direct_overwrite_attempts: 0
    delete_attempts: 0
  usefulness:
    current_update_proposals: 3
    next_task_candidates: 7
    shared_promotion_candidates: 2
```

이걸 대시보드에 붙이면 PM 관점에서도 가치가 큽니다.

---

## 12. PRD에 반영할 핵심 변경

PRD에는 아래 문단을 추가합니다.

> Knowledge Harness는 자동 문서 작성기가 아니다.
> Knowledge Harness는 evidence-based proposal system이다.
> Worker agent는 raw source와 기존 문서를 읽고 proposal을 생성한다.
> Lead agent는 proposal을 검토하고 병합하여 WritePlan을 만든다.
> Writer agent는 승인된 WritePlan만 staging vault에 적용한다.
> Validator는 staging 결과를 검사한다.
> Human reviewer는 diff와 validation report를 보고 실제 vault 반영 여부를 결정한다.

### MVP Feature Gate 정책

- `auto-write-to-real-vault`, `auto-shared-promotion`, `auto-deprecate`, `auto-delete`는 **지원하지 않는다**.
- MVP는 **proposal generation, staging write, validation, human review**까지 지원한다.

---

## 13. 구현 로드맵

### Step 1. 규칙과 schema부터 작성

- `harness-rules.md`
- `feature-gates.yml`
- `run-state-machine.yml`
- `node-proposal.schema.yml`
- `write-plan.schema.yml`
- `validation-report.schema.yml`

### Step 2. vault/staging/runs 구조 만들기

- `vault/`
- `vault-staging/`
- `runs/`
- `raw/`
- `inbox/proposals/`

### Step 3. MVP agent prompt 작성

- `wiki-graph-lead.md`
- `project-discovery.md`
- `document-intent-classifier.md`
- `conversation-history-reader.md`
- `knowledge-node-extractor.md`
- `obsidian-wiki-writer.md`
- `graph-integrity.md`
- `policy-guard.md`

### Step 4. 첫 run을 수동으로 실행

1. `project-discovery`
2. `document-intent-classifier`
3. `conversation-history-reader`
4. `knowledge-node-extractor`
5. `wiki-graph-lead`
6. `writer to staging`
7. `graph-integrity`
8. `policy-guard`

### Step 5. 결과를 보고 prompt/schema 수정

초기에는 agent 결과가 많이 흔들릴 겁니다.
그래서 바로 자동화하지 말고, **artifact 품질을 먼저 안정화**해야 합니다.

---

## 14. 결론

**최종 원칙:**

| 역할 | 책임 |
|------|------|
| **Raw** | 불변 |
| **Worker** | proposal만 생성 |
| **Lead** | merge만 수행 |
| **Writer** | plan만 실행 |
| **Validator** | 검증만 수행 |
| **Human** | canonical/shared 승인 |

이 원칙을 지키면 이 하네스는 단순 문서 정리 도구가 아니라,
**AI agent와 함께 일한 모든 흔적을 안전하게 프로젝트 기억으로 승격시키는 PM용 Knowledge Operating System**이 됩니다.
