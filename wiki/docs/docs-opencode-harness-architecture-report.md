---
title: Opencode Harness Architecture Report
slug: docs-opencode-harness-architecture-report
sources: [docs/opencode-harness-architecture-report.html]
topic: [wiki-and-knowledge-harness]
---

## Summary

oh-my-opencode 하네스 구조 분석 상위 경로의 opencode/oh-my-opencode 를 기준으로, agent orchestration, category delegation, background task runtime, config merge 구조를 누구나 이해할 수 있게 풀어 쓴 보고서입니다. 분석 대상: oh-my-opencode 비교 대상: ai dashboard-main 작성일: 2026-07-08 1. 한 문장 요약 oh-my-opencode의 하네스는 “OpenCode 플러그인 런타임 위에 얹은 agent 운영체제”에 가깝습니다. 단순히 agent prompt 몇 개를 등록하는 구조가 아니라, 설정을 읽고, agent를 조립하고, 도구를 등록하고, hook으로 세션 생명주기를 감시하며, task delegation을 별도 세션으로 실행하고, 완료 결과를 부모 세션에 다시 연결합니다. 핵심 설계는 엔진 , agent role , category , skill , execution session 을 분리한 것입니다. 이 분리가 좋은 확장성을 만듭니다. 2. 최상위 조립 흐름 플러그인 진입점은 src/index.ts 입니다. 여기서 전체 하네스가 다섯 단계로 조립됩니다. flowchart TD A[OpenCode loads

## Content map

- Source structure is summarized in the originating document.

## Related

- Source: `docs/opencode-harness-architecture-report.html`
