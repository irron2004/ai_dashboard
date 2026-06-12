# 핸드오프 — config 패널 접기 · 노드클릭→문서 · canonical 강제 promote · 툴바 한줄 회수

- **Date**: 2026-06-12
- **Branch**: `main` (커밋·push 완료)
- **성격**: 하니스 대시보드 UX 4건. 전부 렌더러(컴포넌트 + store + CSS), main/IPC/네이티브 불변.
  직전 `2026-06-11-harness-dashboard-ux-runs-promote-agentpanel.md`의 후속(거기서 적은 후속 #1 = canonical force 완료).

## 0. 한 줄 요약

오른쪽 **Agent Configuration 패널을 접이식 레일**로(항상 안 떠 있어도 됨), **그래프 노드 클릭 시 그 문서가
실제로 뜨도록** 매칭 견고화, **canonical 프로모트에도 강제 override** 이식, 상단 **툴바를 탭 줄로 합쳐 한 행 회수**.

## 1. 변경 내용

### 1.1 Agent Configuration 패널 접기 (Runs 레일과 동일 패턴)
- `AgentConfigPanel`에 `collapsed`/`onToggleCollapse`. 접으면 **44px 레일**(◂ 펼침 + 세로 `CONFIG` 라벨 +
  실행중(초록·깜빡)·Promote차단(노랑) 표시 dot), 펼치면 헤더에 ▸ 접기 버튼.
- `HarnessDashboard`: `configCollapsed` + `localStorage('apc:configCollapsed')`. 그리드에
  `--config-collapsed`(3번째 컬럼 44px), Runs와 동시 접힘은 `.--runs-collapsed.--config-collapsed`
  (두 클래스 = 더 높은 specificity)로 `52px 1fr 44px`. 둘 다 접으면 가운데(Markdown/Graph)가 최대폭.

### 1.2 그래프 노드 클릭 → 문서 표시 (견고화)
- 증상: 클릭해도 아무 문서도 안 떴음. 원인 — MarkdownViewer는 **markdown/report 아티팩트만** 탭으로
  보여주는데(`selectedArtifactPath`가 그 중 하나와 일치해야 렌더), 기존 `handleNodeClick`은 `data.path`
  정확일치 / id-target만 봐서 file·wiki 노드가 거의 매칭 안 됨.
- 수정(`HarnessDashboard.handleNodeClick`): **viewable(markdown/report) 아티팩트를 우선**으로,
  `data.path` 정확일치 → `endsWith` → basename 일치 → `artifactMatchesTarget(id)` → label/파일stem 일치
  순으로 찾고, 없으면 전체 아티팩트로 폴백. 찾으면 `setSelectedArtifactPath` + `setTab('markdown')`.
- 실측: 62노드 중 클릭 → Markdown 탭 전환 + "Git Diff Report" 표시 확인.

### 1.3 canonical 프로모트 강제 override
- `store.promoteCanonicalDoc(proposalRelPath, lastReadHash, allowInvalid?)`. 차단(같은 graph-integrity
  게이트)이고 override 가능 사유면 **어떤 제안이 막혔는지**(`harnessCanonicalBlock`) 저장 → 그 제안 항목에만
  **"⚠ 검증 무시하고 promote"** 버튼(`HarnessDashboard` canonical 리스트). run 시작/선택/refresh/hydrate에서 정리.
- `allowInvalid`는 IPC/api/service에 이미 배선돼 있어 렌더러만 연결. 시크릿 차단은 유지.

### 1.4 툴바를 탭 줄로 합쳐 한 행 회수
- `MainPanel`에 `actions?: ReactNode` 슬롯 → 탭 줄 우측(`main-panel__tab-actions`)에 렌더.
- `App`: 프로젝트 열렸을 땐 전용 `app-layout__toolbar` 행 없이 `MainPanel actions={toolbarActions}`로 흘리고,
  미선택 시에만 placeholder 위 헤더로 표시. **고정 위치였던 `⭳Update`가 `🔎Search`를 가리던 겹침** 발견 →
  Update도 `toolbarActions`에 인라인으로 합쳐 한 줄(Ingest/Generate/Search/Update) 정렬.

## 2. 동작/구현 메모

- **`/mnt/c` HMR 미동작(반복)**: vite 워처가 WSL 편집을 못 잡음 → 렌더러 변경 확인하려면 `pnpm dev` **재시작**.
  이번에도 검증 때마다 kill+relaunch 했음.
- **노드→문서는 "그 run의 아티팩트"에만 매핑**된다. 클릭한 노드의 문서가 run 아티팩트에 없으면(예: 외부 vault
  문서) 여전히 아무 일도 안 함 — 현재 데이터 한계. cross-run/vault 원문 연결은 별개 작업.
- config 레일의 warn dot은 패널을 접어도 **Promote가 막혀 있음을 알려주는 힌트** — 펼쳐서 force 버튼 사용.

## 3. 보류된 요청 — 그래프 날짜 필터

사용자가 "search 옆 날짜 필터로 날짜별 추가분 보기"를 요청했다가 방향을 틀어 **보류**. 보류 이유를 명확히 남김:
`buildHarnessGraphData`는 **선택한 단일 run** 하나로 그래프를 만들고 노드에 **날짜 필드가 없다**(가진 건
`run.history[].at` 진행 타임스탬프뿐, 보통 같은 날). 의미 있는 "날짜별 추가"를 보려면 **모든 run을 누적**한
그래프(각 노드에 최초 추가 run 날짜 태깅)가 필요 — 그래프를 per-run에서 누적 뷰로 바꾸는 별도 작업. 다음 후보.

## 4. 검증

- `pnpm run typecheck` 클린, 데스크톱 **20파일/85테스트 green**.
- 실물 Electron(CDP): 노드클릭→Markdown 전환+문서표시 / config 레일(CONFIG) + Runs 동시 접힘으로
  가운데 최대폭 / 한 줄 툴바(4버튼 겹침 해소) 확인. (canonical force는 이 run에 제안 0개라 라이브 캡처 생략 —
  main promote와 동일 경로.)

## 5. 핵심 파일

```
apps/desktop/src/renderer/components/HarnessDashboard.tsx   # node→doc 매칭, config/runs 접힘 상태, canonical force 버튼
apps/desktop/src/renderer/components/AgentConfigPanel.tsx   # collapsed 레일 + 헤더 접기 버튼
apps/desktop/src/renderer/components/MainPanel.tsx          # actions 슬롯(탭 줄)
apps/desktop/src/renderer/App.tsx                           # toolbarActions 탭 줄 이동 + Update 인라인
apps/desktop/src/renderer/store.ts                          # promoteCanonicalDoc(allowInvalid) + harnessCanonicalBlock
apps/desktop/src/renderer/app.css                           # config 레일/그리드 + 탭 액션 + canonical force
```
