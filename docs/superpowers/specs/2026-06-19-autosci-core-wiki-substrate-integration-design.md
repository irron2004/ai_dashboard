# autosci-core ↔ ai_dashboard 위키 기질(substrate) 통합 — 설계

- **날짜:** 2026-06-19
- **상태:** 설계 승인됨 (구현 계획 대기)
- **하위 프로젝트:** #1 "이음매 기반" (멀티도메인 LLM 위키 플랫폼 로드맵의 첫 조각)
- **첫 증명 도메인:** 연구 논문 위키 (papers→modules→pipelines)
- **관련 문서:**
  - autosci-core `README.md`, `docs/adr/0001~0004`
  - autosci-core `.scratch/attnembed-e2e/` (known-good 논문 vault, 본 설계의 골든 fixture)
  - ai_dashboard `harness/run-state-machine.yml`, `harness/feature-gates.yml`
  - ai_dashboard `packages/knowledge-harness/src/runtime/make-drivers.ts` (상태→드라이버)

---

## 1. 배경 (왜 이 설계가 필요한가)

두 개의 시스템이 **목적상 거의 같은 일**(원천자료 → LLM 추출 → 타입드 위키 노드 + 그래프 → 검증 → 검수/promote → 렌더)을 **다른 언어**로 하고 있다.

**autosci-core (Python)** — 도메인 무관 "LLM Wiki 코어".
- `kernel` = 계약 집행 엔진. `entities/edges/conventions/xref.yaml`로 노드 타입을 정의하고 `python -m kernel {lint,add-edge,rebuild-index}`로 검증·그래프 재빌드.
- 산출물 = 타입드 마크다운 vault: `wiki/papers/*.md`, `wiki/modules/*.md`, `wiki/pipelines/*.md` + `wiki/graph/edges.jsonl` + `index.md`.
- 어댑터(`autosci-read`: HTML/MD/CSV/PDF→SourceRecord), 트랜스크립트(`autosci-transcripts`), module-bank, `.claude/skills`(코딩 에이전트용 *사용법* 스킬).
- 철칙: **도메인 어휘 0, 의존은 project→core 단방향.** 소비 프로젝트는 submodule+pin으로 가져다 도메인 overlay만 얹는다.

**ai_dashboard (TypeScript / pnpm 모노레포)** — 이미 거의 같은 파이프라인을 보유.
- `packages/knowledge-harness`: `knowledge-node-extractor`, `obsidian-wiki-writer`, `wiki-graph-lead`, `render-node-doc`, `folder-plan/workers`, `policy-guard`, `secret-scanner`, eval/coverage.
- **결정적 사실:** harness는 외부 코딩 에이전트 CLI를 직접 spawn한다 — `claude -p --output-format json`, `codex exec`, `opencode run` (`packages/llm-wiki/src/cli-agent-runner.ts`). 즉 ai_dashboard는 **"코딩 에이전트를 게이트된 상태머신으로 구동하는 오케스트레이터"**다.
- 상태머신(`run-state-machine.yml`)의 `VALIDATED` 단계는 이미 `GraphValidationReport`/`LinkValidationReport`/`MarkdownYamlValidationReport`를 만든다 — autosci-core kernel lint가 하는 일과 **정확히 같다**.
- staging→검수(human review)→promote 흐름 + Electron 데스크탑 UI(그래프 뷰, 검수 탭).

**쟁점 두 가지:** ① 언어(Python vs TS) ② 중복(두 시스템이 거의 같다). autosci-core가 더 가진 것 = **형식 계약 + 결정론적 lint/graph 게이트 + module-bank**. ai_dashboard가 더 가진 것 = **실제 LLM 에이전트 오케스트레이션 + 검수 UI + Electron 통합**.

---

## 2. 확정된 결정 (브레인스토밍 산출)

1. **북극성:** ai_dashboard = 멀티도메인 LLM 위키 플랫폼(오케스트레이터+UI), autosci-core = 공유 기질(substrate), 도메인 = overlay. (autosci-core README의 멀티프로젝트 비전과 일치.)
2. **실행 환경:** *지금은 로컬, 나중엔 배포* — 지금은 Python 허용, 단 나중에 떼어낼 수 있게 경계를 깔끔히.
3. **통합 방식 = 접근 A (프로세스 합성):** ai_dashboard가 autosci-core를 **서브프로세스 + 파일**로 만난다. TS는 **절대 Python을 import하지 않는다.** (claude/codex를 spawn하는 그 패턴 그대로.) 공유 인터페이스 = 계약 + vault 레이아웃 + autosci-core CLI + skills.
   - 기각: B(kernel을 TS로 포팅 → 코어를 둘로 유지, 드리프트 = autosci-core가 막으려던 문제), C(autosci-core가 엔진 전체, ai_dashboard는 뷰어 → TS 투자 대거 폐기, 배포에 불리).
4. **첫 하위 프로젝트 = 이음매 기반.** "통합 플랫폼" 전체는 spec 하나엔 과대 → 분해(§9). 첫 조각은 한 도메인에서 이음매를 end-to-end 증명.
5. **첫 증명 도메인 = 연구 논문 위키.** autosci-core가 `attnembed-e2e`로 이미 known-good vault를 생성함 → 콘텐츠를 *상수*로 두어 통합 리스크를 깨끗이 분리(실패 원인 = 오직 배관).
6. **해소된 설계 질문:**
   - `wiki-substrate`는 **별도 패키지** `packages/wiki-substrate` (경계 명확, 나중에 TS impl 교체 용이).
   - venv 매니저는 **`uv`로 통일** (코어와 동일 도구라 마찰 최소).

---

## 3. 목표와 범위

**목표:** autosci-core ↔ ai_dashboard 이음매를 논문 도메인에서 end-to-end로 증명한다. `attnembed-e2e` vault를 known-good 상수로 써서, 실패 시 원인이 오직 배관이도록 생성 리스크를 분리한다.

### 범위 안 — Phase 1 (배관, LLM 생성 없음)
- autosci-core를 `vendor/autosci-core` submodule + **`core-v0.2.0` 핀** + 관리 venv(`uv`)로 채택.
- TS `WikiSubstrate` 포트 + `PythonKernelAdapter` (`python -m kernel`, `autosci-read` shell-out + 출력 파싱).
- "논문 도메인" overlay = `attnembed-e2e/runtime`의 계약(`schema/*.yaml` + `policy/writers.yaml`)을 일반화한 paper 계약.
- known-good attnembed vault → `kernel lint` 통과 + `rebuild-index`/graph 렌더, 출력을 기존 리포트 타입으로 파싱.
- attnembed PDF → `autosci-read` → `raw/` SourceRecord 검증.
- 결과 vault·그래프를 기존 Electron UI(노드 뷰어/그래프)에 표시.

### 범위 밖 (명시적 연기 — §9)
- 코딩 에이전트로 노드를 **재생성**하는 풀루프 (→ #3 "생성 정렬").
- 다른 도메인(project-docs 등) overlay (→ #2).
- TS 검증기 은퇴, module-bank 표면 노출, 배포 freeze (→ #3~5).

---

## 4. 아키텍처와 경계

**불변 경계 = 계약 + vault 레이아웃 + autosci-core CLI.** TS는 Python을 import하지 않고 오직 서브프로세스 + 파일로 만난다.

```
ai_dashboard (TS, 오케스트레이터 + UI)
  packages/wiki-substrate/            ← 신규. 경계를 가둠
    WikiSubstrate (interface/port)
      lint(vault) -> ValidationReports
      ingest(source) -> raw/ SourceRecord
      rebuildIndex(vault) -> index.md
    PythonKernelAdapter (impl, 지금)
      python -m kernel lint|rebuild-index   (서브프로세스)
      autosci-read                          (서브프로세스)
      텍스트 출력 -> 리포트 파서
    (later) TsKernelAdapter                  같은 포트, 배포용 — 지금은 비워둠
  knowledge-harness/runtime/make-drivers.ts
      VALIDATED 드라이버 -> WikiSubstrate.lint()  (권위 게이트)
vendor/autosci-core/   (submodule, core-v0.2.0 핀)   ← 직접 수정 금지
.venv-substrate/       (uv 관리 venv)
core.lock              (core repo / version / commit 핀)
wiki-domains/paper/    (overlay: 계약 schema+policy + skill 포인터)
```

**왜 별도 패키지인가:** "나중에 배포 시 Python을 떼어낸다"가 `PythonKernelAdapter`를 같은 포트의 다른 impl(`TsKernelAdapter`)로 교체하는 것으로 환원된다 — 호출부(make-drivers, UI)는 불변.

**단방향 의존 보존:** ai_dashboard → autosci-core (CLI 호출). 역방향 없음. `vendor/`는 소비용 고정 복사본 — 코어 수정은 항상 autosci-core repo에서.

---

## 5. 컴포넌트

| 컴포넌트 | 위치 | 역할 |
|---|---|---|
| `vendor/autosci-core` | submodule | `core-v0.2.0` 핀 (paper 계약의 `object`/`list_object` lint 필요) |
| venv 부트스트랩 | `scripts/` + `run-*.sh`/`.bat` 연동 | `uv venv .venv-substrate && uv pip install -e vendor/autosci-core[pdf]`; adapter가 이 venv의 python 해석 |
| `core.lock` | repo 루트 | `core_repo`(github.com/irron2004/autosci-core) / `core_version`(core-v0.2.0) / `core_commit` 기록 |
| `packages/wiki-substrate` | 신규 TS 패키지 | `WikiSubstrate` 포트 + `PythonKernelAdapter` + 텍스트출력→리포트 파서 |
| `wiki-domains/paper/` | 신규 | attnembed에서 일반화한 paper 계약(`runtime/schema/*.yaml`, `runtime/policy/writers.yaml`) + skill 포인터 |
| `make-drivers.ts` 수정 | knowledge-harness | `VALIDATED` 드라이버가 `WikiSubstrate.lint()` 호출 (Phase 1은 **추가** 게이트; TS 검증기 은퇴는 #3) |
| 워크스페이스 vault 배치 | app-services `workspace-vault.ts` | autosci-core 레이아웃(`wiki/`, `wiki/graph/edges.jsonl`, `index.md`, `runtime/`)과 ai_dashboard `raw/` 화해 — `wiki-substrate` 한 곳에 격리 |

---

## 6. 데이터 흐름 (논문 도메인 end-to-end, Phase 1)

```
[0] 부트스트랩 (1회)
    git submodule update --init vendor/autosci-core        (core-v0.2.0 핀)
    uv venv .venv-substrate && uv pip install -e vendor/autosci-core[pdf]
    core.lock 기록 → PythonKernelAdapter가 venv python 해석·검증
        ↓
[1] INGEST   attnembed PDF
    WikiSubstrate.ingest(pdf) → autosci-read
        → <vault>/raw/papers/attnembed-2402-05370.md (SourceRecord)
        ↓
[2] SEED     known-good 노드 배치 (Phase 1은 생성 대신 상수)
    attnembed-e2e/wiki/* → <vault>/wiki/{papers,modules,pipelines}/*.md + wiki/graph/edges.jsonl
    wiki-domains/paper/runtime/{schema,policy} → <vault>/runtime/
        ↓
[3] VALIDATED   make-drivers VALIDATED 드라이버 → WikiSubstrate.lint(vault)
    = python -m kernel lint --contract-dir <vault>/runtime --wiki-dir <vault>/wiki
    출력(issue 텍스트 목록 + exit code) → 파서
        → GraphValidationReport / LinkValidationReport / MarkdownYamlValidationReport
    issue 0 + exit 0 → green
        ↓
[4] INDEX/GRAPH   python -m kernel rebuild-index → index.md ; graph 렌더(dot/mmd/html)
        ↓
[5] VIEW   기존 Electron 그래프 UI/노드 뷰어가 vault의 wiki/* + edges.jsonl 표시
```

**핵심 화해 지점:** ai_dashboard 워크스페이스 vault는 `raw/` + 위키 md를 나란히 두는 반면, autosci-core는 `wiki/` 하위에 노드, `runtime/`에 계약을 둔다. 이 경로 매핑이 `wiki-substrate`가 가두는 **유일한 포맷 어댑팅**이며, 한 곳에 모아두면 #2에서 다른 도메인 붙일 때 재사용된다.

**lint 출력은 텍스트:** `kernel.lint.Linter.run()`은 `list[str]`(예: `[edge json] path:line: msg`)을 반환하고 CLI는 `  - <issue>` 줄로 출력 + issue 있으면 exit 1. 파서는 이 텍스트 형식에 맞춘다 (JSON 아님 — §8 리스크 참조).

---

## 7. 테스트와 검증 (이음매를 *어떻게 증명하나*)

de-risking이 목표이므로 검증이 곧 산출물이다.

| 레벨 | 테스트 | 통과 기준 |
|---|---|---|
| 부트스트랩 | `python -c "import kernel"` + 버전 = `core.lock` | venv가 `vendor/` 코어를 해석 |
| 어댑터 단위 | `PythonKernelAdapter.lint()`를 **깨진 fixture vault**(누락 필수필드/끊긴 링크)에 | issue를 정확히 리포트로 파싱 — **거짓 green 없음** |
| 어댑터 단위 | 정상 vault에 lint | issue 0, exit 0 |
| e2e (골든) | attnembed known-good vault 전체 흐름 [1]~[4] | lint green + index/graph 생성, 스냅샷 안정 |
| **음성(negative)** | 골든 vault의 한 노드 frontmatter를 의도적으로 깸 | run이 **실패** — 게이트가 실제로 문다 |
| UI 스모크 | 생성된 vault를 기존 그래프 뷰어로 | 노드/엣지 렌더, 클릭→문서 |

**음성 테스트가 이 하위 프로젝트의 진짜 가치다** — "kernel 게이트가 ai_dashboard run을 실제로 fail시킨다"를 증명해야 이음매가 살아있는 것. 기존 `harness-pipeline.e2e.test.ts` 패턴에 얹는다.

---

## 8. 리스크와 미해결 사항

| 리스크 | 완화 |
|---|---|
| Windows/WSL 혼재에서 venv·python 경로 해석 | adapter가 python 실행파일을 명시 설정/탐색; `core.lock`에 경로 전략 기록; `CliAgentRunner`의 `shell:true` 선례 따름 |
| kernel lint 출력이 사람용 텍스트(기계가독 아님) | 파서를 그 형식에 맞춤. 깨지기 쉬우면 autosci-core에 `python -m kernel lint --json`을 **core-side 기능 요청**으로(도메인 무관이라 승격 적합 — README §"기능 승격 규칙") |
| vault 레이아웃 화해가 침습적일 수 있음 | `wiki-substrate` 한 곳에 격리; 워크스페이스 vault는 #2까지 paper 전용 별도 루트로 |
| 두 검증기(TS+kernel) 공존 혼란 | Phase 1은 kernel을 *추가* 게이트로만; TS 검증기 은퇴는 #3 |
| `core-v0.2.0`이 paper 계약 전부를 커버 못 할 가능성 | 구현 1단계에서 `attnembed-e2e` 계약을 실제 핀 태그로 lint해 사전 검증; 누락 시 코어에 이슈 + 임시로 다음 stable 사용 |

**해소됨 (브레인스토밍):** `wiki-substrate` = 별도 패키지; venv = `uv`.

---

## 9. 분해 (북극성 로드맵)

| # | 하위 프로젝트 | 산출 |
|---|---|---|
| **1** | **이음매 기반 (← 본 spec)** | vendor+pin+venv, `WikiSubstrate`/`PythonKernelAdapter`, paper overlay, 논문 도메인 e2e 증명 |
| 2 | 도메인 overlay 모델 | "도메인 = overlay 패키지" 정형화, UI/run 도메인 선택형, 기존 project-docs 위키를 overlay로 이관 |
| 3 | 생성 정렬 | 코딩 에이전트 프롬프트에 autosci-core skills 주입, TS 검증기를 kernel로 수렴/은퇴 |
| 4 | module-bank / pipeline composer 표면 | autosci-core v0.3 module-bank를 플랫폼에 노출 |
| 5 | 배포 분리 | Python을 freeze 사이드카로 (또는 `TsKernelAdapter`), 데스크탑 제품 패키징 |

각 하위 프로젝트는 자기 spec → plan → 구현 사이클을 갖는다.

---

## 10. 성공 기준 (하위 프로젝트 #1 완료 정의)

1. `vendor/autosci-core`가 `core-v0.2.0`에 핀되고 `core.lock`에 기록됨; venv 부트스트랩이 재현 가능.
2. `packages/wiki-substrate`의 `PythonKernelAdapter.lint()`가 정상 vault에 green, 깨진 vault에 정확한 issue 리포트(거짓 green 단위 테스트로 봉인).
3. attnembed 골든 vault가 ai_dashboard run을 통해 [1]~[4]를 통과하고 index/graph 생성.
4. 음성 테스트: 의도적으로 깬 노드가 run을 **실패**시킴 (kernel 게이트가 살아있음 증명).
5. 생성된 vault가 기존 Electron 그래프 뷰어에 노드/엣지로 렌더되고 클릭→문서 동작.
