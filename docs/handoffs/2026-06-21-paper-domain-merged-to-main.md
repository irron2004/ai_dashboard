# Handoff — autosci paper 도메인 main 머지 완료 + 남은 단계

**날짜:** 2026-06-21
**상태:** `main` @ `b1faa1d` (origin 동기) — autosci paper 도메인(Plan 1~5) + SSH 수정이 **main에 머지·푸시됨**.
**선행 핸드오프:** `2026-06-20-paper-domain-plans-1-2-3-and-session-state.md`(상세 아키텍처·함정), 설계: `docs/superpowers/specs/2026-06-20-autosci-paper-domain-generation-design.md`, 계획: `docs/superpowers/plans/2026-06-20-paper-domain-plan{1,2,3,3b,4}-*.md` + `2026-06-21-paper-domain-plan5-*.md`.

---

## 1. 지금 상태 (한 줄)

**autosci 기반 paper 위키 생성 파이프라인이 main에 들어갔고, `domain=paper` opt-in으로 게이트됨.** 추출→렌더→kernel-lint→PDF인제스트→타입드 엣지까지 구현·단위/ WSL 검증 완료. **유일하게 안 된 것 = 실제 LLM end-to-end 실행(경험적 증명).**

## 2. main에 올라간 것 (b1faa1d 머지)

- **도메인 배관(Plan 1):** `Project.domain`('project-docs'|'paper') schema/DB(idempotent 마이그레이션)/IPC/렌더러 선택 UI + `domainPackFor`.
- **DomainPack(Plan 2·3):** `validate`(=kernel lint, 계약을 wiki 옆에 fresh-seed), `renderNode`(타입드 노드→`wiki/<type>/<slug>.md`, gray-matter), `contractDir`(getter, `APC_PAPER_CONTRACT_DIR` override).
- **추출기(Plan 3b):** `makePaperNodeExtractor` — paper 계약(entities/edges/conventions) 주입 LlmAgent → `{nodes, edges}`(`PaperNode`/`PaperEdge`, edges는 passthrough 속성).
- **배선/라우팅(Plan 4·5 T1):** `makeDrivers`가 `domain=paper`면 **paper 드라이버만** 반환(project-docs 에이전트 0회 호출; 미정의 상태는 빈 전진). 8개 상태 전부 paper 드라이버.
- **엣지(Plan 5 T3):** `STAGING_WRITTEN`이 `wiki/graph/edges.jsonl` 기록(한 줄당 JSON).
- **PDF 인제스트(Plan 5 T2):** `scripts/autosci_ingest.py`(autosci SourceReader→`raw/_parsed/*.md`) + `WikiSubstrate.ingest` + TS `SourceReader` 바이너리(.pdf 등) 스킵 + paper `SOURCES_EXTRACTED`가 ingest 호출.
- **부수:** SSH `parseSsh` 이중-authority 복구 + pty dedup, 그래프 "원문 없음" 노드뷰 수정(`resolveStagedRel` stemOf), 런처 경로.

**게이트:** 전부 `domain=paper`일 때만. 기존 project-docs 프로젝트는 byte-identical로 무영향.

## 3. ✅ 검증된 것 / ⬜ 안 된 것

- ✅ 전체 스위트: root **568 pass / 10 skip**, desktop **213 pass / 1 skip**, typecheck **0+0**. 머지된 main == 검증된 branch(동일 트리).
- ✅ **WSL 실증(controller):** kernel-lint 게이트(골든 green/깨진 노드 fail), render→validate 라운드트립(0 issues), driver-format edges.jsonl lint green, PDF→116KB 파싱 마크다운.
- ⬜ **실제 LLM 추출 미검증** — 추출기 단위 테스트는 fake-runner(canned). 실제 모델이 사용자 문서로 계약-적합 타입드 노드를 내는지는 아직 안 돌려봄.

## 4. 남은 단계 = Plan 5 Task 5 (실제 LLM end-to-end)

papers 프로젝트로 진짜 한 번 돌려서 증명한다. **WSL/Linux 환경 필요**(venv가 Linux):
1. 앱에서 papers 프로젝트 **`domain=paper`** 설정(프로젝트 편집 다이얼로그).
2. "생성" 실행. 흐름: materialize(원격 문서→raw/) → `SOURCES_EXTRACTED`(autosci-read로 PDF→raw/_parsed) → `NODE_PROPOSALS_CREATED`(LLM 추출, `SourceReader`가 raw/ 텍스트 주입) → `STAGING_WRITTEN`(renderNode + edges.jsonl) → `VALIDATED`(kernel lint) → HUMAN_REVIEW → promote.
3. **확인 포인트:** LLM이 타입별 필수필드/slug/엣지를 맞춰 내는지, kernel lint green인지, promote 시 워크스페이스 `.apc-wiki`에 반영되는지.
4. lint 실패 시 리포트가 `VALIDATED` 아티팩트에 보존됨(run FAILED). 추출 품질 문제면 추출기 ROLE 프롬프트(`paper-node-extractor.ts`) 튜닝.

> **환경 주의(중요):** native Windows는 venv(Linux `bin/python`) 실행 불가 → `validate`/`ingest`가 graceful skip/에러. **실제 실행·검증은 WSL/Linux 클론에서.** 단, 현재 클론의 `node_modules`는 Windows-native라 WSL vitest는 깨짐(linux esbuild 없음) — WSL에서 돌리려면 그 환경에서 재설치 필요. (`[[win-packaging-clone]]`, `[[windows-verification]]`)

## 5. Plan 5 후속(non-blocking)

- **Task 4 패키징:** `wiki-domains/`를 electron-builder `extraResources`로 + 패키징 빌드에서 `resolvePaperContractDir`/`APC_PAPER_CONTRACT_DIR` 해석 검증(별도 win-packaging 클론).
- 추출기 sources 예산(`budgetSourcesForPrompt`) 적용(현재 `sources.read()` 그대로 — 큰 워크스페이스면 윈도우 오버플로 가능).
- paper 인터랙티브 확인 모드(현재 `WRITE_PLAN_CREATED` 최소판, pause 없음).
- venv-skip 가드 3중복 헬퍼 추출.

## 6. 운영 메모

- **다음 작업은 `main`에서 새 브랜치로.** `feat/workspace-vault`를 이어 쓰면 #11 같은 squash-divergence 재발(이번에 10개 충돌 branch-우선으로 해결). 현재 클론은 `main` 체크아웃 상태.
- **push 인증:** HTTPS + Git Credential Manager. 비대화형 push는 GUI 프롬프트로 막힐 수 있음 → 막히면 `! git push ...` 또는 사용자 터미널. **`gh` 미설치**(PR은 compare 링크로). (`[[gh-cli-not-installed]]`)
- **서브에이전트 월 지출 한도 도달**(이전 세션 후반) — 멀티에이전트는 한도 상향 후. Plan 5 T1~T3·dep수정·머지는 controller 직접 수행·검증.
- 검증 명령: `pnpm exec vitest run packages/knowledge-harness` / `node node_modules/typescript/bin/tsc -p tsconfig.typecheck.json` / desktop은 `pnpm --filter @apc/desktop exec vitest run`. SDD ledger: `.git/sdd/progress.md`.
