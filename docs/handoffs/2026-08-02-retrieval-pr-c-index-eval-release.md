# Retrieval Phase 1 Stack C handoff

> 작성: 2026-08-02
> 기준선: PR-B `agent/retrieval-consumers` `80ab017`
> 브랜치: `agent/retrieval-index-eval`
> 구현 검증 tip: `54a6f4f`

## 완료 범위

- Markdown knowledge 인덱싱을 `clearProject → 전체 재작성`에서 완전 snapshot diff로 바꿨다.
  동일 본문·metadata는 durable write 0건이고, 추가·변경·삭제만 한 transaction에서 반영한다.
  불완전 scan, read 실패, depth/file limit, 중복 relPath는 이전 snapshot을 보존한 채 실패한다.
- `pmw://`와 `apc://` source resolver를 추가했다. 등록 project/session만 허용하고 lexical·realpath
  containment, symlink escape, 확장자, 인접 chunk 수와 UTF-8 byte cap을 검증한다. raw locator와 OS
  절대경로는 renderer에 노출하지 않는다.
- Search UI가 실제 source detail을 열고 conflict/deprecated warning 및 retriever partial-failure
  diagnostic을 표시한다.
- 24개 합성 query로 legacy와 신규 retrieval을 같은 corpus에서 비교하는 결정론적 평가 명령
  `pnpm --filter @apc/retrieval eval`을 추가했다. fixture는 실제 session·PII를 포함하지 않는다.
- session FTS를 process-local `:memory:` DB에서 앱의 영속 DB로 옮겼다. 과거에는 cursor만 남고
  검색 row가 재시작 때 사라졌으므로, 최초 migration에서 Claude·Codex·OpenCode cursor만 원자적으로
  한 번 무효화한다. 다음 ingest가 durable session index를 다시 만들며 이후 재시작에는 유지된다.
- task title과 acceptance criteria는 줄별 대안 절로 검색한다. 각 절 안의 token은 `AND`, 절 사이는
  `OR`라서 acceptance criteria의 추가 단어가 title 근거를 전부 탈락시키지 않는다.
- 저장소 표준 gate로 `pnpm check`(`typecheck + full test`)를 추가했다.

## 평가 결과

24개 query 중 정답 parent가 있는 22개를 Recall/MRR에 사용했다. 아래 값은 고정 합성 fixture의
회귀 gate이며 실제 사용자 workload 정확도로 해석하지 않는다.

| Metric | Legacy | Phase 1 |
|---|---:|---:|
| Recall@5 | 0.941558 | 0.987013 |
| Recall@10 | 0.954545 | 0.987013 |
| MRR | 0.954545 | 1.000000 |
| 최대 동일-parent 점유 | 3 | 1 |
| citation URI 완전성 | 0 | 1.000000 |
| scope leakage | 0 | 0 |
| 결과 수(session / knowledge) | 46 (22 / 24) | 44 (21 / 23) |

release threshold는 scope leakage 0, citation completeness 1.0, parent occupancy 1 이하,
Recall@5·MRR legacy 이상이며 모두 통과했다. 평가 stdout 2회 byte diff도 0이었다.

## 실제 Electron smoke

`run-ai-dashboard-desktop` 절차로 별도 detached worktree에서 better-sqlite3를 Electron ABI로
재빌드하고 production bundle을 실제 WSLg Electron 창에서 실행했다. `APC_E2E_USER_DATA_DIR`와
임시 HOME을 사용해 실제 사용자 DB·session을 읽거나 쓰지 않았다.

자동화된 `apps/desktop/e2e/electron/retrieval.spec.ts`가 다음을 확인했다.

1. project-filtered query가 같은 project의 session + Markdown evidence를 함께 반환
2. global query가 등록된 두 project로만 확장
3. conflict badge와 warning을 표시하고 `pmw://` 원문을 bounded resolver로 열기
4. task context에서 pinned Wiki가 검색 근거보다 먼저 나오고 evidence URI가 보존됨
5. 앱을 닫고 같은 DB로 재실행한 뒤 session + knowledge 검색이 그대로 유지됨
6. knowledge FTS를 의도적으로 제거해도 session result가 남고 `knowledge-fts` 실패가 UI에 표시됨

실행 결과는 `1 passed`였고 캡처를 직접 열어 빈 창이 아닌 검색 결과·warning·원문 detail 렌더를
확인했다. 격리 WSLg 환경에는 한글 UI font가 없어 일부 한글 glyph가 네모로 보였지만 검색 결과와
상호작용 검증에는 영향이 없었다. Windows installer/portable 패키징은 이번 코드 변경의 필수 산출물이
아니어서 생성하지 않았다.

## 검증

- targeted retrieval/desktop gate: 108 files passed, 1 skipped; 726 tests passed, 1 skipped
- `pnpm check`: typecheck 통과; 257 files passed, 6 skipped; 1,549 tests passed, 11 skipped
- `pnpm --filter @apc/desktop build`: main/preload/renderer production bundle 통과
- `pnpm --filter @apc/retrieval eval`: threshold 통과, 2회 출력 diff 0
- actual Electron retrieval smoke: 1 passed
- `git diff --check`: 통과

테스트 중 보이는 임시 git fixture의 fatal/error 출력, 의도된 failure logging, 기존 React `act(...)`
warning은 assertion 실패가 아니며 전체 exit code는 0이다.

## Migration과 rollback

- 신규 DB는 기존 app DB 안에 session FTS table과 migration marker를 만든다. 원본 transcript는
  수정하지 않는다.
- 기존 DB는 marker가 없을 때 agent source cursor만 한 번 지운다. 사용자가 다음 ingest를 실행하면
  source를 다시 읽어 persistent row를 만든다. custom cursor는 보존한다.
- rollback은 신규 UI/context consumer를 deprecated `q:search` path로 되돌릴 수 있다. 추가된 FTS와
  knowledge table/column은 이전 read path에 무해하므로 DB를 파괴적으로 되돌릴 필요가 없다.
- source resolver 또는 snapshot indexer가 실패하면 원본 문서와 마지막 정상 snapshot을 유지한다.

## 남은 명시적 gate

- 합성 평가가 아닌 sanitized 실제 질의 corpus로 lexical 실패·latency·source 편중을 계측한다.
- 그 결과를 근거로 embedding/reranker Gate E를 판정한다. gate 전 production dependency 추가 금지.
- 별도 Phase 2 PR에서 `search_evidence`, `get_evidence_source`처럼 작은 MCP primitive만 노출한다.
  `answer_question` 형태의 결합 API는 만들지 않는다.
- PR-A, PR-B, PR-C 병합 뒤에만 사용자 확인을 받아 루트 submodule pointer와 workspace rollup을
  갱신한다.
