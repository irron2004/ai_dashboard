---
title: Knowledge Harness — MVP 8-agent Pipeline 구현 설계
date: 2026-06-02
status: draft
owner: irron2004
relates:
  - 2026-06-02-knowledge-harness-design.md (제품/아키텍처 스펙)
  - 2026-06-02-generate-llm-wiki-ui-design.md (기존 one-shot GenerateService)
---

# Knowledge Harness — MVP 8-agent Pipeline 구현 설계

## 0. 목적과 범위

상위 설계 문서(`2026-06-02-knowledge-harness-design.md`)는 **제품/아키텍처** 스펙이다.
이 문서는 그것을 **이 모노레포에서 어떤 패키지·모듈·계약으로 구현하는지**를 고정한다.

핵심 원칙(상위 문서에서 그대로 계승):

> Worker는 proposal만, Lead는 merge만, Writer는 plan만, Validator는 검증만, Human이 canonical/shared 승인. Raw는 불변.

### 범위 (MVP)

- **In**: 설계 §4의 MVP 8개 구성(ProjectDiscovery, DocumentIntentClassifier, ConversationHistoryReader,
  KnowledgeNodeExtractor, WikiGraphLead, ObsidianWikiWriter, GraphIntegrity, PolicyGuard) +
  RunStateMachine + staging vault + validation + eval report.
- **In**: 실행 표면 두 가지 — standalone CLI(`knowledge-harness`)와 데스크톱 IPC/UI.
- **Out (P1+)**: CodeChangeHistory/ExperimentAndPaper agent, shared 자동 승격, real-vault 자동 반영,
  자동 삭제/deprecate, git-worktree 기반 staging, 다중 세션 synthesis, 스케줄 실행.

### 기존 자산과의 관계

기존 `GenerateService`(one-shot: 최신 세션 → `WikiEngine` 1회 호출 → `current.proposal.md`)는 **건드리지 않는다.**
새 파이프라인은 별도 패키지 `@apc/knowledge-harness`로 병행하며, 아래 기존 자산을 재사용한다.

| 기존 자산 | harness에서의 역할 |
|---|---|
| `AgentIngestAdapter`(claude/codex/opencode) → `NormalizedSession` (`@apc/agents`) | ConversationHistoryReader 입력 소스 |
| `AgentRunner` / `CliAgentRunner` / `FakeAgentRunner` (`@apc/llm-wiki`) | 모든 LLM agent의 실행 백엔드 |
| `unwrapAgentJson` / `parseStructured` (`@apc/llm-wiki`) | LLM 출력 → Zod 파싱 |
| `VaultAdapter.readDoc` (`@apc/vault`), `VaultWriter` (`@apc/pm`) | staging vault read/write |
| `CurrentPromotionService` (hash-gated) (`@apc/app-services`) | `current.md` human-approved merge |
| `ProjectRegistry` (`@apc/core`) | 프로젝트·repoPath 조회 |

---

## 1. 패키지 경계

- **새 패키지** `@apc/knowledge-harness` (`packages/knowledge-harness/`): 런타임 + 8 agents + policy + verify + staging + eval + CLI.
- **계약 스키마는 `@apc/shared`에** 새 파일 `kh-schema.ts`로 추가한다. 이유: 데스크톱 렌더러가 report 타입을 표시해야 하므로 공유가 필요하고, 기존 `wiki-schema.ts`/`ingest-schema.ts`와 같은 위치에 두는 것이 일관적이다.
  - 기존 `packages/shared/src/harness-schema.ts`는 task-profile 용도라 이름 충돌을 피하려 신규 파일은 `kh-` 프리픽스(`KhNodeProposalSchema` 등 export, 또는 파일 단위 분리)로 둔다.
- 의존: `@apc/shared`, `@apc/agents`, `@apc/vault`, `@apc/pm`, `@apc/core`, `@apc/llm-wiki`.

---

## 2. 모듈 레이아웃

```
packages/knowledge-harness/
  package.json                  # name: @apc/knowledge-harness, bin: knowledge-harness → dist/cli.js
  src/
    index.ts
    cli.ts                      # run | show | promote
    runtime/
      run-state-machine.ts      # 12 states + 합법 전이 (TS가 source of truth)
      harness-runner.ts         # 오케스트레이터: 상태 구동·artifact 영속·resume
      run-artifact-store.ts     # runs/RUN-*/ 읽기·쓰기
      run-lock.ts               # 프로젝트당 1 run (lockfile)
      feature-gate.ts           # harness/feature-gates.yml 로드 + gate(name)
    agents/
      llm-agent.ts              # 공통 base: rules+role prompt → run → unwrapAgentJson → parseStructured
      project-discovery.ts
      document-intent-classifier.ts
      conversation-history-reader.ts
      knowledge-node-extractor.ts
      wiki-graph-lead.ts
      obsidian-wiki-writer.ts   # WritePlan을 staging에 실행
    policy/
      policy-guard.ts           # 결정론 코어 (+ 선택적 LLM secret 의미판정)
      secret-scanner.ts         # regex 카탈로그
    verify/
      graph-integrity.ts
      markdown-yaml-validator.ts
      obsidian-link-validator.ts
    staging/
      staging-vault.ts          # vault → vault-staging 복사, git diff
    eval/
      eval-report.ts
    prompts/
      preamble.ts               # harness-rules.md 주입
      *.ts                      # 6개 LLM agent role 프롬프트 빌더
```

`harness/` 설정 디렉터리(설계 §5)는 **런타임 config**로 둔다.

- `harness/feature-gates.yml` — 런타임에 읽음(재빌드 없이 편집 가능).
- `harness/harness-rules.md` — 모든 LLM 프롬프트의 preamble로 주입.
- `harness/run-state-machine.yml` — **문서용**. 실제 source of truth는 `runtime/run-state-machine.ts`의 TS 상수(테스트 가능).
- `harness/schemas/*.yml`, `harness/prompts/*.md` — 사람이 읽는 참조본. 실제 강제는 Zod 스키마와 `prompts/*.ts`.

---

## 3. Agent 계약

```ts
interface Agent<I, O> {
  readonly name: string
  run(input: I, ctx: HarnessContext): Promise<O>
}

type HarnessContext = {
  runId: string
  projectId: string
  engine: AgentType
  gates: FeatureGate
  store: RunArtifactStore
  vault: VaultAdapter           // 실제 vault read
  staging: StagingVault         // vault-staging write
  vaultWriter: VaultWriter
  registry: ProjectRegistry
  runner: AgentRunner           // LLM 백엔드 (CliAgentRunner | FakeAgentRunner)
  now: () => string
}
```

### LLM agent (6개)

`LlmAgent` base가 처리:

1. 프롬프트 조립 = `harness-rules.md` preamble + role 프롬프트 + 입력 artifact JSON.
2. `ctx.runner.run({ agent: ctx.engine, prompt, timeoutMs })`.
3. `unwrapAgentJson(res.output, ctx.engine)` → `parseStructured(json, ZodSchema)`.
4. 실패 시 `ok:false`를 그대로 올려 runner가 `FAILED` 처리.

대상: ProjectDiscovery, ConversationHistoryReader, DocumentIntentClassifier, KnowledgeNodeExtractor, WikiGraphLead, ObsidianWikiWriter.

### 결정론 agent (PolicyGuard, GraphIntegrity, 3 validators)

평범한 클래스로 구현하고 fixture로 단위 테스트한다.

> **설계 결정 — PolicyGuard·GraphIntegrity는 결정론 코어 + 선택적 LLM 보조.**
> 이 둘은 위키 오염을 막는 안전망이라 "대체로 통과" 식 LLM 판정은 위험하고 테스트도 불가능하다.
> 따라서 핵심 검사(경로/삭제/덮어쓰기/evidence/secret regex, broken-link/duplicate/orphan/node_id)는
> 결정론 TS로 구현한다. "이 요약에 의미상 민감정보가 있나?" 같은 애매 판정만 `enable_secret_scan`
> 하위의 선택적 LLM 보조 레이어로 얹는다(기본 off).

---

## 4. 파이프라인 (state → driver → artifact → gate)

| 전이 | Driver | 산출물 | Gate |
|---|---|---|---|
| CREATED → PROJECT_SCANNED | ProjectDiscovery (LLM) | `ProjectDiscoveryReport` | — |
| → SOURCES_EXTRACTED | ConversationHistoryReader (LLM), ingest adapters 위 | `SourceInventoryReport`, `ConversationHistoryReport` | `enable_conversation_history_reader` |
| → DOCUMENTS_CLASSIFIED | DocumentIntentClassifier (LLM) | `DocumentIntentReport` | `auto_classify_documents` |
| → NODE_PROPOSALS_CREATED | KnowledgeNodeExtractor (LLM) | `NodeProposal[]` → `inbox/proposals/` | `auto_create_node_proposals` |
| (검문) | PolicyGuard (det.) | `PolicyReport` — evidence 無/secret 포함 차단 | `enable_policy_guard`, `enable_evidence_required`, `enable_secret_scan` |
| → LEAD_MERGED | WikiGraphLead (LLM) | `GraphUpdatePlan`, `SharedPromotionPlan`, `StaleDocReport` | — |
| → WRITE_PLAN_CREATED | WikiGraphLead | `WritePlan` | `auto_create_write_plan` |
| → STAGING_WRITTEN | StagingVault + ObsidianWikiWriter (`WritePlan` 실행) | `AppliedWriteReport`, `GitDiffReport`(`diff.patch`) | `auto_write_to_staging`, `use_staging_vault` |
| → VALIDATED | GraphIntegrity + Md/Yaml + Link + SecretScan | `GraphValidationReport`, `LinkValidationReport`, `MarkdownYamlValidationReport`, `SecretScanReport` | — |
| → HUMAN_REVIEW_REQUIRED | 항상 (MVP: `auto_write_to_real_vault=false`) | `final-report.md` + `EvalReport` | `enable_human_review_for_shared`, `enable_human_review_for_canonical` |
| (사람) → MERGED | CurrentPromotionService(`current.md`, hash-gated) + staging→vault apply | — | 사람 액션 (CLI `promote` / UI Promote) |
| any → FAILED | 에러 시 | run state에 error 기록 | — |

**Gate 동작:** 전이 직전 해당 gate가 false면 그 state에서 멈춘다(파이프라인 종료 또는 `HUMAN_REVIEW_REQUIRED`).
**PolicyGuard 검문:** `NODE_PROPOSALS_CREATED` 직후, Lead 병합 전에 실행. blocking violation이 있으면 해당 proposal을 제외하거나(비차단) run을 보류(차단)한다.
**Resume:** `harness-runner`는 `RunArtifactStore`에 저장된 직전 state의 artifact를 입력으로 삼아 `--from <state>`부터 재실행한다.

---

## 5. 계약 스키마 (Zod, `@apc/shared/kh-schema.ts`)

상위 설계 문서의 YAML을 Zod로 미러링한다. 각 LLM agent는 **자기 출력 스키마로 `parseStructured`** 하여 hallucination을 차단한다.

- `NodeProposalSchema` — `proposal_id`, `proposal_type`, `proposed_by`, `node`{id,type,scope,title,summary,project_ids,tags}, `claims[]`{claim_id,text,claim_type,confidence,inference,evidence_ids}, `evidence[]`{evidence_id,source_id,source_path,evidence_type,quote_or_summary,confidence}, `claim_policy`, `actions[]`, `risk`, `review`.
- `WritePlanSchema` — `write_plan_id`, `created_by`, `based_on_proposals[]`, `target_vault`, `requires_human_approval`, `operations[]`{op,path,…,risk}, `forbidden_operations_checked`, `validation_required[]`.
- `ProjectDiscoveryReportSchema`, `SourceInventoryReportSchema`, `ConversationHistoryReportSchema`, `DocumentIntentReportSchema`.
- `GraphUpdatePlanSchema`, `SharedPromotionPlanSchema`, `StaleDocReportSchema`.
- 검증: `GraphValidationReportSchema`, `LinkValidationReportSchema`, `MarkdownYamlValidationReportSchema`, `SecretScanReportSchema`, `PolicyReportSchema`.
- `EvalReportSchema` — coverage/evidence_quality/graph_quality/safety/usefulness (설계 §11).
- `RunStateSchema` — `runId`, `projectId`, `engine`, `state`, `history[]`{state,at}, `error?`, `artifacts`{state→경로}.

각 스키마는 `z.infer`로 타입을 함께 export하고, 단위 테스트(`kh-schema.test.ts`)로 round-trip을 검증한다.

---

## 6. Runtime

### 6.1 RunStateMachine (`runtime/run-state-machine.ts`)

설계 §8의 12 state를 TS 상수로 고정하고 합법 전이 맵을 둔다. 불법 전이는 throw. 각 state의 기대 artifact 목록도 여기서 선언해 `RunArtifactStore`가 검증한다.

### 6.2 RunArtifactStore (`runtime/run-artifact-store.ts`)

`runs/RUN-<stamp>/` 구조를 읽고 쓴다(설계 §11 구조).

```
runs/RUN-20260602-001/
  run.json            # RunState (현재 state, history, artifact 인덱스)
  inputs/
  artifacts/<STATE>/*.json|*.yml
  proposals/NP-*.yml
  write-plan.yml
  validation/*.json
  diff.patch
  final-report.md
```

artifact 저장 시 `run.json`의 history/artifacts 인덱스를 갱신해 resume·조회를 지원한다.

### 6.3 RunLock — 프로젝트당 동시 1 run (lockfile, stale lock 타임아웃 포함).

### 6.4 FeatureGate (`runtime/feature-gate.ts`) — `harness/feature-gates.yml`를 로드(설계 §7의 22개 플래그). `gate(name): boolean`, 미정의 플래그는 안전을 위해 false로 간주.

### 6.5 HarnessRunner (`runtime/harness-runner.ts`)

오케스트레이터. `run({ projectId, engine, from?, dryRun? })`:

1. RunLock 획득 → RunState 생성/로드.
2. 현재 state부터 전이 표(§4) 순서대로 진행: gate 확인 → driver 실행 → artifact 저장 → state 갱신.
3. 에러 시 `FAILED` 기록 후 중단. `dryRun`이면 staging write를 건너뛰고 계획만 산출.
4. `HUMAN_REVIEW_REQUIRED` 또는 `FAILED`에서 종료하며 요약 반환: `{ runId, finalState, evalReportPath, diffPath, reportPath }`.

---

## 7. Policy / Verification

### 7.1 PolicyGuard (`policy/policy-guard.ts`, 결정론)

- `target_path`가 `raw/` 아래면 차단.
- 삭제 op면 차단(`auto_delete=false`).
- canonical(`current.md`, `PRD.md`, `ADR-*`) 직접 overwrite면 차단 → `mode: proposal_only`로 강등.
- evidence 없는 node 차단. `scope: shared_candidate`는 evidence ≥ 2 요구(`claim_policy.minimum_evidence_count`).
- secret regex 적중 시 flag → `requires_human_review`.
- 산출: `PolicyReport`{violations[], blocked_proposal_ids[]}.

### 7.2 SecretScanner (`policy/secret-scanner.ts`) — API 키/토큰/private key/이메일+비밀번호 등 regex 카탈로그. 선택적 LLM 의미판정 레이어(기본 off).

### 7.3 GraphIntegrity (`verify/graph-integrity.ts`, 결정론, staging vault 대상)

- broken `[[wiki-link]]` (대상 노드 파일 부재)
- duplicate `node_id` (여러 파일이 동일 id)
- orphan node (inbound backlink 없음)
- frontmatter `node_id` ↔ 파일/노드 id 불일치
- missing backlink (A→B 링크인데 B에 backlink 없음)

### 7.4 Markdown/YAML validator, Obsidian link validator — frontmatter YAML 파싱 가능 여부, 링크 문법, 코드펜스 무결성.

---

## 8. Staging Vault (`staging/staging-vault.ts`)

- `prepare()`: `vault/` → `vault-staging/` fs 복사(MVP). Writer는 **staging에만** write.
- `diff()`: `git diff --no-index vault vault-staging` → `runs/RUN-*/diff.patch`.
- `applyToRealVault()`: human 승인 후에만 호출(MVP에서는 CLI/UI promote 경로). `current.md`는 `CurrentPromotionService`(hash-gated)로, 그 외 신규/관련 노드는 staging→vault 파일 복사로 반영.
- P1: git worktree 기반으로 교체.

---

## 9. 실행 표면

### 9.1 CLI (`src/cli.ts`, bin `knowledge-harness`)

- `knowledge-harness run --project <id> --engine <claude|codex|opencode> [--from <STATE>] [--dry-run]`
- `knowledge-harness show <runId>` — RunState/artifact/eval 요약 출력.
- `knowledge-harness promote <runId>` — human 승인 후 staging→vault 반영(gated).
- 설정은 `harness/feature-gates.yml`·`harness/harness-rules.md`에서 읽는다.

### 9.2 데스크톱

- IPC 채널 추가(`apps/desktop/src/shared/ipc-contract.ts`):
  - `c:harnessRun` `{ projectId, engine }` → `{ ok, runId?, finalState?, evalReport?, diffPath?, reportPath?, reason? }`
  - `c:harnessGetRun` `{ runId }` → `RunState` + artifact 인덱스
  - `c:harnessPromote` `{ runId, lastReadHash }` → promote 결과(충돌 시 conflict doc)
- `apps/desktop/src/main/container.ts`에 `GenerateService`와 동일 패턴으로 `HarnessRunner` DI(주입형 `AgentRunner` 유지 → 테스트는 `FakeAgentRunner`).
- UI: 기존 Generate 옆 "Harness" 액션 → run state 타임라인 + proposals + validation reports + diff 미리보기 + eval 지표 + **Promote/Discard** 패널.

---

## 10. 테스트 전략

- **LLM agent**: `FakeAgentRunner`에 agent별 canned JSON 주입 → artifact 파싱 + state 전이 검증.
- **PolicyGuard/GraphIntegrity/validators**: fixture vault로 순수 단위 테스트(각 violation 케이스).
- **HarnessRunner**: `FakeAgentRunner`로 CREATED→HUMAN_REVIEW_REQUIRED 전 구간 통과 + mid-state `--from` resume.
- **StagingVault**: temp dir 복사 + `git diff --no-index` 산출 확인.
- **kh-schema**: Zod round-trip.
- `pnpm test` green 유지(기존 테스트 불변).

---

## 11. 구현 단계 (writing-plans 골격)

- **Phase 1 — 계약 + 런타임 골격**
  `kh-schema`(shared), RunStateMachine, RunArtifactStore, RunLock, FeatureGate, HarnessRunner 셸, `harness/` config 파일.
  fake artifact로 전 state 전이 + `runs/RUN-*/` 기록까지 end-to-end 동작.
- **Phase 2 — Worker + Lead + Writer (LLM) + Staging**
  ProjectDiscovery, ConversationHistoryReader, DocumentIntentClassifier, KnowledgeNodeExtractor, WikiGraphLead, ObsidianWikiWriter + StagingVault.
  실제 `NodeProposal[]` → `WritePlan` → staging write → `diff.patch`.
- **Phase 3 — Policy + Verify + Eval**
  PolicyGuard, SecretScanner, GraphIntegrity, Markdown/YAML/Link validator, EvalReport.
- **Phase 4 — 표면**
  CLI(run/show/promote) + 데스크톱 IPC/UI + promote 경로(`CurrentPromotionService` 재사용).

각 Phase는 독립 PR 가능하며, Phase 1만으로도 `runs/` 산출물·resume이 검증된다.

---

## 12. 수용 기준 (MVP)

1. `knowledge-harness run --project <id> --engine claude`가 CREATED→…→HUMAN_REVIEW_REQUIRED를 완주하고 `runs/RUN-*/`에 artifact·`diff.patch`·`final-report.md`·EvalReport를 남긴다.
2. 생성된 `NodeProposal`은 모두 evidence를 가지며(설계 §6.6), evidence 없는 proposal은 PolicyGuard가 차단한다.
3. Writer는 `WritePlan`만 실행하고 **staging에만** write한다. 실제 `vault/`는 promote(사람 승인) 전까지 불변이다.
4. `raw/` 수정·삭제·canonical 직접 overwrite 시도는 PolicyGuard가 0건으로 보고하거나 차단한다.
5. GraphIntegrity가 broken link/duplicate/orphan/node_id 불일치/missing backlink를 report로 남긴다.
6. 실패한 state에서 `--from <STATE>`로 resume이 가능하다.
7. 데스크톱에서 Harness 실행 → run 상태·diff·eval을 보고 Promote로 `current.md`가 hash-gated로 반영된다.
8. `pnpm test` green 유지, 새 로직은 `FakeAgentRunner`/fixture로 단위 테스트된다.

---

## 13. 비목표 / 리스크

- LLM 출력 품질은 초기에 흔들린다 → Phase 1~2에서 **artifact 품질을 먼저 안정화**하고 자동화는 뒤로(설계 §13 Step 5).
- CLI headless 동작은 agent/버전 의존(기존 `CliAgentRunner` 주의사항 계승) → 실패는 `ok:false`로 표면화.
- staging fs 복사는 대형 vault에서 느릴 수 있음 → P1 git worktree로 교체.
- shared 자동 승격·real-vault 자동 반영·자동 삭제는 **MVP 미지원**(feature gate false 고정).

---

## 14. MVP 구현 narrowing (팀 리뷰 2026-06-03 반영)

구현이 상위 설계 대비 **의도적으로 좁힌** 지점을 명시한다(스펙과 코드 일치 목적).

- **안전 불변식은 결정론으로 강제** — LLM 프롬프트가 아니라 코드로 보장한다:
  - canonical(`current.md`/`PRD.md`/`ADR-*`)은 `ObsidianWikiWriter`가 op.mode와 무관하게 항상
    `.proposal.md`로 라우팅하고, `HarnessPromoteService`가 applied[]의 canonical 경로 복사를 거부한다.
  - secret이 staging에 있으면 `HarnessPromoteService.promote`가 거부한다(`allowSecrets`로만 override).
  - 모든 staging write/promote 경로는 `resolveInside`(separator 경계)로 경로 탈출을 막는다.
  - `raw/` write·delete는 PolicyGuard가 block(run FAILED).
- **feature gate는 5개만 런타임 소비**(PIPELINE step.gate). 나머지는 forward-declared이며 **fail-safe로
  항상 켜진 안전 검사**를 토글하지 않는다(§4 게이트 표의 일부는 P1에서 per-flag wiring 예정).
  `auto_write_to_real_vault=false`는 vault를 "지키는" 플래그가 아니다 — promote가 그것을 읽지 않으며,
  vault는 구조적으로(자동 파이프라인은 staging에만 write, promote는 사람이 트리거) 보호된다.
- **canonical `current.md` hash-gated 병합(수용 기준 #7)은 MVP 미연결.** harness promote는 canonical을
  `.proposal.md`로만 남기고 사람이 Obsidian에서 병합한다. 구조화된 `projects/<id>/current.md`의
  hash-gated 경로는 기존 `CurrentPromotionService`(별도 `promoteCurrent` 채널) 소관 — harness promote에
  `lastReadHash`를 통합하는 것은 P1.
- **RunLock는 `HarnessService.run`에 연결됨**(프로젝트당 in-process 1 run). 단 cross-process 배타성 +
  stale-lock timeout(§6.3)은 P1. **Resume**는 runtime(`HarnessRunner.advance`)에서 동작하고 테스트되나,
  CLI `--from <STATE>`/전용 IPC는 P1(현재 `HarnessService.run`은 항상 새 runId 생성).
