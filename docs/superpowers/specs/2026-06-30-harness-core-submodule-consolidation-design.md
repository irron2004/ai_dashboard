# Spec — S1: langgraph-agent를 canonical 공유 하네스 submodule로 정식화

**날짜:** 2026-06-30
**상태:** 설계(spec). 승인 후 writing-plans로 구현 계획 분기.
**상위 맥락:** [`2026-06-30-multi-project-integration-map.md`](./2026-06-30-multi-project-integration-map.md) — 4 프로젝트 → ai_dashboard 고도화, ② harness/PM 표준화 축. 그 축의 **③ 통합/단일화** 목표를 분해한 첫 sub-project(S1).
**결정 사항(브레인스토밍):** 흡수 수준 = ③ consolidate · 하네스 홈 = 독립 Python 레포 + submodule · 화해 전략 = A(anoint-and-extend) → 실측 후 "이미 존재하는 canonical(`langgraph-agent main`)을 정식화 + 느슨한 clone을 submodule로 전환"으로 구체화 · 레퍼런스 = calculate_math · 프로젝트 콘텐츠 위치 = `<project>/.harness/`(추천, 가역).

---

## 1. 배경 — 현재 상태(실측)

각 프로젝트의 멀티에이전트 하네스는 **이미 공유 레포 `github.com/irron2004/langgraph-agent`**에서 왔지만, **느슨한 nested clone**으로 들어와 드리프트 중이다. submodule이 아니라 부모 repo가 핀을 기록하지 못한다.

| 프로젝트 | agents/ 원격 | 브랜치@커밋 | origin/main 대비 | 로컬 미커밋 | 부모 추적 |
|---|---|---|---|---|---|
| coin | langgraph-agent | main@f46638d (2026-03-03) | 0/0 | **0 (완전 클린)** | nested(미추적) |
| calculate_math | langgraph-agent | main@f46638d | 0/0 | 4 (`.env`·README·`agents_up.sh`·`task_spec.py`) | `?? agents/` (미추적) |
| sns_blog | langgraph-agent | **master@9266539 (2026-01-06)** | (옛 브랜치) | **22** | nested(미추적) |
| english_egg | **icme.git** (별개) | main | — | — | icme에 vendoring |

**핵심 사실:**
- 함수 집합 계보는 충돌형 포크가 아니라 **상위집합**이다: `sns_blog(81 def) ⊂ calc(100) ⊇ coin(100)`. coin은 def 추가가 아니라 별도 모듈(`supervisor_decision.py`·`supervisor_schema.py`·`task_spec.py`·`worker.sh`)로 확장.
- calc vs sns_blog의 1351줄 차이는 **3자 분기가 아니라 sns_blog가 옛 브랜치(master@9266539)라서** 생긴 것. coin·calc는 이미 `main@f46638d`로 동일·최신.
- 따라서 canonical 본체(langgraph-agent main)는 사실상 이미 정렬돼 있고, S1의 실제 작업은 **느슨한 clone → 정식 submodule 전환 + 부모의 핀 기록 + 소량 드리프트 화해 + core/project 경계 정리**다.

### 엔진 구성(`agents/` 작업트리)
orchestrate_tmux.py · orchestrate_tmux_v2.py · graph.py · routing.py · state.py · schemas.py · patch_schema.py · apply_patch.py · pm_intake_decision.py · pm_intake_schema.py · json_utils.py · git_utils.py · run_files.py · fixture_utils.py · agents_up.sh · agents_up_cli.sh · dispatch.sh · enqueue.sh · `config/graph_profiles.json` · `tests/`(10+ 파일). coin은 여기에 supervisor 모듈군을 추가.

---

## 2. 목표 / 비목표

**목표:** langgraph-agent `main`을 canonical 공유 하네스로 정식화하고, calculate_math를 레퍼런스로 *느슨한 clone → 핀된 submodule*로 전환해 동작 패리티(golden-run)를 증명한다. 동시에 엔진 vs 프로젝트 콘텐츠 경계와 콘솔이 구동할 CLI 계약을 고정한다.

**In(S1):**
1. langgraph-agent `main` canonical 선언 + 상태 점검.
2. **core/project 경계** 확정 — 엔진은 submodule, 프로젝트 전용 콘텐츠는 프로젝트로 분리(§4).
3. calc의 nested `agents/` clone → `git submodule add`(같은 경로 `agents`)로 핀 전환, 부모가 핀 기록.
4. calc 로컬 드리프트 4건 화해 — 개선분은 upstream PR, `.env`는 프로젝트-로컬.
5. **CLI 계약** 문서화 — `agents_up_cli.sh` 입출력/종료코드(§5). S3 콘솔 seam.
6. golden-run 패리티 + `agents/tests/` green으로 수용.

**Out(후속 spec):**
- **S2:** coin(클린, 거의 무료)·sns_blog(stale master@9266539 + 22건 salvage 후 main fast-forward) submodule 전환.
- **english_egg:** 원격이 `icme.git`로 langgraph-agent 계보가 아님 → 별도 spec에서 통합 여부 판단(S1/S2 범위 밖).
- **S3:** ai_dashboard `harness-service`에 dev-orchestration 모드 — submodule CLI shell-out + `pm` AgentRunStore 기록 + 로그 스트리밍.
- **blog(irron2004/blog):** `.claude/skills` 기반 Claude 하네스 — 다른 패러다임, 본 통합 트랙 외.
- coin supervisor 모듈을 "옵션 엔진 기능"으로 게이팅하는 정식 설계 — S2(coin 전환)에서 다룸. S1은 calc 경로만.

---

## 3. 아키텍처 개요

```
langgraph-agent (canonical, GitHub)        ← 단일 진실원(엔진 + 기본 profiles + tests)
   │  main @ <pin>
   ├─(submodule)→ calculate_math/agents     ← S1: 핀된 submodule (부모가 핀 기록)
   ├─(submodule)→ coin/agents               ← S2
   └─(submodule)→ sns_blog/agents           ← S2 (salvage 후)

각 프로젝트 루트
   ├─ agents/                (submodule, 엔진 — 수정 금지, 핀으로만 갱신)
   ├─ .harness/              ← 프로젝트 전용 콘텐츠 (NEW)
   │    ├─ graph_profiles.json   (프로젝트 워크플로; 없으면 엔진 기본값)
   │    └─ roles/                (프로젝트 역할 프롬프트)
   ├─ .env                   (프로젝트-로컬, submodule에서 gitignore)
   ├─ tasks/                 (프로젝트 task 콘텐츠)
   └─ agents_up.sh           (thin 진입점 → agents/agents_up_cli.sh)
```

의존 방향: 프로젝트 → langgraph-agent(엔진). 콘솔(ai_dashboard) → CLI 구동(S3). 역방향 결합 없음. autosci-core가 이미 이 워크스페이스에서 같은 submodule 패턴을 쓴다(공유 wiki 커널) — 일관됨.

---

## 4. core/project 경계 (S1의 본질 작업)

현재 엔진 작업트리에 **프로젝트 전용 콘텐츠가 섞여** 있다(예: `agents/config/graph_profiles.json`의 calc 전용 프로필 `curriculum_viewer_v1`). submodule화하려면 분리해야 한다.

| 레이어 | 항목 | 위치 | 비고 |
|---|---|---|---|
| ENGINE | 오케스트레이터·graph·routing·state·schemas·patch·pm_intake·utils·tests·`agents_up_cli.sh`·**기본 graph profiles** | `agents/` (submodule) | 핀으로만 갱신, 프로젝트에서 직접 수정 금지 |
| PROJECT | **프로젝트별 graph_profiles**·`roles/` | `<project>/.harness/` | NEW. 엔진이 오버레이로 읽음 |
| PROJECT | `.env` | `<project>/.env` | 로컬, submodule gitignore |
| PROJECT | `tasks/` | `<project>/tasks/` | 이미 프로젝트 루트 |
| PROJECT | `agents_up.sh` | `<project>/agents_up.sh` | thin 진입점 |

**오버레이 메커니즘:** 엔진은 이미 env 구동(`ROOT`, `*_PANE`, `--graph-profile`). 추가: 엔진이 graph profile을 **`$ROOT/.harness/graph_profiles.json`이 있으면 우선 사용, 없으면 submodule 기본값**으로 해석. 이 한 가지 변경이 프로젝트 콘텐츠를 submodule 밖으로 빼면서 동작을 보존하는 seam이다. (이 변경 자체가 calc 드리프트 4건 중 개선분과 함께 upstream 후보.)

---

## 5. CLI / 콘솔 seam 계약 (S3가 소비)

기존 seam: `agents_up.sh` → `agents/agents_up_cli.sh <task_id> [--workflow <wf>] [--graph-profile <p>]`. S1에서 **계약으로 고정·문서화**한다(코드 변경 최소, 명세화가 산출물):

- **입력:** env `ROOT`(프로젝트 루트), `.env`(안전 로더, KEY=VALUE), task 파일(`$ROOT/tasks/<id>/…`), `--graph-profile`(없으면 `.harness` 오버레이 or 엔진 기본).
- **출력:** run 로그(pane 캡처), state 파일, handoff inbox 경로(`$ROOT/.agents/inbox/…`).
- **종료코드:** 0=성공, 비0=실패(사유 stderr).

→ S3 콘솔은 이 CLI를 shell-out하고 stdout/stderr 스트리밍 + `pm` AgentRunStore에 run 레코드(시작/종료/transcript 경로)만 기록하면 된다. **S1은 계약 정의까지, 소비는 S3.**

---

## 6. 마이그레이션 절차 (calc 레퍼런스, 되돌리기 쉬움)

1. langgraph-agent `main@f46638d` 상태 점검. calc 로컬 4건 분류 — `agents_up.sh`/`task_spec.py`/오버레이 변경 = 개선이면 upstream PR로 main 반영; `.env` = 프로젝트-로컬; README = 케이스별.
2. 프로젝트 전용 콘텐츠 분리: `agents/config/graph_profiles.json`의 calc 전용 프로필 → `calc/.harness/graph_profiles.json`. 엔진 오버레이 경로 지원분을 upstream에 포함.
3. calc의 nested `agents/` clone 제거 → `git submodule add <langgraph-agent-url> agents` (같은 경로), 핀 = 갱신된 main. 부모(calc)가 `.gitmodules` + 핀 커밋 기록.
4. thin `agents_up.sh` 진입점 유지(venv 탐색 흡수 후 `agents/agents_up_cli.sh` 호출).
5. **golden run:** 기존 calc task 1개를 전/후 실행해 동작 패리티 확인.

각 단계 git으로 가역(submodule 제거/복원 가능).

---

## 7. 테스트 / 수용 기준

- 엔진엔 이미 `agents/tests/`(parsers·json_utils·git_utils·pm_intake_decision·run_files·schema_artifacts·plan_reviewer_node·events_next_node 등) → langgraph-agent CI로 승격.
- **수용 기준:**
  1. calc가 핀된 submodule 경유로 오케스트레이터 end-to-end 실행.
  2. 기존 calc task golden-run 패리티(전/후 동작 동일).
  3. 부모 repo가 `.gitmodules` + submodule 핀 기록(`?? agents/` 해소).
  4. 프로젝트 전용 profiles가 `.harness/`에서 로드(오버레이 동작).
  5. `agents/tests/` green.

---

## 8. 리스크 / 완화

| 리스크 | 완화 |
|---|---|
| venv/경로 결합(`agents_up.sh` venv 탐색) | thin 진입점에서 흡수, env 우선순위 유지 |
| 콘텐츠 이동 시 숨은 경로 의존 | golden-run으로 포착, 가역 단계 |
| 오버레이 변경이 upstream 동작 회귀 | `.harness` 부재 시 엔진 기본값 fallback(기존 동작 보존) |
| tmux/WSL 환경 의존 | 엔진 특성, 변경 없음 — 환경 전제 문서화 |
| submodule UX 마찰 | 1인 운영이라 낮음, `git submodule update --remote` 워크플로 문서화 |

---

## 9. S2/S3 연결

- **S2:** 동일 전환을 coin(미커밋 0 → 거의 무료, supervisor 모듈 옵션화 설계 포함)·sns_blog(master@9266539+22건 → main과 3-way salvage 후 fast-forward)에 반복. english_egg는 별도 판단.
- **S3:** 콘솔 `harness-service`에 dev-orchestration 모드 추가 → §5 CLI shell-out + `pm` AgentRunStore 기록 + 로그 스트리밍. 이로써 ai_dashboard가 "harness 관리" 목적을 실제 멀티에이전트 run 구동으로 충족.
