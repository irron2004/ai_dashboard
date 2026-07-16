---
name: module-run-eval
description: Use when recording experiment results back into the module bank as pipeline trials with feedback edges — e.g. "/module-run-eval <experiment-slug>", "실험 결과 기록해줘", "이 조합 실패했어/성공했어".
---

> **작업 디렉토리**: 이 스킬의 모든 명령·상대경로(`wiki/`·`raw/`·`labs/`·`uv run …`)는
> 모노레포의 `research/` 디렉토리 기준이다. 실행 전 `cd research/` 할 것.

# 실험 결과 기록·되먹임 (module-run-eval)

## 개요
사용자가 보고한 실험 결과를 pipeline_trial 페이지 + feedback edge로 기록한다.
**실패도 반드시 기록한다** — trial의 `changed_modules`(role/from_module/to_module) 시그니처가
다음 search penalty와 compose "실패 조합 제외"의 키다. 기록이 없으면 같은 실패 조합이 재추천된다.

## 절차
1. `wiki/experiments/<slug>.md`에서 baseline/candidate pipelines와 `lab_dir`를 읽는다.
   결과(지표, 성공/실패)는 사용자 보고 또는 `lab_dir` 산출물에서 받는다 — **결과를 추정하지 않는다.**
2. 평가된 candidate pipeline마다 pipeline_trial 페이지 작성(`runtime/templates/pipeline_trials.md.tmpl`):
   - `source_pipeline`: **평가된 composed pipeline**(seed 아님 — 어떤 변형인지 잃지 않는다)
   - `linked_experiment`: experiment slug, `task`/`dataset`
   - `status`: succeeded / failed / inconclusive — 애매하면 inconclusive(성공 과대평가 금지)
   - `metrics[]`: name/value/baseline/delta (baseline은 seed 결과)
   - `changed_modules[]`: role/from_module/to_module/reason — **누락 금지(penalty 키)**
   - `success_reason` 또는 `failure_reason` 한 줄
3. edge 추가:
   ```bash
   # 노드 id는 kind/slug (슬래시). edge_engine=rwlib이 콜론(kind:slug)·bare slug를 거부한다.
   uv run python -m kernel add-edge --type evaluated_by_trial --from pipelines/<candidate> --to pipeline_trials/<trial>
   # 성공 시:
   uv run python -m kernel add-edge --type succeeded_with --from modules/<to_module> --to pipeline_trials/<trial>
   # 실패 시:
   uv run python -m kernel add-edge --type failed_with --from modules/<to_module> --to pipeline_trials/<trial>
   ```
4. experiment 페이지 갱신: `status: completed`(모든 후보 평가 시), body `## Status log`에 결과 한 줄 요약.
5. `uv run python -m kernel rebuild-index` → `uv run python -m kernel lint` green(신규 페이지는 index 등재 전에 lint의 orphan 체크에 걸린다).
6. 후속 제안: 성공 후보가 있으면 그것을 **새 seed로** `/compose-experiment` 재실행(단계적 다중 개선).

## 흔한 실수
- 실패를 기록하지 않는 것 — **실패가 가장 가치 있는 기록이다.**
- module 페이지 evidence로의 승격: trial은 *조합*의 결과다. module 단독 evidence 추가는
  module-specific ablation 근거가 있을 때만 한다.
- `source_pipeline`을 seed로 거는 것 — 평가된 변형이 무엇인지 잃는다.
