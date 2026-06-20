# Handoff — 세션 종료 상태 + 앱 실행 방법

**날짜:** 2026-06-20
**선행 핸드오프(상세 기술):** `docs/handoffs/2026-06-19-autosci-core-substrate-and-interactive-node-confirmation.md`

이 문서는 **현재(세션 종료) 상태**와 **앱을 실제로 띄우는 법**에 집중한다. 두 기능의 설계/구현 상세는 위 선행 핸드오프와 `docs/superpowers/specs|plans/2026-06-19-*` 참조.

---

## 1. 현재 git 상태 (반영 완료)

- **브랜치:** `feat/workspace-vault` @ `720c3d2` — 작업트리 clean, `origin/feat/workspace-vault`와 동기(ahead 0).
- **푸시됨:** `688dee4..720c3d2 → origin`. 아래 두 기능 + 핸드오프가 전부 포함.

| # | 기능 | 상태 |
|---|---|---|
| 1 | autosci-core 위키 기질 통합 (`packages/wiki-substrate`, vendor submodule, kernel lint 게이트) | ✅ 머지+푸시 |
| 2 | 인터랙티브 노드 확인 (paused 러너 계약, `approved-nodes`@LEAD_MERGED, `harnessConfirmNodes` IPC, `NodeConfirmPanel`) | ✅ 머지+푸시 |

- **검증:** 전체 스위트 537 pass / 1 skip, `tsc`(shared+desktop) 0 errors, 최종 whole-branch 리뷰(opus) = Ready to merge Yes.

---

## 2. 앱 실행 방법 (중요 — 운영 메모)

### ⚠️ 런처 경로 불일치 (반드시 인지)
`run-dashboard.bat` → `run-desktop.sh`는 **`/mnt/c/Users/irron/Downloads/ai_dashboard-main/ai_dashboard-main`**(별도 클론)로 `cd`한다. 우리가 개발/머지한 코드는 **`/mnt/c/Users/irron/Desktop/my/ruahverce/ai_dashboard-main`**에 있다. → **더블클릭 런처는 우리 기능이 없는 옛 복사본을 띄운다.**

선택지:
- (A) `run-desktop.sh`의 `cd` 경로를 Desktop 복사본으로 바꾼다(더블클릭으로 최신 화면). **아직 안 함 — 원하면 해줄 수 있음.**
- (B) Downloads 복사본에서 `git pull` 해서 최신을 받는다(그 클론이 같은 origin을 추적한다면).

### 우리 코드로 띄우기 (확인됨: 빌드 성공)
**별도 WSL 터미널(Claude Code 밖)** 에서 실행 — Claude의 Bash 샌드박스는 detached GUI를 죽이므로(exit 144), 사용자 본인 터미널이 확실:
```bash
cd /mnt/c/Users/irron/Desktop/my/ruahverce/ai_dashboard-main
pnpm --filter @apc/desktop start      # electron-vite preview: ~5s 재빌드 후 WSLg 창
```
- 빌드 검증됨: `pnpm --filter @apc/desktop build` exit 0, 메인 프로세스 정상 기동(네이티브 모듈 better-sqlite3/node-pty 크래시 없음).
- WSL 로그의 `Failed to connect to the bus`(dbus)·`Exiting GPU process`는 **정상** — 소프트웨어 렌더링으로 fallback, WSLg 창은 뜬다.
- 네이티브 모듈이 깨지면: `pnpm --filter @apc/desktop rebuild`(better-sqlite3) / `rebuild:pty`(node-pty).

### 기능 확인 동선
Wiki Gen 탭 → **"확인 모드"** 체크 → 워크스페이스 지정 → 생성 → 에이전트가 노드 제안 후 **일시정지** → **노드 확인 패널**(keep/remove/rename) → **「이대로 생성」** → 위키 작성 → 검수/promote.

---

## 3. 후속 작업 (non-blocking)

1. (운영) `run-desktop.sh` 경로를 Desktop 복사본으로 수정 — 더블클릭 런처가 최신 코드를 띄우게.
2. (housekeeping) `node_modules/@apc/.ignored_*` 벤더 스냅샷 정리 — 개발 중 본 **stale IDE 진단의 원인**(authoritative는 `tsc -p tsconfig.typecheck.json` + `apps/desktop/tsconfig.json`).
3. `confirmNodes`에 `prev.awaiting==='node-confirmation'` precheck; rename 경로 테스트 + `confirmNodes` 스토어 테스트.
4. "확인 모드" 토글을 헤더 → start-run 드롭다운(UX).
5. **로드맵:** #2 도메인 overlay(run/UI 도메인 선택형), #3 논문 도메인 실제 LLM 생성. (분해: `2026-06-19-autosci-core-wiki-substrate-integration-design.md` §9.)
6. (선택) `feat/workspace-vault` → `main` PR.

---

## 4. 테스트/환경 빠른 참조

- 테스트는 **레포 루트에서** `pnpm exec vitest run <path>` (`pnpm --filter <pkg> test -- <name>`는 안 먹음).
- substrate venv-gated 테스트: `node scripts/bootstrap-substrate.mjs` 후 `pnpm test`.
- node v22.22.3, pnpm 9.15.9, uv 0.9.17, WSLg(DISPLAY=:0) 가용.
- SDD 진행 ledger: `.git/sdd/progress.md`.
