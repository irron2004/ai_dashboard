---
title: Agent QA 표면 설계 — fixture 브라우저 QA와 Electron 통합 스모크
slug: docs-superpowers-specs-2026-07-14-agent-qa-surface-design
sources: [docs/superpowers/specs/2026-07-14-agent-qa-surface-design.md]
status: accepted
date: 2026-07-14
topic: [desktop-experience]
---

## Context

참조: UI 사용성 진단 · 아키텍처 다이어그램 apc-web-bridge-architecture.svg 상태: 방향 확정 — Track 1A/1B가 QA 필수 경로, 원격 웹은 별도 제품 트랙 에이전트(Claude Code, dock의 claude/codex/opencode)는 Electron 네이티브 창을 일반 브라우저처럼 직접 탐색하기 어렵다. 정적 타입 검사와 컴포넌트 테스트만으로는 실제 CSS 조합에서 생기는 줄바꿈, 압축, 겹침, viewport overflow를 놓친다. 2026-07-14 UI 검증에서도 전체 테스트와 typecheck가 통과한 뒤 다음 두 결함이 렌더된 화면에서 발견됐다. 따라서 QA에는 빠르고 결정적인 브라우저 렌더링 표면과, Electron 고유 연결을 확인하는 작은 통합 표면이 모두 필요하다. apps/desktop/src/preload/index.ts 가 노출하는 window.apc 는 다음 16개 함수로 모인다. React renderer와 app.css 는 그대로 두고 이 경계의 구현만 교체하면 Chromium에서도 같은 UI를 렌더할 수 있다. 다만 main 프로세스에는 handlers() 밖의 폴더 선택, SSH 테스트, 업데이트·재시작, PTY와 workspace 이벤트가 있으므로 이 경계를 곧바로

## Decision

- **1. 문제** — 에이전트(Claude Code, dock의 claude/codex/opencode)는 Electron 네이티브 창을 일반 브라우저처럼 직접 탐색하기 어렵다. 정적 타입 검사와 컴포넌트 테스트만으로는 실제 CSS 조합에서 생기는 줄바꿈, 압축, 겹침, viewport overflow를 놓친다. 2026-07-14 UI 검증에서도 전체 테스트와 typecheck가 통과한 뒤 다음 두 결함이 렌더된 화면에서 발견됐다. 따라서 QA에는 빠르고 결정적인 브라우저 렌더링 표면과, Electron 고유 연결을 확인하는 작은 통합 표면이 모두 필요하다.
- **2. renderer 경계** — apps/desktop/src/preload/index.ts 가 노출하는 window.apc 는 다음 16개 함수로 모인다. React renderer와 app.css 는 그대로 두고 이 경계의 구현만 교체하면 Chromium에서도 같은 UI를 렌더할 수 있다. 다만 main 프로세스에는 handlers() 밖의 폴더 선택, SSH 테스트, 업데이트·재시작, PTY와 workspace 이벤트가 있으므로 이 경계를 곧바로 범용 HTTP 프록시로 간주하지 않는다.
- **3. 결정** — QA 실행 순서는 다음과 같다. 1. Track 1A — FixtureBridge 기반 Chromium 시각·레이아웃 QA 2. Track 1B — Windows Electron 통합 스모크 3. Track 2 — 기존 status-web 을 확장하는 읽기 전용 원격 제품 fixture는 실제 IPC를 흉내 내기 위한 임시 대체물이 아니라, 재현하기 어려운 UI 상태를 버전 관리하는 QA 계약이다. Electron 스모크는 preload와 실제 IPC 연결을 보완하지만 fixture 시나리오를 대체하지 않는다.
- **4. Track 1A — fixture 기반 브라우저 시각 QA**
- **목적** — 실제 renderer와 실제 app.css 를 Chromium에서 빠르고 결정적으로 검증한다. DB, PTY, 네트워크, 로컬 사용자 데이터에 의존하지 않으므로 에이전트와 CI가 같은 상태를 반복 재현할 수 있다.
- **구조**
- **고정 시나리오** — 최소 다음 상태를 독립 시나리오로 유지한다. 실데이터는 탐색적 QA에 사용할 수 있지만 위 시나리오의 회귀 계약을 대체하지 않는다.
- **검증 계약** — 스크린샷 저장만 하지 않고 DOM과 레이아웃을 우선 검증한다. toHaveScreenshot() 은 핵심 컴포넌트에만 제한 적용한다. 픽셀 결과는 OS, 폰트, GPU 설정에 민감하므로 golden 생성과 비교는 같은 Windows 기준 환경에서 수행한다. Playwright도 baseline과 실행 환경을 동일하게 유지할 것을 권고한다: Visual comparisons.

## Consequences

- **검증 계약** — 스크린샷 저장만 하지 않고 DOM과 레이아웃을 우선 검증한다. toHaveScreenshot() 은 핵심 컴포넌트에만 제한 적용한다. 픽셀 결과는 OS, 폰트, GPU 설정에 민감하므로 golden 생성과 비교는 같은 Windows 기준 환경에서 수행한다. Playwright도 baseline과 실행 환경을 동일하게 유지할 것을 권고한다: Visual comparisons.

## Related

- Source: `docs/superpowers/specs/2026-07-14-agent-qa-surface-design.md`
