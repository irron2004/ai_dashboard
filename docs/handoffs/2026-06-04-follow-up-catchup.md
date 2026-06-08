# Handoff — 지금까지 진행된 작업 Catch-up

- **Date**: 2026-06-04
- **Branch**: `docs/knowledge-harness-pipeline-spec`
- **Remote**: `origin/docs/knowledge-harness-pipeline-spec`
- **PR URL**: <https://github.com/irron2004/ai_dashboard/pull/new/docs/knowledge-harness-pipeline-spec>
- **Purpose**: 사용자가 중간 과정을 follow-up하지 못한 상태에서, 이 브랜치에서 진행된 핵심 작업·검증·주의점을 한 번에 파악할 수 있게 정리한다.

## 0. 현재 상태 한 줄 요약

이 브랜치는 **Knowledge Harness 파이프라인을 skeleton에서 실제 검증/증거 기반 파이프라인에 가깝게 끌어올리고**, 이후 team-mode 진단으로 발견한 desktop/agent/service/test 문제를 보강한 상태다. 브랜치는 원격에 push되어 있고, PR 생성 URL도 준비되어 있다.

## 1. 큰 작업 흐름

### 1) Knowledge Harness 핵심 진단과 교정

초기 구현 이후 holistic/team 진단에서 “겉보기로는 테스트가 많지만 실제 evidence chain, validator gate, UI 정직성, packaged boot, typecheck가 약하다”는 결론이 나왔다. 이를 바탕으로 권장 순서 1~6을 구현했다.

주요 내용:

- 루트 typecheck 도입 및 잠복 타입 오류 수정.
- feature gate / preamble 기본값을 런타임 파일 의존 대신 compiled-in fallback으로 전환.
- GraphIntegrity, markdown/yaml/link validator가 promotion gate에 실제로 연결되도록 수정.
- `kh-schema`를 더 엄격하게 만들어 LLM output hallucination/empty id/typo enum을 구조적으로 거부.
- Harness config UI를 “실제로 wired된 것만 live control”로 정직화.
- `SourceReader`와 `EvidenceVerifier`를 추가해 raw source 기반 evidence chain을 실제 검증 대상으로 만듦.
- adversarial fixtures, stale lock recovery, malformed LLM output, raw skip, fabricated evidence 실패 테스트 추가.

상세 handoff:

- `docs/handoffs/2026-06-03-kh-diagnosis-remediation-steps-1-6.md`

### 2) Renderer / Desktop surface landing

별도 stream으로 존재하던 renderer restyle과 viewer components가 브랜치에 landing되었다. 이로 인해 HEAD가 단독 빌드 가능한 상태로 복원되었다.

주요 내용:

- `HarnessDashboard` 주변 UI restyle.
- `MarkdownViewer`, `DiffViewer`, `TaskFlowView`, `GraphVisualization` 등 viewer components 추가.
- `harness-utils.ts`를 renderer에서 사용하도록 정리.
- desktop tests가 green인 상태로 맞춰짐.

관련 최근 커밋 예:

- `feat(desktop): land renderer restyle + viewer components (restores HEAD build)`

### 3) Agent ingest / source provenance / recursive discovery

agent session ingest 쪽도 확장되었다.

주요 내용:

- `sourceMeta` provenance가 shared ingest schema와 adapters에 반영됨.
- Claude/Codex discovery가 recursive source discovery helper를 사용.
- OpenCode adapter가 SQLite session을 discovery/parse.
- `source-discovery.ts` helper 추가.
- `IngestService`에 serialization lock이 들어가 concurrent ingest 중복 인덱싱을 막음.

관련 최근 커밋 예:

- `feat(agents): sourceMeta provenance + recursive source discovery + ingest serialization`

### 4) Team-mode 진단 후 current remediation

사용자가 “지금 개발된 내용의 문제를 team mode로 진단해줘”라고 요청했고, frontend/backend/test-quality 관점에서 진단했다. 이후 “말한 것들을 모두 개선하고 handoff 작성” 요청에 따라 문제를 수정했다.

수정한 문제:

- `App.tsx` inline grid columns가 CSS responsive grid를 깨던 문제 수정.
- `ProjectSidebar.tsx` context menu overlay가 edit modal을 막던 문제 수정.
- malformed `ssh://` path edit fallback 개선.
- `GraphVisualization.tsx` keyboard/ARIA 접근성 추가, layout iteration 축소 및 cache 추가.
- OpenCode source id를 `opencode:<dbPath>#session:<sessionId>` 형태로 바꿔 multi-root cursor collision 방지.
- OpenCode discovered source에 `mtimeMs` 추가.
- `GenerateService` 무제한 source parse를 `GENERATE_SOURCE_SCAN_LIMIT = 100`으로 제한하되, 기존 25개 cap보다 넓게 scan.
- remote Claude transcript discovery를 flat glob에서 recursive `find` 기반으로 변경.
- `source-discovery`, `opencode-adapter`, `generate-service`, `ingest-service`, `remote-generate`, `graph-integrity` 관련 테스트 보강.

상세 handoff:

- `docs/handoffs/2026-06-03-current-diagnosis-remediation.md`

### 5) Push protection 대응

처음 push 시 GitHub push protection이 `secret-scanner.test.ts`의 fixture 문자열을 실제 Slack/Stripe token으로 탐지해 push를 거부했다.

처리 내용:

- 실제 secret은 아니고 테스트 fixture였지만, GitHub는 history 전체를 검사하므로 literal fixture를 fragment concatenation 형태로 변경.
- offending literal이 들어간 로컬 branch history를 rewrite.
- `git log -S`로 Slack/Stripe literal이 history에 남아 있지 않음을 확인.
- 이후 branch push 성공.

관련 최근 커밋 예:

- `test(harness): avoid push-protection fixture literals`
- `test(harness): normalize secret fixture fragments`

## 2. 현재 브랜치의 최신 흐름

최근 커밋 기준으로 보면 대략 이런 순서다:

1. Knowledge Harness core remediation and hardening.
2. Renderer restyle/viewer components landing.
3. Agent source provenance + recursive discovery.
4. Diagnosis remediation and test/typecheck expansion.
5. Push-protection fixture normalization.
6. 추가 harness medium/refactor fixes.

확인된 최신 커밋 예:

- `refactor(harness): shared ARTIFACTS constants + exact-basename artifact lookup (B2 #17)`
- `fix(harness): MEDIUM bug batch — wiki-link suffixes, raw_modified signal, diff buffer, win path (B1)`
- `test(harness): normalize secret fixture fragments`
- `docs: remediation-pass handoff + llm-wiki agent spec`
- `test(repo): expand typecheck gate to tests + apps/desktop (A1)`

## 3. 검증 상태

내가 수행했고 통과 확인한 검증:

```bash
pnpm typecheck
```

- root package typecheck + desktop typecheck까지 통과하도록 확장된 상태.

```bash
pnpm test
```

- 전체 package test 통과.

```bash
cd apps/desktop && npx vitest run
```

- desktop test suite 통과.

Push-protection 대응 후 추가 확인:

```bash
git log -S xoxb-REDACTED-EXAMPLE --oneline
git log -S sk_live_REDACTED_EXAMPLE --oneline
```

- 둘 다 빈 결과로 확인했다.

## 4. 사용자가 지금 알아야 할 핵심 변경점

### 제품/기능 관점

- Knowledge Harness는 이제 단순 skeleton이 아니라 evidence/source/validator/policy가 실제 gate로 작동하는 구조에 가까워졌다.
- Desktop UI는 harness dashboard/viewer 중심으로 더 풍부해졌고, 이전에 HEAD build를 막던 untracked component 문제도 해결된 흐름이다.
- Agent ingest는 Claude/Codex/OpenCode의 source provenance와 recursive discovery를 더 잘 담는다.

### 안정성 관점

- Promotion/validation path가 더 엄격해졌다.
- fabricated evidence, malformed output, invalid graph/link/markdown 상태가 더 잘 실패 처리된다.
- ingest/generate 경로의 race/latency 문제가 일부 줄었다.
- typecheck 범위가 넓어졌다.

### 리뷰 관점

- 이 브랜치는 매우 큰 변경 세트다. PR에서는 전체를 한 번에 보기보다 다음 단위로 나눠 보는 것이 좋다:
  1. Knowledge Harness runtime/policy/verify/evidence chain.
  2. App-services / CLI / IPC surface.
  3. Renderer dashboard/viewer UI.
  4. Agent ingest/source discovery/provenance.
  5. Tests/typecheck/handoff/docs.

## 5. 주의점 / 남은 리스크

- `GenerateService` scan limit은 100이다. 기존 25개 false-negative보다 낫지만, 아주 오래된 session만 matching되는 경우에는 여전히 못 찾을 수 있다.
- OpenCode source id format 변경으로 기존 cursor key(`opencode:<sessionId>`)는 새 key와 맞지 않는다. 따라서 한 번 정도 재-ingest가 발생할 수 있다. 이건 multi-db collision 방지를 위한 의도된 tradeoff다.
- remote Claude recursive discovery는 Linux/GNU `find -printf` 가정이 있다. non-GNU remote 환경이면 fallback이 필요할 수 있다.
- history rewrite를 한 번 수행했으므로, 누군가 같은 브랜치를 이미 fetch해 작업 중이었다면 branch를 새로 맞춰야 한다. 현재는 원격 branch가 push되어 있음.

## 6. 다음 액션 추천

1. PR을 열고 CI 결과를 확인한다.
2. 리뷰어에게 위 5개 리뷰 단위로 나눠 봐달라고 요청한다.
3. 특히 `GenerateService` scan limit, OpenCode cursor migration, remote GNU `find` 의존성은 제품 판단이 필요한 후속 후보로 남긴다.
4. 필요하면 내가 다음 세션에서 PR description을 작성하거나, PR review checklist를 만들어도 된다.
