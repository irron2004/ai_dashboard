---
title: Handoff — 세션 종료 상태 + 앱 실행 방법
slug: docs-handoffs-2026-06-20-session-state-and-running-the-app
sources: [docs/handoffs/2026-06-20-session-state-and-running-the-app.md]
topic: [agent-runtime-and-sessions]
---

## Summary

선행 핸드오프(상세 기술): docs/handoffs/2026-06-19-autosci-core-substrate-and-interactive-node-confirmation.md 이 문서는 현재(세션 종료) 상태 와 앱을 실제로 띄우는 법 에 집중한다. 두 기능의 설계/구현 상세는 위 선행 핸드오프와 docs/superpowers/specs plans/2026-06-19- 참조. run-dashboard.bat → run-desktop.sh 는 /mnt/c/Users/irron/Downloads/ai dashboard-main/ai dashboard-main (별도 클론)로 cd 한다. 우리가 개발/머지한 코드는 /mnt/c/Users/irron/Desktop/my/ruahverce/ai dashboard-main 에 있다. → 더블클릭 런처는 우리 기능이 없는 옛 복사본을 띄운다. 별도 WSL 터미널(Claude Code 밖) 에서 실행 — Claude의 Bash 샌드박스는 detached GUI를 죽이므로(exit 144), 사용자 본인 터미널이 확실 cd /mnt/c/Users/irron/Desktop/my/ruahverce/ai dashboard-main pnpm --filter @apc/desktop start electron-vite

## Content map

- **1. 현재 git 상태 (반영 완료)**
- **2. 앱 실행 방법 (중요 — 운영 메모)**
- **⚠️ 런처 경로 불일치 (반드시 인지)** — run-dashboard.bat → run-desktop.sh 는 /mnt/c/Users/irron/Downloads/ai dashboard-main/ai dashboard-main (별도 클론)로 cd 한다. 우리가 개발/머지한 코드는 /mnt/c/Users/irron/Desktop/my/ruahverce/ai dashboard-main 에 있다. → 더블클릭 런처는 우리 기능이 없는 옛 복사본을 띄운다. 선택지
- **우리 코드로 띄우기 (확인됨: 빌드 성공)**
- **기능 확인 동선** — Wiki Gen 탭 → "확인 모드" 체크 → 워크스페이스 지정 → 생성 → 에이전트가 노드 제안 후 일시정지 → 노드 확인 패널 (keep/remove/rename) → 「이대로 생성」 → 위키 작성 → 검수/promote.
- **3. 후속 작업 (non-blocking)** — 1. (운영) run-desktop.sh 경로를 Desktop 복사본으로 수정 — 더블클릭 런처가 최신 코드를 띄우게. 2. (housekeeping) node modules/@apc/.ignored 벤더 스냅샷 정리 — 개발 중 본 stale IDE 진단의 원인 (authoritative는 tsc -p tsconfig.typecheck.json + apps/desktop/tsconfig.json ). 3. confirmNodes 에 prev.awaiting==='node-confirmation' precheck; rename 경로 테스트 + confirmNodes
- **4. 테스트/환경 빠른 참조**

## Related

- Source: `docs/handoffs/2026-06-20-session-state-and-running-the-app.md`
