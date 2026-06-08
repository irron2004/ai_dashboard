# Handoff — 전 문서→위키 원클릭 + 커버리지 검증 (구현 완료)

- **Date**: 2026-06-08
- **Branch**: `docs/knowledge-harness-pipeline-spec`
- **PR**: #1 → main (이 기능 + PM Home + 기존 harness 작업 포함)

## 0. 한 줄 요약

사용자 핵심 목표("하위 경로 전 문서를 LLM 위키로 변환하는 원클릭 harness + 중간 과정 시각화로 검증")를 **brainstorming→spec→plan→구현(subagent team-mode dev+QA, 8 Task 전부 APPROVED)** 으로 완성했다. 최종 종합 리뷰 **READY_TO_MERGE**. 전 스위트 green.

## 1. 이번 세션에 한 일

### A. 설계 결정 (brainstorming)
- "잘 구성됐는지 테스트" = **산출물(run 결과) 품질** 검증으로 정의(파이프라인 구성 검증 아님).
- 1차 검증 화면 = **커버리지 매트릭스**(원본 문서→위키 노드, 누락 빨강).
- 소스 확보 = **A안**: 프로젝트 문서를 `vault/raw/project-docs/`로 materialize.
- spec: `docs/superpowers/specs/2026-06-08-docs-to-wiki-coverage-design.md`
- plan: `docs/superpowers/plans/2026-06-08-docs-to-wiki-coverage.md` (8 Task, TDD)

### B. 구현 (8 Task)
1. `KhCoverageReport` 스키마 + 순수 `buildCoverageReport(sourcePaths, proposals)` — covered=노드가 evidence로 인용 / unmapped=미인용.
2. 파이프라인 `HUMAN_REVIEW_REQUIRED`에서 `coverage-report` artifact emit (`sources.read()` + proposals 기반).
3. `SourceMaterializer.materializeProjectDocs(repoPaths, vaultRoot)` — `.md/.markdown/.txt` 재귀 복사→`raw/project-docs/<i>/`, 제외(node_modules/.git/dist/build/.worktrees + vault 자기), 멱등(project-docs만 clear), 기존 raw/ 불변.
4. `materialize?` 플래그 배선: `HarnessRunReq`(IPC) → `HarnessService.run`(materialize 먼저) → `container.harnessRun`(registry로 repoPaths 해결).
5. store `startHarnessRun(materialize?)` 플래그 전달.
6. 순수 `CoverageMatrix` 컴포넌트(요약/소스↔노드/누락 목록/empty state).
7. `HarnessDashboard`에 "전 문서로 위키 생성" 버튼 + "Coverage" 탭 + CSS.
8. 전체 검증 + 최종 종합 리뷰.

### C. end-to-end 데이터 흐름 (검증됨)
버튼 → `startHarnessRun(true)` → `api.harnessRun({materialize:true})` → container가 registry에서 repoPaths 해결 → `harness.run`이 materialize 먼저 → `raw/project-docs/` 적재 → 파이프라인 `SourceReader`가 `raw/` 전체 읽음 → `coverage-report` emit → UI `coverageData = artifacts.find(name==='coverage-report')` → `CoverageMatrix`. 경로 네임스페이스(`raw/project-docs/…`)가 materializer/SourceReader/evidence/builder 전부 일치.

## 2. 커밋 (이 세션 신규, base `0a1c880` 위 — PM Home handoff 다음)

```
c63c493 feat(desktop): Coverage tab + 전 문서로 위키 생성 button
23c9fcb feat(desktop): CoverageMatrix component
599475f feat(desktop): startHarnessRun(materialize)
2ab5b7d feat: thread materialize flag (service+container+contract)
a0e2511 test(app-services): materializer raw/ preservation + vault-exclusion safety
f2d210f feat(app-services): SourceMaterializer
b0bdb3d feat(knowledge-harness): emit coverage-report artifact
00414ef feat(knowledge-harness): coverage-report schema + pure builder
44076bc docs: implementation plan (8 tasks, TDD)
14e397b docs: design (approach A)
```
- 미커밋 없음(트리 clean).

## 3. 검증 상태 (전부 green)

```bash
pnpm typecheck                          # clean (root + desktop)
npx vitest run packages/knowledge-harness   # 121/121
npx vitest run packages/app-services        # 54/54
cd apps/desktop && npx vitest run           # 60/60
```

## 4. 다음에 할 일 / 남은 항목 (low-severity, 비차단)

- **누락 문서 클릭 "열기"**: 현재 `window.alert(path)` 스텁. 실제 열기는 `shell.openPath` IPC 채널 신규 필요.
- **manifest `rel` 접두어**: materializer manifest의 `rel`이 `raw/` 접두어 없음(`project-docs/0/..`) vs SourceReader `source_path`(`raw/project-docs/0/..`). 현재 manifest는 폐기되어 무영향. 향후 manifest를 UI에 노출하면 접두어 통일 필요.
- (스코프 밖, 향후) 누락 문서 자동 재처리, 문서 내부 부분 커버리지, 코드 파일 위키화, CI eval 임계값 golden 회귀.

## 5. 재현·검증 명령 / 핵심 파일

```bash
# 핵심 파일
packages/knowledge-harness/src/eval/coverage-report.ts        # buildCoverageReport
packages/knowledge-harness/src/runtime/make-drivers.ts        # ARTIFACTS.coverageReport emit
packages/app-services/src/source-materializer.ts              # materializeProjectDocs
packages/app-services/src/harness-service.ts                  # run({materialize, repoPaths})
apps/desktop/src/main/container.ts                            # harnessRun resolves repoPaths
apps/desktop/src/renderer/components/CoverageMatrix.tsx       # UI
apps/desktop/src/renderer/components/HarnessDashboard.tsx     # Coverage tab + button
```

## 6. 참고

- 사용자 핵심 방향 메모리: `memory/docs-to-wiki-harness-goal.md` (이 작업으로 1차 충족 — 커버리지 검증까지).
- 다음 세션은 resume 대신 이 폴더에서 새 세션으로 시작하면 SessionStart hook이 이 handoff를 자동 주입한다.
