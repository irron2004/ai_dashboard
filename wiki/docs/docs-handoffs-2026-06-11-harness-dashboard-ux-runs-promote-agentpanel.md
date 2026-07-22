---
title: "핸드오프 — 하니스 대시보드 UX: 노드클릭·Runs레일·강제promote·슬림헤더·Agent패널 재설계"
slug: docs-handoffs-2026-06-11-harness-dashboard-ux-runs-promote-agentpanel
sources: [docs/handoffs/2026-06-11-harness-dashboard-ux-runs-promote-agentpanel.md]
topic: [wiki-and-knowledge-harness]
---

## Summary

IPC/main/네이티브 불변, 전부 렌더러(컴포넌트 + store + CSS). 직전 핸드오프 2026-06-11-ui-sidebar-rail-wiki-stepper.md 의 후속. 위키 생성(하니스) 화면을 더 직관적으로: 그래프 노드 클릭 → 문서 표시 , Runs 패널 접이식 레일 , Promote가 graph 검증에 막힐 때 강제 override , 상단 헤더 슬림화 , 그리고 오른쪽 Agent Configuration 패널을 ①실행/②안전/③미구현 3그룹으로 재편 + 파이프라인 agent 라이브 펄스 . setTab('markdown') 까지 호출. 기존엔 Graph 탭에 머물러 문서가 안 보였음. run 상태 dot[ stateTone 색] + 하단 + start), 펼치면 기존 카드 리스트(헤더에 ◂ ). harness-dashboard grid--runs-collapsed → 첫 컬럼 minmax(250,300) → 52px . (사이드바 레일과 동일 패턴.) 아직 없는 페이지로 [[링크]] )에 걸려 HarnessPromoteService.gate() 가 promotion을 막음. 메시지: graph integrity validation failed; promotion blocked (pass allowInvalid to ove

## Content map

- **0. 한 줄 요약** — 위키 생성(하니스) 화면을 더 직관적으로: 그래프 노드 클릭 → 문서 표시 , Runs 패널 접이식 레일 ,
- **1. 변경 내용**
- **1.1 그래프 노드 클릭 → 문서 표시**
- **1.2 Runs/Timeline 접이식 레일** — run 상태 dot[ stateTone 색] + 하단 + start), 펼치면 기존 카드 리스트(헤더에 ◂ ). harness-dashboard grid--runs-collapsed → 첫 컬럼 minmax(250,300) → 52px . (사이드바 레일과 동일 패턴.)
- **1.3 Promote 강제 override (graph integrity 차단 해제)** — 아직 없는 페이지로 [[링크]] )에 걸려 HarnessPromoteService.gate() 가 promotion을 막음. 메시지: graph integrity validation failed; promotion blocked (pass allowInvalid to override) . 실패 사유가 /pass allowInvalid to override/i 면 harnessPromoteBlockedReason 에 저장(단, 이미 force였으면 null → 루프 방지). canonical 프로모트( promoteCanonicalDoc )는 같은 게이트를 타지만 아직
- **1.4 상단 헤더(툴바) 슬림화** — .app-layout toolbar button { padding:5px 12px; font-size:.82rem } . 앱 셸 gap/padding 14 → 10px .
- **1.5 Agent Configuration 패널 재설계 (가장 큰 변경)** — 22개 평면 카드 → 그룹·색·접기로 "지금 진짜 작동하는 것"만 부각. KhState 에 매핑(projectDiscovery→PROJECT SCANNED, … policyGuard→VALIDATED). running (=harnessLoading) 중 라이브 배지(깜빡임). HarnessDashboard 가 running={harnessLoading} activeState={harnessProgress} 전달.
- **2. 동작/구현 메모 (다음 사람이 헷갈릴 지점)** — 못 받는다 → dev 서버가 편집 전 번들을 계속 서빙 . 렌더러 변경을 실물로 보려면 pnpm --filter @apc/desktop dev 를 재시작 해야 함(HMR/ Page.reload 로는 반영 안 됨). 이번에 이걸로 두 번 헛돌았음. 최종 state라 모든 agent가 done으로 떠 false-active가 거의 없음(최초 refresh+progress=null만 예외). 전용 generating 플래그를 두면 더 깔끔(후속). 근본 해결(생성기가 유효 그래프를 내게)은 별개의 더 큰 작업.

## Related

- Source: `docs/handoffs/2026-06-11-harness-dashboard-ux-runs-promote-agentpanel.md`
