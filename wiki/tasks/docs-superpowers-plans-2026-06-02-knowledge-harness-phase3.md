---
title: Knowledge Harness — Phase 3 (Policy + Verify + Eval) Implementation Plan
slug: docs-superpowers-plans-2026-06-02-knowledge-harness-phase3
sources: [docs/superpowers/plans/2026-06-02-knowledge-harness-phase3.md]
status: open
created: 2026-06-02
topic: [wiki-and-knowledge-harness]
---

## Summary

REQUIRED SUB-SKILL: superpowers:test-driven-development. All Phase 3 modules are DETERMINISTIC — pure functions/classes over fixtures, no LLM. This is the safety net, so it must be fully testable. Goal: 위키 오염을 막는 결정론 안전망을 추가한다 — PolicyGuard(+SecretScanner), GraphIntegrity, Markdown/YAML/Link validator, EvalReport. 그리고 이들을 Phase 2 파이프라인의 검문 지점에 연결한다 PolicyGuard는 NODE PROPOSALS CREATED 직후(차단 가능), validators는 VALIDATED , EvalReport는 HUMAN REVIEW REQUIRED . harness-runner.ts 는 여전히 불변(makeDrivers만 확장). Architecture: 설계 §3의 결정. PolicyGuard/GraphIntegrity는 "대체로 통과"식 LLM 판정이 위험하므로 순수 결정론 TS. 선택적 LLM 의미판정 레이어는 기본 off(Phase 3 비포함). 각 모듈은 fixture로 모든 Te

## Progress log

- Source checklist: 0 completed, 9 remaining.
- **Task 1: 검증 report 스키마 (shared/kh-schema.ts)** — 추가: KhPolicyReportSchema , KhSecretScanReportSchema , KhGraphValidationReportSchema , KhLinkValidationReportSchema , KhMarkdownYamlValidationReportSchema . 각 report는 { ok: boolean, violations/findings: [...] } 모양으로 round-trip 테스트. feat(shared): kh-schema verify/policy report schemas .
- **Task 2: SecretScanner (policy/secret-scanner.ts)** — regex 카탈로그: AWS/Google API key, generic sk-... /bearer token, private key header ( -----BEGIN ... PRIVATE KEY----- ), password= . scan(text, sourceLabel) → findings[]; 매치 미리보기는 마스킹(앞 4글자 + ). 빈 텍스트/클린 텍스트는 [] . feat(knowledge-harness): SecretScanner — regex catalog with masked previews .
- **Task 3: PolicyGuard (policy/policy-guard.ts, 결정론)** — 입력: KhNodeProposal[] + KhWritePlan? . 규칙(설계 §7.1) (warn + 권고: writer가 어차피 proposal only로 강등; 여기선 warn). 출력 KhPolicyReport . blocked proposal ids 에 block된 proposal id 수집. ok = violations에 block 없음 . feat(knowledge-harness): PolicyGuard — deterministic proposal/write-plan policy checks .
- **Task 4: GraphIntegrity (verify/graph-integrity.ts) — staging vault 대상** — vault 디렉터리의 .md 를 읽어 frontmatter( node id )와 본문 wiki-link 를 수집 출력 KhGraphValidationReport , ok = 모든 목록 빈 경우 . feat(knowledge-harness): GraphIntegrity — broken/dup/orphan/mismatch/backlink checks .
- **Task 5: Markdown/YAML + Obsidian link validator (verify/)** — 짝( )이 맞는지. 문제 → problems[] . 존재성과 달리 문법 만 본다. feat(knowledge-harness): markdown/yaml + obsidian-link validators .
- **Task 6: EvalReport builder (eval/eval-report.ts)** — run artifact들(node-proposals, policy-report, validation reports, applied-write-report)을 읽어 KhEvalReport (이미 kh-schema에 존재)를 계산: coverage(분류된 source 수), evidence quality(evidence 없는 proposal 수, 최소 evidence 충족 수, inference without note), graph quality(orphan/dup/broken/missing), safety(raw modified=false 확인, secret warni
- **Task 7: 파이프라인 연결 (makeDrivers 확장) + e2e + 전체 suite** — block 위반이 있으면 driver throw → run FAILED(안전). 4개 report artifact emit. (canned 데이터가 policy-clean이므로). 필요한 곳에서 assertion 추가. 별도 테스트: evidence 없는 proposal canned → run FAILED(policy block).
- **Phase 3 완료 기준**

## Related

- Source: `docs/superpowers/plans/2026-06-02-knowledge-harness-phase3.md`
