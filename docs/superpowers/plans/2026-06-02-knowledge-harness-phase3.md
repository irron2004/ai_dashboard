# Knowledge Harness — Phase 3 (Policy + Verify + Eval) Implementation Plan

> REQUIRED SUB-SKILL: superpowers:test-driven-development. All Phase 3 modules are DETERMINISTIC —
> pure functions/classes over fixtures, no LLM. This is the safety net, so it must be fully testable.

**Goal:** 위키 오염을 막는 결정론 안전망을 추가한다 — PolicyGuard(+SecretScanner), GraphIntegrity,
Markdown/YAML/Link validator, EvalReport. 그리고 이들을 Phase 2 파이프라인의 검문 지점에 연결한다:
PolicyGuard는 `NODE_PROPOSALS_CREATED` 직후(차단 가능), validators는 `VALIDATED`, EvalReport는
`HUMAN_REVIEW_REQUIRED`. `harness-runner.ts`는 여전히 불변(makeDrivers만 확장).

**Architecture:** 설계 §3의 결정. PolicyGuard/GraphIntegrity는 "대체로 통과"식 LLM 판정이 위험하므로
순수 결정론 TS. 선택적 LLM 의미판정 레이어는 기본 off(Phase 3 비포함). 각 모듈은 fixture로 모든
violation 케이스를 단위 테스트한다.

**Tech Stack:** TS, Zod(@apc/shared 신규 report 스키마), `node:fs` (staging vault 스캔), 정규식.
외부 의존 추가 없음(YAML frontmatter는 경량 파서 — feature-gate와 동일 철학의 subset, 또는 기존
`@apc/shared` 패턴 재사용). Vitest fixtures.

---

## Task 1: 검증 report 스키마 (shared/kh-schema.ts)

추가: `KhPolicyReportSchema`, `KhSecretScanReportSchema`, `KhGraphValidationReportSchema`,
`KhLinkValidationReportSchema`, `KhMarkdownYamlValidationReportSchema`.
각 report는 `{ ok: boolean, violations/findings: [...] }` 모양으로 round-trip 테스트.

- [ ] Step1 failing test (parse defaults) → Step2 fail → Step3 implement → Step4 pass → commit
  `feat(shared): kh-schema verify/policy report schemas`.

```ts
export const KhPolicyReportSchema = z.object({
  generated_by: z.string().default('policy-guard'),
  ok: z.boolean().default(true),
  blocked_proposal_ids: z.array(z.string()).default([]),
  violations: z.array(z.object({
    proposal_id: z.string().default(''),
    rule: z.string(),                 // raw_write | delete | canonical_overwrite | no_evidence | secret | shared_evidence_min
    severity: z.enum(['block', 'warn']).default('warn'),
    detail: z.string().default(''),
  })).default([]),
})
// KhSecretScanReport: { ok, findings:[{ source, rule, match_preview }] }
// KhGraphValidationReport: { ok, broken_links:[], duplicate_node_ids:[], orphan_nodes:[], node_id_mismatches:[], missing_backlinks:[] }
// KhLinkValidationReport: { ok, broken:[{ from, to }] }
// KhMarkdownYamlValidationReport: { ok, problems:[{ path, kind, detail }] }
```

---

## Task 2: SecretScanner (policy/secret-scanner.ts)

regex 카탈로그: AWS/Google API key, generic `sk-...`/bearer token, private key header
(`-----BEGIN ... PRIVATE KEY-----`), `password=`. `scan(text, sourceLabel)` → findings[]; 매치 미리보기는
마스킹(앞 4글자 + `***`). 빈 텍스트/클린 텍스트는 `[]`.

- [ ] TDD: fixture에 각 secret 종류 한 줄씩 → 모두 탐지, 클린 라인은 미탐지. Commit
  `feat(knowledge-harness): SecretScanner — regex catalog with masked previews`.

---

## Task 3: PolicyGuard (policy/policy-guard.ts, 결정론)

입력: `KhNodeProposal[]` + `KhWritePlan?`. 규칙(설계 §7.1):
- `node.scope==='shared_candidate'` 인데 evidence < 2 → `shared_evidence_min` (block).
- claim/evidence 없는 proposal → `no_evidence` (block, `enable_evidence_required`).
- write op path가 `raw/` → `raw_write` (block).
- delete op → `delete` (block).
- canonical(`current.md`,`PRD.md`,`ADR-*`) 직접 overwrite(mode!=='proposal_only') → `canonical_overwrite`
  (warn + 권고: writer가 어차피 proposal_only로 강등; 여기선 warn).
- evidence quote에 SecretScanner 매치 → `secret` (warn → requires_human_review).
출력 `KhPolicyReport`. `blocked_proposal_ids`에 block된 proposal id 수집. `ok = violations에 block 없음`.

- [ ] TDD: clean proposals → ok:true/빈 violations. 각 위반 fixture → 해당 rule+severity. Commit
  `feat(knowledge-harness): PolicyGuard — deterministic proposal/write-plan policy checks`.

---

## Task 4: GraphIntegrity (verify/graph-integrity.ts) — staging vault 대상

vault 디렉터리의 `*.md`를 읽어 frontmatter(`node_id`)와 본문 `[[wiki-link]]`를 수집:
- broken_links: `[[X]]` 인데 X.md(또는 node_id X) 부재.
- duplicate_node_ids: 같은 node_id를 가진 파일 ≥2.
- orphan_nodes: inbound `[[..]]` 없는 노드.
- node_id_mismatches: frontmatter node_id ≠ 파일 stem(규약 위반).
- missing_backlinks: A→B 링크인데 B에 A로의 backlink 없음.
출력 `KhGraphValidationReport`, `ok = 모든 목록 빈 경우`.

- [ ] TDD: fixture vault(temp dir)로 각 케이스. Commit
  `feat(knowledge-harness): GraphIntegrity — broken/dup/orphan/mismatch/backlink checks`.

---

## Task 5: Markdown/YAML + Obsidian link validator (verify/)

- markdown-yaml-validator: frontmatter 블록(`---\n...\n---`)이 파싱 가능한지(경량 key:val), 코드펜스
  짝(```)이 맞는지. 문제 → `problems[]`.
- obsidian-link-validator: `[[..]]` 문법 정합성(빈 링크, 닫히지 않은 `[[`). GraphIntegrity의 target
  존재성과 달리 **문법**만 본다.

- [ ] TDD fixtures. Commit
  `feat(knowledge-harness): markdown/yaml + obsidian-link validators`.

---

## Task 6: EvalReport builder (eval/eval-report.ts)

run artifact들(node-proposals, policy-report, validation reports, applied-write-report)을 읽어
`KhEvalReport`(이미 kh-schema에 존재)를 계산: coverage(분류된 source 수), evidence_quality(evidence 없는
proposal 수, 최소 evidence 충족 수, inference_without_note), graph_quality(orphan/dup/broken/missing),
safety(raw_modified=false 확인, secret_warnings, canonical/ delete attempts), usefulness(current proposal 수 등).

- [ ] TDD: 합성 artifact 입력 → 기대 EvalReport. Commit
  `feat(knowledge-harness): EvalReport builder from run artifacts`.

---

## Task 7: 파이프라인 연결 (makeDrivers 확장) + e2e + 전체 suite

- NODE_PROPOSALS_CREATED driver: extractor 후 PolicyGuard 실행, `policy-report` artifact 추가.
  block 위반이 있으면 driver throw → run FAILED(안전).
- VALIDATED driver(신규): staging vault에 GraphIntegrity + md/yaml + link + secret 스캔,
  4개 report artifact emit.
- HUMAN_REVIEW_REQUIRED driver(신규): EvalReport 계산 → `eval-report` artifact + `final-report.md`.
- DriverDeps는 변화 없음(결정론 모듈은 staging 경로만 필요). Phase 2 테스트는 그대로 green이어야 함
  (canned 데이터가 policy-clean이므로). 필요한 곳에서 assertion 추가.

- [ ] TDD: clean run → VALIDATED reports ok:true + EvalReport.safety.raw_modified=false.
  별도 테스트: evidence 없는 proposal canned → run FAILED(policy block).
- [ ] `pnpm test` 전체 green.
- [ ] Commit `feat(knowledge-harness): wire policy/verify/eval into pipeline + phase-3 e2e`.

---

## Phase 3 완료 기준
- PolicyGuard가 raw/delete/canonical/no-evidence/secret을 결정론적으로 잡고 block 시 run FAILED.
- GraphIntegrity + validators가 staging vault에서 5종 무결성 + md/yaml/link 문법을 report.
- EvalReport가 run 산출물에서 5개 지표군을 계산해 `HUMAN_REVIEW_REQUIRED`에 남긴다.
- 모든 모듈 fixture 단위 테스트, `pnpm test` green, harness-runner.ts 불변.

## Phase 3 비포함 (Phase 4)
- CLI(run/show/promote) + 데스크톱 IPC/UI + promote(`CurrentPromotionService`).
- 선택적 LLM secret 의미판정 레이어(기본 off, P1).
