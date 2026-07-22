---
title: 진단 — project-discovery failed (codex) (PROJECT SCANNED 단계 실패)
slug: docs-handoffs-2026-06-09-harness-codex-discovery-failure
sources: [docs/handoffs/2026-06-09-harness-codex-discovery-failure.md]
topic: [wiki-and-knowledge-harness]
---

## Summary

RUN-2026-06-09T04-34-43-610Z → FAILED — project-discovery failed (codex): … doc/bayesian/exp035 combo05 ensemble.py 50 paper d sensor doc/bayesian/analysis-output-2026-05-24/analysis-report.md 50 paper d sensor doc/bayesian/analysis-output-2026-05-24/figures/figure-02-exp046-hierarchy-stress.pdf 50 paper d sensor doc/bayesian/analysis-output-2026-05-24/figures/figure-02-exp046-hierarchy-stress.png 50 paper d sensor doc/bayesian/analysis-output-2026-05-24/figures/figure-01-exp043c-main-comparison.pdf 50 paper d sensor doc/bayesian/analysis-output-2026-05-24/figures/figure-01-exp043c-main-comparison.png 50 paper d sensor doc/bayesian/analysis-o

## Content map

- **0. 원본 로그** — 데스크톱 앱에서 위키 생성 실행 시
- **1. 한 줄 요약** — 파이프라인 첫 LLM 단계( PROJECT SCANNED → project-discovery) 에서 codex exec 가 비정상 종료(exit ≠ 0) 했다. 그런데 사용자에게 보이는 메시지가 실패 원인이 아니라 codex가 "쳐다본 파일 목록" 이다 — 진짜 codex 에러는 메시지에 들어있지 않다. 이는 에러 표면화 경로의 두 개 결함이 겹쳐서 생긴 것이고, 그래서 현재 로그만으로는 codex가 왜 죽었는지 단정할 수 없다.
- **2. 호출 경로 (확인된 사실)**
- **3. 근본 원인 (확실 — 코드로 확인)**
- **결함 A — CliAgentRunner 가 stderr 를 버리고 exit code 를 안 남긴다** — packages/llm-wiki/src/cli-agent-runner.ts:33
- **결함 B — LlmAgent 가 raw 의 끝 800자 만 보여준다** — packages/knowledge-harness/src/agents/llm-agent.ts:34-37
- **결함 C — 실패 시 codex 의 전체 출력이 어디에도 영속되지 않는다**
- **4. codex 가 죽은 실제 사유 (가설 — 현재 로그로는 단정 불가)** — 가능성 높은 순서. 결함 A/B/C 때문에 확정하려면 추가 계측이 필요 하다. 1. 인증/레이트리밋/모델 에러 (stderr 로 나가 결함 A 로 버려짐). 가장 흔한 1차 단계 실패. → 2026-06-08 핸드오프 §5 의 "엔진 CLI 설치·인증·PATH" 미충족과 동일 계열. 2. codex exec 의 sandbox/approval 모드 . 기본 codex exec 는 비대화형에서 승인 없이 파일 접근/쓰기를 못 해 열거만 하고 비정상 종료할 수 있다 ( --full-auto / 적절한 --sandbox 플래그 부재). 현재 템플릿은 args: ['exec'

## Related

- Source: `docs/handoffs/2026-06-09-harness-codex-discovery-failure.md`
