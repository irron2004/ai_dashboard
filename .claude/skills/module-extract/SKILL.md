---
name: module-extract
description: Use when extracting stage-level modules and the paper's pipeline recipe from an ingested paper — e.g. "/module-extract <paper-slug>", "이 논문 모듈로 분해해줘", "논문 방법 모듈화". Default is dry-run (report only); write pages only with --write.
---

> **작업 디렉토리**: 이 스킬의 모든 명령·상대경로(`wiki/`·`raw/`·`labs/`·`uv run …`)는
> 모노레포의 `research/` 디렉토리 기준이다. 실행 전 `cd research/` 할 것.

# 논문 → module/pipeline 추출 (module-extract)

## 개요
paper 페이지(+`raw/` 원문)에서 **논문에 명시된** stage 단위 구성요소를 modules로, stage 순서를
`origin: paper` pipeline으로 추출한다. 무엇이 module인지의 *판단*은 이 스킬이 하고,
검증은 core(`kernel lint`, `module_bank validate`)가 한다.

## 입력
`/module-extract <paper-slug> [--write]` — 기본은 **dry-run**(파일 미생성, report만).

## 절차
1. `wiki/papers/<paper-slug>.md` 확인. 원문이 필요하면 `raw/`에서 찾아 [[read-source-documents]](`autosci-read`)로 읽는다.
2. 방법 섹션에서 stage 단위 구성요소를 식별하고, 각각에 대해 **원문 인용(evidence_text)**을 확보한다.
3. dedup: `wiki/modules/` 슬러그 목록과
   `uv run python -m autosci_core.module_bank search --kind modules --task "<task>"`로
   같은 구성요소가 이미 있는지 확인. 있으면 새 페이지 대신 기존 페이지의 `evidence`에 추가한다.
4. **dry-run report 출력** (기본 종료 지점): 제안 modules 표(slug/kind/stage/근거 인용),
   제안 pipeline stages 순서, uncertain 목록(근거 부족으로 만들지 않은 것).
5. `--write`일 때만:
   a. module 페이지 — `runtime/templates/modules.md.tmpl` 구조, frontmatter는 `runtime/schema/entities.yaml`의
      modules 필드. 논문이 비교·대체 실험한 module은 `alternatives:`에 선언한다 —
      **compose가 이 frontmatter 필드를 후보 소스로 쓴다**(alternative_to edge가 아님).
      evidence 항목에는 `scope`를 선언한다 — module-specific ablation·같은 stage 내 교체
      비교면 `scope: module`, 파이프라인 전체 비교 수치면 `scope: pipeline`.
      `confidence: high`는 `scope: module`일 때만 가능하다(lint constraints가 기계 검증).
   b. pipeline 페이지 — `origin: paper`, `source_paper`, `stages[].role/module/required`,
      `metrics`(논문 보고 수치), `reproducibility`, `code_available`.
   c. edge 추가(edges.jsonl 직접 편집 금지):
      ```bash
      uv run python -m kernel add-edge --type module_from_paper --from modules:<slug> --to papers:<paper> --attr confidence=<high|medium|low>
      uv run python -m kernel add-edge --type uses_module --from pipelines:<slug> --to modules:<slug>
      uv run python -m kernel add-edge --type pipeline_from_paper --from pipelines:<slug> --to papers:<paper> --attr confidence=<high|medium|low>
      ```
   d. `uv run python -m kernel rebuild-index` → `uv run python -m kernel lint` green 확인(신규 페이지는 index 등재 전에 lint의 orphan 체크에 걸린다).
   e. paper 페이지 body의 `## Modules extracted`에 `[[module-slug]]` 목록 갱신.
   f. `uv run python -m autosci_core.module_bank validate-pipeline --slug <pipeline-slug>` → ok 확인.

## 추출 규칙 (위반 금지)
1. 논문에 명시된 module만 추출한다.
2. 논문에 없는 hyperparameter를 추정해 채우지 않는다.
3. evidence_text(원문 인용)가 없으면 페이지를 만들지 않고 uncertain 목록으로 보고한다.
4. stage sequence가 불명확하면 `pipeline_from_paper` edge의 `confidence=low`로 두고 report에 명시한다.
5. pipeline 전체 성능을 개별 module 효과로 승격하지 않는다 — module evidence `confidence: high`는
   module-specific ablation이 있을 때만. (= scope: module일 때만 — lint가 집행)
6. 논문 ablation에서 진 변형도 pipeline_trial(`status: failed` 또는 `inconclusive`)로 기록한다 —
   다음 search/compose의 penalty 입력이다.
7. dedup 판정과 백필 지시가 충돌하면(예: dedup은 "evidence 추가하지 않음" 권고, 백필
   기대값은 일치 모듈 전원 evidence 요구): **일치 module에는 항상 evidence를 추가한다.**
   단, 그 evidence가 서술 전용(근거 문장은 있으나 수치·ablation 없음)이면 confidence는
   **low를 상한**으로 한다. (이 규칙은 충돌 해소 전용 — 서술 전용 evidence 일반의 강등
   규칙이 아니다.)
