# Handoff — Knowledge Harness 진단 교정 (Recommended sequencing 1~6 전부)

- **날짜**: 2026-06-03
- **브랜치**: `docs/knowledge-harness-pipeline-spec` (repo: `ai_dashboard`)
- **세션 성격**: Ralph loop — 진단 문서(`2026-06-03-knowledge-harness-diagnosis.md`)의 권장 순서 1~6을
  단계별로 (계획 → spec → TDD 개발 → commit) 수행.

## 1. 한 일 (결론)

직전 세션의 holistic 진단(58 confirmed problems)이 제시한 **권장 순서 6단계를 전부 구현·커밋**했다. 각
단계마다 spec 문서(`docs/superpowers/specs/2026-06-03-kh-remediation-step<N>-*.md`)를 쓰고 TDD로 개발 후 커밋.

| step | 내용 | commit | addresses |
|---|---|---|---|
| 1 D2 | 루트 typecheck 스텝(`tsconfig.typecheck.json` + `pnpm typecheck`, package source) + 커밋된 잠복 타입오류 수정(parseStructured `S['_output']`, shared `TaskStatus/ReviewStatus` 타입 export) | 51f567f | #5 |
| 1 D1 | 번들 부팅 수정: `DEFAULT_GATES_YAML`/`DEFAULT_PREAMBLE` 임베드(fs-free boot), HarnessService fail-safe gate, drift/smoke 테스트 | f6037a6 | #4 |
| 2 B1-B3 | graph-integrity: orphan/missing-backlink advisory화, node_id는 graph-plan 기준(파일명 아님), self-link 제외; promote `gate()`가 graph/md/link `!ok` 차단(`allowInvalid` override, service→IPC→CLI); #58 계약 테스트 | 11d195f | #3,#6,#25,#30,#39,#58 |
| 3 schema | kh-schema identity `.min(1)`, op/scope/engine `z.enum`(delete_file 유지); PolicyGuard shared floor를 any non-project scope로; 거부 테스트 | f98dad6 | #11,#19,#20,#28,#31,#36,#49 |
| 4 C1/C2 | dead-UI 정직화(plumb 아님 — round-1에서 per-flag wiring은 안전망 약화로 기각): harness-utils `GATE_WIRING`/`SHIPPED_GATE_VALUES`, AgentConfigPanel은 engine만 live·gate read-only+wiring badge·temp/tokens/prompts/safety disabled+"not wired" | c8bab5a | #2,#8,#9 |
| 5 A1/A2 (핵심) | **SourceReader**(`<vault>/raw/` 실제 텍스트 → agent input) + **EvidenceVerifier**(evidence.source_path가 raw/에 실재 + quote 존재 검증, NODE_PROPOSALS_CREATED에서 BLOCKING → fabricated evidence면 FAILED); report schema+artifact; full-run fixtures가 raw 소스 시딩 | 37527ad | #1,#7,#34 |
| 6 E1 | make-drivers.adversarial.test(envelope/fence·canonical mode:apply→proposal·raw skip·fabricated→FAILED·malformed→FAILED); RunLock stale-lock 복구(pid+ts+TTL)+테스트; writer unimplemented-op skip 테스트; opt-in 실LLM smoke(`KH_REAL_LLM=1`); #33 config 주석 | b3e9b8e | #10,#32,#33,#35,#37,#38 |

## 2. 변경/커밋 상태
- 7 commits (51f567f..b3e9b8e), 전부 커밋됨. 단계별 spec 6개 + 핸드오프(이 파일).
- **신규 모듈**: `packages/knowledge-harness/src/runtime/source-reader.ts`,
  `packages/knowledge-harness/src/verify/evidence-verifier.ts`, 루트 `tsconfig.typecheck.json`.
- **미커밋(이 작업 아님, 세션 시작부터 존재 — 건드리지 않음)**: `remote-generate.ts`, `App.tsx`, `app.css`(+800),
  `ProjectSidebar.tsx`, `store.ts`, `packages/agents/*adapter*`, `ingest-schema*`, `cli-agent-runner.test`,
  `harness-store.test`, untracked `source-discovery.ts` + 렌더러 컴포넌트(MarkdownViewer/GraphVisualization/
  TaskFlowView/DiffViewer). **이건 다른 작업 스트림(sourceMeta ingest 리팩터 + 렌더러 restyle)이다.**

## 3. 검증
```bash
cd ai_dashboard && pnpm typecheck            # exit 0 (package source)
cd ai_dashboard && pnpm test                 # 279 passed + 1 skipped (real-LLM smoke)
cd ai_dashboard/apps/desktop && pnpm exec vitest run   # 38 passed
```

## 4. 남은 일 / 주의
- **typecheck 범위**: 현재 package SOURCE만 게이트. tests + apps/desktop은 2개 in-flight 스트림(sourceMeta
  ingest 리팩터 + untracked 렌더러 컴포넌트)과 얽혀 보류. 그 스트림들이 landing되면 typecheck를 tests+desktop으로 확장.
- **HEAD가 단독 빌드 불가**: 커밋된 HarnessDashboard.tsx가 아직 untracked인 렌더러 컴포넌트(MarkdownViewer 등)를
  import. step 4에서 harness-utils.ts+AgentConfigPanel.tsx는 커밋했으나 나머지 컴포넌트는 다른 스트림 소유라 미커밋.
- **D1 packaged extraResource**: electron-builder 설정이 repo에 없어, 임베드 defaults로 부팅은 완전히 고쳤으나
  "패키지 앱에서 편집 가능한 override 파일 동봉"은 packaging 설정 도입 후속.
- **남은 진단 항목**: MEDIUM/LOW 다수(진단 문서 §Full list)는 staging+human-promote containment로 bounded. 미처리.
- **Ralph loop**: 1~6 완료. completion promise 미설정이라 loop는 계속 re-prompt됨 → 종료하려면 `/cancel-ralph`.
