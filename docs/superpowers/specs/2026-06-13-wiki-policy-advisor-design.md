# Wiki Policy Advisor — 설계 문서

**Date:** 2026-06-13
**Status:** 설계 승인됨 (구현 플랜 대기)
**Origin:** 사용자 요청 (2026-06-12, 3-tab restructure 중). 핸드오프 `docs/handoffs/2026-06-12-ui-three-tab-restructure-impl.md` §"Known limitations" #4.
**관련:** `harness/harness-rules.md` (DEFAULT_PREAMBLE 원본), `packages/knowledge-harness/src/policy/policy-guard.ts` (결정론적 게이트)

---

## 1. 목적

지금은 *모든* 프로젝트가 단일 고정 정책(`DEFAULT_PREAMBLE` = `harness/harness-rules.md`의 8개 하네스 규칙)을 공유한다. 이 규칙은 모든 LLM 에이전트 프롬프트의 맨 앞에 주입된다(`LlmAgent.buildPrompt`, `packages/knowledge-harness/src/agents/llm-agent.ts:17`).

**Wiki Policy Advisor**는 base 하네스 규칙 + 프로젝트 발견(discovery) 신호를 입력으로 받아, 그 프로젝트 성격에 맞춘 wiki 정책을 제안하는 새 worker agent다. 사람이 리뷰·승인하면 이후 해당 프로젝트의 wiki 생성 런에 적용된다.

예: 연구 프로젝트 → `ExperimentNode` 우선; 라이브러리 → canonical = API 문서 + ADR.

## 2. 핵심 결정 (브레인스토밍 확정)

| 항목 | 결정 | 비고 |
|------|------|------|
| 범위 | advisor가 **프로젝트별 전체 preamble**을 제안 | governance + content 둘 다 보이지만, governance는 잠김 |
| 안전 | **PolicyGuard 바닥 불가침** | 거버넌스 규칙 1–8은 구조적으로 잠김; PolicyGuard는 텍스트와 무관하게 코드로 강제 |
| 실행 시점 | **온디맨드 버튼** | Wiki Gen → ⚙ 에이전트 설정 슬라이드오버의 "정책 제안 받기" |
| 저장/리뷰 | **vault 파일** `projects/<id>/wiki-policy.md` | DEFAULT_PREAMBLE 대비 diff 리뷰; git 추적; Node·SSH에서 읽힘 |
| 입력 신호 | 기존 **ProjectDiscoveryReport** 재사용 | 최신 PROJECT_SCANNED 있으면 재사용, 없으면 project-discovery 1회 실행 |
| 출력 형태 | **구조화 `ProjectPolicyProposal`** (Zod) + 자유 서술 필드 | 기존 에이전트들과 동일하게 `parseStructured` 검증 |

## 3. 핵심 아키텍처 — "잠긴 거버넌스 + 맞춤 본문"

가장 중요한 안전 불변식. **프로젝트 파일은 거버넌스를 절대 담지 않는다.**

- `projects/<id>/wiki-policy.md`의 **body** = advisor가 만든 **맞춤(tailoring) 섹션만**.
- 런타임 주입 시 합성: **effective preamble = `DEFAULT_PREAMBLE`(항상 새로 읽음) + `\n\n` + body**.

결과:
1. 프로젝트 파일이 변조돼도 텍스트를 *추가*만 할 수 있고 규칙 1–8을 *제거·변경*할 수 없다 (구조적 보장).
2. `PolicyGuard`(`policy/policy-guard.ts`)는 프롬프트 텍스트와 무관하게 evidence 필수·shared≥2·raw 쓰기 금지·삭제 금지·markdown-only·canonical proposal_only를 **코드로** 강제한다.
3. 사용자가 "전체 preamble"을 보는 경험은 **합성 미리보기**로 제공한다. 바닥 보장은 저장 구조에서 나온다.

## 4. 컴포넌트

### 4.1 새 스키마 — `KhProjectPolicyProposalSchema`
위치: `packages/shared/src/kh-schema.ts` (기존 KH 스키마 옆). 기존 스키마처럼 모든 리스트/문자열에 `.default()` 부여.

```ts
export const KhProjectPolicyProposalSchema = z.object({
  project_id: z.string(),
  generated_by: z.string(),
  project_character: z.string().default(''),          // 이 프로젝트 성격 한 줄 요약
  node_type_priorities: z.array(z.object({
    node_type: z.string(),
    rationale: z.string().default(''),
  })).default([]),                                     // 우선할 노드 타입 + 근거
  canonical_definition: z.string().default(''),        // 이 프로젝트에서 canonical 정의
  scan_scope_notes: z.string().default(''),            // 스캔 범위 강조/제외 가이드
  tailoring_markdown: z.string().default(''),          // 자유 서술 맞춤 프로즈
  rationale: z.string().default(''),
  evidence: z.array(z.object({
    signal: z.string(),                                // 예: "topics", "repos", "canonical_docs"
    detail: z.string().default(''),
  })).default([]),
})
export type KhProjectPolicyProposal = z.infer<typeof KhProjectPolicyProposalSchema>
```

### 4.2 새 worker agent — `makeWikiPolicyAdvisor`
위치: `packages/knowledge-harness/src/agents/wiki-policy-advisor.ts`; `agents/index.ts`에 export 추가.
`makeProjectDiscovery` 패턴(`agents/project-discovery.ts`)을 그대로 따른다.

```ts
const ROLE = [
  'You are the WikiPolicyAdvisor agent. Given the base harness rules and a ProjectDiscoveryReport,',
  'propose a project-tailored wiki policy as a ProjectPolicyProposal.',
  'Do NOT restate, modify, or weaken governance rules 1-8 — they are locked and enforced separately.',
  'Only fill the tailoring fields: which node types to prioritize and why, what',
  'counts as canonical for THIS project, scan-scope emphasis, and free-form tailoring prose.',
  'Every recommendation must cite a discovery signal in evidence (topics / repos / canonical_docs).',
].join(' ')

export function makeWikiPolicyAdvisor(preamble: string) {
  return new LlmAgent({ name: 'wiki-policy-advisor', role: ROLE, schema: KhProjectPolicyProposalSchema, preamble })
}
```
입력(`run({ input })`): `{ base_preamble: string, discovery: KhProjectDiscoveryReport }`.

### 4.3 합성·해석 (순수 함수, Node)
위치: `packages/knowledge-harness/src/agents/wiki-policy.ts` (또는 `policy/`). LLM 비의존, 전부 결정론적 → 단위 테스트 용이.

- `renderTailoring(proposal: KhProjectPolicyProposal): string`
  구조 필드 + `tailoring_markdown` → 단일 `## Project Tailoring (advisor)` 마크다운 섹션. `node_type_priorities`는 불릿, `canonical_definition`/`scan_scope_notes`는 소제목.
- `resolveProjectPreamble(vaultRoot: string, projectId: string, base: string): string`
  `<vaultRoot>/projects/<projectId>/wiki-policy.md`를 읽어 frontmatter 파싱:
  - 존재 & `status === 'approved'` → `base + '\n\n' + body` 반환
  - 없음 / `status !== 'approved'` / 파싱 실패 / 파일 손상 → `base` 반환 (**런을 절대 차단하지 않음**; 손상 시 경고 로그)

### 4.4 저장 파일 형식 — `projects/<id>/wiki-policy.md`
Obsidian/마크다운+frontmatter 관례를 따른다.
- **frontmatter:** `project_id`, `status: proposed | approved`, `generated_by`, `generated_at`, `approved_at?`, `source_run?`, 그리고 구조화 `proposal`(provenance·재렌더용).
- **body:** `renderTailoring(proposal)`의 출력 (맞춤 섹션만 — 거버넌스 없음).

### 4.5 app-services (`packages/app-services/src/harness-service.ts`)
- `proposeWikiPolicy(projectId, engine)`:
  1. discovery 확보 — `runs/`에서 이 프로젝트의 가장 최근 PROJECT_SCANNED 아티팩트가 있으면 재사용, 없으면 `makeProjectDiscovery`로 1회 실행.
  2. `makeWikiPolicyAdvisor(this.preamble).run({ base_preamble: this.preamble, discovery })` → `ProjectPolicyProposal` (검증).
  3. 파일에 `status: proposed`로 기록.
  4. 반환: `{ proposal, effectivePreview }` (`effectivePreview = this.preamble + '\n\n' + renderTailoring(proposal)`).
- `approveWikiPolicy(projectId)`: frontmatter `status: approved` + `approved_at` 기록.
- `getWikiPolicy(projectId)`: 현재 상태/proposal 반환.
- `revertWikiPolicy(projectId)`: 파일 삭제 또는 `status` 강등 → 다음 런부터 base로 폴백.
- **주입 지점:** `runnerFor(runId, projectId, …)`의 `preamble: this.preamble` →
  `preamble: resolveProjectPreamble(this.deps.vaultRoot, projectId, this.preamble)`.

### 4.6 IPC + 렌더러
- IPC 채널: `harness:proposeWikiPolicy`, `harness:approveWikiPolicy`, `harness:getWikiPolicy`, `harness:revertWikiPolicy` (main + preload + renderer client).
- UI: Wiki Gen 탭의 **⚙ 에이전트 설정** 슬라이드오버(현 `HarnessStructurePanel` 영역)에 "정책 제안 받기" 버튼.
  - 클릭 → `proposeWikiPolicy` → 제안 표시: `project_character`, `node_type_priorities`(근거 포함), `canonical_definition`, `scan_scope_notes`, `tailoring_markdown`, `evidence`.
  - **합성 effective preamble 미리보기** + "거버넌스 규칙 1–8 (잠김 / 변경 불가)" 명시 표시.
  - "승인" → `approveWikiPolicy`; "기본값으로 되돌리기" → `revertWikiPolicy`.
  - 현재 정책 상태(proposed/approved/none + approved_at) 표시.

## 5. 데이터 흐름

```
[버튼 "정책 제안 받기"]
  → app-services: discovery 확보(재사용 또는 1회 실행)
  → WikiPolicyAdvisor(base_preamble, discovery) → ProjectPolicyProposal (Zod 검증)
  → renderTailoring → 파일 status:proposed 기록 + effectivePreview 반환
  → [사람 리뷰] → "승인" → status:approved
  → [다음 wiki 생성 런] runnerFor → resolveProjectPreamble
       = DEFAULT_PREAMBLE + approved tailoring body  → 모든 에이전트에 주입
  → PolicyGuard는 그대로 코드로 강제 (바닥 불가침)
```

## 6. 에러 처리

| 상황 | 처리 |
|------|------|
| advisor LLM 실패 | `LlmAgent`가 engine/exit/logs 담아 throw → UI 에러 표시, **파일 미기록** |
| discovery 없음 + 실행 실패 | 에러 반환("먼저 프로젝트를 스캔하세요") |
| proposal 검증 실패 (Zod) | `parseStructured` throw → UI 표시, 미기록 |
| 주입 시 파일 손상/없음 | `resolveProjectPreamble`이 **DEFAULT_PREAMBLE 폴백** + 경고 로그 (런 차단 금지) |
| 악의적 tailoring body | 거버넌스 아래에 합성될 뿐 규칙 제거 불가; PolicyGuard가 코드로 차단 유지 |

## 7. 테스트

- **agent** (`wiki-policy-advisor.test.ts`): 프롬프트에 base preamble + discovery 포함; fake 구조 출력 파싱(FakeAgentRunner).
- **schema** (`kh-schema.test.ts`에 추가): 기본값, 필수 필드(`project_id`/`generated_by`).
- **render/resolve** (`wiki-policy.test.ts`): 거버넌스 항상 존재·불변; `approved`만 합성; `proposed`/없음/손상 → base 폴백(no throw); 결정론적 출력.
- **harness-service**: `approved`일 때 `makeDrivers`에 전달되는 preamble이 거버넌스 전체 + 맞춤 섹션 둘 다 포함.
- **적대적 e2e** (`policy-pipeline.e2e` 스타일): tailoring body가 "규칙 4 무시"라 주장해도 합성 후 `PolicyGuard`가 evidence<2 shared 승격을 여전히 차단.
- **렌더러 컴포넌트**: 제안→표시→승인 흐름 (`HarnessStructurePanel` 테스트 패턴).

## 8. 파일/모듈 배치

| 레이어 | 파일 |
|--------|------|
| 스키마 | `packages/shared/src/kh-schema.ts` (+ export) |
| agent | `packages/knowledge-harness/src/agents/wiki-policy-advisor.ts` (+ `agents/index.ts` export) |
| 합성/해석 | `packages/knowledge-harness/src/agents/wiki-policy.ts` |
| 서비스 | `packages/app-services/src/harness-service.ts` (propose/approve/get/revert + runnerFor 주입) |
| IPC | `apps/desktop/src/main/*` (handlers) + preload + renderer client |
| UI | Wiki Gen ⚙ 설정 슬라이드오버 (`HarnessStructurePanel` 확장 또는 신규 `WikiPolicyPanel`) |

## 9. 비목표 (YAGNI)

- 파이프라인 자동 단계화(매 런 자동 재제안) — 온디맨드로 충분.
- PolicyGuard 임계값의 프로젝트별 재설정 — 바닥 불가침 결정에 따라 제외.
- 언어/프레임워크 전용 심층 스캐너 — 기존 ProjectDiscoveryReport로 시작, 추후 확장.
- shared(다중 프로젝트) 정책 — 프로젝트 단위에 한정.
