# Agent QA 표면 설계 — fixture 브라우저 QA와 Electron 통합 스모크

**날짜:** 2026-07-14
**참조:** [UI 사용성 진단](../../handoffs/2026-07-14-ui-usability-diagnosis.md) · 아키텍처 다이어그램 [apc-web-bridge-architecture.svg](../../mockups/2026-07-14-apc-web-bridge-architecture.svg)
**상태:** 방향 확정 — Track 1A/1B가 QA 필수 경로, 원격 웹은 별도 제품 트랙

---

## 1. 문제

에이전트(Claude Code, dock의 claude/codex/opencode)는 Electron 네이티브 창을 일반 브라우저처럼 직접 탐색하기 어렵다.
정적 타입 검사와 컴포넌트 테스트만으로는 실제 CSS 조합에서 생기는 줄바꿈, 압축, 겹침, viewport overflow를 놓친다.

2026-07-14 UI 검증에서도 전체 테스트와 typecheck가 통과한 뒤 다음 두 결함이 렌더된 화면에서 발견됐다.

- `▶ 위키 생성` 버튼이 좁은 flex 컬럼에서 여러 줄로 압축됨
- 런 카드의 `오후 9:25`와 `0 artifacts`가 구분자 없이 붙어 보임

따라서 QA에는 빠르고 결정적인 브라우저 렌더링 표면과, Electron 고유 연결을 확인하는 작은 통합 표면이 모두 필요하다.

## 2. renderer 경계

`apps/desktop/src/preload/index.ts`가 노출하는 `window.apc`는 다음 16개 함수로 모인다.

| 종류 | 개수 | 내용 |
|---|---:|---|
| `invoke(channel, payload)` | 1 | renderer의 쿼리와 커맨드 |
| fire-and-forget `send` | 7 | PTY 4종, pane open/close, project select |
| 이벤트 구독 `on*` | 8 | PTY, harness, dev harness, workspace restore 이벤트 |

React renderer와 `app.css`는 그대로 두고 이 경계의 구현만 교체하면 Chromium에서도 같은 UI를 렌더할 수 있다.
다만 main 프로세스에는 `handlers()` 밖의 폴더 선택, SSH 테스트, 업데이트·재시작, PTY와 workspace 이벤트가 있으므로
이 경계를 곧바로 범용 HTTP 프록시로 간주하지 않는다.

## 3. 결정

QA 실행 순서는 다음과 같다.

1. **Track 1A — FixtureBridge 기반 Chromium 시각·레이아웃 QA**
2. **Track 1B — Windows Electron 통합 스모크**
3. **Track 2 — 기존 `status-web`을 확장하는 읽기 전용 원격 제품**

fixture는 실제 IPC를 흉내 내기 위한 임시 대체물이 아니라, 재현하기 어려운 UI 상태를 버전 관리하는 QA 계약이다.
Electron 스모크는 preload와 실제 IPC 연결을 보완하지만 fixture 시나리오를 대체하지 않는다.

## 4. Track 1A — fixture 기반 브라우저 시각 QA

### 목적

실제 renderer와 실제 `app.css`를 Chromium에서 빠르고 결정적으로 검증한다. DB, PTY, 네트워크, 로컬 사용자 데이터에
의존하지 않으므로 에이전트와 CI가 같은 상태를 반복 재현할 수 있다.

### 구조

```text
Renderer (React + Vite + app.css)
└─ ApcBridge
   └─ FixtureBridge
      └─ 버전 관리되는 시나리오 데이터
         └─ Playwright Chromium
```

- renderer 부팅 전에 `FixtureBridge`를 `window.apc`에 설치한다.
- URL의 `fixture` 값이 invoke 응답, 이벤트 스트림, workspace restore, harness run localStorage를 선택한다.
- fixture 빌드는 명시적인 Vite 환경에서만 활성화하며 Electron production 경로에는 설치하지 않는다.
- 알 수 없는 채널 호출은 조용히 성공시키지 않고 실패시켜 fixture 계약 누락을 드러낸다.

### 고정 시나리오

최소 다음 상태를 독립 시나리오로 유지한다.

| 시나리오 | 고정할 상태 |
|---|---|
| `empty-project` | 프로젝트와 workspace overview가 모두 비어 있음 |
| `many-projects-docs` | 프로젝트 다수, 문서 수백 개, 긴 이름과 내부 스크롤 |
| `wiki-generating` | 실행 중 progress, 긴 engine log, live node 이벤트 |
| `auth-failure-long-path` | HTTP 401 실패와 긴 Windows 로그 경로가 있는 FAILED run |
| `many-changes` | 변경 파일 20개 이상과 긴 파일 경로 |
| `large-graph` | 노드·엣지가 많은 wiki graph |
| `long-korean-narrow` | 긴 한글 레이블과 좁은 viewport |

실데이터는 탐색적 QA에 사용할 수 있지만 위 시나리오의 회귀 계약을 대체하지 않는다.

### 검증 계약

스크린샷 저장만 하지 않고 DOM과 레이아웃을 우선 검증한다.

- 앱 루트의 `scrollWidth <= clientWidth`, `scrollHeight <= clientHeight`
- 주요 action 그룹의 인접 버튼 bounding box가 겹치지 않음
- `▶ 위키 생성` 버튼 높이가 한 줄 버튼 범위이고 `white-space: nowrap`
- 실패 run footer가 `오후 9:25 · 0 artifacts`를 포함
- 대량 변경 파일 수, 대량 문서 수, graph 노드 수가 fixture 계약과 일치
- 각 탭이 실제 content를 렌더하며 브라우저 콘솔에 처리되지 않은 오류가 없음

`toHaveScreenshot()`은 핵심 컴포넌트에만 제한 적용한다. 픽셀 결과는 OS, 폰트, GPU 설정에 민감하므로
golden 생성과 비교는 같은 Windows 기준 환경에서 수행한다. Playwright도 baseline과 실행 환경을 동일하게 유지할 것을
권고한다: [Visual comparisons](https://playwright.dev/docs/test-snapshots).

## 5. Track 1B — Windows Electron 통합 스모크

### 목적

브라우저 fixture가 검사할 수 없는 앱 조립 경계를 작게 확인한다. Playwright의 Electron 지원으로 앱을 실행하고 첫 창을
조작한다: [Playwright Electron API](https://playwright.dev/docs/api/class-electron).

### 범위

- production build 산출물로 앱 부팅
- preload가 `window.apc` 16개 함수를 노출
- 실제 main/preload IPC로 빈 프로젝트 목록 조회
- 5개 주 탭 이동
- `Ctrl+Shift+D` 단축키와 변경사항 dialog
- 앱 종료 시 테스트 프로세스와 임시 데이터가 정리됨

전체 화면 픽셀 비교, 대량 데이터, 복잡한 graph, 실패 상태 조합은 Track 1A에서 담당한다.

### 사용자 데이터 격리

`--user-data-dir` 인자에 의존하지 않는다. 테스트가 만든 존재하는 임시 디렉터리를
`APC_E2E_USER_DATA_DIR`로 전달하고, main 진입 직후 `ready` 전에 다음을 적용한다.

```ts
app.setPath('userData', process.env.APC_E2E_USER_DATA_DIR)
```

Electron은 `setPath` 대상 디렉터리가 미리 존재해야 한다고 명시한다. 테스트와 앱 양쪽에서 이를 보장한다:
[Electron app.setPath](https://www.electronjs.org/docs/latest/api/app#appsetpathname-path).

PTY native ABI 때문에 이 스모크의 기준 실행 환경은 Windows x64다. 테스트는 터미널 프로세스를 실제로 실행하거나
장시간 세션을 검증하지 않는다.

## 6. Track 2 — 읽기 전용 원격 대시보드 제품

원격 웹은 QA 필수 경로와 분리한다. 신규 범용 `POST /ipc/:channel` 프록시보다 이미 존재하는 다음 기반을 확장한다.

- `packages/status-web/src/server.ts`: 토큰 인증과 읽기 전용 HTTP API
- `packages/status-web/src/read-only-db.ts`: desktop SQLite의 read-only 연결과 busy timeout

제품 확장 시에도 채널 이름을 그대로 외부에 노출하지 않고 명시적인 읽기 전용 API allowlist를 둔다. git push, 파일 변경,
정책 승인, 앱 업데이트 같은 쓰기 기능은 원격 surface에 포함하지 않는다. WebSocket이 필요해지면 쿠키 또는 안전한
subprotocol 인증, `Origin` 검증, loopback 기본 bind를 함께 설계한다. 브라우저에서 임의 `Authorization` 헤더를
WebSocket handshake에 붙일 수 있다고 가정하지 않는다.

## 7. 비범위

- 모든 화면의 pixel diff와 OS 간 공용 golden
- fixture에서 실제 PTY 또는 native dialog 실행
- 범용 IPC-over-HTTP/WS 프록시
- `status-web`의 쓰기 API, 인터넷 직접 노출, 멀티유저 권한 모델
- Electron 스모크에서 DB 전체 기능과 위키 파이프라인 재검증

## 8. 실행 순서와 완료 판정

| 순서 | 작업 | 완료 판정 |
|---:|---|---|
| 1 | Track 1A FixtureBridge와 고정 시나리오 | Chromium에서 7개 상태를 독립 재현 |
| 2 | 레이아웃 계약과 핵심 Windows snapshot | overflow·겹침·nowrap·B2 계약이 자동 검증됨 |
| 3 | `APC_E2E_USER_DATA_DIR` 격리 | 테스트 DB가 임시 경로에만 생성됨 |
| 4 | Track 1B Electron 스모크 | Windows에서 부팅·preload·탭·단축키·IPC가 통과 |
| 5 | 후속 CI 편입 | fixture QA는 일반 check, pixel/Electron은 Windows check에서 실행 |
| 6 | 별도 제품 계획 | `status-web` 읽기 전용 API를 필요한 화면 단위로 확장 |

일상 에이전트 루프는 다음처럼 단순하게 유지한다.

```text
UI 코드 수정 → fixture Chromium QA → DOM/레이아웃 실패와 핵심 snapshot 확인
             → Windows Electron 스모크 → typecheck/test/build
```

실행 명령은 다음과 같다.

```bash
pnpm qa:fixture         # 7개 fixture 계약 + 현재 Windows golden 비교
pnpm qa:fixture:update  # 의도한 UI 변경 뒤 Windows에서 golden 갱신·검토
pnpm qa:electron        # production build + Windows Electron 통합 스모크
pnpm qa                 # Track 1A와 Track 1B 순차 실행
```
