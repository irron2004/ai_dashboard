# 인터랙티브 노드 확인 (Wiki 생성 중간 확인 단계) — 설계

- **날짜:** 2026-06-19
- **상태:** 설계 승인됨 (구현 계획 대기)
- **브랜치:** `feat/interactive-node-confirm`
- **관련:** `docs/superpowers/specs/2026-06-19-autosci-core-wiki-substrate-integration-design.md`(#1, 머지됨), `harness/run-state-machine.yml`, `harness/feature-gates.yml`

---

## 1. 배경 / 목표

사용자가 원하는 위키 생성 플로우:

```
UI에서 워크스페이스 설정 → 「Wiki 생성」 버튼 → 에이전트가 노드 제안 → 사용자 확인 → 위키 생성
```

지금 파이프라인은 **에이전트가 끝까지 자동 생성**한 뒤 **맨 끝(HUMAN_REVIEW_REQUIRED)에서 보기 전용 검수 → promote** 한다. 즉 *쓰기 전*에 노드 구성을 사용자가 손볼 중간 확인이 없다.

**이 작업의 목표:** 노드 제안·정리 직후 파이프라인을 **일시정지**하고, 제안된 **노드 목록을 편집(고르기/제거/이름수정/제목 추가)하고 승인**하면, **그 승인 목록으로** 위키를 쓰도록 한다. 확인 방식은 **가벼운 목록 승인**(에이전트와의 Q&A 대화 없음 — 체크포인트 1개).

**먼저 적용할 도메인:** 이미 워크스페이스 문서로 end-to-end 동작하는 **project-docs** 파이프라인(`makeDrivers`). 논문 도메인·멀티도메인은 이후 작업.

### 범위 밖 (명시적 연기)
- 에이전트↔사용자 **대화형 질문**(clarifying Q&A) — 이번엔 목록 승인만.
- 도메인 overlay/선택(이전 로드맵 #2) — 보류.
- 논문 도메인 실제 생성(#3).

---

## 2. 현재 메커니즘 (재사용할 것)

- **일시정지/재개 내장:** `HarnessRunner.advance`는 닫힌 게이트를 만나면 그 지점에서 **멈추고 반환**(FAILED 아님). `HarnessService.resume(req)`는 게이트 파일을 다시 읽어 멈춘 지점부터 이어간다(IPC `harnessResume`).
- **파이프라인 단계:** `… → NODE_PROPOSALS_CREATED → LEAD_MERGED → WRITE_PLAN_CREATED(gate: auto_create_write_plan) → STAGING_WRITTEN → VALIDATED → HUMAN_REVIEW_REQUIRED`.
- **노드 제안 아티팩트:** `NODE_PROPOSALS_CREATED`가 `node-proposals`를, `LEAD_MERGED`가 `graph-update-plan`을 저장한다. `WRITE_PLAN_CREATED` 드라이버는 `node-proposals`(+graph-update-plan)를 읽어 위키를 쓴다(`make-drivers.ts`).
- **Task 1(#1) 러너 계약:** `DriverResult.status: 'ok' | 'failed'` — 실패 시 artifacts 보존 후 FAILED. 이번에 `'paused'`를 추가한다(아래 §4-1).

핵심 차이는 **(a) 쓰기 직전에 멈추는 per-run 일시정지**와 **(b) 제안 노드를 쓰기 전에 편집하는 UI**, **(c) 쓰기 단계가 '승인 목록'을 소비**하는 것 — 셋 다 지금은 없다.

---

## 3. 사용자 플로우 (목표 동작)

```
[1] 워크스페이스 선택 + 「Wiki 생성(확인 모드)」
[2] 에이전트: scan → extract → 노드 제안 → 정리(LEAD_MERGED)
[3] ⏸ 일시정지 — run은 LEAD_MERGED에 머물고 awaiting='node-confirmation' 마커 노출 (새 상태 추가 X, §4-2)
[4] UI: 제안 노드 목록 표시 (id/title/type) + 체크/제거/이름수정/제목추가
[5] 사용자: 목록 다듬고 「이대로 생성」
[6] 승인 목록이 approved-nodes 아티팩트로 저장 → run 재개
[7] WRITE_PLAN_CREATED: '에이전트 원안'이 아니라 'approved-nodes'로 위키 작성
[8] STAGING_WRITTEN → VALIDATED → HUMAN_REVIEW_REQUIRED (기존 그대로)
```

비확인 모드(기존)는 `[3]~[6]` 없이 곧장 진행 — **완전 하위호환**.

---

## 4. 아키텍처

### 4-1. 러너 일시정지 계약 (`'paused'`)
`DriverResult.status`에 `'paused'`를 추가: `'ok' | 'failed' | 'paused'`.
- 드라이버가 `status:'paused'`를 반환하면 러너는 **그 단계 artifacts(있으면)를 먼저 저장**한 뒤, 전이하지 않고 `runState.awaiting`(예: `'node-confirmation'`)을 기록하고 **멈춰 반환**한다(현재 상태 유지, FAILED 아님).
- `resume`/`advance`로 같은 단계를 다시 실행하면, 조건이 충족된 경우 `'ok'`로 전이한다.
- 기존 `'ok'`/`'failed'`/throw 경로는 불변.

### 4-2. 확인 단계 (새 상태 없이 게이팅)
WRITE_PLAN_CREATED 드라이버를 **확인 게이팅**한다(새 파이프라인 상태 추가하지 않음 — 단계 수 최소화):
- run이 **확인 모드**(`interactive` 플래그)이고 이 run에 `approved-nodes` 아티팩트가 **없으면** → `WRITE_PLAN_CREATED` 드라이버가 `status:'paused'`, `awaiting:'node-confirmation'` 반환 → run은 `LEAD_MERGED`에서 멈춤.
- `approved-nodes`가 **있으면** → 그 목록으로 write plan 생성(아래 4-4).
- 비확인 모드면 이 게이팅을 건너뛰고 기존대로 동작.

> 대안(새 상태 `AWAITING_NODE_CONFIRMATION` 추가)도 검토했으나, KhState enum/전이/머신을 늘리는 대신 **기존 LEAD_MERGED 정지 + runState.awaiting 마커**로 더 작게 구현한다.

### 4-3. 승인 목록 제출 + 재개 (IPC)
새 IPC `harnessConfirmNodes({ runId, approvedNodes })`:
- `approvedNodes`(사용자가 다듬은 목록)를 run의 `approved-nodes` 아티팩트로 저장.
- 그런 다음 해당 run을 **resume** → WRITE_PLAN_CREATED가 이제 아티팩트를 찾고 진행.
- `awaiting` 마커 해제.

### 4-4. 쓰기 단계가 승인 목록 소비
WRITE_PLAN_CREATED 드라이버는 `approved-nodes`가 있으면 **그것을** 노드 소스로 사용(없던 기존 경로는 `node-proposals`). 승인 목록은 원 제안의 **부분집합 + 이름수정 + (제목만 있는) 신규 항목**일 수 있다:
- 유지/이름수정: 원 제안에서 매칭해 사용.
- 제거: 제외.
- 신규(제목만): writer가 제목/intent로 노드 문서를 생성(기존 writer 경로 재사용).

### 4-5. UI — 편집 가능한 노드 목록 + 「이대로 생성」
- run 상태가 멈춤(`awaiting==='node-confirmation'`)일 때, Knowledge/Wiki Gen 화면에 **확인 패널**: 제안 노드 목록(체크박스·이름 인라인 수정·제거·"제목으로 추가").
- 「이대로 생성」 → `harnessConfirmNodes` 호출 → 진행 표시 재개.
- 기존 그래프/검수 뷰는 그대로(이건 *쓰기 전* 편집용 신규 패널).

---

## 5. 컴포넌트

| 컴포넌트 | 위치 | 역할 |
|---|---|---|
| `DriverResult.status:'paused'` + 러너 정지 | `knowledge-harness/runtime/harness-runner.ts` | 일시정지 계약 (#1 계약 확장) |
| `RunState.awaiting?` | `@apc/shared` run-state schema | 확인 대기 마커 |
| 확인 게이팅 + 승인 소비 | `knowledge-harness/runtime/make-drivers.ts` (WRITE_PLAN_CREATED) | 멈춤/재개·approved-nodes 소비 |
| `approved-nodes` 아티팩트 + 스키마 | `@apc/shared` (`KhApprovedNodes`) | 승인 목록 |
| `interactive` 플래그 | `HarnessRunReq` (`@apc/shared`) + `HarnessService.run` | 확인 모드 on/off |
| `harnessConfirmNodes` IPC | `app-services/harness-service.ts` + `apps/desktop/main/{ipc,container}.ts` | 승인 저장 + 재개 |
| 확인 패널 UI | `apps/desktop/src/renderer/components/` | 노드 목록 편집 + 「이대로 생성」 |

---

## 6. 데이터 흐름

```
harnessRun({ projectId, engine, interactive: true })
  → advance → … → LEAD_MERGED → WRITE_PLAN_CREATED 드라이버:
       approved-nodes 없음 → DriverResult{status:'paused', awaiting:'node-confirmation'}
  → 러너: artifacts 저장, runState.awaiting 설정, LEAD_MERGED에서 정지·반환
UI: awaiting 감지 → 제안 노드 목록(node-proposals/graph-update-plan에서) 편집 → 「이대로 생성」
  → harnessConfirmNodes({ runId, approvedNodes })
       approved-nodes 아티팩트 저장 → resume(advance)
  → WRITE_PLAN_CREATED 드라이버: approved-nodes 발견 → 그 목록으로 write plan → STAGING_WRITTEN → VALIDATED → HUMAN_REVIEW_REQUIRED
```

---

## 7. 테스트

| 레벨 | 테스트 | 통과 기준 |
|---|---|---|
| 러너 단위 | 드라이버가 `status:'paused'` 반환 | run이 그 단계에서 정지(전이 X, FAILED X), `awaiting` 기록, artifacts 보존 |
| 러너 단위 | 정지 후 조건 충족 상태로 재개 | 다음 단계로 전이 |
| 드라이버 단위 | 확인 모드 + approved-nodes 없음 | WRITE_PLAN_CREATED가 paused |
| 드라이버 단위 | approved-nodes 있음(부분집합/이름수정/신규) | write plan이 **승인 목록**대로 생성(원 제안과 다름) |
| e2e | 확인 모드 run → 정지 → confirm → 완주 | LEAD_MERGED 정지 → confirm 후 HUMAN_REVIEW_REQUIRED 도달, staging이 승인 목록 반영 |
| 하위호환 | `interactive` 미지정 run | 기존 e2e 전부 green(정지 없음) |
| IPC | `harnessConfirmNodes` | approved-nodes 저장 + 재개, 잘못된 runId 처리 |
| UI | 확인 패널 | 목록 편집(제거/이름수정/추가) 후 「이대로 생성」이 올바른 approvedNodes 전송 |

**핵심 가치 테스트:** "승인 목록이 원 제안과 다를 때(노드 1개 제거) 최종 staging에 그 차이가 반영된다" — 확인 단계가 실제로 결과를 바꾼다는 증명.

---

## 8. 리스크 / 미해결

| 리스크 | 완화 |
|---|---|
| `'paused'`가 기존 게이트-정지와 의미 충돌 | 게이트-정지는 그대로(특정 단계 전 멈춤). `paused`는 per-run·드라이버 주도 정지 + `awaiting` 마커로 구분 |
| 전역 게이트(feature-gates.yml)는 per-run 아님 | 확인 정지는 게이트가 아니라 **per-run `interactive` 플래그 + approved-nodes 아티팩트 유무**로 구동 |
| 신규(제목만) 노드 생성이 writer 계약과 안 맞을 수 있음 | 1차 구현은 **유지/제거/이름수정**을 핵심으로, '제목 추가'는 writer가 받을 수 있는 최소형(제목+intent)으로; 안 맞으면 '추가'는 후속으로 분리 |
| resume가 전역 게이트 재읽기에 의존 | 확인 재개는 게이트와 독립(approved-nodes 유무로 진행) — 전역 상태 변경 없음 |
| UI 패널이 기존 그래프/검수와 혼동 | 쓰기 전 전용 패널 + 명확한 상태 라벨(예: "확인 대기") |

---

## 9. 성공 기준 (완료 정의)

1. `interactive:true` run이 노드 제안 후 `LEAD_MERGED`에서 정지하고 `awaiting:'node-confirmation'`을 노출.
2. 제안 노드 목록이 UI에 뜨고 편집(제거/이름수정/추가) 가능.
3. 「이대로 생성」→ `harnessConfirmNodes`가 승인 목록 저장 + run 재개.
4. WRITE_PLAN_CREATED가 **승인 목록**으로 위키를 쓴다(원 제안과 다르면 결과도 다름 — 봉인 테스트).
5. run이 HUMAN_REVIEW_REQUIRED까지 완주, staging이 승인 목록 반영.
6. `interactive` 미지정 run은 기존과 100% 동일(정지 없음, 전체 스위트 green).
