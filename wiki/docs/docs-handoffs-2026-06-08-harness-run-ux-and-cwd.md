---
title: Handoff — Harness run 사용성 + 엔진 cwd 수정 (구현 완료)
slug: docs-handoffs-2026-06-08-harness-run-ux-and-cwd
sources: [docs/handoffs/2026-06-08-harness-run-ux-and-cwd.md]
topic: [wiki-and-knowledge-harness]
---

## Summary

사용자가 "전 문서로 위키 생성" 클릭 → 긴 무반응 후 Promote failed: run is FAILED… 를 겪었다. 진단 결과 4개 실제 결함을 찾아 spec→plan→subagent 구현(5 Task team-mode dev+QA 전부 APPROVED, 최종 READY TO MERGE) 으로 고쳤다. RUN-… → FAILED — project-discovery failed: agent runner returned not-ok = 파이프라인 첫 LLM 단계부터 엔진 CLI(claude/codex/opencode)가 not-ok . CliAgentRunner 가 실제 stderr( res.raw )를 잡아두는데 LlmAgent 가 버리고 깡통 메시지만 던졌고, 실패가 사용자가 보는 Coverage 탭이 아니라 상단에만 떴으며, CLI가 cwd 없이 spawn돼 프로젝트 폴더가 아니라 앱 폴더에서 돌았다. de513b7 feat(desktop): disable promote unless run is HUMAN REVIEW REQUIRED d8dc94f feat(desktop): Coverage tab shows loading + failure reason d217694 feat: run harness engine in the project

## Content map

- **0. 한 줄 요약** — 사용자가 "전 문서로 위키 생성" 클릭 → 긴 무반응 후 Promote failed: run is FAILED… 를 겪었다. 진단 결과 4개 실제 결함을 찾아 spec→plan→subagent 구현(5 Task team-mode dev+QA 전부 APPROVED, 최종 READY TO MERGE) 으로 고쳤다.
- **1. 진단한 근본 원인** — RUN-… → FAILED — project-discovery failed: agent runner returned not-ok = 파이프라인 첫 LLM 단계부터 엔진 CLI(claude/codex/opencode)가 not-ok . CliAgentRunner 가 실제 stderr( res.raw )를 잡아두는데 LlmAgent 가 버리고 깡통 메시지만 던졌고, 실패가 사용자가 보는 Coverage 탭이 아니라 상단에만 떴으며, CLI가 cwd 없이 spawn돼 프로젝트 폴더가 아니라 앱 폴더에서 돌았다.
- **2. 한 일 (5 Task)**
- **3. 커밋 (base 2666862 = PR 1 머지 지점 위)**
- **4. 검증 (전부 green)** — 최종 종합 리뷰: cwd 체인 IPC→spawn 무결, 에러 노출 end-to-end, promote 가드 일관, 회귀 없음 → READY TO MERGE.
- **5. 남은 현실 / 다음**
- **6. 핵심 파일**

## Related

- Source: `docs/handoffs/2026-06-08-harness-run-ux-and-cwd.md`
