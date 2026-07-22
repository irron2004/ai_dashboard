---
name: ask-wiki
description: Use when answering questions from a contract-driven wiki with page-level evidence, graph expansion, explicit knowledge gaps, and optional human-approved crystallization back into the wiki.
---

# 위키 질의

현재 위키에 실제로 기록된 내용과 관계를 근거로 답한다. 계약에 없는 어휘를 가정하지
않고, 위키 밖의 일반 지식은 위키 근거와 명확히 분리한다.

## 1. 읽기와 검색

1. `python -m kernel contract-info --json`을 실행해 모든 선언 kind, 디렉터리,
   필드, 템플릿 섹션, edge type, xref와 파생 뷰를 파악한다.
2. 질문 키워드와 동의 표현을 정리하고 모든 선언 kind에 대해
   `python -m kernel find <wiki_root> <kind>`를 실행한다. 제목만 보지 말고 반환된
   페이지의 선언 경로에서 본문을 읽으며, frontmatter 확인이 필요하면
   `python -m kernel read-meta <page-path>`를 사용한다.
3. 유력 페이지의 계약상 정식 노드 ID로
   `python -m kernel neighbors <wiki_root> <node-id> --depth 2`를 실행한다. 관계 타입과
   방향, evidence를 보존하고 관계가 있다는 이유만으로 본문에 없는 사실을 만들지 않는다.
4. `contract-info`의 `derived`에 선언된 읽기 전용 뷰가 질문에 맞으면 보조 근거로 쓴다.
   파생 결과만 있고 원천 페이지가 없으면 그 한계를 표시한다.

## 2. 답변

- 주장마다 근거 페이지의 선언 경로 또는 정식 페이지 ID를 붙인다. 여러 페이지를 종합한
  문장은 각각을 모두 인용한다.
- 충돌하는 기록은 숨기지 말고 각 주장, 근거, lifecycle/날짜를 나란히 제시한다.
- 위키 근거가 없으면 "위키에 근거 없음"이라고 답한다. 보충이 유용해도 위키 밖의 일반
  지식이라는 표지를 붙이고, 위키 사실처럼 인용하지 않는다.
- capture 실패나 원본 소실 때문에 답이 불완전하면 지식 부재와 수집 부재를 구분한다.

## 3. 선택적 환류

사용자가 환류를 명시적으로 요청한 경우에만 쓴다.

1. 계약 전체에서 제목, slug, 출처를 다시 비교해 기존 페이지 보강인지 새 페이지인지
   제안한다. 도메인 전용 유사도 명령에 의존하지 않는다.
2. kind와 필드, 템플릿 섹션, 출처 필드가 모두 계약에 맞는지 보여 주고 승인받는다.
3. 새 페이지는 `python -m kernel new-page <kind> --title <title> --slug <slug>
   --field <key=value> --json`으로 만들고, 기존 페이지 보강은 사용자 문장을 보존한다.
4. 근거 페이지와의 관계는 선언된 endpoint와 필수 속성을 만족할 때만
   `python -m kernel add-edge`로 추가한다. xref 양쪽을 함께 갱신한다.
5. 선언된 파생 뷰와 인덱스를 재구성하고 `python -m kernel lint` error 0을 확인한다.
6. 정확한 diff를 보여 준다. 사용자가 승인한 경로만 `git add -- <정확한-경로...>`로
   staging하고, commit도 별도 명시 승인을 받은 경우에만 실행한다.

환류가 거절되면 이번 작업의 변경만 원래 바이트로 복원하고 답변 자체는 읽기 전용 결과로
남긴다. 다른 dirty 파일이나 capture 큐는 건드리지 않는다.
