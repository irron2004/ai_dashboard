---
title: "Handoff — 하네스 config 폼 편집 + diff/validate/apply (AC 8, 구현 완료)"
slug: docs-handoffs-2026-06-09-harness-config-apply
sources: [docs/handoffs/2026-06-09-harness-config-apply.md]
topic: [wiki-and-knowledge-harness]
---

## Summary

PRD P0 격차 8 (Harness Studio가 provider config를 parse/diff/validate/apply) 충족. OpenCode 프로필을 폼으로 편집 → Validate/Diff/Apply(snapshot+원자적 쓰기)/Rollback. brainstorm→spec→plan→subagent 6 Task team-mode 완료, 최종 리뷰가 잡은 블로커(diff 파싱)까지 수정. 10d0218 fix(harness): diffText emits git-header so DiffViewer parses it; UI surfaces IPC errors f125898 feat(desktop): AgentConfigEditorPanel + Config tab 5320e6e feat(desktop): config preview/apply/rollback IPC 6aa3998 feat(harness): AgentConfigEditor apply(snapshot+atomic) + rollback + preview/applyEdit d8c9d9e feat(harness): AgentConfigEditor validateConfigText + diffText b8eb04a feat(harness): AgentConfigEditor.seri

## Content map

- **0. 한 줄 요약** — PRD P0 격차 8 (Harness Studio가 provider config를 parse/diff/validate/apply) 충족. OpenCode 프로필을 폼으로 편집 → Validate/Diff/Apply(snapshot+원자적 쓰기)/Rollback. brainstorm→spec→plan→subagent 6 Task team-mode 완료, 최종 리뷰가 잡은 블로커(diff 파싱)까지 수정.
- **1. 한 일 (6 Task + fix)**
- **2. 커밋 (base 4928d2c =plan 위)**
- **3. 검증 (전부 green)** — 최종 리뷰: end-to-end 체인 무결(UI→api→CH→ipc.ts→AgentConfigEditor, arg order/channel 일치), ProfileEdits 단일 정의, 안전 불변식(validate/snapshot/atomic) IPC 경로까지 유지.
- **4. 남은 것 / 후속 (low, 비차단)**
- **5. 핵심 파일**
- **6. 다음 후보**

## Related

- Source: `docs/handoffs/2026-06-09-harness-config-apply.md`
