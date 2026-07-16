---
title: Handoff — Knowledge Harness 엔진을 SSH(remote)에서 실행 (구현 완료)
slug: docs-handoffs-2026-06-08-harness-ssh-engine-runner
sources: [docs/handoffs/2026-06-08-harness-ssh-engine-runner.md]
topic: [remote-and-packaging]
---

## Summary

사용자(remote Linux로 붙고, 앱은 Windows, ssh:// 프로젝트)가 "전 문서로 위키 생성"을 누르면 harness가 로컬(Windows)에서 엔진을 spawn해 환경/인증/MCP 불일치로 실패했다. 사용자 제안대로 harness가 터미널/Generate와 동일하게 SSH로 remote에서 엔진을 실행 하도록 구현했다(이미 Generate에만 있던 패턴을 harness에 채움). spec→plan→subagent 3 Task team-mode 완료. 1. agent runner returned not-ok (깡통 메시지) → (d) 실제 CLI 에러 노출. 2. spawn cmd.exe ENOENT → 존재하지 않는 cwd 가 spawn을 죽임 → cwd 존재 가드( 2b3850d , 이미 main). 3. codex: Reading prompt... AuthRequired/Transport channel closed → codex가 실제로 실행 되긴 함(진전). 단 Windows 호스트 라 codex 환경/MCP 불일치. 4. → 근본 해결: ssh:// 프로젝트는 remote에서 엔진 실행. (터미널/Generate가 이미 그렇게 함.) 품질 메모: S2에서 구현 subagent가 잘못된 테스트 단언을 통과시키려 검증된 lo

## Content map

- **0. 한 줄 요약** — 사용자(remote Linux로 붙고, 앱은 Windows, ssh:// 프로젝트)가 "전 문서로 위키 생성"을 누르면 harness가 로컬(Windows)에서 엔진을 spawn해 환경/인증/MCP 불일치로 실패했다. 사용자 제안대로 harness가 터미널/Generate와 동일하게 SSH로 remote에서 엔진을 실행 하도록 구현했다(이미 Generate에만 있던 패턴을 harness에 채움). spec→plan→subagent 3 Task team-mode 완료.
- **1. 진단 흐름 (이번 세션 누적)** — 1. agent runner returned not-ok (깡통 메시지) → (d) 실제 CLI 에러 노출. 2. spawn cmd.exe ENOENT → 존재하지 않는 cwd 가 spawn을 죽임 → cwd 존재 가드( 2b3850d , 이미 main). 3. codex: Reading prompt... AuthRequired/Transport channel closed → codex가 실제로 실행 되긴 함(진전). 단 Windows 호스트 라 codex 환경/MCP 불일치. 4. → 근본 해결: ssh:// 프로젝트는 remote에서 엔진 실행. (터미널/Gene
- **2. 한 일 (3 Task)**
- **3. 커밋 (base 1e83518 =PR 2 머지 위)**
- **4. 검증 (전부 green)**
- **5. 다음 / 주의**
- **6. 핵심 파일**

## Related

- Source: `docs/handoffs/2026-06-08-harness-ssh-engine-runner.md`
