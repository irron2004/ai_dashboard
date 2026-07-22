---
title: Handoff — Knowledge Harness 구현 (Phase 1~4) + 팀 리뷰
slug: docs-handoffs-2026-06-03-knowledge-harness-phases-1-4
sources: [docs/handoffs/2026-06-03-knowledge-harness-phases-1-4.md]
topic: [wiki-and-knowledge-harness]
---

## Summary

이 핸드오프 본문(§1~2)은 "수렴/완료"로 적혀 있으나, 마지막에 수행한 holistic 팀 진단이 그 프레이밍을 뒤집었다. narrow 리뷰 7라운드는 바뀐 부분 만 검증해서 시스템 차원의 구멍을 놓쳤다. 전체 진단 결과 현 구현은 잘 테스트된 "골격(skeleton)"이지 동작하는 evidence 파이프라인이 아니다 — production-ready 아님. 전체 진단 문서 : docs/superpowers/specs/2026-06-03-knowledge-harness-diagnosis.md (58개 confirmed 문제, 우선순위·fix 포함). 3대 시스템 약점 : (1) evidence chain이 decorative(실제 source 미수집·미검증), (2) 결정론 검증이 advisory/inert(validator .ok를 아무도 안 읽음, 게이트 17/22 inert), (3) 데스크톱 UI config가 backend로 전달 안 됨(죽은 컨트롤). + CI typecheck 없음, 실 LLM 테스트 없음. 현재 안전한 이유는 staging-only write + 사람 promote뿐 — 코드가 아니라 사람이 안전장치다. 블로커 : A1/A2(grounding 부재), B1–B3(검증 미게이트+매번 false-fail), C1/

## Content map

- **1. 이번 세션에 한 일 (결론 중심)** — 증거 기반 위키 파이프라인 @apc/knowledge-harness 를 4개 phase 전부 구현 했다. 기존 GenerateService (one-shot)는 건드리지 않고 새 패키지로 병행. 모든 작업은 TDD + task별 커밋. yml subset 파서, fail-safe), RunArtifactStore(fs, atomic temp+rename), RunLock, HarnessRunner (driver 주입, resume, FAILED). harness/ config 3종. foreign-lock 가드), terminal state(FAILED/MERGED)
- **2. 변경 파일 / 커밋 상태** — package.json bin/dep), apps/desktop/src/{shared/ipc-contract,main/container,main/ipc}.ts (+ipc.test). docs/superpowers/plans/2026-06-02-knowledge-harness-phase{1,2,3,4}.md . packages/shared/src/ingest-schema , untracked packages/agents/src/source-discovery.ts , docs/superpowers/specs/2026-06-02-llm-wiki-agent-spec.md .
- **2-b. 팀 리뷰 + 개선 반복 1 (완료)** — Workflow wf 82e87259-8ac (34 agents): 28 raised / 27 confirmed → 12 distinct issues . 핵심 결론 "아키텍처는 건전하나 하드 불변식이 LLM 프롬프트 + non-blocking warn에만 의존". 12개 전부 수정 완료 (결정론 백스톱으로 전환). 주요 커밋 canonical proposal-only, 수용기준 7/resume-CLI는 P1).
- **2-c. 팀 리뷰 라운드 2 + 개선 반복 2 (완료)** — Workflow wf 75252b8b-34c : 13 raised / 13 confirmed . 결론: 라운드1 fixes의 canonical 백스톱은 8개 distinct 이슈 전부 수정 allow-secrets CLI valve, IPC strict-parse, contract allowSecrets/refusedCanonical , scanner 패턴 확장(stripe/gitlab/azure/pgp/ key), CLI reason 테스트.
- **2-d. 팀 리뷰 라운드 3 + 개선 반복 3 → 수렴 (완료)** — Workflow wf 96661c77-2a0 : 7 raised / 6 confirmed . iteration 2 fixes 전부 코드에서 유지 확인, 내가 iter 2에 넣은 regression 1건 + minor 테스트 갭 2건. 전부 수정 client secret: word 같은 평범한 prose를 매칭 → fail-closed로 정상 promote를 막음. 명시적 credential 키 이름(password/api key/secret key/access token/auth token/aws secret access key)만 매칭하도록 좁힘 + negative
- **2-e. 수렴 후 개선 (자신있게 가능한 것 전부 완료)** — HarnessService.promoteCanonical + c:harnessPromoteCanonical IPC. ConflictManager로 generic hash-gating(match→promote, stale→conflict doc). packages 228 + desktop 21 green. (generic 구현이라 vault-layout 결정 불요였음 — 앞서 과도하게 보수적으로 판단했던 항목.)
- **2-f. 렌더러 UI — 이미 존재(외부 추가) + 새 채널 연결 완료** — apps/desktop/src/renderer/components/ 에 HarnessDashboard/HarnessPanel(+test)/HarnessRunList + DiffViewer/MarkdownViewer 가 이미 있고 desktop 테스트 green(21). 내 백엔드 변경과 호환됨. api.ts 에 harnessResume / harnessPromoteCanonical 을 추가해 새 IPC 채널까지 렌더러에서 호출 가능.
- **상태: MVP 수용 기준 §12의 1~8 전부 충족(7번 hash-gated canonical promote 포함), UI는 IPC 경계까지**

## Related

- Source: `docs/handoffs/2026-06-03-knowledge-harness-phases-1-4.md`
