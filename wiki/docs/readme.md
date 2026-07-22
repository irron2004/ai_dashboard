---
title: ai dashboard (agent-project-console)
slug: readme
sources: [README.md]
topic: [project-architecture]
---

## Summary

개인 LLM-wiki를 구축·관리하고, 여러 프로젝트를 동시 진행할 때 전후 작업을 파악해 다음 할 일을 LLM에게 빠르게 전달하는 Electron 데스크톱 PM 대시보드 입니다. apps/desktop (Electron) apps/graph-web (Browser) │ ├── Home (current.md · Changes · PmHome · TaskBoard) │ ├── Knowledge (KnowledgeView · GraphVisualization) │ └── Wiki Gen (WikiGenDashboard · HarnessRunList · NodeConfirmPanel) ├── Agent Dock claude │ opencode │ codex (PTY xterm.js, 드래그 리사이즈) └── Container.buildContainer() ← 모든 서비스 조립·IPC 배선 │ HarnessService 위키 파이프라인 (지식 위키 생성·promote) │ DevHarnessService dev 하네스 (S3, 코딩 에이전트 오케스트레이션) │ IngestService 세션 수집 → SearchIndex · Task 추출 │ GenerateService 단순 wiki 생성(LLM 1-shot) │ WorkspaceVault 위키 로컬/s

## Content map

- **주요 기능**
- **아키텍처** — 채널 정의 단일 소스: apps/desktop/src/shared/ipc-contract.ts ( CH 상수 + 타입).
- **시작하기**
- **의존성 설치**
- **테스트** — vitest workspace(루트 vitest.workspace.ts )가 packages/ + apps/desktop 두 스위트를 한 번에 실행합니다. 소요 시간 약 2.5분. 단일 파일만 실행
- **타입 검사** — tsc -p tsconfig.typecheck.json (packages) + tsc -p apps/desktop/tsconfig.json --noEmit 두 단계를 순서대로 실행합니다. IDE 진단보다 이 명령이 권위 기준입니다. @xterm/… / @apc/node:sqlite "not found" 류 IDE 경고는 오경보이므로 무시하세요.
- **데스크톱 앱 실행**
- **개발 모드 (hot-reload)** — pnpm --filter @apc/desktop dev

## Related

- Source: `README.md`
