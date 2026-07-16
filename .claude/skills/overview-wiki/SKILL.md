---
name: overview-wiki
description: Use when creating or refreshing the contract-declared singleton project overview while preserving all user-authored bytes outside its managed block.
---

# 계약 기반 overview 생성·갱신

현재 계약이 명시한 단 하나의 overview 역할 페이지를 만들거나 갱신한다. 어휘와 저장
경로를 이름으로 추측하지 않으며 전체 페이지를 강제 교체하지 않는다.

## 1. 기능과 입력 확인

1. 대상 레포 루트에서 `python -m kernel contract-info --json`을 실행한다. 반환된
   `capture_notes`에서 정확한 선언 ``overview-equivalent kind: `<kind>` ``를 찾는다.
   선언이 없거나 두 개 이상이거나 `<kind>`가 `kinds`에 없으면 쓰지 말고 계약 보강을
   요청한다. kind 이름에 `overview`라는 문자열이 있다는 이유만으로 선택하지 않는다.
2. `contract-info`가 선언한 그 kind의 디렉터리에서 일반 `.md` 페이지를 안전하게 센다.
   symlink, 비정규 파일, 읽을 수 없는 페이지가 있으면 중단한다.
   - 0개: 신규 생성 절차로 간다.
   - 1개: managed block 갱신 절차로 간다.
   - 2개 이상: singleton 위반을 경로와 함께 보고하고 사용자 정리 전에는 진행하지 않는다.
3. `wiki/index.md`, 엄격하게 파싱한 typed edge 저장소, `autosci-capture status --json`,
   그리고 `contract-info.derived`가 실제 선언한 파생 뷰만 읽는다. capture `orphaned`
   (원본 소실)와 graph-isolated(그래프 관계가 없는 페이지)는 별도 목록으로 유지한다.
   malformed graph·queue·파생 뷰를 빈 값으로 간주하지 않는다.

## 2. 생성할 내용

근거가 있는 항목만 아래 고정 순서로 작성한다.

```markdown
<!-- autosci:overview:start -->
## Purpose
...
## Structure
...
## Key documents
...
## Gaps
...
<!-- autosci:overview:end -->
```

- Purpose: 레포 목적과 경계. 추측은 사실처럼 쓰지 않는다.
- Structure: 계약 kind, 디렉터리, topic 계층과 확인된 연결.
- Key documents: 원본 출처가 있고 typed edge 또는 명시 링크로 뒷받침되는 대표 페이지.
- Gaps: missing-source, failed/skipped capture, graph-isolated, open question을 서로 다른
  소제목이나 목록으로 표시한다. `orphaned`를 graph-isolated의 동의어로 쓰지 않는다.
  `rebuild-open-questions`는 이 섹션의 **각 불릿을 실제 gap 한 건으로 수집**하므로, 미해결
  항목만 불릿으로 쓴다. "모두 캡처됨", "실패 없음", "열린 작업 없음" 같은 정상·0건
  상태는 불릿이 아닌 문단으로 기록한다. 실제 gap이 하나도 없으면 그 사실만 문단으로 쓴다.

managed block 안에만 생성 내용을 둔다. marker 문자열을 본문 데이터에 다시 넣거나
중첩하지 않는다.

## 3. singleton이 0개일 때

대표 원본 source_id를 하나 이상 고르고 `contract-info.kinds[<kind>]`의 모든 필수 필드를
채운다. 대표 출처가 없으면 빈 출처나 가짜 경로를 만들지 말고 중단한다. 먼저 다음 형태로
템플릿 골격을 만든다.

```bash
python -m kernel new-page <kind> --title <title> --slug <stable-slug> \
  --field <required=value> --json
```

`--force`는 사용하지 않는다. 생성된 템플릿에 marker가 정확히 한 쌍이고 네 heading이
순서대로 있는지 확인한 뒤 `python -m kernel update-overview`의 표준 입력으로 새 managed
block을 전달한다. 생성 또는 갱신이 실패하면 이번 실행에서 만든 페이지 변경만 원래
상태로 복원하고 큐를 건드리지 않는다.

## 4. singleton이 1개일 때

페이지 전체를 다시 쓰거나 `new-page --force`를 실행하지 않는다. marker 시작·끝이 각각
정확히 하나이고 시작이 끝보다 앞서며 중첩되지 않았는지 먼저 확인한다. 한쪽 marker가
없거나 중복·역순·중첩이면 사용자 작성 영역을 추측하지 말고 중단한다.

새 block을 `python -m kernel update-overview`의 표준 입력으로 전달한다. 이 명령은 기존
시작 marker 앞의 bytes와 끝 marker 뒤의 bytes를 byte-for-byte 보존해야 한다. 갱신 후
두 바깥 영역의 hash가 전과 같은지 확인한다. 같은 입력으로 다시 실행해 파일 bytes가
같은 rerun인지도 확인한다.

## 5. 재구성·검수

계약이 선언한 파생 뷰만 대응하는 `kernel rebuild-*` 명령으로 갱신하고
`python -m kernel rebuild-index`를 실행한 뒤 `python -m kernel lint`가 error 0인지
확인한다. 변경 파일, singleton kind와 경로, 근거 source_id, capture 상태별 미해결 항목,
graph-isolated 목록, typed edge 검토 결과를 구분해 보여 준다.

이 스킬은 capture 항목을 mark하거나 git commit하지 않는다. 기존 dirty 파일과 겹치면
쓰기 전에 중단하며, staging이 필요해도 전체 경로를 일괄 추가하지 않고 사용자 승인 경로만
`git add -- <정확한-경로...>`로 제안한다.
