# Handoff — 하네스 config 폼 편집 + diff/validate/apply (AC#8, 구현 완료)

- **Date**: 2026-06-09
- **Branch**: `docs/knowledge-harness-pipeline-spec`
- **PR**: 신규 → main 예정

## 0. 한 줄 요약

PRD P0 격차 **#8**(Harness Studio가 provider config를 parse/diff/validate/apply) 충족. OpenCode 프로필을 폼으로 편집 → Validate/Diff/Apply(snapshot+원자적 쓰기)/Rollback. brainstorm→spec→plan→subagent 6 Task team-mode 완료, 최종 리뷰가 잡은 블로커(diff 파싱)까지 수정.

## 1. 한 일 (6 Task + fix)

- **C1** `ProfileEdits`(@apc/shared) + `AgentConfigEditor.serializeProfileEdit` — 폼 edits를 config로 직렬화(md=gray-matter 왕복, jsonc=재포맷, permissions→permission).
- **C2** `validateConfigText`(파싱+mode/permission 값) + `diffText`(공통접두/접미 trim unified diff).
- **C3** `applyConfigText`(validate→snapshot→원자적 쓰기, 실패 시 미작성) + `rollbackConfig`(최신 snapshot 복원) + `previewEdit`/`applyEdit`(IO).
- **C4** IPC 3개(`configPreview`/`configApply`/`configRollback`, ipc.ts 핸들러는 listProfiles처럼 dynamic import) + api 래퍼.
- **C5** `AgentConfigEditorPanel`(model/mode/permissions/temperature 폼 + Validate/Diff/Apply/Rollback) + HarnessDashboard "Config" 탭.
- **fix(`10d0218`)** 최종 리뷰 블로커: `diffText`가 `diff --git a/.. b/..` 헤더를 빠뜨려 `parseUnifiedDiff`(DiffViewer)가 빈 결과 → 헤더 추가, **통합 테스트로 DiffViewer 파싱 증명**. + UI 핸들러 try/catch(파일없음 등 IPC 에러 노출, §7).

## 2. 커밋 (base `4928d2c`=plan 위)

```
10d0218 fix(harness): diffText emits git-header so DiffViewer parses it; UI surfaces IPC errors
f125898 feat(desktop): AgentConfigEditorPanel + Config tab
5320e6e feat(desktop): config preview/apply/rollback IPC
6aa3998 feat(harness): AgentConfigEditor apply(snapshot+atomic) + rollback + preview/applyEdit
d8c9d9e feat(harness): AgentConfigEditor validateConfigText + diffText
b8eb04a feat(harness): AgentConfigEditor.serializeProfileEdit + ProfileEdits
```

## 3. 검증 (전부 green)

```bash
pnpm typecheck                          # clean
npx vitest run packages/harness packages/shared   # 57
cd apps/desktop && npx vitest run       # 74 (config-diff-integration 포함)
```
최종 리뷰: end-to-end 체인 무결(UI→api→CH→ipc.ts→AgentConfigEditor, arg order/channel 일치), `ProfileEdits` 단일 정의, 안전 불변식(validate/snapshot/atomic) IPC 경로까지 유지.

## 4. 남은 것 / 후속 (low, 비차단)

- 폼에 **tools/description/prompt 필드 미노출**(백엔드는 지원) — UI 확장 후속.
- `ConfigValidation` export 미사용(dead) — 정리 후속.
- diff가 변경 영역을 -전체/+전체로(비최소) — line-level LCS는 후속.
- **Codex/Claude config 어댑터** — 후속(이번은 OpenCode).
- jsonc **주석 보존**(jsonc-parser surgical edit) — 후속.
- ssh:// 원격 config — 로컬 프로젝트 한정(원격은 별도 설계 필요).

## 5. 핵심 파일

```
packages/shared/src/harness-schema.ts            # ProfileEdits
packages/harness/src/agent-config-editor.ts      # AgentConfigEditor (serialize/validate/diff/apply/rollback)
apps/desktop/src/main/ipc.ts                     # config* 핸들러
apps/desktop/src/renderer/components/AgentConfigEditorPanel.tsx  # 폼 UI
apps/desktop/src/renderer/components/HarnessDashboard.tsx        # Config 탭
```

## 6. 다음 후보

- **#6 통합검색**(session+knowledge 단일 결과셋) — 단, knowledge 인덱싱이 데스크톱에 미연결이라 다층 작업. (사용자가 #8 먼저 선택했음.)
- codex 런타임 end-to-end(사용자 진단 입력 대기).
