---
title: 하네스 config 폼 편집 + diff/validate/apply 설계 (AC#8)
date: 2026-06-08
status: design-approved
author: PM (Claude)
relates-to:
  - docs/superpowers/specs/2026-06-07-product-requirements-coverage-diagnosis.md (P0 격차 #8)
  - docs/superpowers/specs/2026-06-02-pm-workbench-prd-v0.2.md (Harness Studio: diff/validate/apply)
branch: docs/knowledge-harness-pipeline-spec
approach: A — 폼 편집을 형식별로 직렬화(markdown=gray-matter 왕복, jsonc=재포맷). 안전은 Apply 전 diff 미리보기 + Apply 시 snapshot 백업으로 확보.
---

# 하네스 config 폼 편집 + diff/validate/apply

## 1. 배경 / 문제

PRD 수용기준 **#8** — "Harness Studio가 최소 한 provider config를 parse/diff/validate/apply" — 가 미달이다. 진단(`2026-06-07-...-coverage-diagnosis.md` §2)에서 확인:

- `OpenCodeConfigAdapter`(`packages/harness/src/opencode-config-adapter.ts`)는 `.opencode/opencode.jsonc|json`(agent 맵)과 `.opencode/agent/*.md`(frontmatter)를 **읽기(parse)만** 한다. `AgentConfigAdapter` 인터페이스는 `discoverProfiles()`뿐.
- 각 `AgentProfile`(`@apc/shared`)은 `rawConfigPath`/`rawFormat`('json'|'markdown') + 정규화 필드(model/mode/permissions/tools/temperature/prompt/description)를 가진다.
- **diff/validate/apply/rollback 전부 미구현**, config 편집 UI도 없다.

**목표:** OpenCode config를 폼으로 편집 → diff 미리보기 → validate → apply(snapshot 백업 + 원자적 쓰기) → rollback. "reviewable automation"(PRD 6대 원칙) 충족.

## 2. 설계 결정 (확정)

| 항목 | 결정 |
|---|---|
| 편집 방식 | **폼 기반** — 정규화 필드(model/mode/permissions/tools/temperature/prompt/description) |
| 직렬화 | **A안** — markdown=gray-matter 왕복(깔끔), jsonc=parse→필드 갱신→재포맷(주석 손실) |
| 안전 | Apply 전 **diff 미리보기** + Apply 시 **snapshot 백업** + **원자적 쓰기**; snapshot 실패 시 Apply 중단 |
| provider | **OpenCode만**(파서 존재). Codex/Claude = 후속 |

## 3. 백엔드 — `AgentConfigEditor` (`packages/harness/src/agent-config-editor.ts`, 신규)

순수 fs 연산, 단위 테스트 용이. 입력은 명시적 `(rawConfigPath, rawFormat, profileName, edits)`.

`ProfileEdits`는 **`@apc/shared`에 정의**(AgentProfile처럼)해 백엔드·IPC 계약이 공유한다:
```ts
// @apc/shared
export type ProfileEdits = {
  model?: string
  mode?: string
  permissions?: Partial<Record<'read'|'edit'|'bash'|'web'|'task', 'allow'|'ask'|'deny'>>
  tools?: string[]
  temperature?: number
  description?: string
  prompt?: string
}
```
```ts
// @apc/harness AgentConfigEditor
export type ConfigValidation = { ok: boolean; errors: string[] }

/** 폼 edits를 config 텍스트로 직렬화 (현재 텍스트 위에 병합). */
serializeProfileEdit(currentText: string, rawFormat: 'json'|'markdown', profileName: string, edits: ProfileEdits): string
//  - markdown: matter(current) → frontmatter에 edits 병합(undefined는 무시) + content=edits.prompt(있으면) → matter.stringify
//  - json:     parseJsonc(current) → obj.agent[profileName] 필드 갱신 → JSON.stringify(obj, null, 2)  (주석 손실)

/** 파싱 가능 여부 + mode/permission 값 유효성. */
validateConfigText(text: string, rawFormat: 'json'|'markdown'): ConfigValidation

/** 순수 line 기반 unified diff (DiffViewer가 렌더). */
diffText(current: string, proposed: string, path: string): string

/** validate 통과 시 snapshot 백업 후 원자적 쓰기. snapshot 실패 시 throw(쓰기 안 함). */
applyConfigText(path: string, proposedText: string, rawFormat: 'json'|'markdown'): { ok: boolean; snapshotPath?: string; errors: string[] }
//  - validate → 실패 시 { ok:false, errors }
//  - snapshot: copyFileSync(path, `${path}.bak-${stamp}`)
//  - 원자적 쓰기: writeFileSync(`${path}.tmp`) → renameSync(tmp, path)

/** 최신 `${path}.bak-*` 복원. */
rollbackConfig(path: string): { ok: boolean; restoredFrom?: string; error?: string }
```

> snapshot 명명: `${path}.bak-<ISO stamp>`. rollback은 같은 디렉터리에서 `${basename}.bak-*` 중 최신을 path로 복사.

## 4. IPC (명령 3개, additive)

`apps/desktop/src/shared/ipc-contract.ts`:
```ts
export type ConfigEditReq = { rawConfigPath: string; rawFormat: 'json'|'markdown'; profileName: string; edits: ProfileEdits }
export type ConfigPreviewRes = { ok: boolean; errors: string[]; diff: string }
export type ConfigApplyRes = { ok: boolean; errors: string[]; snapshotPath?: string }
export type ConfigRollbackReq = { rawConfigPath: string }
export type ConfigRollbackRes = { ok: boolean; restoredFrom?: string; error?: string }
// CH: configPreview, configApply, configRollback
```
- `configPreview(req)` → 현재파일 읽기 → serialize → validate → diff. **쓰기 없음**.
- `configApply(req)` → serialize → validate → snapshot + 원자적 쓰기 → `{ ok, errors, snapshotPath }`.
- `configRollback(req)` → 최신 snapshot 복원.

컨테이너(`container.ts`)가 `AgentConfigEditor`를 인스턴스화하고 위 3 메서드를 노출. `registerIpc`로 채널 배선(기존 패턴).

## 5. UI — `AgentConfigEditorPanel` (신규, Harness Studio 영역)

`apps/desktop/src/renderer/components/AgentConfigEditorPanel.tsx`:
- props: `{ profiles: AgentProfile[] }` (기존 listProfiles 결과).
- 프로필 선택 → 폼에 현재 필드 채움: model(text), mode(select), permissions read/edit/bash/web/task(select allow/ask/deny), tools(comma input), temperature(number), prompt(textarea).
- 버튼:
  - **Validate** → `api.configPreview(req)` → errors 표시.
  - **Diff** → `api.configPreview(req)` → `diff`를 기존 `DiffViewer`로 렌더.
  - **Apply** → `api.configApply(req)` → 결과/`snapshotPath` 표시(성공 시 "백업: …").
  - **Rollback** → `api.configRollback({ rawConfigPath })` → 복원 결과.
- HarnessDashboard에 탭/패널로 노출(예: "Config" 탭) 또는 우측 패널. (배선은 typecheck+스위트 게이트.)

## 6. 데이터 흐름

폼 edits → `configPreview`/`configApply` IPC → `AgentConfigEditor`(현재파일 읽기→serialize→validate→[diff]/[snapshot+쓰기]) → 결과(errors/diff/snapshotPath) → UI.

## 7. 에러 / 안전

| 상황 | 처리 |
|---|---|
| 파일 없음/쓰기 불가 | 에러 메시지 surface, Apply 미수행 |
| validate 실패 | Apply 차단, errors 표시 |
| snapshot 실패 | Apply 중단(백업 없이 절대 안 씀) |
| jsonc 주석 손실 | Apply 전 Diff로 사용자가 확인 |
| rollback 대상 snapshot 없음 | `{ ok:false, error }` |

## 8. 테스트

- `serializeProfileEdit`: md(frontmatter 병합 + prompt) · json(agent[name] 필드 갱신) 왕복 — 순수.
- `validateConfigText`: 유효 jsonc/md, 깨진 jsonc, 잘못된 mode/permission.
- `diffText`: 변경 라인 unified diff.
- `applyConfigText`: temp 파일 → snapshot 생성 + 파일 갱신; validate 실패 시 미작성.
- `rollbackConfig`: snapshot 복원, 없으면 ok:false.
- UI/IPC 배선: typecheck + 데스크톱 스위트 green.

## 9. 범위 밖 (YAGNI)

- Codex/Claude config 어댑터 — 후속.
- jsonc 주석 보존(jsonc-parser surgical edit, Approach B) — 후속.
- 새 프로필 생성/삭제 — 이번엔 기존 프로필 편집만.
- ssh:// 원격 config — 로컬 프로젝트 한정.
- 다중 snapshot 관리 UI — rollback은 "최신 1개" 복원만.

## 10. 수용 기준 (Done)

1. OpenCode 프로필을 폼으로 편집하고 **Validate/Diff/Apply** 할 수 있다.
2. Apply가 **snapshot 백업 후 원자적 쓰기**를 하고, snapshot 실패 시 쓰지 않는다.
3. Diff가 현재↔제안을 unified diff로 보여준다(jsonc 재포맷 포함).
4. **Rollback**이 최신 snapshot을 복원한다.
5. validate 실패 시 Apply가 차단된다.
6. 신규/기존 테스트 + `pnpm typecheck` 통과. 새 IPC **명령** 3개 추가(이벤트/migration 없음).
