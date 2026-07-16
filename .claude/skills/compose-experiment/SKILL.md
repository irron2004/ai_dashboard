---
name: compose-experiment
description: Use when planning experiments by composing one-module-swap variants of a seed pipeline — e.g. "/compose-experiment <task> --seed <pipeline>", "이 파이프라인 변형 실험 설계해줘", "모듈 바꿔가며 실험 계획".
---

> **작업 디렉토리**: 이 스킬의 모든 명령·상대경로(`wiki/`·`raw/`·`labs/`·`uv run …`)는
> 모노레포의 `research/` 디렉토리 기준이다. 실행 전 `cd research/` 할 것.

# 모듈 교체 실험 설계 (compose-experiment)

## 개요
seed pipeline에서 core compose(**한 번에 한 모듈 교체**)로 후보를 만들고, 선택된 후보를
`origin: composed` pipeline 페이지 + experiment 계획 페이지로 기록한다. **실험을 실행하지 않는다** —
산출물은 wiki 수준 계획까지. 실행은 사용자가 `lab_dir`에서 하고, 결과는 `/module-run-eval`로 기록한다.

## 절차
1. seed 결정: 사용자가 지정하지 않으면 `/module-search`로 상위 pipeline을 제안받아 확인한다.
2. 후보 생성:
   ```bash
   uv run python -m autosci_core.module_bank compose --from-pipeline <seed> --max-candidates 5
   ```
   candidates(교체 내용)와 rejected(사유)를 표로 제시하고, 진행할 후보를 사용자와 2~3개 고른다.
3. 선택된 후보마다 pipeline 페이지 작성(`runtime/templates/pipelines.md.tmpl`):
   - slug는 compose 출력 그대로(`<seed>--<role>-<module>`), `origin: composed`,
     `derived_from: [<seed>]`, stages는 compose 출력 그대로.
   - `metrics`는 **비워둔다** — 아직 실행 전이다. seed(논문) 수치를 옮겨 적지 않는다.
4. experiment 페이지 작성(`runtime/templates/experiments.md.tmpl`):
   - frontmatter: `status: planned`, `task`, `baseline_pipeline: <seed>`,
     `candidate_pipelines: [<후보 slug들>]`, `lab_dir: labs/<domain>/<experiment-slug>`,
     `hypothesis`(교체 모듈이 나을 것으로 기대하는 근거 — module 페이지 evidence 인용).
   - body: 변경 모듈(role: from→to)별 기대 지표, 실행 방법 제안(데이터·베이스라인·평가 지표).
5. `uv run python -m kernel rebuild-index` → `uv run python -m kernel lint` green(신규 페이지는 index 등재 전에 lint의 orphan 체크에 걸린다).
6. 사용자에게 안내: `lab_dir`를 만들어 실험을 실행하고, 결과가 나오면 `/module-run-eval <experiment-slug>`.

## 흔한 실수
- 한 experiment에 후보를 4개 이상 벌리지 않는다 — 목적은 탐색 폭이 아니라 **원인 해석**이다.
- 후보가 안 나오면: seed의 module 페이지 `alternatives:` 선언 여부와 rejected 사유
  (stage 불일치 / 과거 실패 / contract 비호환)를 확인해 보고한다.
- 2개 이상 동시 교체 후보를 손으로 만들지 않는다 — 성공한 후보를 **새 seed로** 이 스킬을 다시 돌린다.
