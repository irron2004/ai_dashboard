# 위키생성 검수 화면 재구성 — 설계

- 날짜: 2026-07-21
- 상태: 사용자 승인 완료 (구현 전)
- 브랜치: `feat/wikigen-review-redesign` (base: `main`)

## 1. 배경 — 진단 요약

위키생성 화면(`WikiGenDashboard`)의 검수 탭은 실제로는 "AI 제안 뷰어"다. 구조적 원인 세 가지:

1. **사람의 판단을 저장할 곳이 없다.** 스키마·DB 어디에도 proposal 단위 승인/제외 상태가 없다. `ReviewPanel`은 항목 선택과 초안 펼치기 외에 상호작용이 없고, Approve/Reject 버튼을 가진 `ReviewActions.tsx`는 어디에도 연결되지 않은 채 방치돼 있다.
2. **판단 시점이 거꾸로다.** 사람이 개입하는 유일한 게이트(`NodeConfirmPanel`)는 초안·검증 결과가 나오기 전(node-confirmation)이고, 정보가 다 모인 `HUMAN_REVIEW_REQUIRED` 시점의 행동은 run 전체 일괄 Promote뿐이다.
3. **탭 7개(요약/구조/검수/Coverage/Quality/Proposals/Flow)가 파이프라인 산출물 단위**로 나뉘어 있어 사용자 과업(관찰→이해→판단)에 답하는 탭이 없다. Proposals는 검수의 순수 부분집합이고, Quality 지표 2개는 0으로 하드코딩돼 있으며, Coverage의 원본 열기는 `window.alert` 스텁이다.

또한 "원본 vs AI 판단" 경계가 UI에 없다. proposal의 모든 필드(`quote_or_summary`, claims, risk 등)는 LLM 출력이며, 원문 일치 여부는 `EvidenceVerifier`가 사후 검증해 `evidence-verification-report`에 남긴다 — 이 데이터가 있는데 배지로 쓰이지 않는다. STAGING 단계가 만드는 `diff.patch`(실제 vault ↔ staging git diff)도 UI에 노출되지 않는다.

## 2. 목표 / 비목표

**목표**

- 검수 탭을 항목별 **승인/제외** 판단이 가능한 작업대로 재구성
- Promote를 **승인분만 반영**으로 변경 (미결은 확인 다이얼로그 후 제외 취급)
- 원본/AI 해석/반영 결과의 경계를 UI에서 명시
- 탭을 과업 기준 4개(개요/검수/구조/진행)로 재편

**비목표 (후속 확장)**

- 초안·제목 편집, 수정요청(LLM 재생성) 루프
- 판단 이력의 run 교차 조회 (DB 저장)
- 앱 내 원문 전체 뷰어
- `NodeConfirmPanel`(생성 전 게이트) 변경 — 저비용 사전 필터로 현행 유지 (이중 게이트)

## 3. 화면 구조

### 탭 재편: 7개 → 4개

| 새 탭 | 내용 | 기존 탭의 행방 |
|---|---|---|
| 개요 | 판단용 대시보드 | 요약 + Coverage + Quality 흡수 |
| 🔎 검수 | 항목별 검수·판단 작업대 | 검수 확장. **Proposals 탭 삭제** |
| 구조 | `ProjectStructureView` 그대로 | 구조 유지 |
| 진행 | `TaskFlowView` 그대로 | Flow 이름 한글화 |

### 개요 탭

- 헤드라인 숫자: 노드 제안 N건(승인 a · 제외 b · 미결 c), 소스 반영 covered/total(누락 u), 경고(근거없음 · 인용불일치 · 정책위반 · 그래프문제)
- **숫자 클릭 → 검수 탭의 해당 필터로 이동** (탭 간 이동 신설: `setReviewTab('review')` + 필터 상태 전달)
- 하위 섹션으로 `CoverageMatrix` · `QualityPanel` · 폴더 워커 fanout 요약 재사용. FAILED 에러 표시 유지
- Coverage의 `onOpenSource`는 `window.alert` 대신 `harness:openSourceFile` 호출로 교체

### 검수 탭

**좌측 목록** — 기존 attentionScore 정렬 유지 + 항목별 상태 배지(✓승인/✗제외/미결) + 필터 칩(전체·미결·경고·승인·제외) + 일괄 승인/일괄 해제 버튼(현재 필터에 표시된 항목에만 적용).

**우측 상세** — 3영역으로 재구성:

1. **원본** — evidence별로:
   - `source_path` 클릭 → OS 기본 앱으로 raw 사본 열기
   - 인용 주변 원문 발췌(±5줄, `harness:readSourceExcerpt`로 on-demand 로드)
   - 검증 배지: 원문 일치 확인 시 `✓ 원문 일치`, 불일치 warning 시 `⚠ AI 요약일 수 있음` (`evidence-verification-report` 기반)
2. **AI 해석** — 제목·유형·범위·요약, 주장(inference/confidence 배지), 에이전트 의견(risk, reviewer_question), 정책 위반. 영역 전체에 "AI 판단" 시각 구분
3. **반영 결과** — staged 초안(기존 `harnessReadStagedDoc`) + 해당 파일의 before/after diff(`harness:readNodeDiff`). 신규 파일이면 초안만 표시. 초안 내 위키링크 점프 비활성은 유지

**하단** — 승인 / 제외 버튼. 재클릭 시 미결로 복귀(토글). 방치된 `ReviewActions.tsx`는 삭제하고 2-버튼 컴포넌트를 새로 작성.

### Promote 푸터

- "Promote run" → **"승인 N건 반영"**. 미결 M>0이면 "미결 M건은 반영되지 않습니다" 확인 다이얼로그
- 승인 0건이면 비활성 + 안내
- `⚠ 검증 무시`(force) · `📤 워크스페이스로 export` · canonical 문서별 promote는 현행 유지

## 4. 데이터 모델

`packages/shared/src/kh-schema.ts`에 추가:

```ts
KhReviewDecisionSchema = z.object({
  proposal_id: z.string(),
  verdict: z.enum(['approved', 'excluded']),
  decided_at: z.string(),
});
KhReviewDecisionsSchema = z.object({
  decisions: z.array(KhReviewDecisionSchema),
});
```

- 저장: run artifact **`review-decisions`**, `HUMAN_REVIEW_REQUIRED` 상태 키 아래 `RunArtifactStore`로 기록 (기존 `approved-nodes` 패턴과 동일 — `harness-service.ts`의 confirmNodes 저장 방식 참고)
- 미결(pending)은 레코드 부재로 표현 — verdict enum에 넣지 않는다
- 쓰기: 렌더러가 전체 decisions 배열을 전송, 서비스가 검증 후 원자적으로 덮어씀 (부분 병합 없음)
- 읽기: 신규 채널 불필요 — artifact로 등록되면 기존 `harnessGetRun` bundle에 자동 포함

## 5. IPC 채널 (신규 4개)

CLAUDE.md 규칙대로 4곳 배선: `ipc-contract.ts` → `preload/index.ts` → `renderer/api.ts` → `main/ipc.ts`.

| 채널 | 요청 | 응답 | 비고 |
|---|---|---|---|
| `harness:setReviewDecisions` | `{ runId, decisions }` | `{ ok }` | run이 `HUMAN_REVIEW_REQUIRED`일 때만 허용, proposal_id 유효성 검증 |
| `harness:readSourceExcerpt` | `{ runId, sourcePath, quote }` | `{ matched, excerpt, line? }` | EvidenceVerifier의 공백정규화 매칭 재사용, ±5줄 반환 |
| `harness:openSourceFile` | `{ runId, sourcePath }` | `{ ok }` | `shell.openPath`. workspace vault `raw/` 내부 경로만 허용 |
| `harness:readNodeDiff` | `{ runId, relPath }` | `{ diff: string \| null }` | `diff.patch`를 `diff --git` 경계로 분리해 해당 파일 섹션 반환 |

`Container`/`HarnessService`에 대응 메서드 추가.

## 6. Promote 의미 변경

`HarnessPromoteService.promote`:

- `review-decisions` artifact **있음** → `applied-write-report.applied[]` 중 승인된 proposal의 노드 파일(`nodes/<node.id>.md`)만 vault로 복사. 노드가 아닌 부수 파일(인덱스 등)과 canonical `.proposal.md` 경로는 현행 유지
- artifact **없음** → 기존 전체 promote 유지 (headless 실행·기존 테스트 호환). 데스크톱 UI는 promote 전 항상 artifact를 쓰므로 UI 경로는 언제나 승인분만 반영
- 승인 0건 (artifact가 존재하는 경우) → promote 거부 + 안내 메시지
- **ledger 규칙 변경**: `wiki_processed_sources`에는 승인된 proposal이 인용한 소스만 기록. 제외/미결 노드만 인용한 소스는 미처리로 남아 다음 run에서 재시도 가능
- **미해결 위키링크**: 승인 노드가 제외 노드를 `[[링크]]`로 참조하면 미해결 링크 발생. Obsidian식 위키에서 허용되므로 차단하지 않고, promote 결과 메시지에 건수 표시 (승인 파일 내용에서 제외 node id 링크 스캔)
- 기존 secret/validator 게이트와 force(`allowInvalid`/`allowSecrets`) 경로는 변경 없음

## 7. 기존 부채 정리 (이번 작업 범위)

- `eval-report.ts`의 하드코딩 0 두 개: `shared_promotion_candidates`는 `shared-promotion-plan` artifact에서 실제 계산으로 연결. `next_task_candidates`는 데이터 소스가 없으므로 **UI 표시 제거** (스키마 필드는 호환성 위해 유지)
- `ProposalsPanel.tsx` 삭제 (검수의 부분집합)
- `ReviewActions.tsx` + 테스트 삭제 (미배선 dead code, 3-버튼 구조가 새 설계와 불일치)
- `CoverageMatrix`의 `onOpenSource` alert 스텁 교체

## 8. 에러 처리

- `setReviewDecisions`: `HUMAN_REVIEW_REQUIRED` 외 상태 거부. 존재하지 않는 proposal_id 거부. MERGED 이후 판단 잠금
- `readSourceExcerpt`: 파일 없음·매칭 실패 → `matched: false`, UI는 "인용 위치를 찾지 못했습니다" + 파일 열기 버튼 폴백
- `openSourceFile`: `raw/` 외부 경로(경로 이탈 포함) 거부
- `readNodeDiff`: `diff.patch` 부재 → `null`, UI는 초안만 표시
- promote: 승인 0건 차단. 미결 확인 다이얼로그. 기존 게이트 유지

## 9. 테스트 계획 (vitest workspace)

- **스키마**: `KhReviewDecisions` 파싱·거부 케이스
- **HarnessService**: 판단 artifact 저장, 상태 가드, proposal_id 검증
- **HarnessPromoteService**: 승인분 필터, artifact 부재 시 레거시 전체 promote, ledger가 승인 인용 소스만 기록, canonical 경로 무영향, 승인 0건 거부
- **발췌·diff**: 매칭 성공/실패, `raw/` 경로 이탈 차단(기존 security 테스트 관례), 파일별 patch 분리
- **렌더러**: ReviewPanel 판단 상호작용(승인/제외/토글/필터/일괄), WikiGenDashboard 4탭 렌더, 개요→검수 필터 이동, promote 버튼 상태

## 10. 구현 단계 (각 단계 독립 커밋 가능)

1. **데이터+서비스** — 스키마, `review-decisions` artifact 저장, promote 필터·ledger 규칙 (+테스트)
2. **IPC** — 신규 4채널 4곳 배선 (+Container 메서드)
3. **검수 탭 UI** — 3영역·판단 버튼·필터·발췌·diff
4. **탭 재편** — 개요 통합·탭 간 이동·Proposals/ReviewActions 삭제·Quality 수정·Coverage 열기 교체

## 11. 확정된 결정 사항 (Q&A 기록)

| 질문 | 결정 |
|---|---|
| 범위 | 전면 재편 (탭 4개 + 판단 + 선택 promote를 한 스펙으로) |
| 판단 종류 | 승인/제외 2단 + 미결 기본값. 편집·재생성은 후속 |
| 미결 처리 | 승인분만 반영, 미결은 확인 다이얼로그 후 제외 취급 |
| 게이트 구조 | 이중 게이트 — `NodeConfirmPanel` 현행 유지, 최종 결정권은 검수 탭 |
| 원본 확인 | 앱 내 발췌(±5줄) + OS 파일 열기 |
| 판단 저장 | run artifact `review-decisions` (DB 테이블·approved-nodes 재활용 대신) |
