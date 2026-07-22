---
name: paper-plan
description: Use when compiling a paper outline from the wiki's pipeline/module graph — e.g. "/paper-plan <pipeline-slugs...> --venue <ICLR|NeurIPS|ICML|ACL|CVPR|IEEE> [--title <t>]", "이 파이프라인들로 논문 개요 잡아줘", "논문 아웃라인/플랜 만들어줘". Evidence map(pipeline+succeeded trial) → narrative → section/figure/citation plan → cross-model review → research/outputs/에 PAPER_PLAN 출력.
---

> **작업 디렉토리**: 이 스킬의 모든 명령·상대경로(`wiki/`·`raw/`·`labs/`·`outputs/`·`uv run …`)는
> 모노레포의 `research/` 디렉토리 기준이다. 실행 전 `cd research/` 할 것.

# 논문 개요 컴파일 (paper-plan)

## 개요
**검증된 pipeline**(근거 = 성공한 `pipeline_trial`)에서 evidence map을 만들고 → 서사 구조를
결정 → 섹션/그림/인용 계획을 컴파일한다. cross-model review(area chair)를 거쳐
`research/outputs/paper-plan-<slug>-<date>.md`를 출력한다. 핵심: 아웃라인은 **pipeline-graph 기반** —
모든 섹션은 어떤 pipeline(그 근거 trial·구성 module)을 뒷받침하기 때문에 존재한다. 논문 관례가
요구해서가 아니다.

## 엔티티 매핑 (원본 AutoSci idea-graph → autosci-core)
이 스킬은 원래 `ideas`/`concepts`/`topics`/`outputs`가 있는 idea-graph 위키용이었다. autosci-core엔
그 엔티티가 없으므로 아래로 재정합했다.

| 원본(idea-graph) | autosci-core (module/pipeline) |
|---|---|
| idea (기여 단위) | **pipeline** — 하나의 구체적 접근; 그 주장 = 그 trial 근거 |
| idea status `validated` / `in_progress`+succeeded exp | pipeline이 `evaluated_by_trial` → `status: succeeded` trial을 ≥1 보유 |
| linked_experiments (근거) | **pipeline_trials** (succeeded/failed/inconclusive; metrics value/baseline/delta) + **experiments**(계획 suite) |
| method | **module** (+ 묶음으로서 methods) |
| concept/topic (배경지식) | **papers**(문헌) + module `## Evidence from papers` + methods.summary — 별도 배경 노드 없음 |
| origin_gaps | pipeline/module `assumptions`·`failure_modes` + `graph/open_questions.md` |
| wiki/outputs/ | **research/outputs/** — lint 대상 `wiki/` 밖의 새 디렉토리 |
| derived_from edge (plan→idea) | plan은 그래프 노드가 아니다 — provenance는 plan front-matter(`source_pipelines`) + `kernel log`로 기록 (엣지 생성 금지) |

## 입력
`/paper-plan <pipeline-slug...> --venue <ICLR|NeurIPS|ICML|ACL|CVPR|IEEE> [--title <제목>]`
- pipeline slug들(공백 구분). 각 target pipeline은 성공한 trial을 ≥1 보유해야 한다.
- `--venue` (필수): 페이지 한도·포맷 결정. `shared-references/academic-writing.md`의 venue 표 참조.
- `--title` (선택): 없으면 target pipeline들로 생성.

## 출력
- `research/outputs/paper-plan-<slug>-<date>.md` — 완성된 PAPER_PLAN
- `wiki/log.md` — append (via `kernel log`)
- `wiki/graph/context_brief.md` — 재생성
- **PAPER_PLAN_REPORT** (터미널 출력)

## 절차

**Precondition**: `cd research/`. `wiki/`·`runtime/`·`labs/`가 보이는지 확인.

### 1. pipeline graph 로드
1. target마다 `wiki/pipelines/<slug>.md` 읽기 (origin, stages, metrics, reproducibility, code_available).
2. graph 이웃 순회:
   ```bash
   uv run python -m kernel neighbors wiki pipelines:<slug> --depth 1
   ```
   - `evaluated_by_trial` → `wiki/pipeline_trials/*.md` (status, metrics value/baseline/delta, success_reason/failure_reason)
   - `uses_module` → `wiki/modules/*.md` (`## Mechanism`, `## Role in pipeline`, `## Evidence from papers`, parameters)
   - module `source_papers` / `module_from_paper`·`pipeline_from_paper` → `wiki/papers/*.md`
   - pipeline `source_experiment` / `used_in_experiments` → `wiki/experiments/*.md`
3. `wiki/graph/context_brief.md`(전역 맥락), `wiki/graph/open_questions.md`(한계 주석용) 읽기.
4. `uv run python -m kernel query wiki ready-to-test` / `maturity wiki`로 성숙도 참고.

**검증**:
- target pipeline에 성공 trial이 하나도 없으면 → **error**: "논문 계획엔 성공한 pipeline_trial이 최소 1개 필요. 먼저 실험을 돌려 `/module-run-eval`로 기록하라."
- pipeline `origin: paper`만이고 자체 trial이 없으면 → warn: "주장이 논문 보고 수치에만 의존 — 자체 근거 없음."
- `wiki/papers/`가 5개 미만이면 → warn: "related work 커버리지 빈약; `/ingest`로 문헌 보강 권장."

### 2. evidence map 컴파일
pipeline → trial(근거) → module/paper → 섹션 매트릭스:

```markdown
| Pipeline | 성공 근거(trial) | 실패/애매 trial | 핵심 module | 섹션 |
|---|---|---|---|---|
| [[primary-pipeline]] | [[trial-main]] (succeeded, +Δ) | [[trial-abl-2]] (failed) | [[module-core]] | Method + Exp 5.2 |
| [[variant-pipeline]] | [[trial-abl-1]] (succeeded) | — | [[module-swap]] | Exp 5.3 (Ablation) |
```
- **primary pipeline** → 핵심 기여 → Abstract+Intro+Method
- **derived/composed pipeline**(한 모듈 교체 변형) → ablation 근거 → Exp ablation 소절
- 실패/inconclusive trial도 **명시** — 정직한 ablation 서사 + reviewer 방어

### 3. 서사 구조 결정
`shared-references/academic-writing.md`의 hourglass 원칙:
1. 스토리라인: Gap(module `assumptions`/`failure_modes` + open_questions) → Solution(pipeline stages + module `## Mechanism`) → Evidence(trial metrics value/baseline/delta) → Impact(maturity + delta 크기).
2. 각(angle): 문제주도 vs 방법주도 vs 데이터주도. 주 독자층. 최근접 논문 3편과의 차별점(`cites` 그래프).
3. 섹션↔pipeline 매핑: 모든 섹션은 ≥1 pipeline(또는 그 근거/모듈)을 뒷받침해야 한다. 근거 없는 섹션은 filler → 제거.

### 4. 섹션 아웃라인 생성
venue 포맷에 맞춰 섹션별로 작성 (각 섹션: `### Pipelines addressed`, `### Paragraph plan`, `### Key citations`, `### Figures/Tables`). 표준 골격:
- **1. Introduction** — gap framing(assumptions/open_questions), primary pipeline 기여, 결과 preview(headline delta).
- **2. Related Work** — 방향별 그룹핑(`wiki/papers/` + `cites`), 각 그룹 대비 본 연구 위치.
- **3. Method** — pipeline stages + module `## Mechanism`/`## Parameters`. Figure 1 = 전체 파이프라인(mandatory).
- **4. Experiments** — 4.1 setup(dataset/baseline/metric from trials), 4.2 main results(성공 trial 표), 4.3 ablation(교체/제거형 trial), 4.4 analysis.
- **5. Conclusion** — 핵심 takeaway, 한계(failure_reason/open_questions), future work(next candidate).

**페이지 예산**: `--venue`로 배정(academic-writing.md 표); 총합 ≤ venue main-body 한도.

### 5. Figure/Table 계획
- **Figure 1**: 파이프라인 아키텍처(stages/module 다이어그램) — mandatory.
- **Table 1 (main)**: 성공 trial metrics — 열 Method|metric…, 행 baseline+ours(ours bold, best bold/2nd underline, ↑/↓). 출처 = `pipeline_trials.metrics`(value/baseline/delta).
- **Figure/Table (ablation)**: 교체·제거형 trial 비교. 출처 = `changed_modules` + metrics.
- 각 항목에 type/source/축/스타일 명시.

### 6. Citation 계획
`shared-references/citation-verification.md` 준수:
1. 아웃라인이 `[[slug]]`로 참조한 `wiki/papers/` 전부 나열.
2. 각 논문 BibTeX 선(先)조회: DBLP → CrossRef → S2(WebFetch). 성공=key+source 기록, 실패=`[UNCONFIRMED]`.
3. 커버리지 리포트: `Citations: N total, M verified (DBLP/CrossRef/S2), K [UNCONFIRMED]`.

### 7. Cross-model review (mandatory, 폴백 있음)
`shared-references/cross-model-review.md` 준수 — **Claude 자체 평가를 reviewer에 노출 금지**.
```
mcp__llm-review__chat:
  system: "You are an area chair at {venue} reviewing a paper outline.
           Is the narrative convincing? Does every section serve a clear purpose?
           Are the experiments (pipeline trials) sufficient to support the central claims?
           Is related work adequate? What will reviewers attack?"
  message: |
    ## Paper Outline
    {step 4}
    ## Evidence Map
    {step 2}
    ## Figure/Table + Citation Coverage
    {step 5, 6}
    ## Questions
    1. narrative arc(gap→solution→evidence→impact) 설득력?
    2. 근거 부족 pipeline? 빠진 trial?
    3. related work 그룹핑 적절? 빠진 방향?
    4. 페이지 예산 현실적?
    5. 그림/표 충분?
```
- Review MCP 미구성 시(autosci-core 기본): 사용자에게 알리고 Claude self-review로 진행, 출력에 `[Claude self-review — no independent second opinion]` 명시.
- 피드백 반영해 아웃라인 수정.

### 8. wiki에 쓰기
1. slug 생성: `uv run python -m kernel slug "<working-title>"`.
2. `research/outputs/paper-plan-<slug>-<date>.md` 작성 — front-matter(venue, title, date, `source_pipelines: [<slug…>]`) + Evidence Map(2) + 아웃라인(4, review 반영) + Figure/Table 계획(5) + Citation 계획+커버리지(6) + Review 요약(7).
   - ⚠️ `research/outputs/`가 없으면 만든다. `wiki/` 안에 두지 말 것 — lint의 kind-dir 검증에 걸린다. plan은 graph 노드가 아니므로 **add-edge 하지 않는다**.
3. 파생물 재생성: `uv run python -m kernel rebuild-context-brief`.
4. 로그: `uv run python -m kernel log wiki "paper-plan | {venue} outline for {title} | pipelines: {slug…} | citations: {verified}/{total}"`.
5. **PAPER_PLAN_REPORT** 터미널 출력: Meta(title/venue/page limit/date), Pipelines→Sections 표, 페이지 예산 표, Figures/Tables 수, Citations verified/total, Review 점수·verdict, Next Steps(`/paper-draft research/outputs/paper-plan-<slug>-<date>.md`; [UNCONFIRMED] 해소).

## 흔한 실수 / 제약
- **--venue 생략 불가** — 페이지·포맷이 venue마다 크게 다르다.
- **성공 trial 근거 필수** — 논문 보고 수치(origin:paper)만으로는 empirical 주장 불충분.
- 모든 target pipeline은 최소 한 섹션에 등장해야 하고, 모든 섹션은 pipeline 근거가 있어야 한다.
- 인용은 전부 `wiki/papers/`에서 나온다 — 위키에 없는 논문 인용 금지, 메모리로 BibTeX 생성 금지.
- 페이지 예산 초과 시 하위 우선순위 섹션을 appendix 계획으로 이동하고 보고.
- graph 엣지는 `uv run python -m kernel add-edge`로만 — `edges.jsonl`·`citations.jsonl` 직접 편집 금지.
  (단 plan 자체엔 엣지 없음.)

## 의존성
- **Bash/kernel**: `uv run python -m kernel {slug|neighbors|query|maturity|rebuild-context-brief}`, `uv run python -m kernel log wiki "<msg>"`.
- **Claude Code 네이티브**: Read(위키 페이지), Glob(pipelines/trials/modules/papers 찾기), WebFetch(DBLP/CrossRef/S2 BibTeX).
- **MCP(선택)**: `mcp__llm-review__chat` — step 7 outline review(미구성 시 self-review 폴백).
- **shared-references**: `shared-references/academic-writing.md`, `shared-references/citation-verification.md`, `shared-references/cross-model-review.md`.
- **다음 단계**: `/paper-draft research/outputs/paper-plan-<slug>-<date>.md`.
