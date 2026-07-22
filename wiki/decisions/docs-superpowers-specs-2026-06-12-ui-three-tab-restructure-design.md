---
title: 화면 전면 재구성 — Home / Knowledge / Wiki Gen 3-탭 — 설계
slug: docs-superpowers-specs-2026-06-12-ui-three-tab-restructure-design
sources: [docs/superpowers/specs/2026-06-12-ui-three-tab-restructure-design.md]
status: accepted
date: 2026-06-12
topic: [desktop-experience]
---

## Context

중앙 탭 7, Runs 레일, Agent Config 패널, 툴바 4버튼)이 몰려 조잡하고, "Runs"가 뭔지, Run harness/전 문서로 위키 생성/Resume이 뭐가 다른지 읽히지 않는다. 그래프 노드를 클릭해도 vault 문서는 열리지 않는다(run 아티팩트에만 매칭). 솔루션의 본래 목적 — 여러 프로젝트를 병행하며 md를 빠르게 파악해 에이전트에게 일을 잘 시키는 것 — 에 1. 상단 탭 3개(Home / Knowledge / Wiki Gen)로 "지금 뭘 하러 왔는지"와 화면이 1:1. 2. 평소 화면(Home·Knowledge)에서 생성·설정 UI가 보이지 않는다. 3. 그래프·트리·변경분 어디서든 md를 클릭하면 실제 파일 내용이 열린다 . 4. 에이전트 작업으로 생긴 새 문서를 "보고 → 바로 Ingest"하는 동선. 5. 컨트롤 다이어트: hero 버튼 3 → 1, 중앙 탭 7 → (Knowledge 2모드 + Wiki Gen 검수 서브탭 5), 상시 3컬럼 → 필요 시 슬라이드 패널. ( docs/handoffs/2026-06-12-config-collapse-node-doc-canonical-toolbar.md §3). ┌──────┬───────────────────────────────────────────────

## Decision

- **0. 브레인스토밍에서 확정된 결정**
- **1. 목표 / 비목표** — 1. 상단 탭 3개(Home / Knowledge / Wiki Gen)로 "지금 뭘 하러 왔는지"와 화면이 1:1. 2. 평소 화면(Home·Knowledge)에서 생성·설정 UI가 보이지 않는다. 3. 그래프·트리·변경분 어디서든 md를 클릭하면 실제 파일 내용이 열린다 . 4. 에이전트 작업으로 생긴 새 문서를 "보고 → 바로 Ingest"하는 동선. 5. 컨트롤 다이어트: hero 버튼 3 → 1, 중앙 탭 7 → (Knowledge 2모드 + Wiki Gen 검수 서브탭 5), 상시 3컬럼 → 필요 시 슬라이드 패널. ( docs/handoffs/2026-06
- **2. 전체 셸** — ⋯ 오버플로우 메뉴(안에 ⭳ Update ). 기존 toolbarActions의 Ingest/Generate는 각 탭의 컨텍스트 위치로 이동(§3, §5). 에이전트별 상태 dot). attention(노랑) 상태 dot은 깜빡임. 접힘 상태는 localStorage('apc:dockCollapsed') . Shift+1/2/3은 접혀 있으면 자동으로 펼치며 해당 에이전트 포커스. 터미널 프로세스(xterm 세션)는 접어도 살아 있어야 함 — unmount가 아니라 높이 0 처리(키 유지).
- **3. 🏠 Home 탭** — 레이아웃: 좌(1.4) 문서 뷰어 / 우(1) 변경분 피드, 하단 PM strip. 생성" empty state). 헤더: 파일명 + 마지막 갱신 상대시각 + ✨ 갱신 제안 버튼. generateModalOpen 블록을 Home으로 이관). Promote 흐름(handlePromote) 유지. ↩ current.md + 경로 + (미반영 md면) Ingest now 로 바뀜. md는 렌더( fs:readDoc ), 코드 파일은 git diff 미리보기( changes:diff 로 patch 조회 → 기존 DiffViewer 재사용), 삭제 파일은 안내문. 상대시각(m
- **4. 📖 Knowledge 탭 (읽기 전용)** — 세그먼트 컨트롤 [문서 그래프] 두 모드. 생성·run 선택 UI 없음. MarkdownViewer가 쓰던 소스), 프로젝트 문서 — fs:listDocs IPC(§7)가 돌려주는 repoPath 하위 md 목록. 문서 열기(기존 handleOpenWikiLink 확장: 아티팩트 매칭 실패 시 fs:readDoc 폴백). 없으므로 "가장 최근 완료 run"을 자동 선택). 기존 handleNodeClick 아티팩트 매칭 → 실패 시 노드의 data.path 로 fs:readDoc (디스크 직접 읽기) → 그래도 없으면 peek에 "원문 없음: " 표시.
- **5. ⚙ Wiki Gen 탭 (생성·검수 전용)** — 레이아웃: 좌(0.6) 실행 이력 레일 / 우(1.8) run 상세. hero 헤더 없음. 완료) + 모드·상대시각. ↻ 이어하기 (기존 Resume)는 중단/실패 run 카드에만 표시. (기존 CoverageMatrix/QualityPanel/ProposalsPanel/TaskFlowView 이동. 요약 = 생성 문서 수·커버리지·품질 한 줄 + run 메타). ⚠ 검증 무시 — 기존 HarnessDashboard canonical 블록과 AgentConfigPanel의 Promote/Force/Refresh 버튼을 여기로 통합. conversation-histor
- **6. 기존 → 신규 매핑 요약**
- **7. 신규 IPC (main 프로세스 — 이번 작업의 백엔드 전부)** — 1. changes:list { projectId } → { files: { path, status: 'new' 'modified' 'deleted', isMarkdown, mtimeMs, unreflected }[] } md이고 mtime 마지막 ingest 시각. git 저장소가 아니면 { ok:false, reason } . 2. changes:diff { projectId, relPath } → { ok, patch?, reason? } patch 텍스트 반환. Home에서 코드 파일 클릭 시에만 호출. 3. fs:readDoc { projectId, relP

## Consequences

- Consequences and validation details remain traceable to the source document.

## Related

- Source: `docs/superpowers/specs/2026-06-12-ui-three-tab-restructure-design.md`
