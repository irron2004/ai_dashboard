---
title: 폴더 기반 PM-워커(orchestrator-workers) 위키 생성 설계
date: 2026-06-16
status: implemented (phases 1–5)
author: PM (Claude) + irron
relates-to:
  - docs/superpowers/specs/2026-06-08-docs-to-wiki-coverage-design.md (현 단발 파이프라인)
  - memory/workspace-vault-model.md (워크스페이스 vault 모델)
branch: feat/workspace-vault (또는 신규 feat/folder-orchestrator)
approach: 소스를 폴더 단위로 분할하고, PM(오케스트레이터)이 폴더별 역할을 분류·워커를 할당, 폴더 워커가 자기 폴더의 문서+관련 세션으로 노드를 제안, PM이 폴더 간 엣지를 해소하며 병합·검수한다. 기존 5개 에이전트를 폴더 스코프 루프로 재배치한다(신규 에이전트 최소).
---

# 폴더 기반 PM-워커 위키 생성

## 1. 배경 / 문제

현재 하니스는 **모든 소스를 한 프롬프트에 직렬화하는 단발(single-shot)** 구조다:
- `SOURCES_EXTRACTED`(conversation-history-reader): `{discovery, sources: 전체}`
- `NODE_PROPOSALS_CREATED`(knowledge-node-extractor): `{history, intents, sources: 전체}`

`SourceReader`(`source-reader.ts`)에 **파일당** 64KB 캡은 있으나 **총량 캡이 없어**, 실제 규모(문서 200개) 프로젝트에서 프롬프트가 모델 토큰 윈도를 초과한다. 실측 실패:
- `Input exceeds the maximum length of 1048576 characters` (codex 전송 하드 char 한도)
- `ran out of room in the model's context window` (gpt-5.5 토큰 윈도 + xhigh reasoning 예약분)

현재 임시 대응으로 `budgetSourcesForPrompt`(기본 200K자)가 초과분 소스를 **드롭**한다 — 크래시는 막지만 **커버리지 손실**(드롭된 문서는 위키에 미반영). 이는 band-aid이며 구조적 해결이 아니다.

**결론:** 단발 구조를 버리고, 의미 단위(폴더)로 분할하는 **orchestrator-workers** 구조로 전환한다.

## 2. 핵심 아이디어

> PM이 폴더별로 탐색·역할을 분류하고, 폴더마다 워커를 할당한다. 워커는 자기 폴더의 문서와 그 폴더를 건드린 세션을 읽고 그래프 노드를 제안한다. PM이 폴더 간 연결을 해소하며 병합·검수한다.

평면적 청킹(바이트 단위)보다 우월한 이유: **폴더는 응집된 의미 단위**라 워커가 끊기지 않은 맥락을 받는다. 그리고 소스를 드롭하지 않는다(전 폴더 처리).

## 3. 설계 결정 (초안 — 검토 필요)

| 항목 | 결정(안) |
|---|---|
| 분할 경계 | **자동 크기 기반 (확정)** — 고정 깊이 없이 폴더 트리를 토큰 예산으로 bin-packing: 폴더 단위를 보존하되 ① 한 폴더가 `maxPromptChars` 초과 → 하위 폴더/파일 그룹으로 **분할**, ② 연속된 작은 폴더 → 윈도 안에서 **묶음**. 폴더 = 의미 경계, 토큰 = 크기 경계 |
| 워커 실행 | **병렬**(독립 배치), 동시성 상한은 엔진/레이트리밋 고려 (§11 미결) |
| 부분 실패 | **그 폴더(배치)만 스킵, 나머지 진행 (확정)** — 실패 폴더는 리포트에 명시, 그 폴더 소스는 커버리지에 미반영으로 드러남. 전체 FAIL 아님 |
| 대화 스코프 | 각 폴더 워커에 **그 폴더의 파일을 건드린 세션만** 매칭해 전달 (`session.filesTouched ∩ folder files`) |
| 폴더 간 엣지 | 워커는 "타 폴더 참조 후보"를 남기고, **PM 병합(LEAD_MERGED)이 해소** |
| 신규 에이전트 | 최소화 — 기존 5개 재배치. PM 라우터/리듀서는 기존 classifier/lead 역할 확장 |
| 상태 머신 | **신규 state 없음** — 기존 driver 내부를 fan-out 루프로 변경 |

## 4. 기존 에이전트/상태에 매핑 (재사용)

```
당신 설계                         기존 (state / agent)                바뀌는 점
─────────────────────────────────────────────────────────────────────────────
PM: 폴더 탐색·역할 분류·할당   DOCUMENTS_CLASSIFIED                 문서 1개씩 → 폴더 단위 분류 +
                                / document-intent-classifier        FolderPlan(폴더→역할→워커) 산출
                                + project-discovery(폴더 트리)

폴더 워커: 대화 파악 → 노드    NODE_PROPOSALS_CREATED               전체 1회 → 폴더마다 N회(자기
                                / knowledge-node-extractor          폴더 문서+세션만). 결과 누적
                                (+ conversation-history-reader를     + cross-folder 후보 표시
                                 폴더 세션 요약으로 스코프)

PM: 병합·검수                  LEAD_MERGED / wiki-graph-lead        proposal 병합(이미) +
                                + policy-guard                       폴더 간 엣지 해소(신규 책임)
```

핵심: **`NODE_PROPOSALS_CREATED` 드라이버가 단일 호출에서 폴더 fan-out 루프로 바뀌는 것**이 변경의 중심. 상태 머신·아티팩트 메커니즘은 그대로.

## 5. 아키텍처 / 데이터 흐름

```
[전체 문서 실행]
   │
   ├─ PROJECT_SCANNED        : (기존) 프로젝트 지도
   │
   ├─ DOCUMENTS_CLASSIFIED   : PM 라우터
   │     · raw/project-docs/<i>/ 아래를 folderDepth로 폴더 경계 산출
   │     · 폴더별 역할 분류(canonical/reference/scratch 등)
   │     · 폴더별 토큰 추정 → 큰 폴더 하위분할 / 작은 폴더 묶음
   │     · 폴더↔세션 매핑(filesTouched 교집합)
   │     → FolderPlan artifact
   │
   ├─ NODE_PROPOSALS_CREATED : 폴더 워커 fan-out (병렬)
   │     for each folder in FolderPlan:
   │        worker.run({ folderDocs, folderSessions, role })
   │          → proposals[] (+ cross_folder_refs[])
   │     누적 → normalizeEvidencePaths(전체 소스) → PolicyGuard → EvidenceVerifier
   │     → node-proposals artifact (병합 전 누적분)
   │
   ├─ LEAD_MERGED            : PM 리듀서
   │     · 중복 노드 병합(기존)
   │     · cross_folder_refs 해소 → 폴더 간 엣지/링크 생성 (신규)
   │     → graph-update-plan / write-plan
   │
   └─ … (STAGING_WRITTEN → VALIDATED → HUMAN_REVIEW → promote, 기존)
```

## 6. 데이터 구조 (신규/변경)

```ts
// DOCUMENTS_CLASSIFIED 산출 — PM 라우터의 결과.
// 각 entry = 워커 1개가 처리할 "작업 단위(배치)". 자동 크기 기반 분할이므로 배치는
//  (a) 폴더 1개, (b) 큰 폴더의 분할 조각(splitOf), 또는 (c) 작은 폴더 여러 개의 묶음(memberPaths) 중 하나.
type WorkUnit = {
  id: string                 // 안정 식별자
  label: string              // 표시용, 예: 'paper-A' 또는 'paper-A (1/3)' 또는 'misc(3 folders)'
  memberPaths: string[]      // 이 배치가 포함하는 폴더(들), repo-relative
  role: 'canonical' | 'reference' | 'scratch' | 'mixed'
  docSourceIds: string[]     // 이 배치의 SourceDoc id
  sessionIds: string[]       // filesTouched가 이 배치 파일과 겹치는 세션
  estTokens: number          // bin-packing 판정 근거(문자수 기반 근사)
  splitOf?: string           // 큰 폴더를 쪼갠 경우 부모 폴더 식별자
}
type FolderPlan = {
  units: WorkUnit[]
  unplacedSourceIds: string[] // 어느 배치에도 못 들어간 소스(있다면 — 보통 없음)
}
```

// 워커 출력에 추가되는 필드 — PM 리듀서가 해소
type CrossFolderRef = {
  from_node_id: string
  to_hint: string              // 참조 대상 설명(타 폴더 개념/파일)
  evidence_id?: string
}
```

## 7. 반드시 풀어야 할 3가지 난점 + 해법(안)

### 7.1 폴더 간 엣지 (가장 어려움)
- 문제: 워커가 자기 폴더만 보면 cross-folder 링크를 못 만든다.
- 해법: 워커는 **노드를 만들되, 타 폴더를 참조하는 부분은 `cross_folder_refs`에 후보로만** 남긴다. `LEAD_MERGED`(PM 리듀서)가 전체 노드 집합을 보고 후보를 실제 엣지로 해소한다. 해소 못 하면 inference_note로 남기고 사람 검수로 넘긴다(기존 human-review 철학 일관).

### 7.2 폴더 크기 편차
- 문제: 큰 폴더는 그 자체로 윈도 초과, 작은 폴더는 워커 낭비.
- 해법: 라우터가 폴더별 `estTokens`(문자수 기반 근사) 계산 →
  - `> maxPromptChars` → 그 폴더를 하위 경계(또는 파일 그룹)로 **하위분할**(`splitOf`)
  - 연속된 작은 폴더 → **묶어서** 한 워커. 단 묶음도 윈도 안에 들도록.
- 즉 폴더 = 1차 경계, `maxPromptChars`(per-harness 설정) = 2차 안전장치. 기존 `budgetSourcesForPrompt`는 **워커 내부 최후 방어선**으로만 잔존(여기서 드롭이 일어나면 그건 진짜 비정상 → 로그).

### 7.3 대화는 폴더로 안 나뉜다
- 문제: `raw/conversations/`의 세션은 문서 폴더 구조와 별개.
- 해법: 라우터가 세션의 `filesTouched`(이미 존재: `generate-service.ts`, `sessionMatchesProject`)와 폴더 파일의 교집합으로 **폴더↔세션 매핑**을 만든다. 워커는 자기 폴더 + 매칭된 세션만 받는다. 어느 폴더에도 안 걸리는 세션은 "프로젝트 전역" 풀로 두고 PM 단계에서 처리.

## 구현 현황 (2026-06-16, 모두 완료)
- ✅ **1** 라우터 — `planFolders`(folder-plan.ts) bin-packing → `folder-plan` 아티팩트 (310aceb)
- ✅ **2** 워커 fan-out — `NODE_PROPOSALS_CREATED` 폴더 루프, 실패 배치 스킵, `fanout-report` (a3356ea)
- ✅ **3** 폴더 provenance — fan-out이 proposal→폴더 기록, lead에 전달(cross-folder reduce) (1440509)
- ✅ **4** reader 스코프 — `isConversationSource`로 대화 소스만 (b91b978)
- ✅ **5** UI — `readFanoutSummary` + WikiGen 요약에 폴더 워커 표시 (e1eff11)

전 구간 typecheck/test/build 그린. 빈/단일 plan은 단발 fallback이라 기존 동작과 동치(회귀 0).

## 8. 단계적 도입 (리스크 최소)

1. **라우터(FolderPlan) 추가** — `DOCUMENTS_CLASSIFIED`가 폴더 경계+역할+세션매핑 산출. 아직 fan-out은 안 함(기존 extractor 유지). FolderPlan을 아티팩트로 노출해 UI에서 확인.
2. **워커 fan-out** — `NODE_PROPOSALS_CREATED`를 폴더 루프로. 단일 폴더(=전체)일 때 기존과 동치임을 테스트로 고정 → 회귀 0 확인 후 다중 폴더.
3. **PM 리듀서 cross-folder 해소** — `LEAD_MERGED`에 cross_folder_refs 해소 로직.
4. **대화 스코프** — reader를 폴더 세션 요약으로 스코프(7.3).
5. **UI** — FolderPlan/워커 진행을 구조도에 표시(폴더별 카드/진행률).

각 단계 typecheck+test 그린 + 커밋. 1·2단계만으로도 윈도 초과는 해소된다.

## 9. 테스트 전략

- 라우터: 폴더 경계 산출(깊이/하위분할/묶음), 폴더↔세션 매핑 — 순수 함수로 단위 테스트.
- 워커 fan-out: FakeAgentRunner로 2폴더 → 워커 2회 호출, proposal 누적, 단일 폴더=기존 동치.
- 리듀서: cross_folder_refs가 엣지로 해소되는지 / 미해소는 inference로 남는지.
- 전체: 기존 harness-service 통합 테스트가 다폴더에서도 HUMAN_REVIEW 도달.

## 10. 비목표 (이번 범위 아님)
- 폴더 자동 재구성/리네이밍. (읽기만, 원본 폴더 구조 존중)
- 워커 간 실시간 협상(메시지 패싱). PM 경유의 단순 fan-out/reduce만.
- 임베딩/RAG 기반 검색. (폴더 = 결정론적 파티션)

## 11. 미결 질문 (남은 결정 — 해당 단계에서)
- ✅ **폴더 경계** → 자동 크기 기반(bin-packing). (결정됨)
- ✅ **부분 실패** → 실패 배치만 스킵, 나머지 진행. (결정됨)
- ✅ **PM 검수 = 자동 (해소됨)** — lead가 cross-folder 엣지를 자동 생성하지만, 그 출력은
  `STAGING_WRITTEN`(스테이징만) → `HUMAN_REVIEW_REQUIRED` → 사람 `promote`로만 실 vault에 반영된다.
  즉 **기존 human-review→promote 게이트가 cross-folder 엣지를 이미 검수**하므로 별도 게이트는 중복.
  자동 생성 + 기존 promote 검수가 완결된 설계다.
- ⬜ **병렬 동시성 상한** (2단계) — codex 레이트리밋/세션 한도 고려. 배치 N개를 동시 몇 개씩? (기본: 보수적으로 2~3)
- ⬜ **reader의 위치** (4단계) — 폴더 워커가 세션을 직접 읽을지(reader 흡수) vs reader를 배치별로 N번 돌릴지.

---

## 부록 A — 현재 코드 참조점
- 분할 대상 소스: `packages/knowledge-harness/src/runtime/source-reader.ts` (`raw/project-docs/<i>/<rel>`)
- fan-out 지점: `packages/knowledge-harness/src/runtime/make-drivers.ts` `NODE_PROPOSALS_CREATED`
- 병합 지점: 동 파일 `LEAD_MERGED` + `packages/knowledge-harness/src/agents/wiki-graph-lead.ts`
- 폴더↔세션 매핑 재료: `packages/app-services/src/conversation-materializer.ts` `sessionMatchesProject`, `generate-service.ts` `filesTouched`
- per-harness 윈도 설정: `DriverDeps.maxPromptChars`, `EngineOptions`(이미 구현)
