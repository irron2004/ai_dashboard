# ai_dashboard (agent-project-console)

개인 LLM-wiki를 구축·관리하고, 여러 프로젝트를 동시 진행할 때 전후 작업을 파악해 다음 할 일을 LLM에게 빠르게 전달하는 **Electron 데스크톱 PM 대시보드**입니다.

- 에이전트(Claude/OpenCode/Codex) 세션을 자동 수집 → Task로 캡처
- 멀티에이전트 파이프라인으로 wiki 노드·그래프 생성 → `<repo>/.apc-wiki`
- 프로젝트별 PTY 터미널 dock + work↔wiki 그래프 시각화
- ssh:// 원격 프로젝트 1급 지원(소스 fetch·엔진 실행·vault 동기화)

---

## 주요 기능

| 기능 | 설명 |
|---|---|
| 위키 생성 파이프라인 | HarnessService: 소스 materialize → LLM 추출 → 증거 검증 → 그래프 → HUMAN_REVIEW → promote → export |
| 세션 → Task 캡처 | IngestService가 `~/.claude` 등 대화 로그를 파싱해 `req:` / `todo:` Task를 자동 생성 |
| work↔wiki 그래프 | SP2: Task·AgentRun과 wiki 노드를 Cytoscape.js로 시각화 (Knowledge 탭) |
| 에이전트 dock | 프로젝트별 claude·opencode·codex PTY 터미널 3-컬럼 (Shift+1/2/3 전환, Ctrl+1-9 프로젝트) |
| dev-harness 구동 | DevHarnessService(S3): Task → 멀티에이전트 코딩 하네스 원클릭 실행, 로그 스트리밍 |
| ssh 원격 프로젝트 | `ssh://` repoPaths: 문서·대화·엔진·vault push/pull 전부 원격 기준 동작 |
| 전역 검색 | Ctrl+K — 세션·wiki·knowledge 통합 검색(sqlite in-memory FTS) |
| 앱 자체 업데이트 | GlobalMenu ▸ Update (git pull + pnpm install) + 재시작 |

---

## 아키텍처

```
apps/desktop (Electron)                       apps/graph-web (Browser)
  ├── renderer                                  그래프 전용 웹 뷰어
  │     ├── Home      (current.md · Changes · PmHome · TaskBoard)
  │     ├── Knowledge (KnowledgeView · GraphVisualization)
  │     └── Wiki Gen  (WikiGenDashboard · HarnessRunList · NodeConfirmPanel)
  │
  ├── Agent Dock  claude │ opencode │ codex  (PTY xterm.js, 드래그 리사이즈)
  │
  └── main (Electron)
        └── Container.buildContainer()  ← 모든 서비스 조립·IPC 배선
              │
              ├── app-services
              │     HarnessService     위키 파이프라인 (지식 위키 생성·promote)
              │     DevHarnessService  dev 하네스 (S3, 코딩 에이전트 오케스트레이션)
              │     IngestService      세션 수집 → SearchIndex · Task 추출
              │     GenerateService    단순 wiki 생성(LLM 1-shot)
              │     WorkspaceVault     위키 로컬/ssh 동기화
              │
              ├── knowledge-harness    위키 생성 런타임
              │     discovery → extract → verify → graph
              │     → HUMAN_REVIEW → promote → export
              │     DomainPack: project-docs | paper
              │
              ├── llm-wiki            WikiEngine · CliAgentRunner
              ├── wiki-substrate      autosci-core PythonKernelAdapter (lint·index)
              │
              ├── core                ProjectRegistry · Db (node:sqlite)
              ├── pm                  TaskStore · AgentRunStore · ReviewService
              ├── agents              Claude/Codex/OpenCode 인제스트 어댑터 · resume
              ├── knowledge           KnowledgeStore · chunker · 검색 retrieval
              ├── search              SearchIndex (sqlite in-memory FTS)
              ├── vault               VaultAdapter (gray-matter 마크다운 읽기/쓰기)
              ├── dashboard-api       getProjectDashboard
              ├── graph-view          GraphVisualization(Cytoscape) · build-graph
              ├── harness             TaskProfileStore · AgentConfigEditor
              ├── workflow            LocalWorkerRunner (SQLite 잡 큐)
              └── shared              Zod 스키마 단일 소스 (Project·Task·AgentRun…)
```

**IPC 흐름:** renderer `api.ts` → preload `contextBridge` → main `ipc.ts` → `Container` 메서드.  
채널 정의 단일 소스: `apps/desktop/src/shared/ipc-contract.ts` (`CH` 상수 + 타입).

---

## 시작하기

### 의존성 설치

```bash
pnpm install
```

> `pnpm-workspace.yaml`에서 `nodeLinker: hoisted` 설정 — node-pty·better-sqlite3 등 네이티브 모듈 빌드에 필요합니다.  
> 네이티브 모듈 재빌드가 필요한 경우:
> ```bash
> pnpm --filter @apc/desktop rebuild      # better-sqlite3
> pnpm --filter @apc/desktop rebuild:pty  # node-pty
> ```

### 테스트

```bash
pnpm test
```

vitest workspace(루트 `vitest.workspace.ts`)가 `packages/**` + `apps/desktop` 두 스위트를 한 번에 실행합니다. 소요 시간 약 2.5분.

단일 파일만 실행:

```bash
npx vitest run <파일명패턴>   # 예: npx vitest run harness-service
```

### 타입 검사

```bash
pnpm typecheck
```

`tsc -p tsconfig.typecheck.json` (packages) + `tsc -p apps/desktop/tsconfig.json --noEmit` 두 단계를 순서대로 실행합니다.  
IDE 진단보다 이 명령이 권위 기준입니다. `@xterm/…` / `@apc/node:sqlite` "not found" 류 IDE 경고는 오경보이므로 무시하세요.

### 데스크톱 앱 실행

```bash
# 개발 모드 (hot-reload)
pnpm --filter @apc/desktop dev

# 프리뷰 모드 (빌드 후 미리보기)
pnpm --filter @apc/desktop start
```

### 브라우저 그래프 뷰어

```bash
pnpm graph-web
```

`scripts/graph-web.mjs`로 `apps/graph-web` Vite 개발 서버를 시작합니다.

### 원격 읽기전용 상태 대시보드

```bash
pnpm status-web --db /path/to/apc.db          # 127.0.0.1:4319, 토큰 자동 생성
pnpm status-web --host 0.0.0.0 --token <t>    # 폰/원격 접속(LAN opt-in)
```

Electron과 같은 `apc.db`를 읽어 전 프로젝트 상태를 웹으로 노출(읽기 전용, 토큰 인증).
자세한 내용은 `docs/status-web.md` 참고.

---

## 패키지 맵 (packages/)

| 패키지 | 역할 |
|---|---|
| `shared` | Zod 스키마 단일 소스 — Project·Task·AgentRun·AgentKind·RunAgent 등 모든 공용 타입 |
| `core` | ProjectRegistry·Db(node:sqlite)·IngestCursorStore·ConflictManager |
| `pm` | TaskStore·AgentRunStore·ReviewService·VaultWriter — PM 데이터 레이어 |
| `agents` | Claude/Codex/OpenCode 인제스트 어댑터(세션 파싱·cursor), resume 명령, redact |
| `app-services` | HarnessService(위키파이프라인)·DevHarnessService(dev 하네스)·IngestService·GenerateService·KnowledgeIndexer·WorkspaceVault·task-extractor·session-summarizer |
| `knowledge-harness` | 위키 생성 런타임 — RunStateMachine·FeatureGate·HarnessRunner·StagingVault·PolicyGuard·SecretScanner·DomainPack(project-docs/paper)·ObsidianWikiWriter |
| `llm-wiki` | WikiEngine·CliAgentRunner·LoggingAgentRunner·EngineOptions·prompts |
| `harness` | TaskProfileStore·AgentConfigEditor·opencode-config-adapter — 에이전트 설정 파일 관리 |
| `knowledge` | KnowledgeStore·ProcessedSourceStore·chunker·KnowledgeRetrieval·context-package·migrate |
| `graph-view` | GraphVisualization(Cytoscape)·build-graph(work↔wiki)·graph-algorithms·graph-style — 브라우저·데스크톱 공용 |
| `dashboard-api` | `getProjectDashboard` — 프로젝트별 activeTasks·reviewQueue·recentRuns 집계 |
| `status-web` | 읽기전용 상태 웹 서버 — node:http + 토큰 인증, dashboard-api 집계를 HTTP로 노출, 모바일 페이지 |
| `search` | SearchIndex — sqlite in-memory FTS, 세션·wiki·knowledge 통합 검색 |
| `vault` | VaultAdapter — gray-matter 기반 Obsidian 마크다운 읽기/쓰기 |
| `wiki-substrate` | WikiSubstrate 인터페이스·PythonKernelAdapter(autosci-core 커널 lint·index·ingest)·SubstrateGraphAdapter |
| `workflow` | LocalWorkerRunner — SQLite 잡 큐(향후 Temporal 등으로 교체 가능한 seam) |

---

## 테스트 및 타입 검사 요약

```bash
pnpm test           # vitest workspace 전체 (packages + apps/desktop), ~2.5분
pnpm typecheck      # tsc 두 패스 (packages tsconfig + desktop tsconfig)
npx vitest run <패턴>  # 단일 파일·패턴 실행 (repo root에서)
```

테스트 파일 위치: `packages/**/*.test.{ts,tsx}`, `scripts/**/*.test.ts`, `apps/desktop/src/**/*.test.{ts,tsx}`.

---

## 현재 상태 및 로드맵

`docs/handoffs/2026-07-02-product-diagnosis-and-roadmap.md` 참조.  
위키 생성(P0 완성)·에이전트 dock·ssh 원격 프로젝트는 동작하며, Task 의존성 모델(P1)·Context Package Composer(P2)·크로스 프로젝트 홈(P3)·원격 웹 대시보드(P4) 순으로 개발 예정.
