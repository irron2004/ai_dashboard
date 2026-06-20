# Handoff — autosci-core 위키 기질 통합 + 인터랙티브 노드 확인

**날짜:** 2026-06-19
**작성:** Claude (subagent-driven development 세션)

이 세션에서 **두 개의 하위 프로젝트**를 brainstorm→spec→plan→구현(TDD)→리뷰까지 완주했다.

---

## 1. 완료된 작업

### (A) autosci-core 위키 기질 통합 — #1 "이음매" — ✅ 머지+푸시 완료
- **브랜치:** `feat/workspace-vault`에 fast-forward 머지됨, `origin`에 푸시됨(`688dee4`).
- **무엇:** Python `autosci-core`(계약 집행 kernel)를 이 TS 모노레포에 **서브프로세스 경계**로 통합. TS는 Python을 import하지 않고 `python -m kernel` / `autosci_core.adapters`를 spawn(claude/codex를 띄우는 그 패턴).
- **산출:**
  - `vendor/autosci-core` submodule(`core-v0.2.0` 핀) + `core.lock` + `scripts/bootstrap-substrate.mjs`(uv venv).
  - `packages/wiki-substrate` — `WikiSubstrate` 포트 + `PythonKernelAdapter`(kernel lint over subprocess) + lint 텍스트 파서 + `KhKernelLintReport` 스키마.
  - 논문 도메인 fixture freeze(`wiki-domains/paper/runtime` 계약 + `packages/wiki-substrate/test/fixtures/paper-golden/` 골든 vault + PDF).
  - Phase-1 fixture drivers(`paper-phase1-drivers.ts`) + vault→UI 그래프 어댑터(`substrate-graph-adapter.ts`).
- **증명:** 골든 vault e2e(→HUMAN_REVIEW_REQUIRED + index.md) + **음성 테스트**(깬 노드 → FAILED, kernel-lint-report 보존). DriverResult에 `status:'failed'` 추가(실패 시 artifacts 보존).
- **설계/계획:** `docs/superpowers/specs/2026-06-19-autosci-core-wiki-substrate-integration-design.md`, `docs/superpowers/plans/2026-06-19-autosci-core-wiki-substrate-integration.md`.

### (B) 인터랙티브 노드 확인 — ✅ 구현+리뷰 완료, **머지 대기**
- **브랜치:** `feat/interactive-node-confirm` (HEAD `7b425f2`, `feat/workspace-vault`에서 분기, **아직 미머지**).
- **플로우:** UI에서 워크스페이스 설정 → 「Wiki 생성(확인 모드)」 → 에이전트가 노드 제안 → **일시정지** → 사용자가 노드 목록 keep/remove/rename → 「이대로 생성」 → 승인 목록으로 위키 작성.
- **메커니즘:**
  - `DriverResult.status:'paused'` + `RunState.awaiting` — 드라이버가 현재 상태에 머문 채 정지(FAILED 아님), resume 시 재실행(`harness-runner.ts`).
  - 확인 모드(`interactive` 플래그)에서 `WRITE_PLAN_CREATED`가 `approved-nodes` 아티팩트 없으면 paused → `LEAD_MERGED`에 정지.
  - **핵심:** `approved-nodes`는 **`LEAD_MERGED` 키**에 저장(재실행 안 되는 단계 → 인덱스 안정). `WRITE_PLAN_CREATED` 키에 두면 resume 시 그 드라이버가 인덱스를 덮어써 사라짐(영구 정지 버그). `artifactByName`이 `runState.artifacts` 인덱스를 읽으므로 `confirmNodes`는 파일 쓰기 + **인덱스 append + saveRunState**까지 해야 함.
  - `STAGING_WRITTEN`이 `approved-nodes`로 `proposals`를 필터(keep/rename, 미매칭 drop)한 뒤 렌더(`make-drivers.ts`).
  - `harnessConfirmNodes` IPC(service→ipc→container→`api.ts` 브릿지).
  - `NodeConfirmPanel.tsx` + WikiGenDashboard "확인 모드" 토글.
- **도메인:** 작동하는 **project-docs** 파이프라인 위에. 비-interactive run은 **100% 기존과 동일**.
- **증명:** 인터랙티브 e2e(정지 → a만 승인 → staging에 a.md만, b.md 없음 → HUMAN_REVIEW_REQUIRED) + 비-interactive 불변 + 드라이버 단위 + 패널 컴포넌트.
- **설계/계획:** `docs/superpowers/specs/2026-06-19-interactive-node-confirmation-design.md`, `docs/superpowers/plans/2026-06-19-interactive-node-confirmation.md`.

---

## 2. 현재 상태 / 검증

- **전체 스위트:** 108 파일, **537 passed / 1 skipped**, exit 0.
- **타입체크:** `tsc -p tsconfig.typecheck.json` + `tsc -p apps/desktop/tsconfig.json` 둘 다 0 errors.
- **최종 whole-branch 리뷰(opus):** (B) Ready to merge = **Yes** (Critical/Important 0).

재현:
```bash
node scripts/bootstrap-substrate.mjs        # .venv-substrate (이미 있으면 빠름) — substrate venv-gated 테스트용
pnpm test                                   # 전체
# 인터랙티브만:
pnpm exec vitest run packages/app-services/src/harness-service.interactive.e2e.test.ts \
  packages/knowledge-harness/src/runtime/make-drivers.interactive.test.ts \
  apps/desktop/src/renderer/components/NodeConfirmPanel.test.tsx
```
> 테스트는 **레포 루트에서** `pnpm exec vitest run <path>`로 돌린다. `pnpm --filter <pkg> test -- <name>` 형태는 이 레포의 vitest include(`packages/**`,`scripts/**`)와 안 맞아 "No test files found"가 난다.

---

## 3. 의도적으로 연기한 것 (스코프 밖)

- **"제목으로 새 노드 추가":** evidence 없는 신규 노드는 PolicyGuard의 `no_evidence` 하드블록과 충돌 → 연기. 확인 단계는 **에이전트가 근거를 갖고 제안한 노드의 큐레이션(keep/remove/rename)** 으로 한정. (`make-drivers.ts`는 미매칭 승인 항목을 합성하지 않고 drop.)
- **에이전트↔사용자 대화형 Q&A:** 이번엔 가벼운 목록 승인만.
- **도메인 overlay 모델(#2):** run/UI 도메인 선택형 + project-docs를 overlay로 — 보류(인터랙티브 흐름을 우선함).
- **논문 도메인 실제 생성(#3):** 워크스페이스 PDF를 읽어 논문 위키를 LLM 생성 — 미구현(현재 paper 도메인은 fixture 기반).

---

## 4. 후속 작업 (non-blocking, 우선순위 순)

1. **(B) 브랜치 머지/푸시** — `feat/interactive-node-confirm`을 `feat/workspace-vault`로 (리뷰 통과). *아직 안 함.*
2. `confirmNodes`에 `prev.awaiting === 'node-confirmation'` precheck 추가(비-정지 run 확인 거부 명시화).
3. rename(인라인 제목수정) 경로 테스트 + `confirmNodes` 렌더러-스토어 테스트 추가.
4. **housekeeping:** `packages/*/node_modules/@apc/.ignored_*` · `apps/desktop/node_modules/@apc/.ignored_*` 벤더 스냅샷 정리 — 이게 세션 내내 본 **stale IDE 진단의 원인**(tsc는 `node_modules` 제외라 영향 없음).
5. "확인 모드" 토글을 헤더 → start-run 드롭다운으로(UX).
6. 로드맵 #2(도메인 overlay) / #3(논문 실제 생성) 재개 — `2026-06-19-autosci-core-wiki-substrate-integration-design.md` §9 분해 참조.

---

## 5. 환경 메모

- WSL에서 vitest를 돌리려고 linux esbuild/rollup 바이너리를 **optionalDependencies**로 추가(`package.json`) + `.npmrc`에 `virtual-store-dir-max-length=120`. os-gated라 Windows install엔 영향 없음(EBADPLATFORM 회피).
- `uv` 0.9.17, python 3.12, sibling `../autosci-core` 워킹트리 존재 가정.
- SDD 진행 ledger: `.git/sdd/progress.md`.
