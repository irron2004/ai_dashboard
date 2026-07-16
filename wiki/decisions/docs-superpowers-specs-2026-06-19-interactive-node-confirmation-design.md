---
title: 인터랙티브 노드 확인 (Wiki 생성 중간 확인 단계) — 설계
slug: docs-superpowers-specs-2026-06-19-interactive-node-confirmation-design
sources: [docs/superpowers/specs/2026-06-19-interactive-node-confirmation-design.md]
status: accepted
date: 2026-06-19
topic: [wiki-and-knowledge-harness]
---

## Context

UI에서 워크스페이스 설정 → 「Wiki 생성」 버튼 → 에이전트가 노드 제안 → 사용자 확인 → 위키 생성 지금 파이프라인은 에이전트가 끝까지 자동 생성 한 뒤 맨 끝(HUMAN REVIEW REQUIRED)에서 보기 전용 검수 → promote 한다. 즉 쓰기 전 에 노드 구성을 사용자가 손볼 중간 확인이 없다. 이 작업의 목표: 노드 제안·정리 직후 파이프라인을 일시정지 하고, 제안된 노드 목록을 편집(고르기/제거/이름수정/제목 추가)하고 승인 하면, 그 승인 목록으로 위키를 쓰도록 한다. 확인 방식은 가벼운 목록 승인 (에이전트와의 Q&A 대화 없음 — 체크포인트 1개). 먼저 적용할 도메인: 이미 워크스페이스 문서로 end-to-end 동작하는 project-docs 파이프라인( makeDrivers ). 논문 도메인·멀티도메인은 이후 작업. 핵심 차이는 (a) 쓰기 직전에 멈추는 per-run 일시정지 와 (b) 제안 노드를 쓰기 전에 편집하는 UI , (c) 쓰기 단계가 '승인 목록'을 소비 하는 것 — 셋 다 지금은 없다. [1] 워크스페이스 선택 + 「Wiki 생성(확인 모드)」 [2] 에이전트: scan → extract → 노드 제안 → 정리(LEAD MERGED) [3] ⏸ 일시정지 — run은 LEAD MERGED에 머물고

## Decision

- **1. 배경 / 목표** — 사용자가 원하는 위키 생성 플로우 지금 파이프라인은 에이전트가 끝까지 자동 생성 한 뒤 맨 끝(HUMAN REVIEW REQUIRED)에서 보기 전용 검수 → promote 한다. 즉 쓰기 전 에 노드 구성을 사용자가 손볼 중간 확인이 없다.
- **범위 밖 (명시적 연기)**
- **2. 현재 메커니즘 (재사용할 것)** — 핵심 차이는 (a) 쓰기 직전에 멈추는 per-run 일시정지 와 (b) 제안 노드를 쓰기 전에 편집하는 UI , (c) 쓰기 단계가 '승인 목록'을 소비 하는 것 — 셋 다 지금은 없다.
- **3. 사용자 플로우 (목표 동작)** — 비확인 모드(기존)는 [3]~[6] 없이 곧장 진행 — 완전 하위호환 .
- **4. 아키텍처**
- **4-1. 러너 일시정지 계약 ( 'paused' )** — DriverResult.status 에 'paused' 를 추가: 'ok' 'failed' 'paused' .
- **4-2. 확인 단계 (새 상태 없이 게이팅)** — WRITE PLAN CREATED 드라이버를 확인 게이팅 한다(새 파이프라인 상태 추가하지 않음 — 단계 수 최소화)
- **4-3. 승인 목록 제출 + 재개 (IPC)** — 새 IPC harnessConfirmNodes({ runId, approvedNodes })

## Consequences

- Consequences and validation details remain traceable to the source document.

## Related

- Source: `docs/superpowers/specs/2026-06-19-interactive-node-confirmation-design.md`
