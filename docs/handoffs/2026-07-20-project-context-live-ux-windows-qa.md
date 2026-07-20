# 프로젝트 컨텍스트·실시간 UX Windows QA 증적

## 범위와 결론

- 기준 commit: `27998c5`
- 실행 환경: WSL에서 Windows 네이티브 Node/pnpm을 호출하는 full package workflow
- Windows 경로: `C:\Users\irron\Desktop\my\ruahverce\ai_dashboard-main`
- 결과: Windows x64 unpacked/portable/NSIS package 생성과 Windows Electron 자동 smoke가 통과했다.
- 제한: 패키징된 실행 파일 자체는 실행하지 않았다. 따라서 실제 packaged UI에서의 tmux/SSH/font/paste 제스처와 앱 종료·재실행 시나리오는 수동 검증으로 남긴다.

## 빌드·패키징 결과

실행 명령:

```bash
bash /home/hskim/.codex/skills/build-apc-windows-from-wsl/scripts/build-windows.sh --repo "$PWD"
```

빌드는 Windows Node `v22.20.0`, pnpm `11.5.0`으로 완료됐다. Electron 본체와 `better-sqlite3`, `pty.node`, `conpty.node`가 모두 Windows x64 PE 파일임을 확인했다.

| 산출물 | 크기 | 생성 시각(KST) | 판정 |
|---|---:|---|---|
| `apps/desktop/dist/win-unpacked/Agent Project Console.exe` | 180,849,664 bytes | 2026-07-21 01:27 | 새로 생성됨 |
| `apps/desktop/dist/Agent Project Console 0.0.0.exe` | 84,706,970 bytes | 2026-07-21 01:27 | 새로 생성된 portable |
| `apps/desktop/dist/Agent Project Console Setup 0.0.0.exe` | 84,934,800 bytes | 2026-07-21 01:27 | 새로 생성된 NSIS installer |

`Agent Project Console-win-unpacked.zip`은 2026-07-07 산출물이므로 이번 빌드 증적으로 간주하지 않는다.

비차단 경고:

- 코드 서명이 구성되지 않아 signing 단계가 생략됐다.
- 제품 아이콘이 없어 Electron 기본 아이콘을 사용했다.
- bundle 과정에서 `gray-matter`의 eval 경고가 발생했으나 빌드는 성공했다.

## Windows 네이티브 Electron smoke

실행 명령:

```bash
/mnt/c/Windows/System32/cmd.exe /d /s /c "pnpm.cmd --filter @apc/desktop qa:electron"
```

결과: `1 passed (4.8s)`.

자동 smoke가 실제 Windows Electron 프로세스에서 확인한 항목:

- 앱 boot, preload와 IPC 연결
- OS clipboard의 한글 text round-trip
- terminal tab/shortcut 동작
- 실제 PTY의 project/worktree/pane identity와 `launchId` 전달

## Q3 검증 매트릭스

| 항목 | 증적 | 상태 |
|---|---|---|
| Windows x64 full package와 네이티브 모듈 ABI | package workflow와 PE 검사 | 통과 |
| Windows OS clipboard IPC와 실제 PTY 시작 | Windows Electron smoke | 통과 |
| `Ctrl+V`/`Ctrl+Shift+V`/`Shift+Insert`/우클릭, bracketed paste | renderer/fixture 자동 test | 자동 test 통과, packaged 수동 확인 필요 |
| 한글·경로·여러 줄 paste | renderer/fixture 자동 test | 자동 test 통과, packaged 수동 확인 필요 |
| local/WSL/SSH 일반 shell과 tmux 비교 | 없음 | 수동 확인 필요 |
| tmux resize/split/detach/attach와 font diagnostic | fake terminal 자동 test | packaged 수동 확인 필요 |
| Windows/WSL/상대 경로 Ctrl+click과 md/html/py preview | parser/renderer/security fixture | 자동 test 통과, packaged 수동 확인 필요 |
| project/task/note/activity/wiki 재시작 복구 | file-DB integration test | 자동 test 통과, packaged 재실행 확인 필요 |
| clipboard/question/file 원문 비영속화 | DB/vault byte-scan security test | 자동 test 통과 |

## 남은 수동 acceptance

다음 항목을 완료하기 전에는 `TM-1`과 Windows packaged app 전체 acceptance를 완료로 표시하지 않는다.

1. packaged 실행 파일을 열어 Windows local, WSL, 등록 SSH terminal을 각각 시작한다.
2. 네 가지 paste gesture와 한글·코드·경로·여러 줄 입력을 비교한다.
3. 일반 shell과 tmux에서 한글, box drawing, wide glyph, true color를 비교한다.
4. tmux resize/split/detach/attach와 Powerline glyph 미설치 안내를 확인한다.
5. md/html/py 경로를 Ctrl+click하고 line jump와 project 전환 시 preview 닫힘을 확인한다.
6. 앱을 종료·재실행해 입력 데이터와 완료된 wiki 진행 이력이 복원되는지 확인한다.

패키징 앱을 이번 자동 QA에서 실행하지 않았으므로 screenshot이나 실제 packaged runtime 관찰을 했다고 간주하지 않는다.
