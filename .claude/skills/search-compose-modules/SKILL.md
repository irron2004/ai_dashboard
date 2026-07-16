---
name: search-compose-modules
description: Use when searching the module bank, validating module/pipeline contract compatibility, or composing one-module-swap pipeline candidates — e.g. "모듈 검색", "비슷한 파이프라인 찾아줘", "파이프라인 호환성 검증", "모듈 교체 후보 만들어줘", "compose".
---

# 모듈 뱅크 검색·검증·조립 (search-compose-modules)

## 개요
`autosci_core.module_bank`는 위키의 module/pipeline/trial 페이지를 읽어 **결정적으로**
검증(validate)·검색(search)·조립(compose)하는 엔진이다. 이 스킬은 도메인 무관 **메커니즘**이다 —
어떤 module을 추출하고 어떤 실험을 설계할지 *판단*하는 일은 소비 프로젝트의 도메인 스킬이 맡는다.
**core는 점수와 후보를 계산하고, 프로젝트는 무엇을 기록할지 판단한다.**

## 언제 쓰나
- 새 문제에 쓸 비슷한 module/pipeline을 **검색**할 때
- module/pipeline 페이지 작성·수정 후 **contract 호환성 검증**
- seed pipeline에서 **한 모듈씩 교체한 후보** 생성
- **NOT:** 문서에서 module 추출·실험 설계(→ 프로젝트 도메인 스킬), 페이지 스키마 lint(→ [[validate-wiki-contract]])

## 사용법
```bash
python -m autosci_core.module_bank validate-module   --slug <module-slug>
python -m autosci_core.module_bank validate-pipeline --slug <pipeline-slug>
python -m autosci_core.module_bank validate-bank
python -m autosci_core.module_bank search  --kind pipelines --task "<task>" --modality <m> [--top-k N]
python -m autosci_core.module_bank search  --kind modules   --task "<task>" [--stage <stage>] [--top-k N]
python -m autosci_core.module_bank compose --from-pipeline <seed-slug> [--max-candidates N]
```
- 출력은 전부 **JSON 한 줄**(결정적). 경로 생략 시 `wiki-kernel.yaml` 자동 탐색.
  오버라이드는 `--contract-dir`·`--wiki-dir` **둘 다 함께**.
- 프로젝트 엔티티 kind 이름이 다르면 `--module-kind/--pipeline-kind/--trial-kind`로 재매핑.
  (search의 `--kind {pipelines,modules}`는 *검색 대상* 선택이지 kind 재매핑이 아니다.)

## 핵심 동작 (Quick Reference)
| 명령 | 동작 | exit |
|---|---|---|
| `validate-module` / `validate-pipeline` | 필수 필드·stage module 존재·인접 stage contract(modality) 호환 검사. `issues[]`에 severity/path/message | ok=0 / issue=1 / not found=2 |
| `search` | task 키워드 + modality + contract + evidence + trial 이력의 rule 점수로 랭크. `reasons[]`에 점수 근거 | 0 |
| `compose` | seed에서 **한 번에 한 모듈만** 교체한 호환 후보 `candidates[]` + 거절 사유 `rejected[]`. 후보 slug는 `<seed>--<role>-<module>` | 0 / seed 없음=2 |
| `validate-bank` | bank 전체 module+pipeline 합산 검증 + (contract에 `schema/modality.yaml`이 있으면) modality 게이트 3종: 미선언 토큰 / supertype 토큰의 `scope: contract` evidence 부재 / taxonomy well-formedness(미선언 subtype·순환) — 전부 error | ok=0 / issue=1 |

## 흔한 실수
- **compose 후보원 = `alternatives` ∪ 같은 `(stage, kind)` role-signature drop-in** — 명시된
  `alternatives`(선언 순서) 먼저, 이어서 같은 stage·kind를 가진 다른 module들(slug 오름차순),
  stage별 dedup(선언된 alternatives가 정본). `alternative_to` *edge*가 아니다. 후보마다
  `reasons`에 `source=alternatives` 또는 `source=role-signature (stage=…, kind=…)`가 붙고,
  seed 모듈과 후보 모듈이 **둘 다** `axis:`를 선언했으면 `axis: <seed>-><cand>`도 붙는다.
  교체 후보가 안 나오면 seed가 쓰는 module의 `stage`·`kind`가 다른 module과 일치하는지,
  또는 `alternatives:`가 선언됐는지 본다(role-signature 항은 stage·kind가 둘 다 비어있지 않을 때만 활성).
- **실패한 trial은 반드시 `status: failed` + `changed_modules`(role/from_module/to_module)로 기록**한다 —
  이 시그니처가 compose의 "이미 실패한 조합 제외"와 search penalty의 키다. 기록이 없으면 같은 실패 조합이 재추천된다.
- 다중 모듈 교체 후보는 만들지 않는다(ablation 규율). 2개 이상 바꾸려면 **성공한 후보를 새 seed로** compose를 다시 돌린다.
- 조합(pipeline) 전체 성능을 개별 module 효과로 읽지 않는다 — module 단독 evidence는 module-specific ablation이 있을 때만 confidence를 올린다.
- 페이지를 쓰거나 고쳤으면 search/compose 전에 `python -m kernel lint`부터 — 스키마 위반 페이지는 로드 결과를 왜곡한다. **신규 페이지는 `rebuild-index`를 먼저** 돌려야 lint의 orphan 체크를 통과한다.
- **제거형(removal) trial**: `changed_modules` 항목에 `to_module`이 없으면 "모듈을 빼고
  돌린" 제거형 ablation이다. 순수 제거형 failed trial은 ① `from_module` 모듈에
  `removal_support_bonus`(+1.0) — 빼면 나빠진다 = 모듈 가치의 직접 증거, ② source_pipeline의
  `prior_failure_penalty`(−2.0)에서 면제된다. pipeline 벌점은 swap형(to_module 있음)
  또는 changed_modules가 빈 failed trial에서 발생하고, compose 제외("previously
  failed")는 swap형만 반영된다.
- **evidence_strength는 confidence 가중 × evidence 유형 가중**: 항목당 confidence(high=1.0 /
  medium=0.6 / low=0.3 / 미기재=0.6) × 유형(ablation=1.0 / benchmark=0.8 / narrative=0.5 /
  미기재=narrative 0.5), `min(1.0, Σ/3)`. module 검색 동점은 evidence 최고 confidence → slug
  순으로 결정적으로 정렬된다.
- **task-gate**: 비영 task 쿼리에서 해당 module의 `task_similarity=0`이면 task-무관 성분을
  국소 차단한다 — `removal_support_bonus`는 0으로, `evidence_strength`는 상한 0.2로 깎이고,
  변경분은 `warnings`에 `task-gate: <성분> <before>-><after>`로 기록된다(빈 task 쿼리에서는 비발동).
- **contract-level modality는 정확일치 + 선택 파일 `<contract_dir>/schema/modality.yaml`의
  supertype taxonomy로 판정**된다 — `compatible(out, in) = (out == in) OR is_subtype(out, in)`
  (producer 출력이 consumer 입력과 같거나 그 subtype일 때만 통과, 역방향 supertype 출력은 거절 —
  contravariant). 파일이 없으면 오늘의 정확일치 그대로, malformed면 load가 fail-loud한다.
  supertype 토큰(`subtypes` 선언 노드)을 contract에 쓰는 모듈은 `scope: contract` evidence가
  없으면 `validate-bank`가 hard-fail시키고, 미선언 토큰도 error다. 최상위 `modality:` 검색
  태그는 이 taxonomy의 대상이 아니다(contract-level `input_contract/output_contract.modality`만).
