# Reusable assets

다른 프로젝트가 구현 파일을 임의로 복사하지 않고 평가·도입할 수 있는 패키지 경계를
기록한다. `@apc/graph-view`를 제외한 패키지는 현재 `0.0.0` workspace package이므로,
외부 소비 전에는 버전·배포 방식과 contract test를 먼저 정해야 한다.

| 자산 | 정본 경로 | 재사용 계약 |
|---|---|---|
| `@apc/graph-view` | `packages/graph-view/src/index.ts`, `packages/graph-view/src/README.md` | `GraphData {nodes, links}`와 `onNodeClick(GraphNode)`를 입력으로 받는 React 18+Cytoscape 모듈이다. 미지 타입은 fallback style로 렌더하고, 소비자는 문서의 CSS class와 `.cy-canvas` 높이를 제공해야 한다. |
| `@apc/agents` | `packages/agents/src/index.ts` | Claude·Codex·OpenCode source discovery, session parse/resume, redaction API를 내보낸다. 입력 source가 없거나 손상되면 adapter의 명시적 실패를 보존하고 raw 세션·비밀값을 그대로 전달하지 않는다. |
| `@apc/knowledge-harness` | `packages/knowledge-harness/src/index.ts` | source ledger·domain pack·driver를 받아 run state, staging artifact, 검증·평가 결과를 만든다. lock, policy guard, evidence/link/graph validator를 우회한 promote는 계약 밖이다. |
| `@apc/wiki-substrate` | `packages/wiki-substrate/src/index.ts` | TypeScript 서비스가 Python wiki kernel과 통신하는 `WikiSubstrate`/`PythonKernelAdapter` 및 graph adapter 경계다. subprocess·lint 실패를 성공으로 변환하지 않는다. |
| `@apc/shared` | `packages/shared/src/index.ts`, `packages/shared/src/schema.ts` | 프로젝트·세션·task·wiki run·knowledge·검색·file reference의 Zod schema와 타입 단일 소스다. 소비자는 parsing을 건너뛰어 외부 입력을 신뢰하지 않는다. |

## 현재 통합 상태

- `@apc/graph-view`는 host 내부 import가 없는 추출 가능 모듈이며 `apps/graph-web`과
  `apps/desktop`이 실제 소비한다.
- `@apc/agents`, `@apc/knowledge-harness`, `@apc/wiki-substrate`, `@apc/shared`는
  `packages/app-services`와 데스크톱 패키지들이 소비하는 workspace 내부 계약이다.
- 외부 프로젝트는 소스 폴더를 복사하지 말고 workspace dependency, 별도 package,
  또는 API/CLI adapter 중 하나를 선택하고 해당 package 테스트를 contract gate로 둔다.
- 로컬 DB, 세션 로그, 생성 wiki와 run artifact는 reusable source asset이 아니다.
