# Handoff — B2 (gate single-source) + B3 (safety) 완료

- **Date**: 2026-06-04
- **Branch**: `docs/knowledge-harness-pipeline-spec`
- **이전 handoff**: `2026-06-04-follow-up-catchup.md` (브랜치 전체 맥락), `2026-06-03-*` (KH phase 1~6)

## 0. 한 줄 요약

직전 세션에서 동시 실행 루프에 의해 날아갔던 **B2(feature-gate 단일 소스화)** 를 재작업하고, **B3(안전 게이트)** 전체를 TDD로 구현했다. 각 단계마다 커밋했고(uncommitted 잔여 없음), full suite 307 pass / typecheck 0.

## 1. 이번 세션에 한 일 (커밋 단위)

| 커밋 | 내용 |
|------|------|
| `7cbeba8` | **B2** — `@apc/shared`에 `KNOWN_FEATURE_GATES`(22개 universe) + `HONORED_GATES`(5개) + `FeatureGateKey`/`HonoredGate` 타입 신설. `run-state-machine.ts`의 `PipelineStep.gate: string→HonoredGate` (오타/리네임 = 컴파일 에러). desktop `harness-utils.ts`의 `HarnessFeatureGateKey = FeatureGateKey` 로 단일소스화(GATE_WIRING/SHIPPED_GATE_VALUES가 universe에서 못 벗어남). `feature-gate.config.test.ts` drift 가드 5개(#15/#16/#18): shipped YAML ↔ 컴파일된 DEFAULT_GATES_YAML ↔ shared consts ↔ PIPELINE. |
| `78adb41` | **B3 #23** — SecretScanner에 `credential_assignment`(generic `*_secret`/`*_token`, **값이 secret-shaped**일 때만: 16자+·숫자·대문자 → benign config/prose 회피, `/i` 금지) + `private_key_body`(armor 벗겨진 DER `MII…` base64) 규칙. |
| `fb929d0` | **B3 #21/#22/#24/#26** — PolicyGuard write-plan block 규칙 추가: `non_markdown_write`(#24, create_file/append_section는 `.md`만), `secret_in_write`(#21, op **본문** 스캔→block; evidence 인용 secret은 여전히 warn). STAGING_WRITTEN 드라이버가 `writer.apply` **전에** `policy.check(proposals, plan)` 실행 후 `!ok`면 throw → raw/delete/non-md/secret op은 **스테이징 쓰기 전에 차단**(#22 scan-before-staging, #26 raw 차단). writer의 raw-skip은 defense-in-depth로 유지. adversarial "raw skipped" / make-drivers "secret caught at VALIDATED" 픽스처를 새 차단 동작에 맞춰 재조정(기존 vault secret은 clean run을 막지 않는 불변식 유지). |
| `9a0d90e` | **B3 #21/#22 후속** — app-services `harness-service.test.ts`를 pre-staging gate에 맞춰 재조정(op-본문 secret→FAILED / promote·allowSecrets 커버리지는 append로 병합된 기존 secret 경로로 보존). ※ fb929d0 커밋 시 app-services 미실행으로 놓쳤던 fallout. |
| `a5caeeb` | **B3 #29** — `KhNodeProposalSchema.superRefine`: 모든 claim은 evidence ≥1개 인용 + 인용한 evidence_id가 실제 선언돼야 parse 통과(hallucinated/dangling = 구조적 reject). **빈 proposal(claims·evidence 모두 [])은 의도적으로 parse 허용** (PolicyGuard가 런타임 evidence 게이트, eval이 evidence-less를 측정하므로). eval-report sharedOk 픽스처 1건 재조정. |

## 2. 검증 (모두 통과)

```bash
npx vitest run            # 75 files, 307 passed / 1 skipped
pnpm typecheck            # tsc 루트 + apps/desktop → exit 0
```
KH 단독은 107 → **119** tests.

## 3. ⚠️ 다음 세션이 반드시 알아야 할 것 — 동시 수정 프로세스

세션 도중(17:36~17:40) 내가 건드리지 않은 **`apps/desktop/` 7개 파일이 외부에서 수정됨** (container.ts, ipc.ts, App.tsx, api.ts, app.css, store.ts, ipc-contract.ts — 합 410 insert). ralph-loop 파일은 모두 취소했으므로(아래) 이건 **다른 동시 프로세스**(별도 세션/에이전트로 추정)의 in-progress 작업이다.
- 나는 이 변경을 **stage/commit/revert 하지 않았다** — 남의 작업이라 그대로 둠. `git status`에 unstaged로 남아 있다.
- 다음 세션은 이 desktop 변경의 출처를 먼저 확인할 것. 내 B2/B3 커밋과는 무관(겹치는 파일 없음).

세션 시작 시 정리한 ralph-loop (모두 취소 완료, ai_dashboard에는 애초에 없었음):
- `calculate_math/.claude/ralph-loop.local.md` (iter 1) — 삭제
- `coin/mirofish-practice/.claude/ralph-loop.local.md` (iter 2) — 삭제

## 4. 미완 / 후속 후보

- B2/B3 이슈 클러스터는 완료. 남은 B 항목이 더 있다면 원 백로그(#번호) 대조 필요 — 이번 세션은 #15/#16/#18/#17(기존)·#21/#22/#23/#24/#26/#29 처리.
- 루트 untracked `docs/handoffs/2026-06-04-follow-up-catchup.md`(이전 세션 산출물) 아직 미커밋 — 커밋 여부 사용자 판단.
- desktop 동시 변경 정리 후 PR 생성(`origin/docs/knowledge-harness-pipeline-spec` → PR) 고려.

## 5. 설계 메모 (왜 이렇게 했나)

- **secret 규칙은 `/i` 금지**: 값이 secret-shaped인지 판정할 때 대문자 lookahead가 필요한데 `/i`면 무력화됨. key 접미사는 `secret|SECRET|token|TOKEN`로 명시.
- **빈 proposal parse 허용 유지**: evidence-required는 PolicyGuard(런타임 block)와 eval 지표의 책임. 스키마에서 막으면 `policy-pipeline.e2e`의 "evidence-less → PolicyGuard blocked", eval의 `proposals_without_evidence`/`inference_without_note` 측정이 깨진다.
- **secret 차단 계층**: op 본문 secret = pre-staging block(절대 안 써짐). 기존 vault/append-병합 secret = VALIDATED 스캔(authored 파일만) → promote 게이트에서 차단(allowSecrets로 인간 override). 기존 vault secret이 모든 promotion을 영구 차단하지 않도록 스캔은 run-authored 파일로 한정.
