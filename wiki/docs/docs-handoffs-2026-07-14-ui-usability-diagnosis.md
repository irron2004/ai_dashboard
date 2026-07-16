---
title: "진단 — UI 사용성: 비전 대비 화면 구조 점검과 개선 우선순위"
slug: docs-handoffs-2026-07-14-ui-usability-diagnosis
sources: [docs/handoffs/2026-07-14-ui-usability-diagnosis.md]
topic: [desktop-experience]
---

## Summary

기준 브랜치: feat/resume-recall-surface 제안 화면 목업: docs/mockups/2026-07-14-ui-proposal-mockups.html — 브라우저에서 열어 확인 (개선 1~4 반영) 범위: apps/desktop/src/renderer — App 셸, Home/Knowledge/Wiki Gen/전체 4탭, PmHome·TaskBoard·DevHarnessPanel·ResumeBanner, app.css 기능은 로드맵 P1~P3(의존성 모델, Context Composer, 멀티프로젝트 홈)까지 거의 완주했다. 그러나 UI 계층이 아직 "위키 툴 시절"의 구조(문서 뷰어 중심)에 머물러 있어, PM 대시보드 비전이 화면에 드러나지 않는다. → 개선 1~4번(§4)만 반영해도 체감이 크게 달라진다. 선행 진단 문서 기준, 이 제품은 "여러 프로젝트를 오가며 ① 전후 작업을 빠르게 파악하고 ② 다음 작업을 LLM에게 빠르게 넘기는 개인 PM 대시보드 + llm-wiki 관리 툴" 이다. 상태 파악 → 다음 작업 선정 → 컨텍스트 조립해 LLM에 전달 → 실행 관찰 → 리뷰 이 루프의 기능은 이미 존재한다: blockedBy 의존성, nextUp 위젯, Context Composer( composeContext ), 터

## Content map

- **0. 요약 (TL;DR)** — 기능은 로드맵 P1~P3(의존성 모델, Context Composer, 멀티프로젝트 홈)까지 거의 완주했다. 그러나 UI 계층이 아직 "위키 툴 시절"의 구조(문서 뷰어 중심)에 머물러 있어, PM 대시보드 비전이 화면에 드러나지 않는다. → 개선 1~4번(§4)만 반영해도 체감이 크게 달라진다.
- **1. 비전 재확인 — UI가 답해야 할 질문** — 선행 진단 문서 기준, 이 제품은 "여러 프로젝트를 오가며 ① 전후 작업을 빠르게 파악하고 ② 다음 작업을 LLM에게 빠르게 넘기는 개인 PM 대시보드 + llm-wiki 관리 툴" 이다. 핵심 사용 루프 이 루프의 기능은 이미 존재한다: blockedBy 의존성, nextUp 위젯, Context Composer( composeContext ), 터미널 주입( writePty ), dev-run transcript, WorkspaceHome, ResumeBanner.
- **2. 핵심 진단**
- **🔴 D1. PM 대시보드가 footer 토글 뒤에 숨어 있다 — 최우선**
- **🔴 D2. LLM 핸드오프 6단계 파편화 — 비전 3("빠르게 전달")과 직접 충돌** — 현재 경로
- **🔴 D3. Run 가시성 — 무엇이 실행됐는지 읽을 수 없음**
- **🟡 D4. 상태 색상 의미론이 관습과 반대**
- **🟡 D5. 수동 task 추가 수단 부재**

## Related

- Source: `docs/handoffs/2026-07-14-ui-usability-diagnosis.md`
