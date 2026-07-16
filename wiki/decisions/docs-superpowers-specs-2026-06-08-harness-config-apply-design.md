---
title: 하네스 config 폼 편집 + diff/validate/apply
slug: docs-superpowers-specs-2026-06-08-harness-config-apply-design
sources: [docs/superpowers/specs/2026-06-08-harness-config-apply-design.md]
status: accepted
date: 2026-06-08
topic: [wiki-and-knowledge-harness]
---

## Context

title: 하네스 config 폼 편집 + diff/validate/apply 설계 (AC 8) branch: docs/knowledge-harness-pipeline-spec approach: A — 폼 편집을 형식별로 직렬화(markdown=gray-matter 왕복, jsonc=재포맷). 안전은 Apply 전 diff 미리보기 + Apply 시 snapshot 백업으로 확보. PRD 수용기준 8 — "Harness Studio가 최소 한 provider config를 parse/diff/validate/apply" — 가 미달이다. 진단( 2026-06-07-...-coverage-diagnosis.md §2)에서 확인 목표: OpenCode config를 폼으로 편집 → diff 미리보기 → validate → apply(snapshot 백업 + 원자적 쓰기) → rollback. "reviewable automation"(PRD 6대 원칙) 충족. 순수 fs 연산, 단위 테스트 용이. 입력은 명시적 (rawConfigPath, rawFormat, profileName, edits) . ProfileEdits 는 @apc/shared 에 정의 (AgentProfile처럼)해 백엔드·IPC 계약이 공유한다 // @apc/harness Ag

## Decision

- **1. 배경 / 문제** — PRD 수용기준 8 — "Harness Studio가 최소 한 provider config를 parse/diff/validate/apply" — 가 미달이다. 진단( 2026-06-07-...-coverage-diagnosis.md §2)에서 확인
- **2. 설계 결정 (확정)**
- **3. 백엔드 — AgentConfigEditor ( packages/harness/src/agent-config-editor.ts , 신규)** — 순수 fs 연산, 단위 테스트 용이. 입력은 명시적 (rawConfigPath, rawFormat, profileName, edits) . ProfileEdits 는 @apc/shared 에 정의 (AgentProfile처럼)해 백엔드·IPC 계약이 공유한다
- **4. IPC (명령 3개, additive)** — apps/desktop/src/shared/ipc-contract.ts 컨테이너( container.ts )가 AgentConfigEditor 를 인스턴스화하고 위 3 메서드를 노출. registerIpc 로 채널 배선(기존 패턴).
- **5. UI — AgentConfigEditorPanel (신규, Harness Studio 영역)** — apps/desktop/src/renderer/components/AgentConfigEditorPanel.tsx
- **6. 데이터 흐름** — 폼 edits → configPreview / configApply IPC → AgentConfigEditor (현재파일 읽기→serialize→validate→[diff]/[snapshot+쓰기]) → 결과(errors/diff/snapshotPath) → UI.
- **7. 에러 / 안전**
- **8. 테스트**

## Consequences

- Consequences and validation details remain traceable to the source document.

## Related

- Source: `docs/superpowers/specs/2026-06-08-harness-config-apply-design.md`
