---
title: Agent Project Console — Design (PRD v0.4)
date: 2026-06-01
status: draft
owner: irron2004
supersedes: PRD v0.2 (Multi-Project LLM Wiki Workbench)
---

# Agent Project Console — PRD v0.4

## 0. 한 줄 정의

> **AI agent 시대에 PM이 여러 프로젝트를 운영하는 작업대.**
> AI agent(Claude / Codex / OpenCode)에게 task를 나눠주고, 작업 결과를 리뷰하고,
> 다음 task를 만들며, 프로젝트의 현재 상태와 의사결정을
> **LLM Wiki + Obsidian-compatible vault** 로 유지하는 개인 PM workbench.

**개발자용 또 다른 IDE가 아니다.** 핵심은 코드 편집이 아니라 **task lifecycle**다.

```
코드 작성 도구           ❌
AI agent 작업 관리 + 리뷰 + 다음 task 생성 도구   ✅
```

> v0.2(LLM Wiki Workbench)의 기술 결정(런타임 스택, Common Core, terminal wrapper,
> transcript resolver, 멀티엔진 picker)은 모두 유효하다. v0.3은 그 위에
> **PM 도메인(Task / AgentRun / Review)** 을 중심으로 재포지셔닝한 것이다.

---

## 1. 제품 정체성 & 포지셔닝

사용자는 "코드 편집자"가 아니라 **PM**이다:

```
- 프로젝트를 쪼개는 사람
- agent에게 task를 나눠주는 사람
- agent가 한 작업을 리뷰하는 사람
- 다음 task를 다시 작성하는 사람
- 현재 프로젝트 상태/결정을 유지하는 사람
```

- **Dashboard = PM Control Tower** (프로젝트 목록이 아니라 운영 현황판)
- **Terminal = Agent Work Execution Panel** (제품 중심이 아니라 "일 시키는 실행 창")
- **LLM Wiki = 프로젝트 기억 장치** (지식 저장소가 아니라 PM 운영용 메모리)
- **Obsidian vault = PM 산출물 저장소** (노트 앱이 아니라 task/review/decision/wiki의 저장 기반)
- **Harness Studio = agent 팀 설계 패널** ("누가/어떤 권한으로 task를 실행하는가"를 PM이 보고 선택; MVP는 읽기+선택)

---

## 2. 핵심 워크플로 — Task Lifecycle

제품의 중심 흐름은 코드가 아니라 task lifecycle다.

```
Project
→ (P1) Roadmap / Schedule / Epic
→ Task
→ Context Package 생성
→ Agent Assignment (Claude / Codex / OpenCode)
→ Agent Session (terminal 실행)
→ Transcript Ingest
→ LLM Work Summary
→ PM Review (승인 / 반려 / 수정)
→ Decision / current.md 반영
→ Next Task 생성
```

### MVP 최소 핵심 루프 (확정)

```
1. 프로젝트를 등록한다.                         (Project)
2. Task를 만든다 (평면 리스트).                  (Task)
3. Task용 Context Package를 만든다.             (ContextPackage, Markdown+파일)
4. Task를 agent에 할당하고 터미널에서 실행한다.    (AgentSessionManager)
5. 세션 종료 → transcript를 ingest 한다.        (Transcript Resolver)
6. "생성" 클릭 → 모델 picker → LLM이 작업을 요약한다. (AgentRun.summary)
7. PM이 리뷰한다 (승인 / 반려 / 수정).            (Review)
8. 승인 시 current.md proposal 반영 + Next Task 후보 생성.
```

> Epic / Milestone / Roadmap / Timeline / concept-wiki / Decision 그래프는 **P1**.
> MVP는 위 8단계 루프를 가장 빨리 동작시키는 것이 목표다.

---

## 3. 런타임 스택 결정 (v0.2에서 확정, 유지)

**MVP runtime stack = Electron + React + TypeScript + Node BFF.**

이유:

1. 장기 목표가 독립 앱 기반 multi-project PM workbench다.
2. Obsidian-compatible vault, agent log path scan, SQLite index, file watcher,
   PTY 터미널 등 **로컬 OS 기능**이 핵심이다.
3. 설계 contract를 TypeScript / Zod schema로 한 언어에서 유지할 수 있다.
4. Dashboard / PM 서비스 / LLM Wiki pipeline이 동일한 domain model을 공유한다.
5. 장기 실행 작업은 Electron main에서 직접 수행하지 않고 **Worker로 분리**하며,
   이후 **Temporal worker로 교체 가능**하게 둔다.

비선택: FastAPI(Python sidecar로 P2 재등장 가능), Tauri(P2), Next.js 풀스택.

### 핵심 원칙 (비협상)

> **Electron main process를 비대하게 만들지 않는다.**
> BFF는 얇게(aggregate + IPC), ingest / LLM Wiki / agent task lifecycle 같은 장기 작업은
> 별도 **Worker process(LocalWorkerRunner)** 로 분리한다.

### 부속 스택

| 항목 | 선택 |
|---|---|
| SQLite | `node:sqlite` (`DatabaseSync`, Node 24 built-in — zero native build). `better-sqlite3`는 패키징된 Electron용 폴백 |
| Schema / 검증 | Zod (`packages/shared`) |
| UI state | Zustand |
| 검색 | SQLite FTS / BM25 |
| Vault | Markdown + YAML frontmatter + `[[wiki-link]]` |
| Terminal surface | `node-pty` + `xterm.js` (renderer) — agent CLI 실행 표면 |
| Job (MVP) | LocalWorkerRunner (Node worker thread / utility process) |
| Job (P1) | TemporalWorkflowRunner (어댑터 교체) |

---

## 4. 아키텍처

```
┌──────────────────────────────────────────────┐
│ React Renderer (Zustand) — PM Control Tower   │
│  좌:  Projects (Active/Maintenance/Paused/…)  │
│  중:  PM Home (Goal/Tasks/Review/Next Task)   │
│  우:  Context panel (current.md/task/summary) │
│  하:  Agent Work Execution Panel (terminals)  │
│       + Generate (모델 선택 picker) + Job 상태  │
└──────────────────────────────────────────────┘
                  ↓ IPC (preload / contextBridge)
┌──────────────────────────────────────────────┐
│ Electron Main / Node BFF (얇게)                │
│  화면별 aggregate:                             │
│   getProjectDashboard / getReviewQueue        │
│   getTaskBoard / getAgentRunSummary           │
│  command: startAgentTask / submitReview /     │
│           promoteCurrent / generateSummary    │
└──────────────────────────────────────────────┘
                  ↓
┌──────────────────────────────────────────────┐
│ Application Services                          │
│  ProjectService · TaskService · AgentRun      │
│  ReviewService · WikiService · ContextPackage │
│  ConflictService · JobService · HarnessService│
└──────────────────────────────────────────────┘
                  ↓
┌──────────────────────────────────────────────┐
│ Common Core (packages/*)                      │
│  ProjectRegistry · ObsidianVaultAdapter       │
│  AgentSessionManager (term + resolver)        │
│  SourceNormalizer · ConflictManager           │
│  Search/Index (SQLite FTS)                    │
│  WorkflowRunner (interface)                   │
│  AgentRunner (CLI headless, multi-engine)     │
└──────────────────────────────────────────────┘
                  ↓
┌──────────────────────────────────────────────┐
│ Job Runtime                                   │
│  MVP: LocalWorkerRunner (worker process)      │
│  P1 : TemporalWorkflowRunner (AgentTaskWF)    │
└──────────────────────────────────────────────┘
                  ↓
┌──────────────────────────────────────────────┐
│ Storage                                       │
│  Markdown Vault (Obsidian-compatible)         │
│  SQLite (index, jobs, project map, cursors)   │
│  Raw transcript 보존 (raw/<agent>/…)          │
└──────────────────────────────────────────────┘
```

### 개발 순서

- **Phase 0 — Common Core 먼저.** `ProjectRegistry`, `ObsidianVaultAdapter`,
  `AgentSessionManager interface`, `SourceNormalizer`, `ConflictManager`,
  `WorkflowRunner/Job 모델`.
- **Phase 1 — 병렬.** contract(§5)가 고정되면 PM Dashboard와 LLM Wiki Pipeline을 병렬 개발.

### 모노레포 레이아웃

```
apps/
  desktop/
    main/                  # Node BFF + IPC router + service orchestration
    preload/               # contextBridge
    renderer/              # React UI (PM Control Tower)
    worker/                # LocalWorkerRunner 진입점

packages/
  shared/                  # Zod schema, types, contract (단일 진실원)
  core/                    # domain model, ProjectRegistry
  vault/                   # Obsidian vault adapter
  agents/                  # AgentSessionManager: 터미널(node-pty) + adapter + transcript resolver
  llm-wiki/                # LLM Wiki pipeline + AgentRunner (Claude/Codex/OpenCode)
  pm/                      # Task / AgentRun / Review 도메인 서비스
  harness/                 # Harness Studio: AgentConfigAdapter + 정규화 AgentProfile (MVP: 읽기)
  dashboard-api/           # BFF query/usecase (화면 aggregate)
  search/                  # SQLite FTS/BM25
  workflow/                # WorkflowRunner: Local + (P1) Temporal 어댑터
```

---

## 5. 핵심 데이터 contract / 도메인 객체

모든 contract는 `packages/shared` 에 Zod schema로 둔다.

### MVP 객체

`Project` · `Task` · `ContextPackage` · `AgentRun` · `Review` ·
`CurrentProposal` · `AgentSession` · `NormalizedSession` · `AgentSource(+sourceCursor)` ·
`AgentProfile`(읽기 전용) · `Conflict` · `Job`

### P1 객체

`Milestone` · `Epic` · `Roadmap` · `Decision`(그래프) · `WikiPage / Concept` ·
`TeamProfile / TeamMember` (Harness 편집/팀)

### Project

```yaml
id: agent-project-console
name: Agent Project Console
status: active            # active | maintenance | paused | archived
goal: Agent task lifecycle MVP 설계
current_focus: Task lifecycle 최소 루프
start_date: 2026-06-01
target_date: 2026-06-30
project_type: git | obsidian | hybrid
repo_paths: [ ... ]
vault_paths: [ vault/projects/agent-project-console ]
source_paths: [ ~/.claude, ~/.codex/sessions, ~/.local/share/opencode ]
```

### Task (MVP: 평면 리스트)

```yaml
id: TASK-003
project_id: agent-project-console
title: Claude/Codex/OpenCode terminal wrapper 설계
status: todo | in_progress | review | done | rejected
assignee_type: agent | human
assignee: codex
priority: high
due_date: 2026-06-03
context_package: context-packages/TASK-003.md
review_status: none | pending | approved | needs_changes | rejected
# epic_id / milestone_id 는 P1
```

### AgentRun

```yaml
id: RUN-20260601-001
task_id: TASK-003
agent: codex            # claude | codex | opencode
repo_path: /mnt/c/.../agent-project-console
branch: feature/agent-session-manager
started_at: 2026-06-01T10:00:00
ended_at: 2026-06-01T11:20:00
status: running | completed | failed
transcript_path: raw/codex/...
summary_path: agent-runs/RUN-20260601-001-summary.md
```

### Review

```yaml
id: REVIEW-001
task_id: TASK-003
agent_run_id: RUN-20260601-001
reviewer: hyoseok
status: approved | needs_changes | rejected
summary: 구조는 좋지만 Claude transcript resolver 정책 보완 필요
next_tasks: [ TASK-004 ]
```

### NormalizedSession (공통 정규화 schema)

```ts
type NormalizedSession = {
  id: string;
  agentType: "claude" | "codex" | "opencode";
  projectId?: string;
  repoPath?: string;        // 프로젝트 식별 조인 키
  worktreePath?: string;
  branch?: string;
  startedAt?: string;
  endedAt?: string;
  transcriptPath?: string;
  turns: NormalizedTurn[];
  toolCalls: NormalizedToolCall[];
  filesTouched: string[];
};
```

---

## 6. Ingest 모델 (실제 머신 검증 반영)

> 2026-06-01 기준 이 머신(WSL2)에서 실제 소스를 확인한 결과를 반영했다.

| Agent | 실제 소스 (검증됨) | Adapter 처리 |
|---|---|---|
| Claude Code | `~/.claude/projects/<경로인코딩>/<sessionId>.jsonl` (+ 프로젝트 내 `.claude/`) | JSONL 라인 파싱 |
| Codex | `~/.codex/sessions/YYYY/MM/DD/…` **+ `~/.codex/logs_2.sqlite` (~301MB)** | 파일 + SQLite 커서 |
| OpenCode | **`~/.local/share/opencode/opencode.db` (~347MB SQLite)** (+ `~/.config/opencode`) — `~/.opencode`는 stub | SQLite 커서 |

세 저장 모델이 완전히 다르다(파일형 JSONL / 날짜파티션+SQLite / SQLite-only) → adapter 추상화가 핵심.

### 실행 표면 vs 지식 소스

- **터미널은 실행 표면**이다 — 사용자가 직접 agent CLI를 조작한다.
- **지식화는 터미널 출력 scraping을 기본으로 하지 않는다.** Transcript Resolver 우선순위:
  1. 공식 transcript / session log / hook output
  2. agent별 local history file
  3. sanitized terminal capture fallback (recording opt-in 시에만)

### 증분 ingest는 day-1 요구사항

- 두 SQLite만 합쳐 **650MB+**. 매번 전체 scan 금지.
- 소스별 **watermark/cursor**(파일 mtime·byte offset, SQLite rowid·timestamp)를 저장하고
  `discoverSources(watermark)`는 **지난 ingest 이후 변경분만** 반환.

### 수집 단계

```
MVP: 수동 import + 사용자 지정 경로 증분 scan
P1 : 폴더 watch
P2 : agent hook 자동 ingest (예: Claude SessionEnd hook)
```

---

## 7. 프로젝트 식별 (Hybrid project model)

- **canonical project key = 주 `repoPath`** (없으면 사용자 지정 id). `project_type: git | obsidian | hybrid`.
- `ProjectRegistry`가 **각 agent 네이티브 키 → project_id 매핑**을 보유한다.
  Claude는 이미 세션을 절대 repo 경로로 키잉하므로 자연 조인 키가 된다.
- 단일 프로젝트가 repo + obsidian folder를 동시에 가질 수 있다(hybrid).

> 이 머신엔 이미 ruahverce 하위 10개 프로젝트 디렉터리가 Claude projects에 잡혀 있어
> 테스트 데이터가 풍부하다.

---

## 8. AgentSessionManager (터미널 실행 표면 + 정규화)

세 agent 모두 터미널 기반 사용 표면을 가지므로, MVP는 직접 API 통합이 아니라
공통 터미널 wrapper(PTY)로 각 CLI를 실행하고, 지식화는 별도 Transcript Resolver로 한다.

```ts
type AgentKind = "claude" | "codex" | "opencode";

interface AgentSessionRuntime {
  kind: AgentKind;
  command: string;            // "claude" | "codex" | "opencode"
  args: string[];
  cwd: string;
  env?: Record<string, string>;
}

interface AgentSession {
  id: string;
  kind: AgentKind;
  projectId: string;
  taskId?: string;            // 어떤 Task를 위해 띄운 세션인지
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

interface AgentAdapter {
  kind: AgentKind;
  detectInstall(): Promise<boolean>;
  buildCommand(input: StartAgentInput): AgentSessionRuntime;
  resolveTranscript(session: AgentSession): Promise<TranscriptResolution>;
  discoverSources(opts: { watermark?: SourceCursor }): Promise<AgentSource[]>;
  parseSource(source: AgentSource): Promise<NormalizedSession>;
}
```

`AgentSessionManager` = Terminal Surface / Session Metadata Collector / Transcript Resolver /
NormalizedSession Builder. Dashboard / LLM Wiki / Search는 모두 `NormalizedSession`만 소비한다.

---

## 9. LLM Wiki 엔진 (멀티 엔진, 프로젝트 기억 장치)

LLM 정리는 **설치된 agent CLI를 헤드리스로 재사용**한다(추가 API 키 불필요).
엔진은 **Claude / Codex / OpenCode 셋 다 지원**하며, 생성 시 사용자가 엔진을 **선택**한다.

```ts
type AgentType = "claude" | "codex" | "opencode";

interface AgentRunner {
  run(input: { agent: AgentType; prompt: string; timeoutMs: number }):
    Promise<{ ok: boolean; output: string; raw: string }>;
}
```

원칙:

- `AgentRunner`는 타임아웃·재시도·구조화 출력 파싱 실패 핸들링을 책임진다.
- **트리거 = 단일 사용자-클릭 on-demand.** "생성/갱신"을 누르면 **모델 선택 picker** 가 떠서
  Claude/Codex/OpenCode 중 엔진을 고르고, 선택된 엔진으로 **1회 headless 호출**만 한다.
  - 매 ingest마다 자동 호출하지 않는다. **백그라운드/예약/대량 자동실행은 P2.**
  - 엔진 기본값은 프로젝트별 설정, picker에서 override 가능.
- **호출 방식 = 공식 headless(non-interactive) + 구조화 출력** (예: `claude -p "<prompt>" --output-format json`, 또는 SDK).
  인터랙티브 TUI를 PTY로 긁는 방식은 금지(버전 취약·prompt hang).

### LLM Wiki가 정리/생성하는 것 (PM 관점)

```
- 이 task를 왜 만들었는가?
- agent가 무엇을 했는가 / 어떤 파일을 수정했는가?
- 어떤 문제가 남았는가?
- PM 리뷰 요지
- 어떤 결정으로 이어졌는가?  (P1: Decision)
- 다음 task는 무엇이어야 하는가?  (Next Task 후보)
```

### 산출물 & 권한

| 산출물 | 권한 |
|---|---|
| AgentRun work summary | 자동 |
| log.md 업데이트 | 자동 |
| Next Task 후보 | 자동 (생성만; 확정은 PM) |
| **current update proposal** | 자동 생성, 반영은 승인 |
| current.md 반영 | **사용자(PM) 승인 필요** |
| canonical 문서 반영 | **사용자(PM) 승인 필요** |
| wiki concept page / Decision (P1) | 자동 생성, 반영 승인 |

### current 상태 표현

```
Current Canonical = PM이 승인한 current.md
Current Proposal  = LLM이 제안한 최신 업데이트
```

둘 다 보여주되 명확히 구분한다.

---

## 9.5 Harness Studio (agent/team profile 읽기 + 선택)

PM이 **"누가 / 어떤 권한으로 task를 실행하는가"** 를 설계하는 control panel.
설정 파일을 UI에 직접 박지 않고, 먼저 **정규화된 모델로 읽어** 보여준다.

### MVP = 읽기 + 선택만 (편집/팀은 P1+)

- 각 agent 설정을 **정규화된 `AgentProfile`(읽기 전용)** 로 읽는다.
- 우측 패널에 profile **목록 + 상세(raw view + form view, read-only)** 를 보여준다.
- **task 실행 시 어떤 profile/agent로 돌릴지 PM이 선택**한다 (§9 모델 picker의 확장 — 엔진뿐 아니라 profile까지).
- MVP provider = **OpenCode first** (`opencode.json` + `.opencode/agents/*.md` — 문서화·구조가 명확).
  `AgentConfigAdapter` 인터페이스는 셋 다 대비해 설계하되 **구현은 OpenCode부터**.

### 정규화 모델 (읽기 전용, MVP)

```ts
type Perm = "allow" | "ask" | "deny";

type AgentProfile = {
  id: string;
  provider: "claude" | "codex" | "opencode";
  name: string;
  scope: "global" | "project" | "local" | "managed";
  mode: "primary" | "subagent" | "reviewer" | "planner" | "builder" | "custom";
  description?: string;
  model?: string;
  prompt?: { inline?: string; filePath?: string };
  permissions?: { read?: Perm; edit?: Perm; bash?: Perm; web?: Perm; task?: Perm };
  tools?: string[];
  maxSteps?: number;
  temperature?: number;
  rawConfigPath: string;
  rawFormat: "json" | "markdown" | "toml" | "unknown";
};

interface AgentConfigAdapter {
  provider: "claude" | "codex" | "opencode";
  discoverProfiles(opts: { projectPath?: string }): Promise<AgentProfile[]>; // read-only
}
```

### Config 읽기 안전 원칙 (MVP)

- **인증/세션/token 파일은 읽기 대상에서 제외.** (예: `~/.claude.json`엔 OAuth 세션·MCP 설정·캐시가 섞임
  → 편집은 물론 profile 소스로도 쓰지 않는다.)
- **managed / read-only scope는 read-only로 표시.**
- unknown field는 버리지 않고 보존(편집 P1의 round-trip 보장 토대).
- **MVP는 쓰기가 없다 → 사용자의 실제 도구 설정 파일 손상 위험 0.**

### P1+ (이번 MVP 밖)

- **OpenCode 편집**: "Create Change Proposal" + diff + backup + **conflict-safe write(§10 `ConflictManager` 재사용)**.
- **Claude** settings/subagents read-only preview → 제한적 편집.
- **Codex** config / AGENTS.md / rules / hooks 편집.
- **`TeamProfile` / `TeamMember`** (planner / builder / reviewer / researcher / tester / pm) + task에 team 연결
  + team-aware context package 생성.
- **cross-agent team profile** (provider 혼합 팀).

---

## 10. 충돌(Conflict) 모델

앱이 문서를 수정하려 할 때 `마지막 읽은 hash ≠ 현재 파일 hash` 이면 덮어쓰지 않고
conflict 문서를 생성한다.

```
projects/<id>/conflicts/2026-06-01-current-conflict.md
```

내용: 충돌 대상 문서 / 앱이 알던 이전 버전 / 현재 파일 버전 / LLM 변경안 / merge proposal.
Obsidian 직접 수정과 앱 자동 수정의 공존을 위해 필수다.

---

## 11. Vault 구조 (Obsidian-compatible PM 산출물)

```
vault/projects/<project-id>/
  current.md                 # MVP — PM이 승인한 현재 상태 (canonical)
  log.md                     # MVP — 작업 로그
  tasks/TASK-xxx.md          # MVP
  context-packages/TASK-xxx.md   # MVP
  agent-runs/RUN-xxx-summary.md  # MVP
  reviews/REVIEW-xxx.md      # MVP
  conflicts/*.md             # MVP
  raw/<agent>/...            # MVP — 원본 transcript 보존 (read-only)
  roadmap.md                 # P1
  decisions/ADR-xxx.md       # P1 (Decision 그래프)
  wiki/concepts/*.md         # P1
```

### Obsidian 호환 (Acceptance)

```
[필수]
- 생성된 vault는 Obsidian에서 열 수 있어야 한다.
- 프로젝트/문서/task 간 연결은 [[wiki-link]]로 표현한다. (예: TASK 문서에서 [[RUN-xxx]])
- 문서 메타데이터는 YAML frontmatter로 저장한다.
- 앱이 없어도 Markdown 파일만으로 기본 내용을 읽을 수 있어야 한다.
```

Dataview / graph view / Obsidian plugin = P1 이후.

---

## 11.5 Knowledge Retrieval Core (`@apc/knowledge`)

`@apc/knowledge` indexes Obsidian-compatible project Markdown into a local SQLite FTS5 index
(별도 패키지 — agent 세션 turn을 인덱싱하는 `@apc/search`와 분리). vault 폴더를 프로젝트
collection으로 다루고, `/tasks`·`/reviews`·`/decisions`·`/wiki`·`/current.md` 같은 경로에 대한
context-tree 메타데이터를 저장하며, task 배정용 `ContextPackage`(JSON/files) 출력을 생성한다.

MVP retrieval = 키워드/FTS + PM 메타데이터 랭킹:

- `canonical` / `accepted` 문서는 부스트.
- `candidate` 문서는 중립.
- `superseded` / `deprecated` 문서는 디모트.
- `conflict` 문서는 검색에는 남되 경고(warning)를 단다.

`pmw://project/<projectId>/<relPath>` 결정적 URI로 문서를 식별한다. MCP stdio/HTTP,
vector/rerank는 SDK-first `KnowledgeRetrieval` / `ContextPackageBuilder` 위의 P1/P2 어댑터로 둔다.

---

## 12. 안전 원칙 (Claude / 3rd-party — 비협상)

| 해야 하는 것 | 하지 말아야 하는 것 |
|---|---|
| 사용자 소유 **로컬 transcript read-only** 읽기 | Claude.ai 웹 화면 자동화/scraping |
| 공식 hook / export / `transcript_path` 사용 | 비공식 내부 API 호출 |
| **사용자가 지정한 경로만** scan | 계정 세션/쿠키/토큰 저장 |
| 원본 transcript는 로컬 `raw/`에 보존 | 사용량 우회 |
| 외부 LLM 전송 시 **사용자 승인 또는 redaction** | 출력물을 타 모델 학습용으로 재가공 |
| agent 설정은 **read-only로 읽기**(MVP), 편집은 proposal+backup(P1) | 인증/세션이 섞인 config 파일 편집·소스화 |

credential / session token / cookie는 **수집하지 않는다.**

### 터미널 wrapper 보안 (PTY)

- **raw keystroke 저장 기본 off.** terminal output 저장도 session recording을 켠 경우만.
- password / API key / passphrase prompt 감지 시 입력 저장 금지.
- API key·token 패턴은 redaction 후에만 capture 보존.
- credential은 DB·vault에 절대 저장하지 않는다 — wrapper는 각 CLI 자체 auth만 사용.

### 자동화 경계

- **MVP 허용**: 사용자가 직접 터미널 조작 + **사용자-클릭 1회 headless 생성 호출**.
- **P2**: 백그라운드/예약/대량 자동실행 (공식 non-interactive·SDK).

---

## 13. 화면 (PM Control Tower)

```
┌──────────┬───────────────────────────────┬──────────────────┐
│ Projects │ PM Home (선택한 프로젝트)        │ Context panel    │
│ - Active │  - Current Goal               │  - current.md    │
│ - Maint. │  - Active Tasks               │  - selected task │
│ - Paused │  - Review Queue               │  - agent summary │
│ - Archvd │  - Agent Runs                 │  - current proposal│
│          │  - Next Task Candidates       │                  │
│          │  - (P1) Timeline / Decision Q │                  │
├──────────┴───────────────────────────────┴──────────────────┤
│ Agent Work Execution Panel                                   │
│  [Claude] [Codex] [OpenCode] 터미널 탭 + Generate(picker)     │
│  + running jobs / ingest status                              │
└──────────────────────────────────────────────────────────────┘
```

우측 Context panel은 선택한 task에 대해 **Harness Studio**(§9.5)도 노출한다:
AgentProfile 목록 + 상세(read-only) + **"이 task를 어느 profile/agent로 실행할지" 선택**.

NexusCode식 IDE 화면을 그대로 따르지 않고, **PM 작업 흐름에 맞는 multi-project control room**으로 간다.

---

## 14. MVP 컷 라인

### In (MVP) — 최소 핵심 루프

- Common Core 6모듈 (§4 Phase 0)
- **PM Control Tower**: 좌 Projects / 중 PM Home(Goal·Active Tasks·Review Queue·Agent Runs·Next Task) / 우 Context / 하 Agent 터미널
- **Task (평면 리스트)** + **ContextPackage**(Markdown 생성+파일 저장) + **AgentRun** + **Review(승인/반려/수정)** + **Next Task 후보**
- **AgentSessionManager 터미널 표면**: node-pty + xterm.js로 Claude/Codex/OpenCode CLI 실행 + session metadata 수집
- **Harness Studio (읽기+선택)**: OpenCode agent 설정을 정규화 `AgentProfile`(read-only)로 읽어 우측 패널에 표시 + task 실행 profile 선택
- 증분 ingest: 수동 import + 지정 경로 scan
- **Claude adapter 우선 완성**(터미널 + transcript resolver), Codex·OpenCode는 adapter 인터페이스 + 최소 구현
- LLM Wiki: **단일 사용자-클릭 + 모델 선택(Claude/Codex/OpenCode) headless 호출**로 work summary / current proposal / next task 후보 생성, canonical 반영은 승인
- current canonical ↔ proposal 구분
- SQLite FTS/BM25 검색 (프로젝트/task/문서명 + 전문)
- 단일 vault
- Git 정보: repo path + branch + worktree + agent session 연결
- 충돌 문서 생성
- Job은 LocalWorkerRunner (worker process)

### Out (P1+)

- **Epic / Milestone / Roadmap / Timeline 계층** (P1) — MVP는 평면 Task 리스트
- **Decision 그래프 / ADR 관리** (P1) — MVP는 review 내 next_tasks로 대체
- **wiki concept page / 자동 개념 링킹** (P1)
- **Harness Studio 편집/저장** (P1, OpenCode부터): Create Change Proposal · diff · backup · conflict-safe write
- **Claude/Codex config 읽기·편집** (P1/P2) — MVP는 OpenCode 읽기만
- **TeamProfile / cross-agent team / team-aware context package** (P1+)
- Temporal 어댑터 (P1, `AgentTaskWorkflow`부터)
- 폴더 watch (P1) / hook 자동 ingest (P2)
- Vector search (P1)
- MCP context 제공 (P1) / agent 자동 전달 (P2)
- 다중 vault (P1+)
- Dataview / graph view / Obsidian plugin (P1+)
- 백그라운드/예약/대량 LLM 자동실행 (P2)
- 코드편집 IDE / Monaco / 파일트리 패널 (P2) — **agent 실행 터미널 표면은 MVP 포함**
- Python sidecar (특수 파싱/ML, P2)

---

## 15. 테스트 전략

- **Adapter**: 이 머신의 실제 샘플 로그를 fixture로 박제한 **골든 테스트**
  (Claude JSONL, Codex sessions+sqlite, OpenCode sqlite) → `NormalizedSession` 검증.
- **Transcript Resolver**: 1→2→3 fallback 우선순위, recording off일 때 capture 미저장.
- **증분 ingest**: watermark 전/후 변경분만 잡는지, 중복 ingest 안 하는지.
- **Task lifecycle**: Task → AgentRun → summary → Review → Next Task 상태 전이 단위테스트.
- **ConflictManager**: hash 일치/불일치 분기, conflict 문서 생성.
- **ObsidianVaultAdapter**: write → 재파싱 round-trip, frontmatter/`[[link]]` 보존.
- **AgentRunner**: CLI 타임아웃/비정상 출력/파싱 실패 핸들링.
- **dashboard-api**: `getProjectDashboard` 등 aggregate가 패널 데이터를 한 번에 모으는지.

---

## 16. 주요 리스크

| 리스크 | 완화 |
|---|---|
| PM 도메인 scope 폭발 | MVP를 평면 Task 최소 루프로 고정, 계층/Decision/wiki는 P1 |
| CLI 헤드리스 출력 불안정 | `AgentRunner` 구조화 파싱 실패 핸들링 + 타임아웃/재시도 |
| 대용량 SQLite(650MB+) ingest 성능 | watermark 커서 + 배치 + worker 분리 |
| Electron main 비대화 | BFF 얇게, job은 worker process로 강제 분리 |
| 터미널 입력에 credential 노출 | raw keystroke off 기본 + prompt 감지 + 토큰 패턴 redaction |
| PTY/native module(node-pty) 패키징 | prebuild 바이너리, Electron 버전 핀, 설치 detect 폴백 |
| 빌드 환경에 C 컴파일러 없음 (WSL2 검증, 2026-06-01) | DB 드라이버를 node:sqlite(빌드 불필요)로 선택 → SQLite native 빌드 의존 제거 |
| 세 agent 포맷 변경 | adapter 격리 + 골든 fixture로 회귀 탐지 |
| Harness 읽기가 credential 섞인 config 노출 | 인증/세션 파일 제외 화이트리스트, MVP는 쓰기 없음 |
| Harness 편집이 사용자 실제 도구 설정 손상 | MVP는 read-only, P1 편집은 proposal+diff+backup+conflict-safe write |

---

## 17. 비목표 (Non-goals, MVP)

- 팀/원격 협업 모드
- 클라우드 동기화
- 코드편집용 IDE/에디터 통합 (**agent 실행 터미널 표면은 MVP 포함**, 코드편집 IDE는 비목표)
- 자동(무승인) canonical 문서 수정
- 백그라운드/예약/대량 LLM 자동실행 (P2)
- agent 서비스 자동 조작/대행/scraping

---

## 부록 A. 한 줄 비전

> **AI agent에게 일을 나눠주고, 작업 결과를 리뷰하고, 다음 task를 만들며,
> 프로젝트의 현재 상태와 의사결정을 LLM Wiki로 유지하는 Obsidian-compatible PM workbench.**

---

## 부록 B. ADR — Agent Integration Strategy

```
MVP에서는 Claude, Codex, OpenCode를 직접 API로 통합하지 않는다.
각 도구는 사용자가 로컬에 설치하고 인증한 CLI를 사용한다.

앱은 공통 terminal wrapper(node-pty + xterm.js)를 제공한다.
terminal wrapper는 PTY로 각 CLI를 실행하고, 사용자가 직접 조작하는 terminal surface를 제공한다.

앱은 agent별 credential/token/cookie를 저장하지 않으며,
agent 서비스를 우회하거나 내부 API를 호출하지 않는다.

지식화(ingest)는 terminal output scraping을 기본으로 하지 않는다. 우선순위:
  1. 공식 transcript / session log / hook output
  2. agent별 local history file
  3. sanitized terminal capture fallback (recording opt-in)

LLM Wiki 정리(요약·proposal·next task 생성)는 Claude/Codex/OpenCode 셋 다 지원한다.
사용자가 "생성"을 누르면 모델 선택 picker로 엔진을 고르고,
선택된 엔진을 headless(non-interactive) + 구조화 출력으로 1회 호출한다.

향후(P1/P2) 필요 시 agent별 공식 SDK, hook, non-interactive 자동실행과
AgentTaskWorkflow(Temporal)를 추가한다.
```

---

## 부록 C. AgentTaskWorkflow (P1 — Temporal 후보)

장기 실행·중간 실패·재시도·상태 추적이 필요한 agent task lifecycle은 Temporal에 잘 맞는다.
MVP는 `LocalWorkerRunner`로 구현하고, 동일 `WorkflowRunner` 인터페이스로 P1에 교체한다.

```
AgentTaskWorkflow
1. task 선택
2. context package 생성
3. agent session 시작 (또는 사용자 터미널 실행 감지)
4. session 종료 감지
5. transcript/log resolve
6. normalized session 생성
7. LLM work summary 생성
8. review candidate 생성
9. next task candidate 생성
10. PM review queue 등록
```

---

## 부록 D. 문서 이력

- **v0.4 (2026-06-01)**: **Harness Studio** 추가 — PM이 agent/team profile을 보고 task 실행에 연결.
  MVP = 읽기+선택만(정규화 `AgentProfile` read-only, OpenCode-first, profile 선택).
  편집(Create Change Proposal+diff+backup+conflict-safe write)/팀/Claude·Codex = P1+.
- **v0.3 (2026-06-01)**: PM workbench로 재포지셔닝. 제품명 `Agent Project Console`.
  Task lifecycle 중심, PM Control Tower, PM 도메인 객체(Task/AgentRun/Review) 추가.
  MVP = 최소 핵심 루프(평면 Task), 계층/Decision/wiki는 P1.
- **v0.2**: Multi-Project LLM Wiki Workbench. 런타임 스택(Electron+React+Node BFF),
  terminal wrapper(AgentSessionManager), 멀티엔진 picker, transcript resolver,
  증분 ingest, 충돌 모델 확정.
