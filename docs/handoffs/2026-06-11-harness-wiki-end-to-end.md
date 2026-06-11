# 핸드오프 — "전 문서로 위키 생성" 엔드투엔드 복구 (로깅 → 스키마 → 대화청킹 → 타임아웃 → 환경)

- **Date**: 2026-06-11
- **Branch**: `main` (전부 커밋·push 완료, origin/main = `1f1f287`)
- **성격**: 다단계 기능 구현 + 실패 진단 + WSL 실행환경 복구. 데스크톱 앱의 하니스 위키 생성이
  3일간 불투명하게 죽던 것을, 로깅으로 원인을 하나씩 드러내며 끝까지 밀어붙인 작업.

## 0. 한 줄 요약

`docs/handoffs/2026-06-09-harness-codex-discovery-failure.md` 가 예고한 "결함 A/B/C 수정"을
실제로 구현(=관측 가능성 확보)한 뒤, 그 로그가 드러낸 **진짜 실패 원인들을 차례로** 고쳤다:
프롬프트 스키마 누락 → 단계 타임아웃 180s → codex 바이너리 누락 → codex 인증(provider) 오설정.
부수적으로 WSL 실행환경(노드 버전·네이티브 빌드·폰트·디스플레이) 전반을 정리했다.

## 1. 구현된 코드 (커밋, origin/main에 push됨)

### 1.1 Phase 1 — 구조화 로깅 (관측 가능성) `537221e..1de98d9`
스펙/플랜: `docs/superpowers/{specs,plans}/2026-06-10-harness-structured-logging*`.
- `packages/llm-wiki/src/logging-agent-runner.ts` (신설): 모든 엔진 호출을
  `runs/RUN-…/logs/<NN>-<STATE>-<agent>/{prompt.txt,stdout.log,stderr.log,meta.json}` 에
  **성공·실패 불문** 영속. best-effort(로그 실패가 run을 못 죽임), 10MB 캡, resume 시 순번 이어감.
- `cli-agent-runner.ts` / `ssh-exec.ts` / `ssh-agent-runner.ts`: stderr·exitCode 보존(결함 A),
  chunk 스트리밍(onChunk).
- `knowledge-harness/src/agents/llm-agent.ts`: 실패 메시지 = **stderr 우선 + head+tail +
  exit code + `→ full logs:` 경로**(결함 B). 5개 드라이버에 label 배선.
- `app-services/src/harness-service.ts`: run을 LoggingAgentRunner로 감싸고 `onEngineLog` 노출.
- IPC `harness:engineLog`(50ms 배칭) + 렌더러 Coverage 탭 live tail.
- **이 로깅이 이후 모든 진단의 근거가 됐다.** 실패 시 `runs/RUN-…/logs/…/meta.json`(exitCode·duration)
  과 `stdout.log` 를 먼저 보라.

### 1.2 Phase 2a — 프롬프트에 JSON Schema 임베드 `51bf5c9`
- 로그로 확인: claude가 정상 JSON을 냈지만 **`projectId`(camelCase)** 등 자기식 키 → 스키마의
  `project_id`(snake_case) 불일치로 Zod 거절. 원인은 `buildPrompt`가 "required schema에 맞춰라"
  하면서 **스키마를 보여주지 않음**.
- `packages/knowledge-harness/src/agents/zod-to-json-schema.ts` (신설, 의존성 없음): 각 에이전트의
  Zod 스키마를 JSON Schema로 직렬화해 프롬프트에 포함(정확한 필드명 + required). 5개 에이전트 일괄 해결.

### 1.3 Phase 2b — 대화 세션 → Q&A raw 청킹 `5686534..1cf29dc`
스펙/플랜: `docs/superpowers/{specs,plans}/2026-06-11-conversation-qa-chunking*`.
- `packages/app-services/src/conversation-materializer.ts` (신설): 기존 인제스트 어댑터
  (`@apc/agents` Claude/Codex/OpenCode)를 재사용해 세션을 파싱 → **현재 프로젝트 repoPath와
  일치하는**(C:\ ↔ /mnt/c 정규화) 최신 10개 세션을 →
  `raw/conversations/<engine>/<sessionId>/NNNq_a.txt` 로 materialize. 파일 = Q 전문 + A 텍스트 +
  `### tools` 한 줄 요약(redact 적용, tool_result 본문 제외). "전 문서로 위키 생성"의 materialize
  단계에 통합(`HarnessServiceDeps.conversationAdapters`, container에서 `ingestAdapters` 주입).
- **최종 리뷰가 잡은 실데이터 결함 2건 수정**(`1cf29dc`):
  - claude jsonl은 사용자 질문을 **문자열** `message.content`로 저장하는데 어댑터가 배열만 가정 →
    문자 단위 순회로 text가 비어 Q&A 0개. `claude-adapter.ts`에서 string content 정규화 + `isMeta`
    프리앰블 스킵. 실증: 최대 세션에서 35개 Q&A 단위·실제 질문 추출.
  - `summarizeToolCall`이 `input.command`/`file_path`를 raw로 기록(시크릿 유출 벡터) → `redact()` +
    한 줄 정리 적용.

### 1.4 단계 타임아웃 180s → 600s `1f1f287`
- 로그로 확인: project-discovery(132s 아슬→180s 초과)·node-extractor(>180s)가 **agentic
  claude-opus**라 180s 기본 타임아웃에 SIGKILL(stdout 0바이트, exitCode null). `claude -p
  --output-format json`은 스트리밍이 아니라 **끝에 한 번에** 출력하므로 단계 중엔 stdout이 빈다.
- `make-drivers.ts`: `DEFAULT_STEP_TIMEOUT_MS = 600_000`, `DriverDeps.stepTimeoutMs` /
  `HarnessServiceDeps.stepTimeoutMs`로 조정 가능.

## 2. WSL 실행환경 복구 (레포 밖 — 재현에 필수, `~/.claude/.../memory/dev-env-node-pnpm.md` 에도 기록)

레포가 `/mnt/c`(Windows FS)에 있고 WSL에서 빌드·실행하기 때문에 생긴 함정들:

1. **줄바꿈**: 전 트리가 CRLF로 뒤집혀 있던 것 복원 + `.gitattributes`(`* text=auto eol=lf`) 추가(`11d2e7c`).
2. **Node 22 필수**(20 아님): `@apc/core`가 `node:sqlite`(22.5+ 빌트인)를 쓴다. 루트 `vitest.config.ts`가
   실제 빌트인을 re-export. 모든 명령 앞에
   `export PATH="$HOME/.nvm/versions/node/v22.22.3/bin:$PATH"`. `pnpm`은 `npm i -g pnpm@9`로 nvm bin에 설치.
3. **테스트 toolchain**: node_modules가 Windows용이라 linux `@rollup/rollup-linux-x64-gnu` /
   `@esbuild/linux-x64`를 별도 추출해 넣음. 타입체크는 루트 `pnpm run typecheck`(패키지별 tsc 아님).
4. **앱 실행용 네이티브 리빌드 (`/update`의 5–6단계는 이 레포에서 그대로 쓰면 안 됨)**:
   Electron 31.7.7 → NODE_MODULE_VERSION **125**(Node 22는 127). `electron`·네이티브 모듈이
   `apps/desktop/package.json`(optionalDependencies)에 선언돼 있어, **electron-rebuild를 루트에서
   돌리면 graph에서 못 찾아 Node ABI(127)로 빌드 → 앱 크래시**. 올바른 절차:
   - `cd apps/desktop && npx electron-rebuild -v 31.7.7 -f -o better-sqlite3`
   - node-pty는 Electron prebuild가 없으니 직접:
     `cd node_modules/@homebridge/node-pty-prebuilt-multiarch && <repo>/node_modules/.bin/node-gyp
     rebuild --target=31.7.7 --arch=x64 --dist-url=https://electronjs.org/headers` (헤더 다운로드
     flake 시 1회 재시도). ABI 검증: better-sqlite3를 Node 22에서 `process.dlopen` → "requires 127"
     거절이면 정상(=125).
   - **`pnpm install`로 끝내면 Windows 빌드를 덮어쓰니, 위 리빌드를 반드시 수행.**
5. **한글 폰트**: WSL에 CJK 폰트가 없어 □로 깨짐. sudo 없이 Windows 폰트 링크:
   `mkdir -p ~/.local/share/fonts/winkr && ln -sf /mnt/c/Windows/Fonts/{malgun.ttf,malgunbd.ttf,
   NotoSansKR-VF.ttf,NotoSerifKR-VF.ttf} ~/.local/share/fonts/winkr/ && fc-cache -f` → Electron 재시작.
6. **창이 안 뜸(프로세스는 정상)**: `/mnt/wslg/weston.log`에 `rdp_peer is not initalized` →
   WSLg의 Windows측 RDP 브리지가 죽은 것. `wsl.exe --shutdown` 후 재기동(이번 세션에 1회 했음).
   (CDP 스크린샷: `pnpm --filter @apc/desktop dev -- --remote-debugging-port=9222` 단일 `--` 후
   `Page.captureScreenshot` via `node_modules/ws`.)
7. **codex 엔진**: 두 겹의 문제였음.
   - 바이너리 누락: `@openai/codex`(전역 0.139.0)에 `@openai/codex-linux-x64`가 안 깔림(rollup과
     동일 npm optional 스킵). `npm pack @openai/codex@0.139.0-linux-x64` → 전역 node_modules의
     `@openai/codex-linux-x64/`로 추출(바이너리는 `vendor/x86_64-unknown-linux-musl/bin/codex`).
   - 인증: `~/.codex/config.toml`이 `model_provider = "openai-custom"`(`env_key=OPENAI_API_KEY`)라
     ChatGPT 로그인이 있어도 API 키를 요구. 실측으로 **gpt-5.4는 ChatGPT 로그인으로 동작**(구
     `*-codex` 모델은 폐기) 확인 → `model_provider = "openai"`로 변경(백업:
     `~/.codex/config.toml.bak-20260611-125230`). 이제 키 없이 `codex exec` 동작(exit 0).

## 3. UI 동작 메모

- **하니스 위키 엔진**은 Knowledge Harness 화면 **오른쪽 패널 "Engine" 드롭다운**(claude/opencode/codex,
  기본 claude)에서만 정해지고 프로젝트별 localStorage에 저장된다. 화면 하단 에이전트 터미널이나 Generate
  흐름의 엔진 선택과는 **무관**. (사용자가 codex로 돌리려면 이 드롭다운을 codex로.)
- run 목록/Coverage 탭은 **마지막 run을 그대로 보여주므로**, 수정 후엔 반드시 **새 run을 시작**해야 한다.
  옛 실패 run의 에러를 계속 보고 혼동하기 쉬움(이번에 발생).

## 4. 현재 상태 / 다음에 할 일

- 코드: 전부 main에 커밋·push. 테스트 전부 green(루트 382·desktop 85), typecheck 클린.
- **아직 검증 안 됨**: codex 엔진으로 **전체 파이프라인 엔드투엔드 성공**은 아직 못 봤다(바이너리·인증·
  타임아웃을 막 풀고 사용자가 새 run을 돌리려는 시점). 다음 세션은 codex/claude로 한 번 완주시켜
  `raw/conversations/`가 채워지고 evidence가 그 파일을 인용하는지 확인할 것.
- **알려진 후속 이슈**:
  1. 슬래시커맨드 북키핑 라인(`<command-name>` 등)이 `isMeta`가 아니라 Q 단위로 잡힘 →
     `groupQaUnits`에 필터 후보.
  2. `summarizeToolCall`이 Bash 명령을 `slice(0,80)` 후 redact → 경계 걸친 시크릿 ≤7자 잔존 가능.
  3. claude json 모드는 단계 중 stdout이 비어 **live tail이 claude에선 무용**(codex는 스트리밍됨).
  4. `HarnessService.resume()`가 `projectCwd` 미전달 → ssh 프로젝트 재개 시 원격에 못 닿음(기존 한계).
  5. `batchEngineLog` 단위 테스트 부재.
  6. 전체 파이프라인이 매 materialize마다 3개 어댑터의 전 세션을 재파싱(maxSessions는 출력만 제한) →
     `/mnt/c` IO에서 시작 지연. 모니터링 대상.

## 5. 핵심 파일

```
packages/llm-wiki/src/logging-agent-runner.ts                 # 로그 데코레이터
packages/knowledge-harness/src/agents/llm-agent.ts            # 실패 메시지 + 스키마 임베드 호출
packages/knowledge-harness/src/agents/zod-to-json-schema.ts   # Zod→JSON Schema 직렬화
packages/knowledge-harness/src/runtime/make-drivers.ts        # 단계 타임아웃(stepTimeoutMs)
packages/app-services/src/conversation-materializer.ts        # 대화 Q&A 청킹
packages/app-services/src/harness-service.ts                  # 로깅·청킹·타임아웃 배선
packages/agents/src/claude-adapter.ts                         # string content + isMeta 수정
apps/desktop/src/main/container.ts                            # conversationAdapters 주입
apps/desktop/src/renderer/components/HarnessDashboard.tsx     # live tail + 엔진 드롭다운(AgentConfigPanel)
~/.codex/config.toml                                          # model_provider = "openai" (레포 밖)
```
