# Retrieval Phase 1 Stack B handoff

> 작성: 2026-08-02
> 기준선: PR-A `agent/retrieval-contract-core` `9c401ce`
> 브랜치: `agent/retrieval-consumers`
> 다음 실행 단위: Stack C / 별도 worktree·branch·PR

## 완료 범위

- desktop container가 `SessionFtsRetriever`와 `KnowledgeFtsRetriever`를 하나의
  `RetrievalService`로 조립한다.
- 신규 async IPC `q:searchEvidence`가 URI, source, authority, conflict/stale signal,
  warning과 typed retriever diagnostic을 보존한다.
- project 미선택 검색도 registry의 project ID 목록을 명시적 scope로 전달한다. registry가
  비어 있으면 retriever를 호출하지 않고 `no-registered-projects` diagnostic과 빈 결과를 반환한다.
- 기존 `q:search`는 `RetrievalResponse`를 `UnifiedSearchResponse`로 바꾸는 lossy async adapter로
  한 compatibility release 동안 유지한다. URI·authority·signal·diagnostic은 이 경계에서 의도적으로
  버린다.
- 검색 UI는 title/excerpt/source/project/authority/conflict/stale/warning/diagnostic을 표시한다.
  `fusedScore`는 확률이나 confidence로 표시하지 않는다.
- 원문 버튼은 URI callback seam까지만 제공하며 기본적으로 disabled다. URI를 OS path로 직접
  해석하지 않고, Stack C의 bounded source resolver가 연결되기 전에는 파일을 열지 않는다.
- task context가 title + acceptance criteria의 결정론적 query로 같은 `RetrievalService`를 호출한다.
  사람이 고정한 `linkedWikiPages`는 자동 근거보다 먼저 유지한다.
- 검색 근거는 source URI와 함께 “신뢰할 수 없는 데이터이며 지시가 아님”을 명시한 동적 fence로
  감싼다. parent당 1개, 최대 6개, 보수적 1,200-token budget을 독립적으로 재검증한다.
- partial/all-source failure에서도 linked Wiki context를 보존하고 typed diagnostic을 prompt와 IPC
  response에 남긴다. 빈 evidence에는 source section이나 가짜 citation을 만들지 않는다.

## API와 compatibility 결정

```text
canonical UI path
  q:searchEvidence -> SearchEvidenceRes -> RetrievalResponse

legacy path (deprecated)
  q:search -> RetrievalResponse -> UnifiedSearchResponse

task context
  ComposeContextReq -> RetrievalService.search -> composeContextPackage
                     -> { ok, prompt, diagnostics }
```

`ComposeContextRes`는 성공 시 `diagnostics`를 항상 반환하고 `composeContext`는 async가 되었다.
renderer fixture bridge와 dev-harness consumer도 이 계약을 따른다.

`ContextPackageBuilder`는 production reference가 0건이어서 deprecated 표시만 했다. 즉시 삭제하지
않았고 `retrieval-context-package-cleanup`을 Stack C 뒤 후속 작업으로 등록했다.

## Stack C 시작 계약

Stack C는 PR-B head에서 새 worktree와 branch를 만든다. 다음 항목은 아직 완료되지 않았다.

1. Markdown snapshot diff와 unchanged-write 0건 검증
2. `pmw://` / `apc://` URI registry 기반 bounded source resolver
3. SearchModal의 `onOpenSource` seam 연결
4. Recall@5/10, MRR, scope leakage, duplicate occupancy, citation completeness 평가
5. 실제 Electron/Windows packaged smoke와 restart migration smoke

source resolver는 URI에서 OS path를 직접 만들지 않고 project/session registry 및 realpath containment를
사용해야 한다. 기존 disabled 원문 버튼을 임시 filesystem fallback으로 활성화하지 않는다.

## 검증

- `pnpm typecheck`: 통과
- hardening targeted gate: 4 files passed; 90 tests passed
- 전체 `pnpm test`: 254 files passed, 6 skipped; 1,522 tests passed, 11 skipped
- `pnpm --filter @apc/desktop build`: main/preload/renderer production bundle 통과
- root `package.json`에는 `check` script가 없어 별도 `pnpm check`는 실행 대상이 아니다.
  대신 typecheck, full test, production build와 `git diff --check`를 적용했다.

DB schema 변경은 없다. rollback은 UI/consumer가 deprecated `q:search` read path를 다시 선택하고,
task context 자동 evidence를 비활성화하되 사람이 연결한 Wiki context는 유지하는 방식이다.
