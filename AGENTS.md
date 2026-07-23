# AGENTS.md — ai_dashboard 개발 가이드

> 공통 정책: 워크스페이스 루트 `../AGENTS.md`(ruahverce 정책)를 먼저 따른다.
>
> 단독 클론에서는 위 파일이 없을 수 있다. 그 경우에도 아래 핵심 안전 규칙은 항상 적용한다.
>
> - 에이전트마다 별도 브랜치와 `~/worktrees/` 아래 별도 worktree를 사용한다.
> - 커밋·리베이스·푸시 전 `git status`와 `git log --oneline -5`를 확인한다. 낯선 변경이
>   보이면 덮어쓰지 말고 사용자에게 보고한다.
> - 비밀키·토큰을 커밋하거나 하드코딩하지 않는다. `.env`는 무시하고 예시 파일만 추적한다.
> - 삭제, `reset --hard`, force push, 대량 덮어쓰기에는 사용자 승인이 필요하다.
> - 실패하는 테스트나 게이트를 삭제·skip해서 통과시키지 않는다.
> - 이 저장소 작업은 이 저장소에만 커밋한다. 상위 저장소의 서브모듈 포인터와 원격에는
>   사용자 승인 없이 반영하지 않는다.

## 프로젝트와 주요 경로

개인 LLM wiki를 구축·관리하고 여러 프로젝트의 다음 작업을 빠르게 파악하게 하는 Electron
데스크톱 PM 대시보드다.

| 경로 | 역할 |
|---|---|
| `apps/desktop/` | Electron main·preload·renderer와 데스크톱 UI |
| `apps/graph-web/` | 브라우저용 그래프 뷰어 |
| `packages/` | 도메인 서비스, 저장소, 에이전트, wiki·그래프 런타임 |
| `packages/shared/src/schema.ts` | 모든 공용 Zod 타입의 단일 소스 |
| `apps/desktop/src/main/container.ts` | 서비스 조립 DI 컨테이너 |
| `apps/desktop/src/shared/ipc-contract.ts` | IPC 채널·요청/응답 타입의 단일 소스 |
| `scripts/` | 그래프·상태 웹 서버와 저장소 보조 스크립트 |
| `docs/handoffs/2026-07-02-product-diagnosis-and-roadmap.md` | 현재 상태와 로드맵 |

## 설치·실행·검증

저장소 루트에서 실행한다.

```bash
pnpm install
pnpm check                     # 권위 있는 타입 검사 + 전체 테스트
pnpm test                      # vitest workspace 전체(packages + apps/desktop)
pnpm typecheck                 # 권위 있는 타입 검사
npx vitest run <패턴>          # 단일 파일·패턴
pnpm --filter @apc/desktop dev # Electron 개발 서버(hot reload)
```

완료 전 최소 `pnpm typecheck`와 변경 범위의 테스트를 실행한다. 넓은 변경은 `pnpm check`로
전체 게이트를 실행한다. IDE의 `@xterm/…`, `@apc/node:sqlite not found`,
`@homebridge/node-pty-prebuilt-multiarch` 진단은 선택적 네이티브 의존성과 vite-node shim
때문의 오경보일 수 있다. 판단 기준은 `pnpm typecheck` 결과다.

## 아키텍처 핵심 — 이름 혼동 주의

| 이름 | 실제 역할 | 위치 |
|---|---|---|
| `HarnessService` | 위키 생성 파이프라인(materialize→LLM→verify→promote) | `packages/app-services/src/harness-service.ts` |
| `DevHarnessService` | 멀티에이전트 dev 하네스 구동(S3, 코딩 에이전트 오케스트레이션) | `packages/app-services/src/dev-harness-service.ts` |

두 서비스는 독립적이다. 위키 파이프라인 작업에는 `HarnessService`, 코딩 에이전트 실행에는
`DevHarnessService`를 사용한다.

## AgentKind와 RunAgent

- `AgentKind` = `'claude' | 'codex' | 'opencode'`: CLI 엔진 선택 전용(PTY 터미널,
  ssh `ENGINE_CMD`, resume). PTY 실행·SSH·resume 등 여러 곳이 이 열거형에 의존하므로
  **값을 추가하지 않는다.**
- `RunAgent` = `AgentKind | 'harness'`: `agent_runs` 테이블의 `agent` 컬럼, 즉 run 레코드
  기록에만 사용한다.

## IPC 채널 추가

`CH` 상수는 `apps/desktop/src/shared/ipc-contract.ts`가 단일 소스다. 새 채널은 아래 네
파일에 모두 배선한다.

1. `apps/desktop/src/shared/ipc-contract.ts`: `CH` 상수와 요청/응답 타입
2. `apps/desktop/src/preload/index.ts`: `contextBridge.exposeInMainWorld('apc', …)` 노출
3. `apps/desktop/src/renderer/api.ts`: renderer 호출 함수
4. `apps/desktop/src/main/ipc.ts`: `handlers()` 맵 등록과 필요 시 `Container` 메서드

## DB 패턴

- 엔진은 Node 24 내장 `node:sqlite`의 `DatabaseSync`다.
  `vitest.config.ts`의 `nodeSqlitePlugin`이 vitest shim을 제공한다.
- 마이그레이션은 `CREATE TABLE IF NOT EXISTS`와 `addColumnIfMissing()`을 사용하는
  멱등 패턴이다. `packages/pm/src/migrate.ts`를 참고한다.
- 스키마 소스는 `packages/shared/src/schema.ts`다. DB 컬럼은 snake_case, TypeScript
  필드는 camelCase를 쓴다.

## Task id 규약

```text
req:${projectId}:${sessionId}            세션 요청 Task
todo:${projectId}:${sessionId}:${slug}   세션에서 추출된 todo Task
```

`contextPackage` 필드는 현재 `sessionId` 문자열이다. 향후 Context Package Composer에서
확장할 예정이다.

## 로컬 Claude 스킬

공유 wiki 스킬의 캐노니컬 소스는 워크스페이스 루트 `shared/claude-skills/`이며 사용자
레벨에 배포된다. 이 저장소에는 아직 병합되지 않은 분기본
`bootstrap-wiki`, `ingest-documents`, `overview-wiki`만 유지한다. 공유 스킬 사본을
`.claude/skills/`에 다시 복사하지 않는다.

## 커밋

Conventional Commits를 사용한다: `feat(scope)`, `fix(scope)`, `docs(scope)`,
`chore(scope)`, `test(scope)`. scope 예시는 `harness`, `pm`, `desktop`, `knowledge`,
`agents`다. 정확한 변경 경로만 stage하고 커밋 전 안전 규칙의 상태·이력 확인을 반복한다.
