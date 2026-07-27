# `next.yml` 대시보드 단일소스 — Phase 2 구현 계약

> 상위 계약: 루트 워크스페이스
> `docs/superpowers/specs/2026-07-26-project-next-actions-single-source-design.md` §8

## 범위

- 로컬 `repoPaths` 중 `next.yml`이 정확히 하나 있는 프로젝트를 **파일 관리형**으로 본다.
- 파일 관리형 프로젝트의 Task 화면·명령·대화 추출 진실은 `next.yml`이다.
- `next.yml`이 없는 프로젝트는 점진 이관을 위해 기존 SQLite Task 경로를 유지한다.
- SQLite의 파일 관리형 Task 행은 검색·기존 서비스 호환용 파생 캐시이며, 화면 읽기 실패 시
  진실로 되살리지 않는다.
- 원격 경로와 둘 이상의 `next.yml` 후보는 자동으로 쓰지 않고 명시적 오류를 보여준다.

## Task 매핑

| `next.yml` | `Task` | 역매핑 |
|---|---|---|
| `id` | `next:<projectId>:<id>` | 관리형 prefix를 제거 |
| `title` | `title` | 앞뒤 공백 제거, 한 줄만 허용 |
| `priority: P0/P1/P2` | `high/medium/low` | 완전 역매핑 |
| `status: todo` | `todo` | `todo` |
| `status: doing` | `in_progress` | `doing` |
| `status: blocked` | `todo` + `blockedBy` | blocker가 있으면 `blocked` |
| `status: done` | `done` | `done` |
| `due` | `dueDate` | ISO 날짜 |
| `note` | `acceptanceCriteria[0]` | 첫 항목 |
| `blocked_by` | namespaced `blockedBy[0]` | 단일 blocker만 허용 |
| `source` | `sourceRef: next.yml#<id>` + source 종류 | 기존 source 문자열 보존 |

`review`와 `rejected`는 파일 계약에 없으므로 관리형 프로젝트의 일반 편집에서는 거부한다.
리뷰 승인 결과는 `done`, 변경 요청은 후속 `todo` 제안으로 표현한다.
`chat:<session>`은 Resume 화면이 최신 대화를 다시 찾을 수 있도록 `contextPackage`에도 session을
매핑한다.

## 제안과 승인

- 변경 명령은 canonical 파일을 직접 수정하지 않고 같은 디렉터리의
  `next.proposal.yml`을 만든다.
- proposal에는 `apc.base_sha256`, `apc.proposal_sha256` 메타데이터와 완성된 다음 문서를
  저장한다. 사용자가 보는 preview는 이 완성 문서를 Task로 매핑한 결과다.
- 같은 canonical hash에서 들어온 추가 변경은 현재 proposal 위에 합친다.
- 메모→Task 전환은 proposal 메타데이터에 note id와 새 task id를 함께 묶고, 승인 뒤에만
  메모를 전환 완료로 표시한다. 이후 Task 편집이 합쳐져도 이 후속 동작은 보존한다.
- 승인 요청은 UI가 마지막으로 본 proposal hash를 보낸다.
- 승인 시 canonical hash와 base hash, 디스크 proposal hash를 모두 다시 비교한다.
  하나라도 다르면 canonical과 proposal을 모두 보존하고 충돌을 반환한다.
- 승인 쓰기는 같은 디렉터리의 임시 파일에 쓰고 `fsync` 후 `rename`한다. commit/push는 하지 않는다.
- 거절은 명시적 사용자 동작일 때 proposal 파일만 제거한다.

## 검증과 안전

- `@apc/shared`의 Zod 계약과 패키지에 포함한 JSON Schema runtime mirror를 둘 다 통과해야 한다.
  동등성 테스트는 루트 canonical JSON Schema와 mirror의 구조 및 유효/무효 corpus 결과를 비교한다.
- 중복 id, 없는 `blocked_by`, blocked 상태의 blocker 누락, 실제 달력에 없는 날짜, 여러 줄
  문자열은 의미 검증에서 거부한다.
- `career` 문서는 이메일·전화 패턴을 항상 거부하고, 존재할 경우 추적되지 않는
  `.pii-denylist.txt`의 항목도 거부한다. 오류에는 탐지 문자열을 되풀이하지 않는다.
- 앱이 파일을 다시 읽지 못하면 관리형 프로젝트 패널은 오류 상태를 표시한다. SQLite 캐시로
  조용히 대체하지 않는다.
- 대화 추출 제안을 기록하지 못하면 ingest cursor를 전진시키지 않아 다음 수집에서 재시도한다.

## 완료 조건

- 파일 → 대시보드 Task → proposal → 승인 → 파일 라운드트립 테스트가 통과한다.
- 화면의 파일 관리형 Task 목록은 주입된 SQLite 행과 무관하다.
- 대화 자동추출과 수동 추가·수정·삭제가 같은 proposal 상태로 합류한다.
- 동시 편집, PII, 원자적 rename 실패가 canonical 파일을 손상시키지 않는 테스트가 통과한다.
