---
title: 대화 히스토리 탭 승격 설계 — 모달에서 프로젝트 전용 화면으로
slug: docs-superpowers-specs-2026-07-15-conversation-history-tab-design
sources: [docs/superpowers/specs/2026-07-15-conversation-history-tab-design.md]
status: accepted
date: 2026-07-15
topic: [desktop-experience]
---

## Context

참조: Agent QA 표면 설계 · apps/desktop/src/main/conversation-history.ts (fbfe5b5) 상태: 설계 확정 — Q/A 추출 로직은 현행 유지, 렌더러만 변경 fbfe5b5에서 codex/claude/opencode 세션을 읽어 Q/A로 짝지어 보여주는 QuestionHistory 가 추가됐지만, ResumeBanner의 "질문 히스토리" 버튼으로만 열리는 모달 이다. QuestionHistory 모달을 제거하고 주 화면 탭 💬 히스토리 ( MainTab: 'history' )로 승격한다. Q/A 추출( conversation-history.ts )과 IPC( q:conversationHistory )는 변경하지 않는다 . 분석(LLM 요약·분류)은 하지 않는다 — Q/A 짝짓기 그대로가 이번 범위다. apps/desktop/src/renderer/components/ConversationHistoryView.tsx 추가됨) + 2단 본문 (세션 리스트 Q/A 아코디언). fetchHistory({ projectId, agent, limit: 40 }) , 로딩·오류·빈 상태, truncated/skipped 안내. ( add-project-overlay , dialog 크기 제약)만 벗긴다. 탭 콘

## Decision

- **1. 문제** — fbfe5b5에서 codex/claude/opencode 세션을 읽어 Q/A로 짝지어 보여주는 QuestionHistory 가 추가됐지만, ResumeBanner의 "질문 히스토리" 버튼으로만 열리는 모달 이다. 같은 동선을 담기 어렵다.
- **2. 결정** — QuestionHistory 모달을 제거하고 주 화면 탭 💬 히스토리 ( MainTab: 'history' )로 승격한다. Q/A 추출( conversation-history.ts )과 IPC( q:conversationHistory )는 변경하지 않는다 . 분석(LLM 요약·분류)은 하지 않는다 — Q/A 짝짓기 그대로가 이번 범위다.
- **3. 구성**
- **3.1 ConversationHistoryView (신규, 모달에서 추출)** — apps/desktop/src/renderer/components/ConversationHistoryView.tsx 추가됨) + 2단 본문 (세션 리스트 Q/A 아코디언). fetchHistory({ projectId, agent, limit: 40 }) , 로딩·오류·빈 상태, truncated/skipped 안내. ( add-project-overlay , dialog 크기 제약)만 벗긴다. 탭 콘텐츠 영역 전체를 쓴다. Props
- **3.2 포커스 주입 — 검색 대비의 핵심 이음새** — handleMainTab('history') . 세션 목록에 없으면 무시하고 기본 선택(첫 세션)으로 동작한다.
- **3.3 MainPanel 탭 추가**
- **3.4 모달 제거**
- **4. 데이터 흐름 (변경 없음 확인)** — ConversationHistoryReq 는 객체형이라 향후 query?: string , sessionIds?: string[] 추가가 기존 호출부를 깨지 않는다. 이번 변경에서 IPC 4곳 배선은 건드리지 않는다.

## Consequences

- Consequences and validation details remain traceable to the source document.

## Related

- Source: `docs/superpowers/specs/2026-07-15-conversation-history-tab-design.md`
