---
title: "진단 — ai dashboard: 비전 대비 현재 상태와 향후 개발 로드맵"
slug: docs-handoffs-2026-07-02-product-diagnosis-and-roadmap
sources: [docs/handoffs/2026-07-02-product-diagnosis-and-roadmap.md]
topic: [project-architecture]
---

## Summary

1. 개인 llm-wiki를 구축부터 관리까지 하는 툴 2. 여러 프로젝트 동시 진행 시 전후 작업을 빠르게 파악 하는 화면 3. PM 툴처럼 전후작업을 파악하고 다음 작업을 LLM에게 빠르게 전달 6. 시각화·위키 생성은 autosci-core에서 착안 desktop Electron 앱 — 3탭(Home/Knowledge/Wiki Gen) + 프로젝트별 에이전트 dock(pty 터미널) core ProjectRegistry(domain/repoPaths/ssh)·Db(sqlite) pm TaskStore·AgentRunStore·ReviewService knowledge-harness 위키 생성 파이프라인(discovery→extract→verify→graph→HUMAN REVIEW→promote) llm-wiki 엔진 러너(claude/codex/opencode CLI), 로깅 app-services HarnessService(위키)·DevHarnessService(S3, dev 하네스)·ingest·task-extractor graph-view 그래프 데이터 빌더(work↔wiki 포함) agents 세션 인제스트 어댑터 + resume 명령 wiki-substrate autosci-core 커널 어댑터(PythonKernelAdapter)

## Content map

- **1. 현재 구조 (실측)** — 핵심 데이터 흐름: 에이전트 세션(~/.claude 등) → ingest → 검색 인덱스 + SP1 세션→Task 캡처 (req:/todo:) → SP2 work↔wiki 그래프 → PmHome/KnowledgeView. 위키는 HarnessService가 소스 materialize→LLM 파이프라인→HUMAN REVIEW→promote→ /.apc-wiki + wiki/ export. S3(어제 머지) 로 콘솔이 dev 하네스를 직접 구동.
- **2. 비전 대비 진단**
- **구조적 문제 (기능 외)**
- **3. 개선점 (우선순위)** — 1. Task 의존성 모델 — blockedBy: string[] 한 필드 추가가 비전 2·3의 뿌리. 이것 없이는 "전후 파악"도 "다음 작업 선정"도 그래프가 아니라 사람 머리에 있음. 2. Context Package Composer — task 선택 → {제목, 수용기준, linkedWikiPages 발췌, 직전 세션 요약} 조립 → ① dock 터미널에 주입 or ② DevHarness run 인자로. "PM이 다음 작업을 LLM에게 전달"의 실체. 3. 크로스 프로젝트 홈 — 전 프로젝트의 {진행중 task, 실행중 run, 리뷰 대기}를 한 화면에. 현재
- **4. 향후 개발 Plan (단계별)**
- **5. 참고 — 잘 되어 있는 것 (유지)**

## Related

- Source: `docs/handoffs/2026-07-02-product-diagnosis-and-roadmap.md`
