---
title: "Knowledge Harness — Phase 4 (표면: CLI + Service + Promote + Desktop IPC) Implementation Plan"
slug: docs-superpowers-plans-2026-06-02-knowledge-harness-phase4
sources: [docs/superpowers/plans/2026-06-02-knowledge-harness-phase4.md]
status: open
created: 2026-06-02
topic: [wiki-and-knowledge-harness]
---

## Summary

REQUIRED SUB-SKILL: superpowers:test-driven-development. Surfaces are thin over the Phase 1-3 runtime; everything testable uses FakeAgentRunner + temp dirs. Renderer React UI is wired at the IPC boundary (handlers + contract types tested); pixel UI is a manual follow-up, not unit-tested. Goal: 파이프라인을 사람이 실제로 구동·조회·승인(promote)할 수 있게 한다. (1) HarnessService — run/show/promote 오케스트레이션 (deps 주입, @apc/app-services ). (2) CLI bin knowledge-harness run show promote — HarnessService 위 얇은 디스패처. (3) HarnessPromoteService — staging→real vault 반영(비-canonical만 자동, canonical은 .proposal.md 로 보존). (4) 데스크톱 IPC 채널 3종 + container DI( GenerateService 와 동일 패턴, Fa

## Progress log

- Source checklist: 0 completed, 8 remaining.
- **File Structure**
- **Task 1: HarnessPromoteService (staging→vault apply)** — promote({ runId }) : run state 로드 → HUMAN REVIEW REQUIRED 아니면 거부 → AppliedWriteReport 읽기 → applied[] (비-canonical) 파일을 stagingRoot→vaultRoot 복사, proposals[] (.proposal.md)는 vault에 proposal로 복사(덮어쓰기 금지) → { ok, promoted: string[], proposals: string[] } . vault에 concepts/n1.md 생성, current.proposal.md 생성, 기존 current.md 불변
- **Task 2: HarnessService (run / show / promote)** — deps: { runner, registry, vaultRoot, runsRoot, gatesPath, preamble, now } . makeDrivers({runner, vaultRoot, stagingRoot: runsRoot/runId/vault-staging, preamble}) → HarnessRunner({gates: FeatureGate.fromFile(gatesPath), drivers, now}) → createRun + advance → { ok, runId, finalState, evalReportPath?, diffPath?, reportPat
- **Task 3: CLI bin (knowledge-harness run show promote)** — parseArgs(argv) → { cmd, opts } (순수, 테스트). runCli(args, service, out) 디스패처. bin은 shebang + deps 조립(CliAgentRunner, registry, paths) 후 runCli . 알 수 없는 명령/누락 플래그는 usage + 비0 종료코드. feat(knowledge-harness): CLI bin (run/show/promote) over HarnessService .
- **Task 4: Desktop IPC + container DI** — HarnessPromoteReq/Res . feat(desktop): harness IPC channels + container DI (run/show/promote) .
- **Task 5: 전체 suite + 수용 기준 확인**
- **Phase 4 완료 기준** — CliAgentRunner; 테스트는 Fake)하고 runs/RUN- / 에 산출물을 남긴다.
- **Phase 4 비포함 / P1**

## Related

- Source: `docs/superpowers/plans/2026-06-02-knowledge-harness-phase4.md`
