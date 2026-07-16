---
title: 3-탭 UI 재구성 (Home / Knowledge / Wiki Gen) Implementation Plan
slug: docs-superpowers-plans-2026-06-12-ui-three-tab-restructure
sources: [docs/superpowers/plans/2026-06-12-ui-three-tab-restructure.md]
status: open
created: 2026-06-12
topic: [desktop-experience]
---

## Summary

For agentic workers: REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox ( - [ ] ) syntax for tracking. Goal: 데스크톱 앱 화면을 3개 상단 탭(Home=current.md+git 변경분, Knowledge=문서/그래프 읽기 전용, Wiki Gen=생성·검수)으로 재구성하고, 접이식 터미널 독·노드 클릭→실제 md 열기·"보고 바로 Ingest" 동선을 구현한다. Architecture: 렌더러 재배치가 중심. main 프로세스에는 읽기 전용 IPC 4개( changes:list , changes:diff , fs:readDoc , fs:listDocs )만 추가하고 파이프라인 로직은 불변. 기존 컴포넌트(WikiProgress, CoverageMatrix, QualityPanel, ProposalsPanel, TaskFlowView, DiffViewer, PmHome, MarkdownViewer 렌더부)를 새 탭 컴포넌트(HomeView/KnowledgeView

## Progress log

- Source checklist: 0 completed, 98 remaining.
- **실행 환경 (모든 태스크 공통 — 먼저 읽을 것)** — 이 레포는 /mnt/c (Windows FS)를 WSL에서 빌드한다. 모든 셸 명령 앞에 PATH 설정 필수
- **파일 구조 (전체 조감)** — 각 Phase 끝에는 항상 앱이 동작한다: P1(셸만 교체, 기존 화면 그대로 매달림) → P2(Wiki Gen 분리) → P3(Knowledge 교체) → P4(Home 신설) → P5(구 컴포넌트 제거).
- **Phase 1 — 셸: 3탭 + 글로벌 메뉴 + 접이식 터미널 독**
- **Task 1: MainPanel을 3탭으로 교체** — Expected: FAIL — tab="home" 이 MainTab 타입에 없음 / 'Wiki Gen' 버튼 없음. 그리고 MainPanel 에 넘기는 onTab 을 persist하도록 교체 (App.tsx의 부분) 주의: wikiGenRunning 은 reactive해야 하므로 실제로는 App 상단의 useStore 구조분해에 harnessLoading 을 추가하고 wikiGenRunning={harnessLoading} 으로 쓸 것 Expected: PASS / clean.
- **Task 2: 글로벌 ⋯ 메뉴 (Update 이동) + 툴바 정리** — 주의: Ingest now / ✨ Generate 버튼은 이 태스크에서 지우지 않는다. Home 탭이 생기는 Phase 4 전까지는 탭 줄에 임시로 남겨야 기능 공백이 없다. Expected: FAIL — 모듈 없음.
- **Task 3: 접이식 터미널 독** — 터미널 프로세스는 main의 pty라 렌더러에서 접어도 살아 있다. AgentTerminal을 unmount하지 말고 컨테이너를 display:none 으로만 숨긴다(키 유지 → 세션 유지). 펼칠 때 xterm fit을 위해 window.dispatchEvent(new Event('resize')) 를 쏜다. app.css 의 .app-layout 에서 grid-template-rows: minmax(0, 1fr) 280px; → (이 useEffect의 deps에 toggleDock 은 안정 함수가 아니므로, 핸들러 안에서 직접 setDockCollapsed +
- **Phase 2 — Wiki Gen 탭 (생성·검수 분리)**
- **Task 4: harness-utils — run mode·resumable·stage 매핑 헬퍼** — Expected: FAIL — export 없음.

## Related

- Source: `docs/superpowers/plans/2026-06-12-ui-three-tab-restructure.md`
