# Handoff — Harness run 사용성 + 엔진 cwd 수정 (구현 완료)

- **Date**: 2026-06-08
- **Branch**: `docs/knowledge-harness-pipeline-spec`
- **PR**: 신규 (PR #1은 이미 merged). 이 작업은 main에 새로 머지 예정.

## 0. 한 줄 요약

사용자가 "전 문서로 위키 생성" 클릭 → 긴 무반응 후 `Promote failed: run is FAILED…` 를 겪었다. 진단 결과 4개 실제 결함을 찾아 **spec→plan→subagent 구현(5 Task team-mode dev+QA 전부 APPROVED, 최종 READY_TO_MERGE)** 으로 고쳤다.

## 1. 진단한 근본 원인

`RUN-… → FAILED — project-discovery failed: agent runner returned not-ok`
= 파이프라인 **첫 LLM 단계부터 엔진 CLI(claude/codex/opencode)가 not-ok**. `CliAgentRunner`가 실제 stderr(`res.raw`)를 잡아두는데 `LlmAgent`가 버리고 깡통 메시지만 던졌고, 실패가 사용자가 보는 Coverage 탭이 아니라 상단에만 떴으며, CLI가 **cwd 없이** spawn돼 프로젝트 폴더가 아니라 앱 폴더에서 돌았다.

## 2. 한 일 (5 Task)

- **(d) U1** `LlmAgent.run`: `!res.ok`면 `${name} failed (${engine}): ${res.raw(앞300자)}` 로 throw → 실제 원인 노출.
- **(e) U1~U3** 엔진 cwd 배선: `RunInput.cwd?` + `CliAgentRunner` spawn `cwd` + `LlmRunArgs.cwd` + `DriverDeps.projectCwd` + make-drivers `run={runner,cwd}` + `harness-service.run`이 `repoPaths[0]`를 cwd로. → **엔진 CLI가 프로젝트 repoPath에서 실행.** (repoPath 없음/resume이면 inherit.)
- **(b) U4** Coverage 탭 분기: 로딩 "⏳ 위키 생성 중…" / coverage / `FAILED` "❌ 실패: {error}" / 안내.
- **(c) U5** promote 가드: run이 `HUMAN_REVIEW_REQUIRED` 아니면 canonical 버튼 + AgentConfigPanel "Promote current" 비활성 + 툴팁.

## 3. 커밋 (base `2666862` = PR#1 머지 지점 위)

```
de513b7 feat(desktop): disable promote unless run is HUMAN_REVIEW_REQUIRED
d8dc94f feat(desktop): Coverage tab shows loading + failure reason
d217694 feat: run harness engine in the project repoPath (thread projectCwd)
73f0be6 feat(llm-wiki): CliAgentRunner runs the engine in the provided cwd
26ba9a4 feat(knowledge-harness): surface real CLI error + forward cwd in LlmAgent
c20d5af docs: implementation plan (6 tasks, TDD)
a43a4a4 docs: design (d/b/c + cwd e)
```
- 미커밋 없음.

## 4. 검증 (전부 green)

```bash
pnpm typecheck                              # clean
npx vitest run packages/llm-wiki            # 21/22 (1 pre-existing skip)
npx vitest run packages/knowledge-harness   # 123/123
npx vitest run packages/app-services        # 55/55
cd apps/desktop && npx vitest run           # 60/60
```
최종 종합 리뷰: cwd 체인 IPC→spawn 무결, 에러 노출 end-to-end, promote 가드 일관, 회귀 없음 → READY_TO_MERGE.

## 5. 남은 현실 / 다음

- **이건 실패를 *보이게/올바른 폴더에서 돌게* 만든 것.** 위키가 실제 생성되려면 **선택한 엔진 CLI가 설치·인증·PATH**가 맞아야 한다 — 이제 실패 메시지가 무엇이 빠졌는지 정확히 알려준다.
- **(a) 실시간 단계 진행바**(advance 단계 분할 + 이벤트 스트리밍)는 다음 작업 후보 — 성공 run이 가능해진 뒤 가치가 큼.
- 후속: 엔진 preflight(설치/인증 사전 검사), `window.alert` 대신 `shell.openPath`(누락 문서 열기), WikiEngine cwd 배선.

## 6. 핵심 파일

```
packages/llm-wiki/src/agent-runner.ts            # RunInput.cwd
packages/llm-wiki/src/cli-agent-runner.ts        # spawn cwd
packages/knowledge-harness/src/agents/llm-agent.ts   # raw error + cwd forward
packages/knowledge-harness/src/runtime/make-drivers.ts  # DriverDeps.projectCwd + run object
packages/app-services/src/harness-service.ts     # runnerFor(projectCwd) ← repoPaths[0]
apps/desktop/src/renderer/components/HarnessDashboard.tsx  # (b)(c)
apps/desktop/src/renderer/components/AgentConfigPanel.tsx  # (c) canPromote
```
