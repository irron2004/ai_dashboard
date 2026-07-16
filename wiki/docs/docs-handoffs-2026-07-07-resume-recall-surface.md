---
title: Handoff — 이어서(Resume) 컨텍스트 리콜 표면 (진단→spec→plan→구현→PR)
slug: docs-handoffs-2026-07-07-resume-recall-surface
sources: [docs/handoffs/2026-07-07-resume-recall-surface.md]
topic: [desktop-experience]
---

## Summary

한 줄 상태: 사용자의 두 고통("이전에 뭘 물었는지 까먹음", "다음에 뭐 하려 했는지 까먹음")을 전환 시 슬라이드-인 배너 + note 캡처 + 질문 히스토리 로 해소하는 기능을 진단부터 완주 — 7-task TDD를 subagent-driven(구현 Sonnet / 리뷰·게이트 Opus)로 실행, 최종 whole-branch 리뷰 통과, PR 21 OPEN . 전체 테스트 1018 pass/2 skip/0 fail. 이 세션은 brainstorming → spec → writing-plans → subagent-driven-development → 최종 리뷰 → finishing 흐름으로 진행. spec/plan은 docs/superpowers/{specs,plans}/2026-07-07-resume-recall-surface . 로드맵( 2026-07-02-product-diagnosis-and-roadmap.md )의 비전 2·3("전후 작업 빠른 파악", "다음 작업 → LLM 전달")을 UX 관점 에서 재프레이밍한 기능. 진단의 핵심: 두 고통은 같은 뿌리( 전환 시 컨텍스트 증발 )이고, 필요한 데이터는 이미 대부분 캡처돼 있다 (질문 원문 turn fts , 세션 요약 req: task) → 새 파이프라인이 아니라 리콜 표면 +

## Content map

- **1. 무엇을 만들었나 (비전 대비)** — 로드맵( 2026-07-02-product-diagnosis-and-roadmap.md )의 비전 2·3("전후 작업 빠른 파악", "다음 작업 → LLM 전달")을 UX 관점 에서 재프레이밍한 기능. 진단의 핵심: 두 고통은 같은 뿌리( 전환 시 컨텍스트 증발 )이고, 필요한 데이터는 이미 대부분 캡처돼 있다 (질문 원문 turn fts , 세션 요약 req: task) → 새 파이프라인이 아니라 리콜 표면 + 초경량 human 캡처 문제.
- **2. Task별 커밋 (전부 feat/resume-recall-surface , base main @ 8587daf )** — 진행 ledger: .superpowers/sdd/progress.md (gitignore 스크래치) — task별 커밋·리뷰·Minor 전부 기록.
- **3. 최종 whole-branch 리뷰 — Important 2건 병합 전 해소**
- **4. ⚠️ 함정 / 학습 (다음 세션이 알아야 할 것)**
- **5. 리포/브랜치 상태**
- **6. 남은 작업 (Follow-up, 비차단 — PR 21 본문에도 기록)** — 1. ⌘⇧N이 이력 없는 새 프로젝트에서 무동작 : note 캡처가 배너 렌더에 결합( resumeBannerOpen && resumeCard ) → resumeCard=null이면 배너 미표시. note 캡처를 배너와 분리 검토. 2. QuestionHistory 세션 점프 미구현(spec §5.2) : onPick 이 selectProject 만 하고 entry.sessionId 로 세션 resume 안 함. I2의 resumeAgentSession 프리미티브 재사용하면 됨. 3. 자잘한 정리 : question log.record 트랜잭션 래핑 · 미사용 imp

## Related

- Source: `docs/handoffs/2026-07-07-resume-recall-surface.md`
