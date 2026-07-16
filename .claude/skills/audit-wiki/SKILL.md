---
name: audit-wiki
description: Use when auditing a contract-driven wiki beyond lint, including duplicate candidates, capture-source loss, graph isolation, stale lifecycle state, thin content, and evidence quality.
---

# 위키 감사

구조적 lint와 의미적 건강 상태를 읽기 전용으로 조사하고, 서로 다른 결함 범주를 섞지
않은 수정 제안서를 만든다. 사용자가 명시적으로 수정까지 요청하지 않았다면 파일, 큐,
관계, git을 바꾸지 않는다.

## 1. 계약과 전체 인벤토리

1. `python -m kernel contract-info --json`을 실행한다. 모든 선언 kind, 필드,
   lifecycle, 템플릿 섹션, edge type, xref, 파생 뷰와 `capture_notes`를 읽는다.
2. 각 선언 디렉터리의 페이지를 kind 전체에서 수집하고 제목, slug, 출처 필드,
   lifecycle 값, 채워진 템플릿 섹션을 표로 만든다. 계약에 없는 어휘나 상태 기준을
   추가하지 않는다.
3. `python -m kernel lint` 결과를 error와 warning으로 분리한다.
4. `autosci-capture status --json`으로 capture 상태를 읽는다. 큐 파일을 직접 파싱하지
   않는다.

## 2. 상태를 섞지 않는 검사

다음 범주는 서로 다른 상태다.

- **capture orphaned:** 큐가 추적하던 원본 source_id가 실제 스캔에서 사라진 상태다.
  해당 큐 레코드와 연결된 페이지를 역추적하되 페이지 자체가 잘못됐다고 단정하지 않는다.
- **scope 제외:** 원본이 존재하지만 현재 scan 범위에서 제외된 상태다. capture orphaned로
  분류하지 않고 scan 설정 변경 이력과 실제 존재 여부를 별도로 확인한다.
- **graph-isolated:** 선언 페이지는 존재하지만 현재 typed edge의 어느 endpoint에도 없는
  상태다. 계약의 정식 노드 ID로 `python -m kernel neighbors <wiki_root> <node-id>
  --depth 1`을 확인하고, xref-only 연결은 별도 열로 표시한다.

capture orphaned를 graph-isolated로 보고하지 않고, graph-isolated를 capture orphaned로
보고하지 않는다. 원본 소실과 관계 부재를 합친 "고아" 합계도 만들지 않는다.

## 3. 의미적 검사

- **계약 전체 중복 후보:** 모든 선언 kind의 제목, slug, 출처 source_id를 함께 비교한다.
  정확 일치와 정규화 일치를 먼저, 의미 유사성은 그 다음 후보로 낸다. 도메인 전용 검색
  명령을 일반 계약의 전제로 삼지 않는다.
- **빈약한 페이지:** `template_sections` 중 비어 있는 섹션과 출처 없는 주장을 표시한다.
  짧다는 이유만으로 실패 처리하지 않는다.
- **관계 품질:** 각 edge type이 요구하는 evidence/confidence 등 필수 속성을 계약 그대로
  검사하고, endpoint가 없는 페이지와 근거가 모호한 관계를 나눈다.
- **lifecycle 정체:** lifecycle이 선언된 kind에만 적용한다. 날짜/전이 근거가 없으면
  임의의 "오래됨" 기준을 만들지 말고 검토 대상으로 표시한다.
- **파생 뷰:** `derived`에 선언된 결과만 원천 데이터와 비교한다. 캐시 누락과 실제 원천
  데이터 누락을 구분한다.

## 4. 보고와 선택적 수정

리포트는 다음 순서로 낸다.

1. lint error/warning
2. capture orphaned, failed, skipped와 scope 제외
3. graph-isolated와 xref-only 페이지
4. 중복·빈약·관계 근거·lifecycle 후보
5. 계약에 선언된 파생 뷰 불일치

각 항목에 근거 경로, 현재 값, 계약 규칙, 안전한 다음 행동을 붙인다. 자동 수정 가능한
구조 문제, 내용 판단이 필요한 문제, 원본 복구가 필요한 문제를 별도 등급으로 둔다.

수정 승인을 받으면 정확한 항목만 직렬로 고치고 관계/xref, 파생 뷰, 인덱스 순으로
재구성한 뒤 lint error 0을 확인한다. 병합·삭제·terminal queue mark와 commit은 각각
별도 사용자 승인이 필요하다. 기존 dirty 변경은 staging하지 않는다.
