---
title: "Spec — SP3: 에이전트 헤더 실행 아이콘 (▶ 시작/재시작 · ⏹ 중지)"
slug: docs-superpowers-specs-2026-06-30-agent-launch-icon-design
sources: [docs/superpowers/specs/2026-06-30-agent-launch-icon-design.md]
status: accepted
date: 2026-06-30
topic: [desktop-experience]
---

## Context

상태: 설계(spec). 승인 후 writing-plans로 분기. 상위 맥락: 사용자의 ai dashboard 니즈 — ① 프로젝트 빠른 전환 ② 이전 요청+남은 작업 시각화(작업↔위키 그래프). 분해된 3개 sub-project 중 SP3(빠른 실행/전환 아이콘) = 가장 작고 독립적인 즉각 개선. (SP1 작업 자동 캡처 · SP2 작업↔위키 그래프 뷰는 후속 spec.) 결정 사항(브레인스토밍): 실행 대상 = 프로젝트 에이전트 세션 · 아이콘 위치 = 에이전트 헤더(접근법 A) · ▶ 기본 동작 = 최신 세션 resume("이어서"). desktop 앱은 이미 프로젝트별 멀티에이전트 터미널 dock을 갖고 있다( apps/desktop/src/renderer/App.tsx ~L346–394): 선택한 프로젝트의 AGENTS (claude/codex/opencode)를 나란히 렌더, 각 패널은 마운트 시 PTY를 spawn/resume, 상태 dot·Shift 단축키 제공. 사용자 불만 = "실행 버튼이 없고, (있어도) 아이콘이 아니다" — 에이전트 헤더가 텍스트( claude )+수동 상태 dot이라, 세션을 명시적으로 시작/재시작/중지 하는 한 클릭 아이콘이 없다. 즉 엔진은 완비돼 있고, 빠진 것은 UX 어포던스(실행 아이콘) 하나

## Decision

- **1. 배경 / 문제** — desktop 앱은 이미 프로젝트별 멀티에이전트 터미널 dock을 갖고 있다( apps/desktop/src/renderer/App.tsx ~L346–394): 선택한 프로젝트의 AGENTS (claude/codex/opencode)를 나란히 렌더, 각 패널은 마운트 시 PTY를 spawn/resume, 상태 dot·Shift 단축키 제공. 사용자 불만 = "실행 버튼이 없고, (있어도) 아이콘이 아니다" — 에이전트 헤더가 텍스트( claude )+수동 상태 dot이라, 세션을 명시적으로 시작/재시작/중지 하는 한 클릭 아이콘이 없다. 즉 엔진은 완비돼 있고, 빠진
- **이미 존재하는 빌딩블록 (신규 구현 불필요)**
- **2. 목표 / 비목표**
- **3. 아키텍처** — 신규 엔진 없음. 데이터 흐름 핵심: ▶는 AgentTerminal의 재spawn 경로를 통과 (nonce), ⏹는 killPty 직접 호출 후 기존 onPtyExit가 상태 정리 (AgentTerminal 변경 최소).
- **4. 컴포넌트 / 파일별 변경** — 새 IPC·새 컴포넌트 없음. 아이콘은 유니코드( ▶ / ⏹ ) 또는 소형 인라인 SVG; 버튼은 aria-label ("에이전트 시작/재시작", "에이전트 중지").
- **5. 동작 규칙 (상태 매핑)** — dot 색은 기존 STATUS COLOR 매핑 유지. ▶은 항상 활성.
- **6. 에러 / 엣지**
- **7. 테스트** — apps/desktop vitest(+ @testing-library). AgentTerminal은 PTY를 IPC로 spawn하므로 api 를 모킹. 1. AgentTerminal 재시작: restartNonce 를 0→1로 리렌더 시 api.startPty 가 같은 id 로 재호출됨(spy). cleanup이 이전 onPtyData 구독 해제 함수를 호출. 2. stopAgent: stopAgent(key) 호출 시 api.killPty({id:key}) 1회 + agentStatus[key]==='idle' . 3. 헤더 렌더/클릭: 에이전트 헤더에 ▶/⏹ 버튼

## Consequences

- Consequences and validation details remain traceable to the source document.

## Related

- Source: `docs/superpowers/specs/2026-06-30-agent-launch-icon-design.md`
