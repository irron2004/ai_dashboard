---
title: Diff 패널 설계 — 변경사항 한눈에 보기
slug: docs-superpowers-specs-2026-07-14-diff-panel-design
sources: [docs/superpowers/specs/2026-07-14-diff-panel-design.md]
status: accepted
date: 2026-07-14
topic: [desktop-experience]
---

## Context

참조: UI 사용성 진단 · 목업 이미지 diff-panel-mockup.svg 모티프: Claude Code 데스크톱의 Diff 패널 (Ctrl+Shift+D → 우측 패널, 파일별 +N −N, 클릭 시 펼침) 에이전트가 코드를 바꾸는 앱인데, "지금 워킹트리에 무엇이 얼마나 바뀌었나"를 보려면 문서 탭 → 변경분 피드 → 파일 하나씩 클릭해야 한다. 파일별 증감량(+N −N)은 아예 없다. 목표: 어느 탭에 있든 단축키/버튼 한 번으로 우측에 Diff 패널이 열리고, 변경 파일 목록이 +N −N 스탯과 함께 보이며, 파일을 클릭하면 그 자리에서 diff가 펼쳐진다. 비전 연결: 비전 2(전후 작업 빠른 파악) — 에이전트 작업 결과를 리뷰하는 핵심 루프의 일부. 신규 IPC 채널은 만들지 않는다. 기존 changesList 응답에 필드를 추가하는 것이므로 CLAUDE.md의 "IPC 채널 추가 시 4곳 배선" 규칙은 해당 없음 (contract 타입 + main 구현만 수정). + 경로(ellipsis) + +N / −N (binary·집계불가 파일은 binary 표기) git diff HEAD --numstat 으로 tracked 변경의 증감량을 얻고, porcelain 목록에 병합한다. · "12\t3\tpath" 파싱, "-\t-\tpa

## Decision

- **1. 배경과 목표** — 에이전트가 코드를 바꾸는 앱인데, "지금 워킹트리에 무엇이 얼마나 바뀌었나"를 보려면 문서 탭 → 변경분 피드 → 파일 하나씩 클릭해야 한다. 파일별 증감량(+N −N)은 아예 없다. 변경 파일 목록이 +N −N 스탯과 함께 보이며, 파일을 클릭하면 그 자리에서 diff가 펼쳐진다.
- **2. 기존 재료 (전부 재사용)** — 신규 IPC 채널은 만들지 않는다. 기존 changesList 응답에 필드를 추가하는 것이므로 CLAUDE.md의 "IPC 채널 추가 시 4곳 배선" 규칙은 해당 없음 (contract 타입 + main 구현만 수정).
- **3. UX 스펙**
- **진입점**
- **패널 (우측 오버레이)** — + 경로(ellipsis) + +N / −N (binary·집계불가 파일은 binary 표기)
- **접근성**
- **4. 기술 설계**
- **4.1 main — 파일별 증감량 ( project-changes.ts )** — git diff HEAD --numstat 으로 tracked 변경의 증감량을 얻고, porcelain 목록에 병합한다. 파일을 읽어 줄 수 계산. NUL 바이트 포함(binary) 또는 2MB 초과 시 null (집계 불가) ChangedFile 에 additions?: number; deletions?: number; binary?: boolean 추가.

## Consequences

- Consequences and validation details remain traceable to the source document.

## Related

- Source: `docs/superpowers/specs/2026-07-14-diff-panel-design.md`
