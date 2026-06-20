# Handoff — paper 도메인 Plan 1·2·3 + 세션 상태 (autosci 실제 생성 로드맵)

**날짜:** 2026-06-20
**브랜치:** `feat/workspace-vault` @ `42efd8d` (origin 대비 **ahead 20**, 미푸시)
**선행:** `2026-06-20-session-state-and-running-the-app.md`, `2026-06-19-autosci-core-substrate-and-interactive-node-confirmation.md`

이 세션의 목표는 **"내가 제공한 autosci로 실제 위키를 생성"** — 즉 골든 fixture가 아니라 실제 문서로 paper 도메인 위키를 만드는 것이었다. 그 토대(도메인 배관 + 검증 게이트 + 노드 렌더)를 Plan 1~3으로 깔았다. **실제 LLM 생성(Plan 3b)과 배선(Plan 4)은 아직 미착수.**

---

## 1. ⚠️ 미커밋: SSH `parseSsh` 수정 (작업트리에만 있음 — 먼저 처리할 것)

세션 초반에 고친 실제 버그가 **아직 커밋 안 됨**:
- `apps/desktop/src/main/ssh-exec.ts` (M) — `parseSsh`가 **이중 authority** ssh URL(`ssh://u@newhost:22//u@oldhost:22/path`)에서 진짜 원격 경로를 복구하도록 `recoverRemotePath` 추가. (papers 프로젝트의 저장된 repoPath가 이 형태였고, 원격 `cd`가 `//u@oldhost:22/...`로 깨져 project-discovery가 exit 1로 실패하던 버그.)
- `apps/desktop/src/main/pty-manager.ts` (M) — 중복 `parseSsh`를 공유본(`ssh-exec`)으로 통합.
- `apps/desktop/src/main/ssh-exec.test.ts` (??, 신규) — `parseSsh` 5 테스트(이중-authority 복구 포함).
- `run-desktop.sh`·`run-dashboard.bat` (M) — 런처 `cd`/경로를 **Desktop 클론**으로 수정(기존엔 빈 Downloads 클론을 가리킴).

또한 DB의 `papers` 프로젝트 repoPath를 정상형으로 **이미 정리함**: `ssh://hskim@100.66.232.121:22/home/hskim/work/papers` (Tailscale 호스트, 도달 가능 확인). 이건 런타임 데이터라 커밋 대상 아님.

→ **다음 세션 첫 작업: 이 SSH 변경을 별도 커밋으로 정리.** 검증 완료(parseSsh 테스트 + 전체 데스크톱 스위트 207 pass + tsc 0). 단, 안전 분류기가 원격 SSH 셸 접속을 막아 in-app 최종 확인은 사용자 몫.

---

## 2. 이번 세션에 ship한 것 (20 커밋)

### (A) 네이티브 Windows 실행 셋업 (커밋 없음 — 환경 작업)
WSL용으로 설치돼 있던 `node_modules`를 **Windows용으로 클린 재설치** + `electron.exe`(win32) + `better-sqlite3`·`node-pty`를 **Electron 31.7.7 ABI**로 재빌드. 앱이 네이티브 Windows에서 구동 확인(스크린샷). 실행: `pnpm --filter @apc/desktop start`(electron-vite preview). **하네스 GUI는 background 태스크로 띄워야 살아남음**(foreground/detached/Start-Process는 SIGTERM에 죽음).

### (B) 부수 버그 2건 수정
- `1f644b5` **"원문 없음"** — 그래프에서 노드 클릭 시 본문 대신 "원문 없음: inbox/proposals/<id>.json". `resolveStagedRel`의 `stemOf`가 `.md`만 떼어내 proposal `.json` 노드가 렌더된 `nodes/<id>.md`에 매칭 안 되던 문제. 확장자 무관 절삭으로 수정(점 포함 id `decision.real` 과대절삭 없음 — 테스트로 봉인).
- `8823c8e` `Project` 테스트 픽스처 11곳에 `domain` 추가(Plan 1 스키마 필수화로 깨진 전체 tsc).

### (C) paper 도메인 Plan 1·2·3 (스펙+계획 문서 포함)
스펙: `docs/superpowers/specs/2026-06-20-autosci-paper-domain-generation-design.md`
계획: `docs/superpowers/plans/2026-06-20-paper-domain-plan{1,2,3}-*.md`

---

## 3. paper 도메인 아키텍처 — "도메인 팩 오버레이"(A안)

기존 harness(상태머신·팬아웃·인터랙티브 확인·promote·UI)는 그대로 두고, **도메인마다 바뀌는 것만 `DomainPack`으로 격리**. `packages/knowledge-harness/src/domains/`:

```
DomainPack {
  id: 'project-docs' | 'paper'
  get contractDir(): string | undefined        // paper = wiki-domains/paper/runtime (getter, env override 가능)
  validate?(wikiDir, { substrate }): Promise<KhKernelLintReport>   // paper = kernel lint
  renderNode?(node: TypedNode): RenderedNode    // paper = 타입드 노드 → wiki/<type>/<slug>.md
}
domainPackFor(domain) → projectDocsPack | paperPack
```
- `project-docs` 팩 = 현 동작 그대로(무변경 위임), `validate`/`renderNode` 미정의 → 기존 TS 검증기·렌더 유지.
- 새 도메인 = 팩 하나 추가. **방향은 멀티도메인 일반화, 구현은 paper-우선.**

### Plan별 완료 상태

| Plan | 산출 | 상태 | 증명 |
|---|---|---|---|
| **1 배관** | `Project.domain`(schema/DB/IPC/UI 선택) + `domainPackFor` | ✅ | 최종 리뷰 Yes, 루트 스위트 541 pass, tsc 0 |
| **2 validate** | `DomainPack.validate` + paper kernel-lint 게이트 | ✅ | 최종 리뷰 Yes + **WSL 실증** |
| **3 renderNode** | 타입드 노드 → `wiki/<type>/<slug>.md`(gray-matter) | ✅ | T1 리뷰 Approved + **render→validate 라운드트립 WSL 실증** |
| **3b** | 인제스트(autosci-read) + **LLM 타입드 노드 추출** + edges | ⬜ | — |
| **4** | make-drivers 배선 + papers 라우팅 + 패키징 + e2e | ⬜ | — |

### 핵심 사실 / 함정 (다음 세션 필독)
- **커널 sibling 제약(WSL로 발견):** autosci 커널은 위키 페이지를 **`contractDir.parent`** 에서 찾는다. 따라서 `validate`는 계약을 wiki dir **옆**(`<parent-of-wikiDir>/runtime`)에 **fresh-seed**(rmSync→cpSync)한 뒤 `{contractDir: 거기, wikiDir}`로 lint한다. 저장소 계약 dir + 무관 wikiDir를 넘기면 **엉뚱한 빈 트리를 lint → 깨진 노드를 못 잡는다**(초기 설계 버그였음, 수정 완료).
- **WSL 실측 게이트:** 골든 → 0 issues/exit 0. title 제거 → `[required] …: 'title' missing/empty`/exit 1.
- **renderNode 라운드트립:** 골든 노드 전체를 gray-matter로 재렌더 → lint 0 issues. `date_added`도 `'2026-06-18'` 따옴표 문자열로 정상(우려한 js-yaml date 변환 없음).
- **paper 계약(ML 연구, 그대로 사용):** `papers`(title/slug/year) · `modules`(kind/stage/evidence[{metric,result,confidence}]…) · `pipelines` · `pipeline_trials`(status/metrics/success_reason) + edges `uses_module`/`pipeline_from_paper`/`alternative_to`. 가설/실험결과 = trial/evidence로 매핑. (`wiki-domains/paper/runtime/schema/*.yaml`)
- **TypedNode 모양:** `{ type, slug, fields: Record<string,unknown>, body? }`. renderNode는 **스키마-무관**(fields를 YAML로 직렬화만). 계약-유효성은 `validate`(kernel)의 몫.

---

## 4. 환경 함정 (계속 영향 — 중요)

네이티브 Windows 실행을 위해 `node_modules`를 Windows용으로 재설치한 결과 **교차 플랫폼 분리**가 생겼다:
- **autosci venv(`.venv-substrate`)는 Linux(WSL) 빌드**(`bin/python`, py3.12). 네이티브 Windows에선 실행 불가.
- 그래서 paper 통합 테스트(`*.int.test.ts`)는 **native Windows에서 깨끗이 skip**(`winRunnable = platform!=='win32' || venv가 Scripts/`), **Linux/CI에서 실제 green**. 실제 게이트/라운드트립은 **controller가 WSL로 직접 증명**했다.
- **WSL vitest는 지금 깨짐:** Windows 재설치로 linux esbuild/rollup(os-gated optionalDeps)이 빠짐. → WSL에서 테스트 돌리려면 그 클론에서 재설치 필요.
- **`pnpm install` 실패:** `apps/desktop`의 `blockExoticSubdeps`(electron-builder git subdep, 기존 이슈)로 막힘. Plan 3의 gray-matter dep은 **lockfile 수동 편집**(이미 store에 있어 hoist됨, 런타임 정상). 향후 dep 추가 시 이 점 유의. (`[[win-packaging-clone]]` 참조)

---

## 5. 실행 / 검증 빠른 참조

```bash
# 앱 (네이티브 Windows; background로 띄워야 GUI 생존)
pnpm --filter @apc/desktop start

# 테스트 (레포 루트에서)
pnpm exec vitest run packages/knowledge-harness            # 222 pass / 5 skip (venv-gated)
pnpm exec vitest run packages/knowledge-harness/src/domains # 도메인 팩 단위
node node_modules/typescript/bin/tsc -p tsconfig.typecheck.json   # 0 errors

# 커널 게이트/라운드트립 실증 (WSL — venv가 Linux)
wsl bash -lc '.venv-substrate/bin/python -m kernel lint --contract-dir <root>/runtime --wiki-dir <root>/wiki'
#  (단, contractDir·wikiDir는 sibling이어야 함 — §3 함정)
```
- SDD 진행 ledger: `.git/sdd/progress.md` (Plan 1·2·3 태스크별 커밋/리뷰 기록).
- node v22.22.3, pnpm 9.15.9, uv 0.9.17, WSLg(DISPLAY=:0).

---

## 6. 다음 단계

1. **(먼저) SSH 변경 커밋** (§1).
2. **Plan 3b — 실제 LLM 타입드 노드 추출 (가장 큰 미지수, 설계 논의 권장):**
   - autosci-read로 `raw/` 인제스트(이미 `WikiSubstrate.checkSources` 있음; 파싱 텍스트 반환까지 확장 필요).
   - paper 추출기: 프롬프트에 paper 계약(entities/edges/conventions) + autosci skill 주입 → `TypedNode[]`. `nodeSchema`(Zod)로 출력 강제.
   - 타입드 엣지(`uses_module` 등) → `wiki/graph/edges.jsonl` 렌더(renderNode는 노드만; edge 렌더는 별도).
   - PolicyGuard 도메인-인지(project-docs용 shared-floor/no_evidence가 타입드 노드와 충돌 안 하게).
3. **Plan 4 — 배선/라우팅/e2e:** make-drivers `STAGING_WRITTEN`→`domainPack.renderNode`, `VALIDATED`→`domainPack.validate`(venv python으로 substrate 구성), `domain==='paper'` 라우팅, **`wiki-domains/` 패키징**(electron-builder extraResources — `paperPack.contractDir`가 패키징 빌드에서 해석되는지 검증), e2e(papers fixture→HUMAN_REVIEW+index) + project-docs 회귀 + UI 그래프 스모크.

**Plan 4까지 끝나야** papers 프로젝트에서 "생성"이 실제 paper 위키를 만든다. 현재는 도메인=paper 설정·검증·렌더는 되지만 **생성 버튼은 아직 project-docs 파이프라인**을 돈다.

---

## 7. 이연된 사소 항목 (리뷰가 기록, non-blocking)
- venv-skip 가드 3중복(`paper-pack.lint.int`, `python-kernel-adapter.int`, `paper-phase1.e2e`) — 기존 2개는 `winRunnable` 가드 없음 → 헬퍼로 추출.
- 일부 커밋 메시지에 BOM(`﻿`) — PowerShell here-string 커밋 흔적. 이후 `-F` temp 파일로 ([[git-commit-heredoc-quotes]]).
- `container.ts` harnessRun 긴 spread 라인, `describe.skipIf` 미사용 등.
