---
title: 핸드오프 — config 패널 접기 · 노드클릭→문서 · canonical 강제 promote · 툴바 한줄 회수
slug: docs-handoffs-2026-06-12-config-collapse-node-doc-canonical-toolbar
sources: [docs/handoffs/2026-06-12-config-collapse-node-doc-canonical-toolbar.md]
topic: [project-architecture]
---

## Summary

직전 2026-06-11-harness-dashboard-ux-runs-promote-agentpanel.md 의 후속(거기서 적은 후속 1 = canonical force 완료). 오른쪽 Agent Configuration 패널을 접이식 레일 로(항상 안 떠 있어도 됨), 그래프 노드 클릭 시 그 문서가 실제로 뜨도록 매칭 견고화, canonical 프로모트에도 강제 override 이식, 상단 툴바를 탭 줄로 합쳐 한 행 회수 . 실행중(초록·깜빡)·Promote차단(노랑) 표시 dot), 펼치면 헤더에 ▸ 접기 버튼. config-collapsed (3번째 컬럼 44px), Runs와 동시 접힘은 .--runs-collapsed.--config-collapsed (두 클래스 = 더 높은 specificity)로 52px 1fr 44px . 둘 다 접으면 가운데(Markdown/Graph)가 최대폭. 보여주는데( selectedArtifactPath 가 그 중 하나와 일치해야 렌더), 기존 handleNodeClick 은 data.path 정확일치 / id-target만 봐서 file·wiki 노드가 거의 매칭 안 됨. data.path 정확일치 → endsWith → basename 일치 → artifactMatchesTarget(id) →

## Content map

- **0. 한 줄 요약** — 오른쪽 Agent Configuration 패널을 접이식 레일 로(항상 안 떠 있어도 됨), 그래프 노드 클릭 시 그 문서가 실제로 뜨도록 매칭 견고화, canonical 프로모트에도 강제 override 이식, 상단 툴바를 탭 줄로 합쳐 한 행 회수 .
- **1. 변경 내용**
- **1.1 Agent Configuration 패널 접기 (Runs 레일과 동일 패턴)** — 실행중(초록·깜빡)·Promote차단(노랑) 표시 dot), 펼치면 헤더에 ▸ 접기 버튼. config-collapsed (3번째 컬럼 44px), Runs와 동시 접힘은 .--runs-collapsed.--config-collapsed (두 클래스 = 더 높은 specificity)로 52px 1fr 44px . 둘 다 접으면 가운데(Markdown/Graph)가 최대폭.
- **1.2 그래프 노드 클릭 → 문서 표시 (견고화)** — 보여주는데( selectedArtifactPath 가 그 중 하나와 일치해야 렌더), 기존 handleNodeClick 은 data.path 정확일치 / id-target만 봐서 file·wiki 노드가 거의 매칭 안 됨. data.path 정확일치 → endsWith → basename 일치 → artifactMatchesTarget(id) → label/파일stem 일치 순으로 찾고, 없으면 전체 아티팩트로 폴백. 찾으면 setSelectedArtifactPath + setTab('markdown') .
- **1.3 canonical 프로모트 강제 override** — 게이트)이고 override 가능 사유면 어떤 제안이 막혔는지 ( harnessCanonicalBlock ) 저장 → 그 제안 항목에만
- **1.4 툴바를 탭 줄로 합쳐 한 행 회수** — 미선택 시에만 placeholder 위 헤더로 표시. 고정 위치였던 ⭳Update 가 🔎Search 를 가리던 겹침 발견 → Update도 toolbarActions 에 인라인으로 합쳐 한 줄(Ingest/Generate/Search/Update) 정렬.
- **2. 동작/구현 메모** — 이번에도 검증 때마다 kill+relaunch 했음. 문서) 여전히 아무 일도 안 함 — 현재 데이터 한계. cross-run/vault 원문 연결은 별개 작업.
- **3. 보류된 요청 — 그래프 날짜 필터** — 사용자가 "search 옆 날짜 필터로 날짜별 추가분 보기"를 요청했다가 방향을 틀어 보류 . 보류 이유를 명확히 남김 buildHarnessGraphData 는 선택한 단일 run 하나로 그래프를 만들고 노드에 날짜 필드가 없다 (가진 건 run.history[].at 진행 타임스탬프뿐, 보통 같은 날). 의미 있는 "날짜별 추가"를 보려면 모든 run을 누적 한 그래프(각 노드에 최초 추가 run 날짜 태깅)가 필요 — 그래프를 per-run에서 누적 뷰로 바꾸는 별도 작업. 다음 후보.

## Related

- Source: `docs/handoffs/2026-06-12-config-collapse-node-doc-canonical-toolbar.md`
