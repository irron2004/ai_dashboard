---
title: Harness run 사용성 + 엔진 CLI 실행 위치(cwd) 수정 설계
date: 2026-06-08
status: design-approved
author: PM (Claude)
trigger: 사용자가 "전 문서로 위키 생성" 클릭 → 긴 무반응 후 "Promote failed: run is FAILED, expected HUMAN_REVIEW_REQUIRED". 실제 원인 = `project-discovery failed: agent runner returned not-ok`.
branch: docs/knowledge-harness-pipeline-spec (또는 신규 feature 브랜치)
---

# Harness run 사용성 + 엔진 cwd 수정

## 1. 배경 / 진단

"전 문서로 위키 생성"(= `startHarnessRun(true)`)을 누르면 9단계 파이프라인 전체가 한 번의 블로킹 호출로 돌고, 그중 5단계가 엔진 CLI(claude/codex/opencode)를 spawn하는 LLM 호출이다. 사용자 보고를 코드로 진단한 결과 4가지 실제 결함이 확인됐다.

1. **실패 사유가 깡통 메시지** — `LlmAgent.run`(`packages/knowledge-harness/src/agents/llm-agent.ts:32`)이 `!res.ok`일 때 `agent runner returned not-ok`만 던진다. 정작 `CliAgentRunner`는 실제 원인(`res.raw` = stderr/spawn 에러, 예 `spawn claude ENOENT`)을 **이미 잡아두는데 버려진다**.
2. **실패가 사용자가 보는 화면에 안 뜸** — 버튼이 즉시 Coverage 탭으로 이동시키는데(`HarnessDashboard.tsx:121-125`), 그 탭은 데이터 없으면 placeholder만 보여준다. 실패 사유(`harnessMessage`)는 상단 툴바(`:76`)에만 떠서 못 본다.
3. **promote가 실패 run에서도 눌림** — promote 버튼이 run 상태와 무관하게 활성. 눌러야 비로소 불친절한 `run is FAILED, expected HUMAN_REVIEW_REQUIRED`(`harness-promote-service.ts:51`)가 뜬다.
4. **엔진 CLI가 사용자 지정 폴더에서 안 돈다** — `CliAgentRunner`(`cli-agent-runner.ts`)의 spawn에 **`cwd`가 없다**. `RunInput`(`agent-runner.ts`)에도 cwd 필드가 없다. → CLI가 앱 실행 디렉터리에서 돌고, 프로젝트 repoPath에서 안 돈다.

## 2. 범위 (확정)

이번 작업 = **(d) 실패 사유 살리기 + (e) cwd 수정 + (b) Coverage 탭 상태 표시 + (c) promote 가드**. (a) 실시간 단계 진행바는 다음 작업(성공 run이 가능해진 뒤)으로 분리.

> 주의(문서에 명시): 이 작업들은 실패를 *보이게/올바른 위치에서 돌게* 만들지만, 위키가 실제 생성되려면 선택한 엔진 CLI가 **설치·인증·PATH**가 맞아야 한다. (d)가 그 여부를 사용자에게 명확히 알려준다.

## 3. 변경 설계

### (d) 실패 사유에 실제 CLI 에러 포함 — `LlmAgent.run`
`!res.ok`일 때 엔진명 + `res.raw`(앞 300자)를 포함해 던진다:
```ts
if (!res.ok) {
  const detail = (res.raw || 'agent runner returned not-ok').slice(0, 300)
  throw new Error(`${this.cfg.name} failed (${args.engine}): ${detail}`)
}
```
→ FAILED 사유가 `project-discovery failed (claude): spawn claude ENOENT` 처럼 actionable해진다.

### (e) 엔진 CLI를 프로젝트 폴더(cwd)에서 실행 — cwd 배선
- `RunInput`(`packages/llm-wiki/src/agent-runner.ts`)에 `cwd?: string` 추가.
- `CliAgentRunner.run`(`cli-agent-runner.ts`) spawn 옵션에 `cwd: input.cwd` 추가(미지정이면 기존대로 앱 cwd).
- `LlmRunArgs`(`llm-agent.ts`)에 `cwd?: string` 추가 → `runner.run({ agent, prompt, timeoutMs, cwd: args.cwd })`.
- `DriverDeps`(`make-drivers.ts`)에 `projectCwd?: string` 추가; `const run = { runner: deps.runner, cwd: deps.projectCwd }` 로 모든 에이전트 호출에 전파(기존 `{ ...run, ... }` 스프레드 재사용).
- `harness-service.ts`: `runnerFor(runId, projectId, projectCwd?)` 로 확장, `makeDrivers({ ..., projectCwd })` 전달. `run()`은 `projectCwd = input.repoPaths?.[0]` (materialize용으로 이미 repoPaths 보유). `resume()`은 projectCwd 없음(기존 동작 유지).

### (b) Coverage 탭에 run 상태/실패 표시 — `HarnessDashboard.tsx`
coverage 탭 본문을 우선순위 분기로 교체:
1. `harnessLoading` → "⏳ 위키 생성 중… (수 분 소요 — 단계별 LLM 호출)"
2. else `coverageData` → `<CoverageMatrix>`
3. else `currentRun?.runState.state === 'FAILED'` → "❌ 실패: {currentRun.runState.error ?? '원인 미상'}"
4. else → 기존 placeholder
(`RunState`에 `state`·`error?` 존재 — `kh-schema.ts:159-168`.)

### (c) promote 가드 — `HarnessDashboard.tsx` + `AgentConfigPanel`
- `const canPromote = currentRun?.runState.state === 'HUMAN_REVIEW_REQUIRED'`.
- Canonical proposal 버튼(`:137`): `disabled={harnessLoading || !canPromote}` + `title`("리뷰 대기 상태에서만 promote 가능").
- `AgentConfigPanel`에 `canPromote?: boolean` prop 추가(기본 true), 내부 "Promote current" 버튼을 `disabled={loading || canPromote === false}` + 안내 title로. `HarnessDashboard`가 `canPromote={canPromote}` 전달.

## 4. 테스트

- **(d)** `llm-agent.test.ts`: 러너가 `{ok:false, raw:'spawn claude ENOENT'}` 반환 → `agent.run`이 `ENOENT`와 엔진명을 포함한 에러로 reject.
- **(e-llm)** `llm-agent.test.ts`: `run({..., cwd})` → `FakeAgentRunner.calls[0].cwd`가 그 값.
- **(e-cli)** `cli-agent-runner.test.ts`: 템플릿 `node -e 'process.stdout.write(process.cwd())'` + `cwd=<tmp>` → output이 그 tmp 경로(실제 프로세스, 결정적).
- **(e-wiring)** `harness-service.test.ts`: 직접 만든 `FakeAgentRunner`로 HarnessService 구성 → `run({ projectId, engine, repoPaths:[repo] })` → `runner.calls[0].cwd === repo`.
- **(b)(c)** `HarnessDashboard`는 단위 테스트가 없으므로 typecheck + 전체 데스크톱 스위트 green으로 게이트. `AgentConfigPanel`의 `canPromote` prop 추가는 typecheck로 검증.

## 5. 범위 밖 (YAGNI)

- **(a) 실시간 단계 진행바** — advance 단계 분할 + 이벤트 스트리밍. 별도 작업.
- 엔진 CLI **설치/인증 자동화·preflight 검사** — 이번엔 에러를 actionable하게 만들기까지만.
- `WikiEngine`(generate 경로)의 cwd 배선 — 하네스 범위로 한정(필요 시 후속).
- 9단계 파이프라인 로직 변경 — 없음.

## 6. 수용 기준 (Done)

1. 엔진 CLI 실패 시 FAILED 사유가 **실제 CLI 에러 + 엔진명**을 포함한다(`… failed (claude): spawn claude ENOENT`).
2. 하네스 에이전트가 **프로젝트 repoPath를 cwd로** CLI를 실행한다(repoPaths[0]; 미지정이면 기존 동작).
3. Coverage 탭이 로딩/실패/커버리지/안내를 상태에 맞게 보여준다(실패 시 사유 노출).
4. promote 버튼이 `HUMAN_REVIEW_REQUIRED`가 아니면 비활성 + 이유를 보여준다.
5. 신규/기존 테스트 + `pnpm typecheck` 통과.
6. 새 IPC 채널·DB migration 없음.
