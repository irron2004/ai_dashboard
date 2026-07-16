---
title: autosci-core ↔ ai dashboard 위키 기질(substrate) 통합 — 설계
slug: docs-superpowers-specs-2026-06-19-autosci-core-wiki-substrate-integration-design
sources: [docs/superpowers/specs/2026-06-19-autosci-core-wiki-substrate-integration-design.md]
status: accepted
date: 2026-06-19
topic: [autosci-core-integration]
---

## Context

두 개의 시스템이 목적상 거의 같은 일 (원천자료 → LLM 추출 → 타입드 위키 노드 + 그래프 → 검증 → 검수/promote → 렌더)을 다른 언어 로 하고 있다. autosci-core (Python) — 도메인 무관 "LLM Wiki 코어". ai dashboard (TypeScript / pnpm 모노레포) — 이미 거의 같은 파이프라인을 보유. 쟁점 두 가지: ① 언어(Python vs TS) ② 중복(두 시스템이 거의 같다). autosci-core가 더 가진 것 = 형식 계약 + 결정론적 lint/graph 게이트 + module-bank . ai dashboard가 더 가진 것 = 실제 LLM 에이전트 오케스트레이션 + 검수 UI + Electron 통합 . 1. 북극성: ai dashboard = 멀티도메인 LLM 위키 플랫폼(오케스트레이터+UI), autosci-core = 공유 기질(substrate), 도메인 = overlay. (autosci-core README의 멀티프로젝트 비전과 일치.) 2. 실행 환경: 지금은 로컬, 나중엔 배포 — 지금은 Python 허용, 단 나중에 떼어낼 수 있게 경계를 깔끔히. 3. 통합 방식 = 접근 A (프로세스 합성): ai dashboard가 autosci-core를 서브프로세스

## Decision

- **1. 배경 (왜 이 설계가 필요한가)** — 두 개의 시스템이 목적상 거의 같은 일 (원천자료 → LLM 추출 → 타입드 위키 노드 + 그래프 → 검증 → 검수/promote → 렌더)을 다른 언어 로 하고 있다.
- **2. 확정된 결정 (브레인스토밍 산출)** — 1. 북극성: ai dashboard = 멀티도메인 LLM 위키 플랫폼(오케스트레이터+UI), autosci-core = 공유 기질(substrate), 도메인 = overlay. (autosci-core README의 멀티프로젝트 비전과 일치.) 2. 실행 환경: 지금은 로컬, 나중엔 배포 — 지금은 Python 허용, 단 나중에 떼어낼 수 있게 경계를 깔끔히. 3. 통합 방식 = 접근 A (프로세스 합성): ai dashboard가 autosci-core를 서브프로세스 + 파일 로 만난다. TS는 절대 Python을 import하지 않는다. (claude/code
- **3. 목표와 범위**
- **범위 안 — Phase 1 (배관, LLM 생성 없음)**
- **범위 밖 (명시적 연기 — §9)**
- **4. 아키텍처와 경계**
- **4a. 리뷰 반영: 러너 계약 · Phase-1 driver 경로 · UI 어댑터** — spec 검토에서 드러난, 기존 코드 계약과의 충돌 3건. 이게 구현 계획의 첫 티켓들 이 된다.
- **4a-1. VALIDATED 실패 시 리포트 보존 (러너 계약)** — 현재 HarnessRunner.advance 는 driver가 throw하면 FAILED로 저장하지만 그 단계 artifacts는 저장하지 않는다 ( packages/knowledge-harness/src/runtime/harness-runner.ts:74-84 ). 그래서 "리포트도 파싱하고 run도 fail"이 현 계약으론 불가능하다 — throw는 리포트 소실, 정상 return은 VALIDATED를 성공으로 전진. → 변경: DriverResult 를 { artifacts; status?: 'ok' 'failed'; error?: string } 로 확장. 러

## Consequences

- Consequences and validation details remain traceable to the source document.

## Related

- Source: `docs/superpowers/specs/2026-06-19-autosci-core-wiki-substrate-integration-design.md`
