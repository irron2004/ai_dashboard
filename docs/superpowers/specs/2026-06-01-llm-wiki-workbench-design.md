---
title: Multi-Project LLM Wiki Workbench — Design (PRD v0.2)
date: 2026-06-01
status: draft
owner: irron2004
---

# Multi-Project LLM Wiki Workbench — PRD v0.2

## 0. 한 줄 정의

> 내가 이미 쓰는 **Claude Code / Codex / OpenCode** 의 로컬 작업 기록을 읽어,
> **여러 프로젝트의 "지금 상태(current)"를 한 화면에서 보고 갱신하는 개인 AI 작업대.**
> 저장은 **Obsidian-compatible Markdown vault**, 정리는 **LLM Wiki 엔진**,
> 안전장치는 **candidate / proposal + conflict 문서** 다.

일반 팀 협업 SaaS가 아니라 **단일 사용자의 로컬 작업대(personal workbench)** 다.

---

## 1. 제품 정체성

```
나
+ Claude Code
+ Codex
+ OpenCode
+ 프로젝트별 대화 / 문서 / 결정 / 작업 기억
```

을 하나의 로컬 앱에서 관리한다. 앱 형태는 **독립 앱(NexusCode식 화면)** 이 중심이고,
저장 결과는 **Obsidian에서 그대로 열 수 있어야** 한다(플러그인 우선이 아님).

### MVP의 1순위 가치

> **여러 프로젝트의 current 상태를 한 화면에서 본다.**

따라서 제품 중심은 "검색기"가 아니라 **Multi-Project Current Dashboard** 다.
LLM Wiki는 이 화면을 채우기 위한 **지식 정리 엔진**이다.

MVP 첫 화면이 보여줘야 하는 것:

```
전체 프로젝트 목록
→ 각 프로젝트 current 상태
→ 최근 agent 작업
→ pending decision
→ active task
→ 최근 source
→ stale / conflict 상태
```

---

## 2. 런타임 스택 결정 (확정)

**MVP runtime stack = Electron + React + TypeScript + Node BFF.**

이유:

1. 장기 목표가 독립 앱 기반 multi-project workbench다.
2. Obsidian-compatible vault, agent log path scan, SQLite index, file watcher 등
   **로컬 OS 기능**이 핵심이다.
3. 설계 contract를 TypeScript / Zod schema로 한 언어에서 유지할 수 있다.
4. Dashboard와 LLM Wiki pipeline이 동일한 domain model을 공유한다.
5. 장기 실행 작업은 Electron main에서 직접 수행하지 않고 **Worker로 분리**하며,
   이후 **Temporal worker로 교체 가능**하게 둔다.

비선택(근거 기록용):

- **FastAPI(Python)**: ingest/ML PoC엔 유리하나, 독립 앱 목표 + runtime/packaging
  분리 비용 때문에 후순위. (P2에서 특수 파싱/ML용 **Python sidecar**로 재등장 가능.)
- **Tauri**: 가볍지만 Rust shell + WSL2/멀티OS 빌드 복잡도가 MVP 속도를 늦춤. P2 재검토.
- **Next.js 풀스택 로컬**: 웹 대시보드엔 좋으나 로컬 파일/agent/workflow 중심의
  독립 앱에는 적합성이 낮음.

### 핵심 원칙 (비협상)

> **Electron main process를 비대하게 만들지 않는다.**
> BFF는 얇게(orchestration + IPC), ingest / LLM Wiki / reindex 같은 장기 작업은
> 별도 **Worker process(LocalWorkerRunner)** 로 분리한다.

### 부속 스택

| 항목 | 선택 |
|---|---|
| SQLite | `better-sqlite3` |
| Schema / 검증 | Zod (`packages/shared`) |
| UI state | Zustand |
| 검색 | SQLite FTS / BM25 |
| Vault | Markdown + YAML frontmatter + `[[wiki-link]]` |
| Terminal surface | `node-pty` + `xterm.js` (renderer) — agent CLI 실행 표면 |
| Job (MVP) | LocalWorkerRunner (Node worker thread / utility process) |
| Job (P1) | TemporalWorkflowRunner (어댑터 교체) |

---

## 3. 아키텍처

```
┌──────────────────────────────────────────────┐
│ React Renderer (Zustand)                      │
│  - Multi-Project Dashboard                    │
│  - Project Current View                       │
│  - Source Inbox                               │
│  - Wiki / Decision / Task Review              │
│  - Conflict Review                            │
│  - Context Package View                       │
│  - Agent Terminals (Claude/Codex/OpenCode)    │
│  - Generate (모델 선택 picker)                  │
│  - Job Status                                 │
└──────────────────────────────────────────────┘
                  ↓ IPC (preload / contextBridge)
┌──────────────────────────────────────────────┐
│ Electron Main / Node BFF (얇게)                │
│  - IPC router + Application Services 호출       │
│  - ProjectDashboardQuery / SourceInboxQuery   │
│  - StartWorkflowCommand / ConflictReview      │
│  - Settings / Vault Selection / File Picker   │
└──────────────────────────────────────────────┘
                  ↓
┌──────────────────────────────────────────────┐
│ Common Core (packages/*)                      │
│  - ProjectRegistry                            │
│  - ObsidianVaultAdapter                       │
│  - AgentSessionManager (term + resolver)      │
│  - SourceNormalizer                           │
│  - ConflictManager                            │
│  - Search/Index (SQLite FTS)                  │
│  - WorkflowRunner (interface)                 │
│  - AgentRunner (CLI headless)                 │
└──────────────────────────────────────────────┘
                  ↓
┌──────────────────────────────────────────────┐
│ Job Runtime                                   │
│  MVP: LocalWorkerRunner (worker process)      │
│  P1 : TemporalWorkflowRunner                  │
└──────────────────────────────────────────────┘
                  ↓
┌──────────────────────────────────────────────┐
│ Storage                                       │
│  - Markdown Vault (Obsidian-compatible)       │
│  - SQLite (index, jobs, project map, cursors) │
│  - Raw Source 보존 (vault/raw)                 │
└──────────────────────────────────────────────┘
```

### 개발 순서

- **Phase 0 — Common Core 먼저.** 화면도 LLM Wiki도 아닌 다음 6개를 먼저 만든다:
  `ProjectRegistry`, `ObsidianVaultAdapter`, `AgentSessionManager interface`,
  `SourceNormalizer`, `ConflictManager`, `WorkflowRunner/Job 모델`.
- **Phase 1 — 병렬.** contract(아래 §4)가 고정되면 Dashboard와 LLM Wiki Pipeline을 병렬 개발.

### 모노레포 레이아웃

```
apps/
  desktop/                 # Electron shell
    main/                  # Node BFF + IPC router + service orchestration
    preload/               # contextBridge
    renderer/              # React UI
    worker/                # LocalWorkerRunner 진입점 (ingest/wiki/reindex job)

packages/
  shared/                  # Zod schema, types, contract (단일 진실원)
  core/                    # domain model, ProjectRegistry
  vault/                   # Obsidian vault adapter
  agents/                  # AgentSessionManager: 터미널 표면(node-pty) + adapter + transcript resolver
  llm-wiki/                # LLM Wiki pipeline + AgentRunner (Claude/Codex/OpenCode)
  dashboard-api/           # BFF query/usecase (화면 aggregate)
  search/                  # SQLite FTS/BM25
  workflow/                # WorkflowRunner: Local + (P1) Temporal 어댑터
```

---

## 4. 핵심 데이터 contract (먼저 고정)

모든 contract는 `packages/shared` 에 Zod schema로 둔다(타입과 런타임 검증 일원화).

- `Project`
- `AgentSource` (+ `sourceCursor` 증분 커서)
- `NormalizedSession`
- `AgentSession` (터미널 세션 메타데이터)
- `WikiCandidate`
- `DecisionCandidate`
- `CurrentProposal`
- `Conflict`
- `Job`

### NormalizedSession (공통 schema)

```ts
type NormalizedSession = {
  id: string;
  agentType: "claude" | "codex" | "opencode";
  projectId?: string;        // ProjectRegistry가 매핑
  repoPath?: string;         // 프로젝트 식별 조인 키
  worktreePath?: string;
  branch?: string;
  startedAt?: string;
  endedAt?: string;
  transcriptPath?: string;   // 원본 transcript 위치 (read-only)
  turns: NormalizedTurn[];
  toolCalls: NormalizedToolCall[];
  filesTouched: string[];
};
```

### AgentSessionManager (터미널 실행 표면 + 정규화)

세 agent 모두 **터미널 기반 사용 표면**을 가지므로, MVP는 직접 API 통합이 아니라
공통 **터미널 wrapper(PTY)** 로 각 CLI를 실행하고, 지식화는 별도 **Transcript Resolver**로 한다.
`AgentSessionManager`는 Terminal Surface / Session Metadata Collector / Transcript Resolver /
NormalizedSession Builder로 구성되며, agent별 차이는 얇은 `AgentAdapter`로 격리한다.

```ts
type AgentKind = "claude" | "codex" | "opencode";

// 실행 표면: 사용자가 직접 조작하는 PTY 터미널
interface AgentSessionRuntime {
  kind: AgentKind;
  command: string;            // "claude" | "codex" | "opencode"
  args: string[];
  cwd: string;
  env?: Record<string, string>;
}

// 한 번의 agent 세션 메타데이터
interface AgentSession {
  id: string;
  kind: AgentKind;
  projectId: string;
  repoPath: string;
  worktreePath?: string;
  branch?: string;
  command: string;
  startedAt: string;
  endedAt?: string;
  status: "running" | "exited" | "failed";
  terminalCapturePath?: string;  // recording opt-in 시에만
  transcriptPath?: string;       // resolver가 채움
}

// agent별 차이는 얇게: 실행 명령 + transcript 위치만 다름
interface AgentAdapter {
  kind: AgentKind;
  detectInstall(): Promise<boolean>;
  buildCommand(input: StartAgentInput): AgentSessionRuntime;
  resolveTranscript(session: AgentSession): Promise<TranscriptResolution>;
  // watermark 이후 변경분만 반환 (전체 scan 금지)
  discoverSources(opts: { watermark?: SourceCursor }): Promise<AgentSource[]>;
  parseSource(source: AgentSource): Promise<NormalizedSession>;
}
```

각 adapter는 자기 포맷만 책임지고, 결과는 반드시 `NormalizedSession`으로 정규화한다.
Dashboard / LLM Wiki / Search는 모두 정규화된 데이터만 소비한다.

### WorkflowRunner 인터페이스

```ts
interface WorkflowRunner {
  startIngest(input: IngestInput): Promise<JobId>;
  startWikiUpdate(input: WikiUpdateInput): Promise<JobId>;
  startReindex(input: ReindexInput): Promise<JobId>;
  getJobStatus(jobId: JobId): Promise<JobStatus>;
}
```

MVP는 `LocalWorkerRunner`(worker process + SQLite `jobs` 테이블 + UI progress event).
P1은 동일 인터페이스의 `TemporalWorkflowRunner`로 교체.

---

## 5. Ingest 모델 (실제 머신 검증 반영)

> 2026-06-01 기준 이 머신(WSL2)에서 실제 소스를 확인한 결과를 반영했다.
> **PRD 초안의 경로 가정은 OpenCode/Codex에서 현실과 달랐다.**

| Agent | 실제 소스 (검증됨) | Adapter 처리 |
|---|---|---|
| Claude Code | `~/.claude/projects/<경로인코딩>/<sessionId>.jsonl` (+ 프로젝트 내 `.claude/`) | JSONL 라인 파싱 |
| Codex | `~/.codex/sessions/YYYY/MM/DD/…` **+ `~/.codex/logs_2.sqlite` (~301MB)** | 파일 + SQLite 커서 |
| OpenCode | **`~/.local/share/opencode/opencode.db` (~347MB SQLite)** (+ `~/.config/opencode`) — `~/.opencode`는 플러그인 stub일 뿐 | SQLite 커서 |

세 저장 모델이 완전히 다르다: 파일형 JSONL(Claude) / 날짜파티션 파일 + SQLite(Codex) /
SQLite-only(OpenCode). adapter 추상화가 핵심인 이유.

### 실행 표면 vs 지식 소스

- **터미널은 실행 표면(execution surface)** 이다 — 사용자가 직접 agent CLI를 조작한다.
- **지식화는 터미널 출력 scraping을 기본으로 하지 않는다.** Transcript Resolver 우선순위:
  1. 공식 transcript / session log / hook output
  2. agent별 local history file
  3. sanitized terminal capture fallback (recording opt-in 시에만)
- 터미널엔 ANSI/redraw/permission prompt가 섞여 지식화에 불안정하므로 항상 1→2→3 순으로 정규화 소스를 고른다.

### 증분 ingest는 day-1 요구사항

- 두 SQLite만 합쳐 **650MB+**. 매번 전체 scan 금지.
- 소스별 **watermark/cursor**(파일 mtime·byte offset, SQLite rowid·timestamp)를
  SQLite에 저장하고, `discoverSources(watermark)`는 **지난 ingest 이후 변경분만** 반환.

### 수집 단계(MVP = 옵션 B)

```
MVP: 수동 import + 사용자 지정 경로 증분 scan
P1 : 폴더 watch
P2 : agent hook 자동 ingest (예: Claude SessionEnd hook)
```

---

## 6. 프로젝트 식별 (Hybrid project model)

```
Project = 사용자가 관리하고 싶은 작업 단위
project_type: git | obsidian | hybrid
```

- **canonical project key = 주 `repoPath`** (없으면 사용자 지정 id).
- `ProjectRegistry`가 **각 agent의 네이티브 키 → project_id 매핑**을 보유한다.
  - Claude는 이미 세션을 **절대 repo 경로**로 키잉하므로 자연 조인 키가 된다.
- 단일 프로젝트가 repo + obsidian folder를 동시에 가질 수 있다(hybrid).

```yaml
project_id: llm-agent-v2
project_type: hybrid
repo_paths:
  - /mnt/c/Users/hskim/Desktop/ruahverce/llm-agent-v2
vault_paths:
  - vault/projects/llm-agent-v2
source_paths:
  - ~/.claude
  - ~/.codex/sessions
  - ~/.local/share/opencode
```

> 참고: 이 머신엔 이미 ruahverce 하위 10개 프로젝트 디렉터리(`icme`, `360me`,
> `calculate-math`, `coin`, `blog` 등)가 Claude projects에 잡혀 있어 테스트 데이터가 풍부하다.

---

## 7. LLM Wiki 엔진 (확정: 로컬 CLI 헤드리스 재사용, 멀티 엔진)

LLM 정리는 **설치된 agent CLI를 헤드리스로 재사용**한다(추가 API 키 불필요,
"내가 이미 쓰는 도구" 정체성과 일치). 엔진은 **Claude / Codex / OpenCode 셋 다 지원**하며,
생성 시 사용자가 어느 엔진으로 정리할지 **선택**한다.

```ts
type AgentType = "claude" | "codex" | "opencode";

interface AgentRunner {
  // agent로 어떤 엔진을 쓸지 호출 시점에 결정 (모델 선택 picker 결과)
  run(input: { agent: AgentType; prompt: string; timeoutMs: number }):
    Promise<{ ok: boolean; output: string; raw: string }>;
}
```

원칙:

- `AgentRunner`는 **타임아웃 · 재시도 · 구조화 출력 파싱 실패 핸들링**을 책임진다
  (CLI 출력/종료코드/소요시간이 불안정하다는 전제).
- **트리거 = 단일 사용자-클릭 on-demand.** 사용자가 "생성/갱신"을 누르면 **모델 선택 화면(picker)** 이 떠서
  **Claude / Codex / OpenCode 중 어느 엔진으로 정리할지 고른다.** 선택된 엔진으로 **1회 headless 호출**만 수행한다.
  - 매 ingest마다 자동 호출하지 않는다. **백그라운드/예약/대량 자동실행은 P2**(공식 non-interactive·SDK).
- 엔진 **기본값은 프로젝트별 설정** 가능하고, picker에서 매번 override 할 수 있다.
- **호출 방식 = 공식 headless(non-interactive) 모드 + 구조화 출력**
  (예: `claude -p "<prompt>" --output-format json`, 또는 Agent SDK).
  - 인터랙티브 TUI를 PTY로 감싸 ANSI/스피너/프롬프트를 파싱하는 방식은 **금지**
    (버전 변화에 취약, 권한 프롬프트로 hang 가능). 인간용 텍스트 regex 대신 JSON 파싱.
  - 자동화 중 권한 프롬프트로 멈추지 않도록 비인터랙티브 권한 플래그를 명시한다.
- 이 방식은 §10 안전 원칙과 충돌하지 않는다: **공식 CLI를 사용자 본인 인증으로 정상 호출**하는 것이며,
  scraping/비공식 API/credential 탈취가 아니다. wrapper는 CLI 자체 auth만 사용하고 credential을 저장/추출하지 않는다.

### 산출물 & 권한

| 산출물 | 권한 |
|---|---|
| source summary | 자동 |
| log.md 업데이트 | 자동 |
| wiki candidate | 자동 |
| decision / task candidate | 자동 |
| **current update proposal** | 자동 생성, 반영은 승인 |
| current.md 반영 | **사용자 승인 필요** |
| canonical 문서 반영 | **사용자 승인 필요** |

### current 상태 표현 (질문 6 = C)

```
Current Canonical = 사용자가 승인한 current.md
Current Proposal  = LLM이 제안한 최신 업데이트
```

둘 다 보여주되 **명확히 구분**한다.

---

## 8. 충돌(Conflict) 모델

앱이 문서를 수정하려 할 때 `마지막으로 읽은 hash ≠ 현재 파일 hash` 이면 **덮어쓰지 않는다.**
대신 conflict 문서를 생성한다.

```
projects/<id>/conflicts/2026-06-01-current-conflict.md
```

conflict 문서 내용:

- 충돌 대상 문서
- 앱이 알고 있던 이전 버전
- 현재 파일 버전
- LLM이 적용하려던 변경안
- 사용자가 선택할 merge proposal

이는 **Obsidian 직접 수정과 앱 자동 수정의 공존**을 위해 필수다.

---

## 9. Obsidian 호환 (Acceptance Criteria)

```
[필수]
- 생성된 vault는 Obsidian에서 열 수 있어야 한다.
- 프로젝트/문서 간 연결은 [[wiki-link]]로 표현되어야 한다.
- 문서 메타데이터는 YAML frontmatter로 저장되어야 한다.
- 앱이 없어도 Markdown 파일만으로 기본 내용을 읽을 수 있어야 한다.
```

Dataview, Obsidian plugin, graph view는 **P1 이후**.

---

## 10. 안전 원칙 (Claude / 3rd-party — 비협상)

| 해야 하는 것 | 하지 말아야 하는 것 |
|---|---|
| 사용자 소유 **로컬 transcript read-only** 읽기 | Claude.ai 웹 화면 자동화/scraping |
| 공식 hook / export / `transcript_path` 사용 | 비공식 내부 API 호출 |
| **사용자가 지정한 경로만** scan | 계정 세션/쿠키/토큰 저장 |
| 원본 transcript는 로컬 `vault/raw`에 보존 | 사용량 우회 |
| 외부 LLM 전송 시 **사용자 승인 또는 redaction** | 출력물을 타 모델 학습용으로 재가공 |

credential / session token / cookie는 **수집하지 않는다.**

### 터미널 wrapper 보안 (PTY)

- **raw keystroke 저장 기본 off.** terminal output 저장도 사용자가 **session recording을 켠 경우만**.
- password / API key / passphrase prompt 감지 시 **입력 저장 금지**.
- API key·token 패턴은 **redaction 후에만** capture 보존.
- credential은 DB·vault에 **절대 저장하지 않는다** — wrapper는 각 CLI 자체 auth만 사용한다.

### 자동화 경계

- **MVP 허용**: 사용자가 직접 터미널 조작 + **사용자-클릭 1회 headless 생성 호출**.
- **P2**: 백그라운드/예약/대량 자동실행 (공식 non-interactive·SDK 사용).
- 어느 경우에도 agent 서비스를 우회하거나 내부 API를 호출하지 않는다.

---

## 11. MVP 컷 라인

### In (MVP)

- Common Core 6모듈 (§3 Phase 0)
- 멀티프로젝트 current 대시보드: **좌 프로젝트 사이드바 + 중앙 current + 우 source/wiki/decision/context 패널** (질문 3 = B)
- **AgentSessionManager 터미널 표면**: node-pty + xterm.js로 Claude/Codex/OpenCode CLI 실행 + session metadata 수집
- 증분 ingest: 수동 import + 지정 경로 scan (질문 1 = B)
- **Claude adapter 우선 완성**(터미널 + transcript resolver), Codex·OpenCode는 adapter 인터페이스 + 최소 구현
- SQLite FTS/BM25 검색 (질문 4 = C)
- current canonical ↔ proposal 구분 (질문 6 = C)
- context package: **Markdown 생성 + 파일 저장** (질문 5 = A+B)
- 단일 vault (질문 7 = C: MVP 하나)
- Git 정보: **repo path + branch + worktree** + agent session 연결 (질문 8 = B)
- 충돌 문서 생성
- LLM Wiki: **단일 사용자-클릭 + 모델 선택(Claude/Codex/OpenCode) headless 호출**로 candidate/proposal 생성, canonical 반영은 승인 (질문 2)
- Job은 LocalWorkerRunner (worker process)

### Out (P1+)

- Temporal 어댑터 (P1, IngestSessionWorkflow부터)
- 폴더 watch (P1) / hook 자동 ingest (P2)
- Vector search (P1)
- MCP context 제공 (P1) / agent 자동 전달 (P2)
- 다중 vault (P1+)
- Dataview / graph view / Obsidian plugin (P1+)
- 백그라운드/예약/대량 LLM 자동실행 (P2) — MVP는 사용자-클릭 1회만
- 코드편집 IDE / Monaco 에디터 / 파일트리 패널 (NexusCode식 풀 IDE 확장, P2) — **agent 실행 터미널 표면은 MVP 포함**
- Python sidecar (특수 파싱/ML, P2)

---

## 12. 테스트 전략

- **Adapter**: 이 머신의 실제 샘플 로그를 fixture로 박제한 **골든 테스트**
  (Claude JSONL, Codex sessions+sqlite, OpenCode sqlite) → `NormalizedSession` 검증.
- **Transcript Resolver**: 1→2→3 fallback 우선순위, recording off일 때 capture 미저장 검증.
- **증분 ingest**: watermark 전/후 변경분만 잡는지, 중복 ingest 안 하는지.
- **ConflictManager**: hash 일치/불일치 분기 단위테스트, conflict 문서 생성 검증.
- **ObsidianVaultAdapter**: write → 재파싱 round-trip, frontmatter/`[[link]]` 보존.
- **AgentRunner**: CLI 타임아웃/비정상 출력/파싱 실패 핸들링.
- **dashboard-api**: Project Home aggregate 쿼리가 필요한 패널 데이터를 한 번에 모으는지.

---

## 13. 주요 리스크

| 리스크 | 완화 |
|---|---|
| CLI 헤드리스 출력 불안정 | `AgentRunner` 구조화 파싱 실패 핸들링 + 타임아웃/재시도 |
| 대용량 SQLite(650MB+) ingest 성능 | watermark 커서 + 배치 + worker 분리 |
| Electron main 비대화 | BFF 얇게, job은 worker process로 강제 분리 |
| Electron 메모리/패키징(native module) | better-sqlite3 prebuild, 패널 lazy load |
| 세 agent 포맷 변경 | adapter 격리 + 골든 fixture로 회귀 탐지 |
| 터미널 입력에 credential 노출 | raw keystroke off 기본 + prompt 감지 + 토큰 패턴 redaction |
| PTY/native module(node-pty) 패키징 | prebuild 바이너리, Electron 버전 핀, 설치 detect 폴백 |

---

## 14. 비목표 (Non-goals, MVP)

- 팀/원격 협업 모드
- 클라우드 동기화
- 코드편집용 IDE/에디터 통합 (**agent 실행 터미널 표면은 MVP 포함**, 코드편집 IDE는 비목표)
- 자동(무승인) canonical 문서 수정
- 백그라운드/예약/대량 LLM 자동실행 (P2)
- agent 서비스 자동 조작/대행/scraping

---

## 부록 A. 한 줄 비전

> **NexusCode식 화면을 가진 Obsidian-compatible multi-project dashboard이며,
> agent log ingest와 LLM Wiki 정리를 통해 project current를 계속 갱신하는 개인 AI 작업대.**

---

## 부록 B. ADR — Agent Integration Strategy

```
MVP에서는 Claude, Codex, OpenCode를 직접 API로 통합하지 않는다.
각 도구는 사용자가 로컬에 설치하고 인증한 CLI를 사용한다.

앱은 공통 terminal wrapper(node-pty + xterm.js)를 제공한다.
terminal wrapper는 PTY를 통해 각 CLI를 실행하고,
사용자가 직접 조작할 수 있는 terminal surface를 제공한다.

앱은 agent별 credential, token, cookie를 저장하지 않는다.
앱은 agent 서비스를 우회하거나 내부 API를 호출하지 않는다.

지식화(ingest)는 terminal output scraping을 기본으로 하지 않는다. 우선순위:
  1. 공식 transcript / session log / hook output
  2. agent별 local history file
  3. sanitized terminal capture fallback (recording opt-in)

LLM Wiki 정리(요약·proposal 생성)는 Claude/Codex/OpenCode 셋 다 지원한다.
사용자가 "생성"을 누르면 모델 선택 picker로 엔진을 고르고,
선택된 엔진을 headless(non-interactive) + 구조화 출력으로 1회 호출한다.

향후(P1/P2) 필요 시 agent별 공식 SDK, hook, non-interactive 자동실행을 추가한다.
```

근거:
- 세 도구 모두 **터미널 기반 사용 표면**을 공식 제공 → 공통 wrapper로 MVP 통합 난이도·인증 부담을 낮춘다.
- 실행 표면(터미널)과 지식 소스(transcript resolver)를 분리해, 터미널 출력의 불안정성을 지식 품질과 격리한다.
- 자동화가 필요해질수록 "PTY 화면 조작"이 아니라 **공식 hook / structured output / SDK**로 이동한다.
