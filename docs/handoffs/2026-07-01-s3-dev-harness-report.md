# 보고서 — S3: 콘솔이 멀티에이전트 dev 하네스를 구동

**날짜:** 2026-07-01
**PR:** [irron2004/ai_dashboard#15](https://github.com/irron2004/ai_dashboard/pull/15) (`feat/dev-harness-orchestration`)
**흐름:** brainstorming → spec → writing-plans → executing-plans(inline TDD) → finishing(PR) → opus 통합 리뷰 → 리뷰 반영.
**참조:** spec `docs/superpowers/specs/2026-07-01-dev-harness-orchestration-design.md` · plan `docs/superpowers/plans/2026-07-01-dev-harness-orchestration.md`.

이 문서는 요청대로 **① 고려한 후보와 추천 이유 ② opus 통합 리뷰에서 나온 지적과 조치**를 정리한다.

---

## 0. 무엇을 만들었나

ai_dashboard 콘솔에서 프로젝트 task를 골라 멀티에이전트 코딩 하네스(langgraph-agent `agents_up_cli.sh`)를 **띄우고**, 로그를 live 스트리밍하며, 실행 이력을 `AgentRunStore`에 기록한다. SP1/2/3(세션→Task→그래프)·S1/S2(하네스 통합)를 닫는 키스톤.

**스코프:** 변경은 ai_dashboard 내부로만. langgraph-agent `agents/CLI_CONTRACT.md`는 읽기 전용 외부 seam(코드 미수정). coin/calc/blog 통합·superproject 포인터 정리는 범위 밖(사용자 지시).

---

## 1. 설계 결정 — 고려한 후보와 추천 이유

원칙: **임시방편이 아니라 장기적으로 이득인 방향**(사용자 요구).

### 결정 1 — dev-orchestration의 위치
| 후보 | 트레이드오프 | 판정 |
|---|---|---|
| A. 기존 `HarnessService`에 모드 추가(spec 원문 문구) | 510줄 클래스에 위키생성+dev오케 이질 도메인 결합 → god-object | ✗ |
| **B. 신규 `DevHarnessService`(형제 서비스)** | 파일 1개 추가, 단일 책임, 독립 테스트, cancel/동시실행 확장 자연스러움 | ✅ 채택 |
| C. `packages/harness`에 배치 | 그 패키지는 config 편집 도메인 | ✗ |

**이유:** 실측 결과 기존 `HarnessService`는 이름과 달리 **위키/knowledge 생성 파이프라인**이었다. spec 원문의 "harness-service에 모드 추가"는 그 사실을 모르고 쓰인 문구 → 장기적으로 위키/ dev 하네스를 분리하는 게 옳아 **spec 문구를 의도적으로 이탈**했다.

### 결정 2 — CLI 호출 방식
| 후보 | 판정 |
|---|---|
| A. `CliAgentRunner` 재사용 | LLM 엔진 템플릿(stdin prompt) 전용 — 하네스 CLI(argv+env ROOT+bash)와 계약 불일치 → ✗ |
| **B. 신규 `DevHarnessCli`(주입식 spawner)** | `CLI_CONTRACT` 전용 어댑터, spawn DI로 테스트 → ✅ 채택 |

**이유:** 클래스가 아니라 **패턴**(spawn+stream+timeout+exit)만 재사용. (명명: 기존 위키 `harness-cli.ts` argv 파서와 충돌 방지 위해 `DevHarnessCli`로 정정.)

### 결정 3 — 프로세스 모델
계약이 "실행 중 stdout/stderr 스트리밍 + 종료코드"를 보장 → **블로킹 프로세스로 취급, tmux 내부 attach 안 함**("본 계약 외 내부 구현 미의존"). CLI가 detach하면 프로젝트측 계약 위반으로 S3 밖에서 수정.

### 결정 4 — run 레코드의 `agent` 필드 ⭐(리뷰 중 정제)
`AgentRun.agent`에 `'harness'`가 필요.
| 후보 | 트레이드오프 | 판정 |
|---|---|---|
| A. `AgentKind`에 `'harness'` 추가 | typecheck가 4곳(ssh `ENGINE_CMD`, App.tsx pane/terminal)에서 파손 노출 — 엔진 선택 코드 전반 오염 | ✗ |
| **B. 신규 `RunAgent` enum 분리** | `AgentKind`(3 CLI 엔진) 불변, `AgentRun.agent`만 확장 | ✅ 채택 |

**이유:** 처음엔 A(enum 확장)를 시도했으나 typecheck가 `AgentKind`가 코드 전반에서 "단일 CLI 엔진"을 의미함을 드러냈다(pane/ssh/terminal). `'harness'`를 거기 섞으면 엔진 선택 코드가 오염된다 → **run 레코드의 actor만 넓히는 `RunAgent`로 분리**해 ripple을 0으로. (엔진 선택 코드 무수정.)

### 결정 5 — 인프라 하드닝
루트 `vitest.config.ts`가 `apps/desktop`을 제외 → SP1 회귀를 검증에서 놓쳤던 함정.
| 후보 | 판정 |
|---|---|
| A. 루트 `include`에 `apps/**` 추가 | apps/desktop의 다른 env 오염 위험 → ✗ |
| **B. `vitest.workspace.ts`로 projects 분리** | packages(node)+apps/desktop(자체 config) 각 env로 `pnpm test` 한 번에 실행 → ✅ 채택 |

**이유:** S3가 apps/desktop IPC를 건드리므로 같은 함정을 근본에서 제거.

---

## 2. 구현 요약 (TDD, task별 커밋)

1. `vitest.workspace.ts` — 루트 test가 apps/desktop도 실행(SP1 회귀 함정 제거).
2. `RunAgent` enum(+harness) + `AgentRunStore.fail()`.
3. `DevHarnessCli` — CLI_CONTRACT 어댑터(주입식 spawn, stream/exit/timeout/cancel).
4. `DevHarnessService` — run 생명주기(create→complete/fail) + transcript + 로그 fan-out + cancel.
5. devHarness IPC — `CH.devHarnessRun/Cancel/Log` + container 배선 + 로그 push.
6. `DevHarnessPanel` — ▶ Run harness + live 로그 + ⏹ Cancel, PmHome 마운트.
7. SP1 후속 — `onSessionParsed` 실패 로깅, near-dup todo 드롭.

---

## 3. Opus 통합 리뷰 결과

3개 독립 finder 에이전트(정확성 / 정리·altitude / 교차파일·컨벤션) → 후보 종합 → verify.
교차파일 리뷰어가 **IPC 배선 end-to-end(채널명·타입·핸들러 등록·emit)는 clean** 확인.

### 반영한 지적 (확정 버그 → 수정 + 회귀 테스트)
| # | 지적 | 조치 |
|---|---|---|
| 1 | **runId의 콜론이 transcript 디렉토리 경로에 들어가 Windows에서 mkdir/append 조용히 실패 → transcript 유실** (win32는 지원 타깃) | 파일시스템 안전 디렉토리명 유도(콜론 등 치환). 테스트: `.agent-runs` 세그먼트에 `:` 없음 |
| 2 | **`String(d)`가 Buffer 청크를 개별 디코딩 → 한글이 청크 경계에서 깨짐**(이 코드베이스는 한글 출력) | `StringDecoder`로 스트림 디코딩. 테스트: '가'를 2/1바이트로 쪼개도 재조립 |
| 3 | **same-ms runId 충돌 → INSERT OR REPLACE clobber + active-map 덮어써 첫 run 취소불가·누수** | runId에 랜덤 suffix. 테스트: 동일 timestamp 2회 → 별개 레코드 2건 |
| 4 | **taskId가 프로젝트 전환 시 stale → 교차 프로젝트 오제출** | PmHome에서 `key={project.id}`로 패널 remount |

### 검토했으나 조치 안 함 (사유)
- **`agent:'harness'` 리터럴 vs enum**: `AgentRun.agent: RunAgent`로 **타입체크됨** → rename 시 실제 에러 발생. REFUTED.
- **cancel/close settle race**: `settled` 가드로 double-settle 방지 정상. finish 지점 나노초 경합은 양성(둘 다 타당) → 무해.
- **cross-run 로그 누수**: run 버튼이 `running` 동안 비활성 → 이전 run 완전 종료 후에만 재실행 가능 → 트레일링 청크 창 실질 없음.
- **IPC 핸들러 zod 미검증**: 형제 `harnessRun`도 `as` 캐스트라 컨벤션 일치. 서비스가 unknown project를 `ok:false`로 우아하게 처리.

### Follow-up (버그 아님 · 별도 개선 트랙)
- **DevHarnessCli ↔ CliAgentRunner subprocess 배관 중복**: 공유 `spawnStreaming` 유틸 추출 후보. 계약 상이(argv vs stdin)+교차패키지(llm-wiki 위키 파이프라인 리스크)라 이번 범위 밖.
- **cancel-before-output / started ack**: runId를 첫 로그 chunk에서 캡처 → 출력 없는 startup 동안 cancel 비활성. 전용 "started" 이벤트로 runId를 즉시 전달하면 개선(배선 추가 필요).
- **transcript `appendFileSync` per-chunk**: 수다스러운 하네스에서 메인스레드 FS 블로킹. `WriteStream` 1회 오픈으로 개선(비동기 flush 처리 필요).

---

## 4. 검증
- `pnpm test`(루트, workspace): **173 files / 900 tests pass, 0 failed** (apps/desktop 포함).
- `pnpm typecheck`: clean(권위; IDE `Cannot find module` 진단은 알려진 오경보).
- 수용 기준(spec §7) 1–6 충족.

---

## 5. 세션에서 처리한 그 외
- **PR #12(SP3 실행 아이콘) 머지** — `3a8e762`, main.
- **② superproject 포인터 정리 = 보류** — coin 포인터를 건드려야 하는데 coin이 보류 대상. coin 해제 시 일괄.
- **미커밋 발견(내 것 아님, 미변경)**: `packages/knowledge-harness/src/verify/evidence-verifier.{ts,test.ts}`(statSync/EISDIR 픽스 WIP)·`package-lock.json`(6/30자). 이전 세션 잔여물 — PR에 미포함, 그대로 둠. **사용자 판단 필요.**

## 6. 리포/브랜치 상태
- **ai_dashboard** `main` @ `3a8e762`(PR #12 머지 반영). **PR #15 OPEN**(S3, `feat/dev-harness-orchestration` @ `68a4839`), CI 없음 — 로컬 green.
- langgraph-agent 미수정(읽기 전용 seam).
