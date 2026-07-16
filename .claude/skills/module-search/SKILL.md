---
name: module-search
description: Use when finding similar modules/pipelines in the wiki for a new problem — e.g. "/module-search 시계열 이상탐지", "비슷한 문제 푼 파이프라인 찾아줘", "이 task에 쓸만한 모듈 뭐 있어".
---

> **작업 디렉토리**: 이 스킬의 모든 명령·상대경로(`wiki/`·`raw/`·`labs/`·`uv run …`)는
> 모노레포의 `research/` 디렉토리 기준이다. 실행 전 `cd research/` 할 것.

# 유사 module/pipeline 검색 (module-search)

## 개요
새 문제(task/modality)에 대해 module bank를 rule 기반 점수로 검색해 후보를 근거와 함께 제시한다.
점수는 core가 결정적으로 계산한다 — 이 스킬은 질의 구성과 결과 해석만 한다. ([[search-compose-modules]] 참조)

## 절차
1. 사용자 요청에서 task 키워드, modality(`time_series`/`image`/`text` 등), 필요 stage를 뽑는다.
2. 두 검색을 실행한다:
   ```bash
   uv run python -m autosci_core.module_bank search --kind pipelines --task "<task>" --modality <m> --top-k 5
   uv run python -m autosci_core.module_bank search --kind modules   --task "<task>" --modality <m> [--stage <stage>] --top-k 10
   ```
3. JSON을 표(slug/score/reasons/warnings)로 정리해 제시한다. `reasons`를 생략하지 않는다 —
   왜 추천됐는지가 실험 계획의 근거로 남는다.
4. 다음 행동을 제안한다: 상위 pipeline을 seed로 `/compose-experiment "<task>" --seed <slug>`,
   또는 결과가 빈약하면 관련 논문 ingest + `/module-extract`.

## 흔한 실수
- score는 절대값이 아니라 **상대 랭크**다. 결과가 빈약하면 모델이 나쁜 게 아니라
  `wiki/modules|pipelines/` 커버리지가 부족한 것 — ingest부터 제안한다.
- 이상하게 낮은 항목은 실패 trial penalty일 수 있다 — `wiki/pipeline_trials/`에서 이력을 확인해 함께 보고한다.
