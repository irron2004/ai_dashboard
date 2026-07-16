---
name: paper-draft
description: Use when drafting a LaTeX paper from a PAPER_PLAN produced by /paper-plan — e.g. "/paper-draft research/outputs/paper-plan-<slug>-<date>.md [--review] [--sections 3,4]", "이 플랜으로 논문 초안 써줘", "논문 draft/LaTeX 작성". Writes each section from wiki pipelines/modules/trials/papers + figures/tables + verified BibTeX + de-AI polish → compilable paper/ dir.
---

> **작업 디렉토리**: 이 스킬의 모든 명령·상대경로(`wiki/`·`raw/`·`labs/`·`outputs/`·`uv run …`)는
> 모노레포의 `research/` 디렉토리 기준이다. 실행 전 `cd research/` 할 것.

# 논문 초안 작성 (paper-draft)

## 개요
`/paper-plan`이 만든 PAPER_PLAN에서 **컴파일 가능한 LaTeX 논문**을 섹션 단위로 작성한다. 각 섹션은
wiki의 pipeline/module/pipeline_trial/paper에서 재료를 끌어와 LaTeX+그림+표를 생성한다. BibTeX는
DBLP/CrossRef(citation-verification)에서 조회, 완성 후 de-AI polish(academic-writing)를 적용한다.
선택적 per-section cross-model review. 산출물은 `research/outputs/<slug>/paper/`.

## 엔티티 매핑
`/paper-plan`과 동일(그 스킬 상단 표 참조). 요약: **idea→pipeline, experiment→pipeline_trial,
method→module, concept/topic→papers+module evidence, outputs/→research/outputs/**.

## 입력
`/paper-draft <paper-plan-path> [--review] [--sections <번호들>]`
- `plan`: PAPER_PLAN 경로 (예: `research/outputs/paper-plan-attn-embed-2026-07-09.md`).
- `--review` (선택): per-section + 전체 cross-model review 활성화.
- `--sections` (선택): 지정 섹션만 작성(예 `--sections 3,4` = Method+Experiments) — 증분 작성용.

## 출력
- `research/outputs/<slug>/paper/`:
  - `main.tex`, `math_commands.tex`, `references.bib`
  - `sections/{introduction,related_work,method,experiments,conclusion,appendix}.tex`
  - `figures/`, `tables/`(선택)
- `wiki/log.md` — append.

## 절차

**Precondition**: `cd research/`. PAPER_PLAN 존재 확인(없으면 error → `/paper-plan` 먼저).

### 1. paper 디렉토리 초기화
1. PAPER_PLAN에서 venue/title/섹션 목록/evidence map/figure·citation 계획 추출.
2. `research/outputs/<slug>/paper/`가 이미 있으면 `paper.bak-<timestamp>/`로 백업 후 사용자 확인.
3. 디렉토리 구조 생성(main.tex, math_commands.tex, references.bib, sections/, figures/).
4. venue 템플릿이 `research/outputs/templates/{venue}` 등에 있으면 복사, 없으면 generic `article`로
   시작하고 main.tex에 "공식 템플릿으로 교체 필요" 주석.
5. `math_commands.tex`: `wiki/modules/`(`## Mechanism`·`## Parameters`)와 관련 표기를 모아 벡터/행렬/
   집합/연산자 기호를 통일 정의.
6. `main.tex` 골격: `\documentclass{article}`(→venue 템플릿), `\input{math_commands}`,
   booktabs/graphicx/amsmath/hyperref, `\title`, 익명 `\author{}`, abstract 자리, 각 섹션 `\input`,
   `\bibliography{references}`.

### 2. 그림·표 생성
PAPER_PLAN의 Figure Plan 항목마다:
- **다이어그램**(파이프라인 아키텍처): TikZ/pgfplots 네이티브, 복잡하면 matplotlib→PDF. `figures/<name>.pdf`.
- **플롯**(실험 결과): `wiki/pipeline_trials/*`의 metrics(value/baseline/delta) 추출 → matplotlib
  (academic-writing 도식 기준: colorblind-safe, 폰트 ≥8pt, error bar/CI, 명확한 legend) → PDF.
- **표**: booktabs(toprule/midrule/bottomrule), best bold·2nd underline. 작은 표는 섹션 .tex에 직접,
  큰 표는 `tables/<name>.tex`.

### 3. 섹션 작성
PAPER_PLAN 순서대로(또는 `--sections` 지정분만):

**3a. 재료 수집** — 섹션이 뒷받침하는 pipeline, 대응 wiki 페이지, 그림/표, 인용 목록을 PAPER_PLAN에서 추출한 뒤 해당 위키 페이지의 관련 부분을 읽는다:
- Introduction → `wiki/pipelines/*`(주장) + module `assumptions`/`failure_modes` + `graph/open_questions.md`
- Related Work → `wiki/papers/*`(Related) + `cites` 그래프
- Method → `wiki/pipelines/*`(`## Stage sequence`) + `wiki/modules/*`(`## Mechanism`·`## Role in pipeline`·`## Parameters`) + methods.summary
- Experiments → `wiki/pipeline_trials/*`(`## Result`·metrics·`## Setup`) + `wiki/experiments/*`(task/hypothesis)
- Conclusion → trial `failure_reason`/`success_reason` + `## Next candidate` + open_questions

**3b. LaTeX 작성** (`shared-references/academic-writing.md`) — 문단 계획대로, `\cite{key}`(citation plan 매핑), `\ref{fig:}`/`\ref{tab:}`, math_commands 기호, 문단 첫 문장=topic sentence. Experiments는 claim-first("We claim X. To verify, ...").

**3c. De-AI polish** (academic-writing.md §4, 필수) — AI 시그니처 어휘 치환, 과잉 hedging 제거, 문장 시작 다양화, filler 제거, 능동태, 표기 일관성.

**3d. per-section review (`--review`)** — `shared-references/cross-model-review.md` 준수(자체 평가 비노출):
```
mcp__llm-review__chat:
  system: "Reviewing one section of a paper draft. Focus: clarity, logical flow,
           claim–trial alignment, notation consistency, residual AI-language."
  message: "## Section {name}\n{LaTeX}\n## Pipelines this section supports\n{목록}\n## Review for: 1 주장 뒷받침? 2 명료? 3 AI 어투? 4 표기 일관? 5 빠진 내용?"
```
인라인 수정(전면 재작성 금지). MCP 미구성 시 self-review + `[Claude self-review]` 표기.

### 4. Bibliography 구축
`shared-references/citation-verification.md`:
1. 전 섹션의 `\cite{key}` 수집.
2. 각 인용 BibTeX = PAPER_PLAN citation plan에서 가져오되, 미확인분은 DBLP→CrossRef→S2(WebFetch)
   재조회. 확인분 `references.bib`에 기록, `[UNCONFIRMED]`는 하단에 `% [UNCONFIRMED]` 주석과 함께.
3. `\nocite{*}` 금지 — 실제 인용된 항목만.
4. 각 항목 title/author/year 유효성 검증. 통계 출력: `references.bib: N entries, M verified, K [UNCONFIRMED]`.

### 5. 전체 cross-review (`--review` 또는 기본 1회 권장)
```
mcp__llm-review__chat:
  system: "Final review of a complete draft. Focus: cross-section coherence,
           claim–trial thread(do the pipeline trials back the central claims?),
           narrative flow, notation, figure/table referencing. Structural, not line-by-line."
  message: "## Full Draft\n{전 섹션}\n## Evidence Map\n{PAPER_PLAN}\n## Focus: 1 스토리 일관? 2 모든 pipeline 뒷받침? 3 표기 불일치? 4 그림/표 참조·논의? 5 중복? 6 제출 준비도(1-10)?"
```
피드백 반영해 최종 조정. MCP 미구성 시 self-review.

### 6. 마무리
1. 무결성 검증: `\input{sections/X}` 대상 존재, `\includegraphics{figures/X}` 존재, 모든 `\cite{key}`가 references.bib에 있음, 모든 `\ref{label}`에 대응 `\label`.
2. 로그: `uv run python -m kernel log wiki "paper-draft | drafted {venue} '{title}' | {N} sections, {M} figures, {K} citations ({V} verified)"`.
3. 터미널 출력: Files 목록, Status(작성 섹션/de-AI/review/[UNCONFIRMED] 수), Next Steps(`/paper-compile research/outputs/<slug>/paper/`; [UNCONFIRMED] 해소).

## 흔한 실수 / 제약
- **각 섹션은 wiki에서 나온다** — 무(無)에서 생성 금지; 모든 기술 서술은 위키 페이지(pipeline/module/trial/paper)로 추적 가능해야.
- **BibTeX는 citation-verification 준수** — DBLP/CrossRef/S2 조회, LLM 메모리 생성 금지.
- **De-AI polish 필수** — 섹션마다 작성 후 polish 패스.
- **익명 제출** — 저자/소속/감사말 금지.
- `\nocite{*}` 금지, 표기는 math_commands.tex로 통일, 표는 booktabs(세로선 없음).
- 기존 `paper/` 덮어쓰기 전 백업.
- `[[slug]]`(PAPER_PLAN) → `\cite{key}`(LaTeX) 변환.

## 오류 처리
- PAPER_PLAN 없음 → error(`/paper-plan` 먼저). 포맷 불완전 → 누락 섹션 나열.
- 위키 페이지 없음(플랜이 참조한 pipeline/trial/module/paper 부재) → warn+skip, missing 주석.
- 그림 생성 실패(matplotlib) → `% TODO: generate figure {name}` placeholder 후 계속.
- BibTeX 전부 실패 → [UNCONFIRMED] placeholder, 수동 처리 수 보고.
- Review MCP 미구성(`--review`) → self-review로 대체, "unreviewed/self-review" 표기.
- venue 템플릿 없음 → generic article, main.tex 주석.
- 섹션 초과(페이지 예산) → warn, appendix 이동/압축 제안.

## 의존성
- **Bash/kernel**: `uv run python -m kernel log wiki "<msg>"`; `python3`(matplotlib 그림 스크립트 실행).
- **Claude Code 네이티브**: Read(위키·PAPER_PLAN), Glob, Write(paper/ 파일), Bash(디렉토리·스크립트), WebFetch(DBLP/CrossRef/S2).
- **MCP(선택)**: `mcp__llm-review__chat` — per-section(`--review`) + 전체 cross-review(미구성 시 self-review).
- **shared-references**: `academic-writing.md`(작성 기준·de-AI·그림), `citation-verification.md`(BibTeX·[UNCONFIRMED]), `cross-model-review.md`(reviewer 독립성·폴백).
- **다음 단계**: `/paper-compile research/outputs/<slug>/paper/`.
