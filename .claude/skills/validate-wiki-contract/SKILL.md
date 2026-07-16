---
name: validate-wiki-contract
description: Use when validating wiki pages after edits, adding graph edges, rebuilding the index, or debugging contract/lint/xref/frontmatter-type failures — e.g. "위키 lint", "계약 검증", "엣지 추가", "index 재생성", "xref 깨짐", "frontmatter 타입 에러".
---

# 위키 계약 검증·유지 (validate-wiki-contract)

## 개요
`kernel`은 위키의 **계약 집행 엔진**이다. 위키 페이지를 contract(entities/edges/xref 스키마)에 맞춰 **검증**하고,
그래프 엣지·인덱스를 **유지**한다. 이 스킬은 도메인 무관 **메커니즘**이다 — *어떤* 노드·엣지·taxonomy를 둘지
**제안하는** 일은 소비 프로젝트의 도메인 스킬(예: `curriculum-graph-design`, `diagnostic-taxonomy-design`)이 맡는다.
**core는 구조를 집행하고, 프로젝트는 구조를 제안한다.**

## 언제 쓰나
- 위키 페이지를 추가/수정한 **직후 검증**(lint)
- 그래프에 엣지를 명시적으로 추가
- `index.md` 재생성
- lint 실패·xref 깨짐·frontmatter 타입(bool/object/list_object) 에러 디버깅
- **NOT:** 도메인 스키마/taxonomy/노드를 *설계*(→ 프로젝트 도메인 스킬), 소스 문서 읽기([[read-source-documents]])

## 사용법
```bash
python -m kernel lint                       # 계약 기반 검증 (error 있으면 exit 1; warning은 WARN 라인만, exit 0)
python -m kernel rebuild-index              # index.md 재생성 (index_format 계약 플래그에 따라 generic/autosci)

# 엣지 (edge_engine: rwlib 계약이면 dedup·date 스탬프·JSON status 출력)
python -m kernel add-edge --type <t> --from A --to B [--evidence "..."] [--confidence high|medium|low] [--attr k=v]
python -m kernel update-edge --type <t> --from A --to B --attr k=v      # 매칭 엣지 attr merge
python -m kernel batch-edges < edges.json   # stdin JSON 배열
python -m kernel dedup-edges

# 인용 (papers 전용, citations.jsonl)
python -m kernel add-citation --from A --to B [--source semantic_scholar|parsed_bib|manual]
python -m kernel add-citations-batch --citer <arxiv-id> < s2_refs.json
python -m kernel dedup-citations

# 파생 뷰 재생성
python -m kernel rebuild-projected-edges | rebuild-context-brief | rebuild-open-questions

# 조회 (wiki_root 위치 인자 필요)
python -m kernel find <wiki_root> <kind> [--field value ...]
python -m kernel find-similar-concept <wiki_root> <title> [--aliases a,b]
python -m kernel query <wiki_root> ready-to-test|orphans [slug]
python -m kernel neighbors <wiki_root> <node> [--depth N] [--edge-type t] [--incoming|--outgoing]
python -m kernel compile-context <wiki_root> --for ideation|experiment|writing|review|general
python -m kernel stats <wiki_root> [--json] ; python -m kernel maturity <wiki_root> [--json]

# 라이프사이클·메타·로그·체크포인트
python -m kernel transition <page-path> --to <status> [--reason "..."]   # 계약 lifecycle + guard 집행
python -m kernel read-meta <path> [field] ; python -m kernel set-meta <path> <field> <value> [--append]
python -m kernel log <wiki_root> "<skill> | <details>"
python -m kernel slug "<title>" ; python -m kernel init <wiki_root> ; python -m kernel checkpoint-{save,load,clear,set-meta,get-meta}
```
`stats`/`maturity`/`rebuild-context-brief` 등 일부 커맨드는 autosci 계약 어휘(papers/ideas/…)
하드코딩이 남아 있다(A1.5에서 계약 구동화 예정) — autosci 어휘를 안 쓰는 계약에서는 참고치로만.

경로는 `wiki-kernel.yaml`(contract_dir/wiki_dir)에서 자동 해석. 오버라이드는 `--contract-dir`·`--wiki-dir`을
**둘 다 함께** 줘야 한다(하나만 주면 에러).

## 핵심 동작 (Quick Reference)
| 명령 | 동작 |
|---|---|
| `lint` | 모든 페이지를 contract 스키마로 검증. frontmatter 타입(bool/object/list_object), 필수 필드, enum, link-target, xref, 선언적 `constraints`, 미선언 키를 집행. **error 있으면 exit 1**(warning은 `WARN` 라인만 추가하고 exit 0) |
| `add-edge` | `--type/--from/--to`(+반복 `--attr k=v`)를 `GraphGate`로 검증 후 `edges.jsonl`에 append(직접 편집 금지) |
| `update-edge` | `--type/--from/--to`(+반복 `--attr k=v`) — `(type,from,to)` 일치 엣지의 속성을 merge 갱신(비매치 라인 보존, 매치 없으면 exit 1). 기존 엣지 수정의 유일 경로 |
| `rebuild-index` | 그래프에서 `index.md`를 재생성 |
| `transition` | 계약 `lifecycle.transitions` + guard(예: ideas→in_progress는 linked_experiments 필요, →failed는 --reason 필요, experiments→completed는 key_result 필요) 집행 후 status 갱신·날짜 스탬프 |
| `find`/`query`/`neighbors`/`compile-context` | 조회 계열 — wiki_root 위치 인자 필수 |
| `add-citation(s)-batch` | S2 refs JSON을 citations.jsonl로 (papers 전용) |
| `log` | append-only 로그 기록 (`## [{date}] {skill} | {details}`) |

API: `from kernel import KernelPaths, load_config, WikiContract, GraphGate, Linter`.
**불변 계약:** import 이름 `kernel`과 `python -m kernel` 진입점은 깨지 않는다(소비 프로젝트가 의존).

## 흔한 실수
- 페이지 편집 후 **항상 `lint`를 돌린다.** CI/커밋 전 green이 기본(= error 0). exit code 1 = 미해결 **error**(warning은 exit 0).
- lint는 error/warning 2급이다 — `WARN` 라인은 exit 0(green = error 0). 미선언 frontmatter
  키는 `[undeclared]` warning, 스키마의 `constraints:` 선언(when/severity/message)은 조합
  규칙을 error 또는 warning으로 집행한다.
- lint의 에러·경고 출력은 결정적 사전순 정렬이다 — 실행 간/스냅샷 간 byte 대조에 쓸 수 있다.
- 엣지: 신규는 `add-edge`, 기존 속성 갱신은 `update-edge` — `edges.jsonl` 직접 편집은 여전히 금지.
- `--contract-dir`와 `--wiki-dir`는 **항상 같이** 준다 — 한쪽만 주면 `SystemExit`.
- lint가 *무엇을* 통과시킬지(스키마)는 core가 아니라 **프로젝트 contract**가 정한다. 규칙을 바꾸려면 contract를 고친다.
- "노드를 어떻게 나눌까/어떤 선수관계를 둘까"는 이 스킬이 아니라 프로젝트의 구조-설계 도메인 스킬에서 판단한다.
