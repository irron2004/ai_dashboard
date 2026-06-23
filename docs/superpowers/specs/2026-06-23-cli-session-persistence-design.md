# CLI Session Persistence + Auto-Resume — Design

- 날짜: 2026-06-23
- 상태: approved (brainstorming) → implementing
- 대상: `@apc/desktop`(Electron) + `@apc/agents`
- 한 줄: 앱을 닫았다 켜도 **프로젝트별 CLI(claude/codex/opencode) 대화를 이어서** 진행한다(라이브 resume + 워크스페이스 자동 복원).

## 1. 목적 / 배경

데스크톱 앱은 **프로젝트별로 agent별 터미널**(`${projectId}:${agent}`, agent ∈ {claude, opencode, codex})을 마운트하고, 각 PTY는 프로젝트 `repoPath`에서 해당 CLI를 실행한다. 현재 PTY 세션과 "어떤 패널이 열려 있었는지"는 **메모리(Map/zustand)에만** 있어 앱을 닫으면 사라진다.

각 CLI는 자기 대화 세션을 **디스크에 저장**하고 resume를 지원한다. 또한 `packages/agents`에는 이미 claude/codex/opencode **세션 어댑터**가 있어 `discoverSources()`로 세션 jsonl을 찾고 `sessionId`·`repoPath`·`startedAt/endedAt`를 파싱한다. 이 인프라를 재사용해, 재시작 시 각 패널의 CLI를 resume로 다시 띄운다.

## 2. 결정 요약 (brainstorming)

| 항목 | 결정 |
|---|---|
| 불러오기 수준 | **라이브 resume** — CLI를 resume 플래그로 다시 띄워 모델 대화를 이어감 |
| 대상 CLI | claude · codex · opencode (각 어댑터) |
| 복원 방식 | **이전 워크스페이스 자동 복원** — 열려 있던 패널 재오픈 + 각 resume |
| 캡처 방식 | **디스크 발견 재사용** — 재시작 시 `(agent, repoPath)` 최신 세션을 어댑터로 찾아 resume. 종료 시 패널별 last sessionId 스냅샷으로 보강(없으면 최신 폴백) |

## 3. 단위(unit) 경계

```
packages/agents/
  resume.ts
    findLatestSession(agent, repoPath): Promise<{ sessionId, startedAt } | null>
        # 기존 discoverSources()/parse 재사용, repoPath 매칭 후 최신(startedAt/endedAt) 선택
    resumeCommand(agent, { sessionId?, repoPath }): { command, args }
        # CLI별 매핑(§6). sessionId 있으면 특정 resume, 없으면 "최신" resume

apps/desktop/src/main/
  session-store.ts   # sqlite(apc.db): workspace_pane / app_state 읽기·쓰기 (better-sqlite3)
  pty-manager.ts     # startResume(id, agent, repoPath, sessionId?) 경로 추가
  index.ts / ipc.ts  # before-quit 스냅샷 저장; 부팅 시 스냅샷 로드 → 렌더러 전달
  (ipc-contract)     # workspace:restore 이벤트, StartPtyReq에 { resume?, agent, sessionId? } 추가
                     #   (resume=true면 main이 resumeCommand로 argv 구성; command/args는 무시)

apps/desktop/src/renderer/
  store.ts / App.tsx # 부팅 하이드레이트 → 패널 재오픈 + 선택 프로젝트 복원
  AgentTerminal.tsx  # startPty 호출에 { resume, agent, sessionId } 전달
```

각 단위 책임: `@apc/agents`는 "이 agent/repo의 세션을 어떻게 찾고 어떻게 resume하는가"만, `session-store`는 "무엇이 열려 있었나"만, `pty-manager`는 "어떻게 띄우나"만. 서로 잘 정의된 인터페이스로 통신.

## 4. 데이터 모델 (sqlite, `apc.db`)

```sql
CREATE TABLE IF NOT EXISTS workspace_pane (
  project_id      TEXT NOT NULL,
  agent           TEXT NOT NULL,          -- 'claude' | 'codex' | 'opencode'
  last_session_id TEXT,                   -- 종료 시 발견한 최신 세션 id(보강용; NULL 허용)
  last_active     TEXT,                   -- ISO8601
  was_open        INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (project_id, agent)
);
CREATE TABLE IF NOT EXISTS app_state (
  key   TEXT PRIMARY KEY,                 -- 'selected_project_id' 등
  value TEXT
);
```

## 5. 데이터 흐름

1. 패널에서 agent 실행 → PTY가 `repoPath`에서 CLI 실행 → CLI가 세션 jsonl 기록. main은 `was_open=1`, `last_active` 갱신.
2. **종료(`app.on('before-quit')`)**: 열린 패널 각각에 대해 `findLatestSession(agent, repoPath)` → `last_session_id` 저장, `was_open` 스냅샷, `selected_project_id` 저장.
3. **재시작**: main이 `workspace_pane`(was_open=1) + `selected_project_id`를 읽어 렌더러에 `workspace:restore`로 전달.
4. 렌더러: 해당 (project, agent) 패널 재오픈 + 선택 프로젝트 복원 → 각 AgentTerminal이 `startPty({ id, resume:true, agent, sessionId: last_session_id, cwd: repoPath })`.
5. main `pty-manager.startResume`: `resumeCommand(agent, { sessionId, repoPath })`로 argv 구성 → PTY spawn. CLI가 대화를 replay하며 살아있는 세션으로 이어짐.

## 6. CLI별 resume 매핑 (`resumeCommand`)

구현 시 각 CLI `--help`로 플래그 확정. 미지원/불확실하면 "최신" 경로 우선.

| agent | 세션 위치 | resume(특정 id) | resume(최신) |
|---|---|---|---|
| claude | `~/.claude/projects/<cwd>/<id>.jsonl` | `claude --resume <id>` | `claude --continue` |
| codex | `~/.codex/sessions/…` | `codex resume <id>` | `codex resume --last` |
| opencode | opencode 세션 스토어 | `opencode --session <id>` | `opencode --continue` |

`findLatestSession`은 `@apc/agents`의 기존 `discoverSources()`/parse를 재사용해 `repoPath` 매칭 후 `startedAt/endedAt` 기준 최신 세션을 고른다.

## 7. 에러 처리 / 폴백

- 최신 세션 없음 → resume 없이 **새 세션**으로 평소대로 실행 + 터미널 안내(`[no prior session — fresh start]`).
- resume id 만료/삭제(파일 부재) → 사전 존재확인 실패 시 fresh 폴백.
- `node-pty` 미가용 → 기존 동작 유지(안내 메시지).
- resume는 자동 실행하되 **실패해도 패널은 항상 열림** — 작업 흐름을 깨지 않는다.

## 8. 테스트 (TDD)

- `@apc/agents`:
  - `resumeCommand(agent, …)`가 agent별 올바른 argv(특정/최신) 생성.
  - `findLatestSession`이 fixture jsonl에서 `repoPath` 매칭 + 최신 선택, 매칭 없으면 null.
- `main/session-store`: workspace_pane/app_state 저장·복원 라운드트립, `was_open` 토글.
- `main/pty-manager`: resume 경로가 올바른 argv로 spawn(가짜 pty 주입), 세션 없으면 fresh 폴백.
- `renderer/store`: 부팅 하이드레이트가 패널 재오픈 + 선택 프로젝트 복원.

## 9. 비범위 (YAGNI / 후속)

세션 검색/머지, 읽기전용 transcript 뷰어, 세션 이름 수동 편집, 원격(ssh) 세션 resume, 멀티 윈도우, 세션별 사용량/요약 표시.
