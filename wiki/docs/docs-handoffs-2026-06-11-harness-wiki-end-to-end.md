---
title: '핸드오프 — "전 문서로 위키 생성" 엔드투엔드 복구 (로깅 → 스키마 → 대화청킹 → 타임아웃 → 환경)'
slug: docs-handoffs-2026-06-11-harness-wiki-end-to-end
sources: [docs/handoffs/2026-06-11-harness-wiki-end-to-end.md]
topic: [wiki-and-knowledge-harness]
---

## Summary

3일간 불투명하게 죽던 것을, 로깅으로 원인을 하나씩 드러내며 끝까지 밀어붙인 작업. docs/handoffs/2026-06-09-harness-codex-discovery-failure.md 가 예고한 "결함 A/B/C 수정"을 실제로 구현(=관측 가능성 확보)한 뒤, 그 로그가 드러낸 진짜 실패 원인들을 차례로 고쳤다 프롬프트 스키마 누락 → 단계 타임아웃 180s → codex 바이너리 누락 → codex 인증(provider) 오설정. 부수적으로 WSL 실행환경(노드 버전·네이티브 빌드·폰트·디스플레이) 전반을 정리했다. 스펙/플랜: docs/superpowers/{specs,plans}/2026-06-10-harness-structured-logging . runs/RUN-…/logs/ - - /{prompt.txt,stdout.log,stderr.log,meta.json} 에 성공·실패 불문 영속. best-effort(로그 실패가 run을 못 죽임), 10MB 캡, resume 시 순번 이어감. exit code + → full logs: 경로 (결함 B). 5개 드라이버에 label 배선. project id (snake case) 불일치로 Zod 거절. 원인은 buildPrompt 가 "required schema에 맞춰라" Zo

## Content map

- **0. 한 줄 요약** — docs/handoffs/2026-06-09-harness-codex-discovery-failure.md 가 예고한 "결함 A/B/C 수정"을 실제로 구현(=관측 가능성 확보)한 뒤, 그 로그가 드러낸 진짜 실패 원인들을 차례로 고쳤다 프롬프트 스키마 누락 → 단계 타임아웃 180s → codex 바이너리 누락 → codex 인증(provider) 오설정. 부수적으로 WSL 실행환경(노드 버전·네이티브 빌드·폰트·디스플레이) 전반을 정리했다.
- **1. 구현된 코드 (커밋, origin/main에 push됨)**
- **1.1 Phase 1 — 구조화 로깅 (관측 가능성) 537221e..1de98d9** — 스펙/플랜: docs/superpowers/{specs,plans}/2026-06-10-harness-structured-logging . runs/RUN-…/logs/ - - /{prompt.txt,stdout.log,stderr.log,meta.json} 에 chunk 스트리밍(onChunk). exit code + → full logs: 경로 (결함 B). 5개 드라이버에 label 배선. 과 stdout.log 를 먼저 보라.
- **1.2 Phase 2a — 프롬프트에 JSON Schema 임베드 51bf5c9** — project id (snake case) 불일치로 Zod 거절. 원인은 buildPrompt 가 "required schema에 맞춰라" 하면서 스키마를 보여주지 않음 . Zod 스키마를 JSON Schema로 직렬화해 프롬프트에 포함(정확한 필드명 + required). 5개 에이전트 일괄 해결.
- **1.3 Phase 2b — 대화 세션 → Q&A raw 청킹 5686534..1cf29dc** — 스펙/플랜: docs/superpowers/{specs,plans}/2026-06-11-conversation-qa-chunking . ( @apc/agents Claude/Codex/OpenCode)를 재사용해 세션을 파싱 → 현재 프로젝트 repoPath와 일치하는 (C:\ ↔ /mnt/c 정규화) 최신 10개 세션을 → raw/conversations/ / /NNNq a.txt 로 materialize. 파일 = Q 전문 + A 텍스트 + tools 한 줄 요약(redact 적용, tool result 본문 제외). "전 문서로 위키 생성"의 materializ
- **1.4 단계 타임아웃 180s → 600s 1f1f287** — claude-opus 라 180s 기본 타임아웃에 SIGKILL(stdout 0바이트, exitCode null). claude -p HarnessServiceDeps.stepTimeoutMs 로 조정 가능.
- **2. WSL 실행환경 복구 (레포 밖 — 재현에 필수, ~/.claude/.../memory/dev-env-node-pnpm.md 에도 기록)** — 레포가 /mnt/c (Windows FS)에 있고 WSL에서 빌드·실행하기 때문에 생긴 함정들 1. 줄바꿈 : 전 트리가 CRLF로 뒤집혀 있던 것 복원 + .gitattributes ( text=auto eol=lf ) 추가( 11d2e7c ). 2. Node 22 필수 (20 아님): @apc/core 가 node:sqlite (22.5+ 빌트인)를 쓴다. 루트 vitest.config.ts 가 실제 빌트인을 re-export. 모든 명령 앞에 export PATH="$HOME/.nvm/versions/node/v22.22.3/bin:$PATH" . pnpm 은
- **3. UI 동작 메모** — 기본 claude)에서만 정해지고 프로젝트별 localStorage에 저장된다. 화면 하단 에이전트 터미널이나 Generate 흐름의 엔진 선택과는 무관 . (사용자가 codex로 돌리려면 이 드롭다운을 codex로.) 옛 실패 run의 에러를 계속 보고 혼동하기 쉬움(이번에 발생).

## Related

- Source: `docs/handoffs/2026-06-11-harness-wiki-end-to-end.md`
