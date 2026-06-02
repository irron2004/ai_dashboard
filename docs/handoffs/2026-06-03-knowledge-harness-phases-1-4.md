# Handoff — Knowledge Harness 구현 (Phase 1~4) + 팀 리뷰

- **날짜**: 2026-06-03
- **브랜치**: `docs/knowledge-harness-pipeline-spec` (repo: `ai_dashboard`)
- **세션 성격**: Ralph loop — Phase 1→4 구현, phase마다 commit, 완료 후 team-mode 평가 + 개선 반복.

## 1. 이번 세션에 한 일 (결론 중심)

증거 기반 위키 파이프라인 `@apc/knowledge-harness`를 **4개 phase 전부 구현**했다. 기존
`GenerateService`(one-shot)는 건드리지 않고 새 패키지로 병행. 모든 작업은 TDD + task별 커밋.

- **Phase 1 — 런타임 골격**: kh-schema 계약(Zod, `@apc/shared`), 12-state 머신, FeatureGate(평평한
  yml subset 파서, fail-safe), RunArtifactStore(fs, atomic temp+rename), RunLock, HarnessRunner
  (driver 주입, resume, FAILED). `harness/` config 3종.
- **Phase 1 하드닝** (사용자 코드리뷰 반영): RunLock을 `advance()`에 연결(acquire/finally-release,
  foreign-lock 가드), terminal state(FAILED/MERGED) idempotency, atomic write + `missingArtifacts`
  resume 검증, feature-gate YAML-subset 문서화 + 오탈자 fail-safe 테스트. **#2(repo-root 경로)는
  반례 검증으로 푸시백** — `4× ../` = repo root가 맞고 5×는 오버슈트(empirically + 테스트 green).
- **Phase 2 — LLM agents + staging**: LlmAgent base + 5 LLM agent(discovery/reader/classifier/
  extractor/lead) + ObsidianWikiWriter(결정론 WritePlan 실행기) + StagingVault(vault→staging 복사 +
  `git diff --no-index`) + `makeDrivers(deps)` 팩토리. **harness-runner.ts는 한 줄도 안 바뀜**(driver
  factory로만 주입). 테스트는 전부 `FakeAgentRunner`(실 LLM 호출 없음).
- **Phase 3 — policy/verify/eval (결정론)**: SecretScanner(마스킹 regex 카탈로그), PolicyGuard
  (no_evidence/shared_evidence_min → block, raw/delete → block, canonical_overwrite/secret → warn),
  GraphIntegrity(broken/dup/orphan/mismatch/missing-backlink), md-yaml + obsidian-link validator,
  EvalReport 빌더. NODE_PROPOSALS_CREATED에서 PolicyGuard 차단 시 run FAILED, VALIDATED에서 검증,
  HUMAN_REVIEW_REQUIRED에서 EvalReport+final-report 생성.
- **Phase 4 — 표면**: HarnessPromoteService(staging→real vault 반영, canonical은 `.proposal.md`로 보존),
  HarnessService(run/show/promote, `@apc/app-services`), CLI(`knowledge-harness run|show|promote` +
  bin), 데스크톱 IPC 3채널(`c:harnessRun`/`c:harnessGetRun`/`c:harnessPromote`) + container DI.
- **타입 정합성**: 리포에 typecheck 스텝이 없어(vitest=esbuild) 안 잡히던 tsc 오류를 신규 파일에 대해
  수정 — LlmAgentConfig의 Zod Input 미고정으로 O를 OUTPUT 타입에 바인딩, HarnessRunResult 단일 형태화.

**부수적으로 잡은 실제 결함 2건**: (a) 데스크톱 runsRoot가 vault **안**에 있어 staging 복사가
self-subdir로 크래시 → vault 바깥으로 이동 + 컨테이너 기본값 수정. (b) LLM agent 출력 타입이 Zod
input 형태로 추론되던 문제.

## 2. 변경 파일 / 커밋 상태

- **신규 패키지**: `packages/knowledge-harness/` (runtime, agents, policy, verify, eval, staging).
- **수정**: `packages/shared/src/kh-schema.ts`(+index), `packages/app-services/src/harness-*.ts`(+index,
  package.json bin/dep), `apps/desktop/src/{shared/ipc-contract,main/container,main/ipc}.ts`(+ipc.test).
- **config/docs**: `harness/{feature-gates.yml,harness-rules.md,run-state-machine.yml}`,
  `docs/superpowers/plans/2026-06-02-knowledge-harness-phase{1,2,3,4}.md`.
- **커밋**: `40e230a`(Phase1 첫 모듈)…`2743e7d`(타입수정)까지 ~33개, **task당 1커밋**. 전부 커밋됨.
- **미커밋(이번 작업 아님, 세션 시작부터 존재)**: `remote-generate.ts`, `packages/agents/*adapter*`,
  `packages/shared/src/ingest-schema*`, untracked `packages/agents/src/source-discovery.ts`,
  `docs/superpowers/specs/2026-06-02-llm-wiki-agent-spec.md`. **건드리지 않았으니 그대로 둘 것.**
- **로컬 전용**: `.claude/ralph-progress.md`(gitignored) — loop 상태 추적기.

## 2-b. 팀 리뷰 + 개선 반복 #1 (완료)

Workflow `wf_82e87259-8ac` (34 agents): **28 raised / 27 confirmed → 12 distinct issues**. 핵심 결론:
"아키텍처는 건전하나 하드 불변식이 LLM 프롬프트 + non-blocking warn에만 의존". **12개 전부 수정 완료**
(결정론 백스톱으로 전환). 주요 커밋:
- **canonical 결정론 강제**: Writer가 mode 무관 `.proposal.md` 라우팅 + promote가 applied[]의 canonical 거부.
- **secret promote 차단**: VALIDATED secret-scan !ok면 promote 거부(`allowSecrets` override).
- **경로 탈출 차단**: `resolveInside`(separator 경계) — staging writeDoc + promote from/to.
- **RunLock 연결**: `HarnessService.run`에 프로젝트당 in-process lock.
- **FAILED reason 전달**(error→reason), **eval min-evidence**, **SecretScanner 패턴 확장+matchAll(/g)**.
- **hygiene**: `listMarkdown`→`runtime/vault-fs.ts`, 미사용 deps 제거, CLI `AgentKind` 재사용.
- **테스트 추가**: resume-with-real-drivers e2e, secret-blocks-promotion e2e.
- **문서 정합**: feature-gates.yml 정직 주석 + impl-design **§14 MVP narrowing**(honored 5 gates,
  canonical proposal-only, 수용기준 #7/resume-CLI는 P1).
- 결과: **packages 214 + desktop 20 green**, 신규 파일 tsc-clean. 커밋 ~10개 추가.

## 2-c. 팀 리뷰 라운드 2 + 개선 반복 #2 (완료)

Workflow `wf_75252b8b-34c`: **13 raised / 13 confirmed**. 결론: 라운드1 fixes의 canonical 백스톱은
**수렴(triple-enforced, regression 없음)**, 그러나 1 block + 4 major 발견(내가 만든 regression 2건 포함).
8개 distinct 이슈 전부 수정:
- **secret scan 재스코핑**(block+major): `.md`만/전체 vault 복사본 스캔 → **이번 run이 쓴 파일(applied+proposals)만, 확장자 무관** 스캔. (비-.md 비밀 탐지 + 기존 vault 비밀 오탐 lockout 해소)
- **lock regression**(major, 내 iteration#1): 동시 run이 advance에서 uncaught throw → `HarnessService.run`이 catch해 `{ok:false,reason}`.
- **append_section truncate**(major): 기존 staged 내용 읽어 append.
- **eval min-evidence 테스트**(major), backslash 경로 정규화 + `isRaw` 공유(vault-fs), policy-guard/writer 중복 제거,
  `--allow-secrets` CLI valve, IPC strict-parse, contract `allowSecrets/refusedCanonical`, scanner 패턴 확장(stripe/gitlab/azure/pgp/*_key), CLI reason 테스트.
- 결과: **packages 218 + desktop 20 green**, 신규 파일 tsc-clean. (commits after e08cbdb)

## 2-d. 팀 리뷰 라운드 3 + 개선 반복 #3 → 수렴 (완료)

Workflow `wf_96661c77-2a0`: **7 raised / 6 confirmed**. iteration#2 fixes 전부 코드에서 유지 확인,
내가 iter#2에 넣은 regression 1건 + minor 테스트 갭 2건. 전부 수정:
- **secret_assignment regex 과매칭**(iter#2 regression): `primary_key:`, `session token:`,
  `client_secret: word` 같은 평범한 prose를 매칭 → fail-closed로 정상 promote를 막음. 명시적 credential
  키 이름(password/api_key/secret_key/access_token/auth_token/aws_secret_access_key)만 매칭하도록 좁힘
  + negative-prose 회귀 테스트.
- vault-fs backslash/`isRaw` 커버리지, IPC strict-parse 거부 테스트.
- 결과: **packages 220 + desktop 21 green**.

**수렴 판정**: 라운드3 synthesis가 "secret_assignment 좁히고 + 2개 테스트 갭 메우면 수렴"이라고 명시했고
정확히 그 3가지를 완료. confirmed 추세 27→13→1로 수렴. **이 지점이 깨끗한 수렴 체크포인트.**

## 2-e. 수렴 후 개선 (자신있게 가능한 것 전부 완료)

- [x] **resume**: `HarnessService.resume({runId})` + CLI `resume <runId>` + `c:harnessResume` IPC (수용 #6).
- [x] **eval secret_warnings 완전성**: evidence-text(PolicyGuard) + body-content(VALIDATED scan) 합산.
- [x] **run-dir §6.2 준수**: `diff.patch` + `final-report.md`를 run 루트 top-level 파일로 기록(RunArtifactStore.writeFile).
- 결과: **packages 224 + desktop 21 green**. 이로써 제품 판단 불요 + 고신뢰 개선은 소진.

- [x] **hash-gated canonical promote (수용 #7)**: `HarnessPromoteService.promoteCanonical` +
  `HarnessService.promoteCanonical` + `c:harnessPromoteCanonical` IPC. ConflictManager로 generic
  hash-gating(match→promote, stale→conflict doc). packages 228 + desktop 21 green. (generic 구현이라
  vault-layout 결정 불요였음 — 앞서 과도하게 보수적으로 판단했던 항목.)

## 2-f. 렌더러 UI — 이미 존재(외부 추가) + 새 채널 연결 완료

`apps/desktop/src/renderer/components/`에 `HarnessDashboard/HarnessPanel(+test)/HarnessRunList` +
`DiffViewer/MarkdownViewer`가 이미 있고 desktop 테스트 green(21). 내 백엔드 변경과 호환됨. `api.ts`에
`harnessResume`/`harnessPromoteCanonical`을 추가해 새 IPC 채널까지 렌더러에서 호출 가능.

## 상태: MVP 수용 기준 §12의 1~8 전부 충족(7번 hash-gated canonical promote 포함), UI는 IPC 경계까지
## 연결됨. packages 228 + desktop 21 green, 61 commits. 고신뢰·비-제품판단 작업 소진.

## 2-g. 데스크톱 UX 연결 (resume 노출)

- `store.resumeHarnessRun`(api.harnessResume 호출, ok면 refresh) + HarnessDashboard hero에 **Resume 버튼**.
  acceptance #6 데스크톱 UX까지 완료. (렌더러 store는 단위 테스트 하네스가 없어 wiring+typecheck만; 동작
  단위테스트는 미실시 — promoteHarnessRun과 동일 패턴 mirror.)

## 상태 최종: packages 228 + desktop 21 green, 63 commits. acceptance §12 1~8 충족.
## resume는 backend→CLI→IPC→UI 전 구간. canonical hash-gated promote는 backend→IPC→api 까지(UI 버튼은 아래).

## 3. 남은 backlog (전부 non-blocking)

- **canonical-promote UI**: 현재 Promote 버튼은 basic staging promote(api.harnessPromote) 호출. hash-gated
  canonical promote(api.harnessPromoteCanonical)를 UI에 노출하려면 렌더러가 vault canonical을 읽어
  lastReadHash를 추적해야 함 → 실 UX-state 설계 필요(렌더러가 vault를 읽는지 등).
- per-flag gate wiring(안전망 약화, skip 권장), `--from <STATE>` rewind, git-worktree staging,
  실 CliAgentRunner 통합 테스트, 선택적 LLM secret 의미판정.
- loop 종료: `/cancel-ralph`.
- **렌더러 UI(미구현, 의도적 후속)**: 데스크톱 Harness 패널(타임라인/diff 뷰/Promote/Discard)은 IPC
  경계까지만 됨. 픽셀 UI는 수동 후속.
- **P1 후보**: git-worktree staging, 실 LLM(CliAgentRunner) 통합 테스트, 선택적 LLM secret 의미판정,
  스케줄 실행, shared 자동승격(현재 gate false 고정).
- **리포 typecheck 부재**: 신규 파일은 tsc clean이나 `wiki-engine.ts(16)` 등 **기존** z.input/output
  오류가 잠복. 리포 차원의 typecheck 스텝 도입은 별도 결정 필요.

## 4. 재현 / 검증

```bash
# 패키지 테스트 (203 green) — 루트
cd ai_dashboard && pnpm test
# 데스크톱 테스트 (20 green) — 자체 vitest config
cd ai_dashboard/apps/desktop && pnpm exec vitest run
# 신규 파일 typecheck (리포에 스텝 없음 → 수동)
pnpm exec tsc --noEmit --strict --module ESNext --moduleResolution Bundler --target ES2022 \
  --esModuleInterop --skipLibCheck --resolveJsonModule --types node \
  packages/knowledge-harness/src/index.ts packages/app-services/src/harness-service.ts
# 핵심 경로
#  계약:    packages/shared/src/kh-schema.ts
#  런타임:  packages/knowledge-harness/src/runtime/{run-state-machine,harness-runner,make-drivers}.ts
#  안전망:  packages/knowledge-harness/src/{policy,verify,eval}/**
#  표면:    packages/app-services/src/harness-{service,promote-service,cli}.ts
#  데스크톱: apps/desktop/src/main/{container,ipc}.ts
#  설계:    docs/superpowers/specs/2026-06-02-knowledge-harness-{design,pipeline-impl-design}.md
#  플랜:    docs/superpowers/plans/2026-06-02-knowledge-harness-phase{1,2,3,4}.md
```

**핵심 불변식(테스트로 보증됨)**: Writer는 staging에만 write, 실 vault는 promote 전까지 불변;
evidence 없는 proposal은 PolicyGuard가 차단(run FAILED); canonical은 직접 덮어쓰지 않고 `.proposal.md`;
raw/delete는 차단; gate 닫히면 해당 state에서 멈추고 resume 가능.
