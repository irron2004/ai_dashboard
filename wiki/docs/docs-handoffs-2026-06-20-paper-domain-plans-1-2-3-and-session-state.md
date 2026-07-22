---
title: Handoff — paper 도메인 Plan 1·2·3 + 세션 상태 (autosci 실제 생성 로드맵)
slug: docs-handoffs-2026-06-20-paper-domain-plans-1-2-3-and-session-state
sources: [docs/handoffs/2026-06-20-paper-domain-plans-1-2-3-and-session-state.md]
topic: [paper-domain]
---

## Summary

브랜치: feat/workspace-vault @ 42efd8d (origin 대비 ahead 20 , 미푸시) 선행: 2026-06-20-session-state-and-running-the-app.md , 2026-06-19-autosci-core-substrate-and-interactive-node-confirmation.md 이 세션의 목표는 "내가 제공한 autosci로 실제 위키를 생성" — 즉 골든 fixture가 아니라 실제 문서로 paper 도메인 위키를 만드는 것이었다. 그 토대(도메인 배관 + 검증 게이트 + 노드 렌더)를 Plan 1~3으로 깔았다. 실제 LLM 생성(Plan 3b)과 배선(Plan 4)은 아직 미착수. 또한 DB의 papers 프로젝트 repoPath를 정상형으로 이미 정리함 : ssh://hskim@100.66.232.121:22/home/hskim/work/papers (Tailscale 호스트, 도달 가능 확인). 이건 런타임 데이터라 커밋 대상 아님. → 다음 세션 첫 작업: 이 SSH 변경을 별도 커밋으로 정리. 검증 완료(parseSsh 테스트 + 전체 데스크톱 스위트 207 pass + tsc 0). 단, 안전 분류기가 원격 SSH 셸 접속을 막아 in-app 최종 확인은 사용자 몫. WSL용

## Content map

- **1. ⚠️ 미커밋: SSH parseSsh 수정 (작업트리에만 있음 — 먼저 처리할 것)** — 세션 초반에 고친 실제 버그가 아직 커밋 안 됨 또한 DB의 papers 프로젝트 repoPath를 정상형으로 이미 정리함 : ssh://hskim@100.66.232.121:22/home/hskim/work/papers (Tailscale 호스트, 도달 가능 확인). 이건 런타임 데이터라 커밋 대상 아님. → 다음 세션 첫 작업: 이 SSH 변경을 별도 커밋으로 정리. 검증 완료(parseSsh 테스트 + 전체 데스크톱 스위트 207 pass + tsc 0). 단, 안전 분류기가 원격 SSH 셸 접속을 막아 in-app 최종 확인은 사용자 몫.
- **2. 이번 세션에 ship한 것 (20 커밋)**
- **(A) 네이티브 Windows 실행 셋업 (커밋 없음 — 환경 작업)** — WSL용으로 설치돼 있던 node modules 를 Windows용으로 클린 재설치 + electron.exe (win32) + better-sqlite3 · node-pty 를 Electron 31.7.7 ABI 로 재빌드. 앱이 네이티브 Windows에서 구동 확인(스크린샷). 실행: pnpm --filter @apc/desktop start (electron-vite preview). 하네스 GUI는 background 태스크로 띄워야 살아남음 (foreground/detached/Start-Process는 SIGTERM에 죽음).
- **(B) 부수 버그 2건 수정**
- **(C) paper 도메인 Plan 1·2·3 (스펙+계획 문서 포함)** — 스펙: docs/superpowers/specs/2026-06-20-autosci-paper-domain-generation-design.md 계획: docs/superpowers/plans/2026-06-20-paper-domain-plan{1,2,3}- .md
- **3. paper 도메인 아키텍처 — "도메인 팩 오버레이"(A안)** — 기존 harness(상태머신·팬아웃·인터랙티브 확인·promote·UI)는 그대로 두고, 도메인마다 바뀌는 것만 DomainPack 으로 격리 . packages/knowledge-harness/src/domains/
- **Plan별 완료 상태**
- **핵심 사실 / 함정 (다음 세션 필독)**

## Related

- Source: `docs/handoffs/2026-06-20-paper-domain-plans-1-2-3-and-session-state.md`
