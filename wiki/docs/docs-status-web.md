---
title: 원격 읽기전용 상태 대시보드 (status-web)
slug: docs-status-web
sources: [docs/status-web.md]
topic: [project-management]
---

## Summary

Electron 데스크톱 앱과 같은 sqlite 파일 ( apc.db )을 읽어, 전 프로젝트 상태를 HTTP로 노출하는 독립 실행 node 서버입니다. 읽기 전용 — 승인/실행 같은 쓰기 액션은 다음 phase입니다. pnpm status-web --db /absolute/path/to/apc.db pnpm status-web --host 0.0.0.0 --token my-secret-token 시작 시 로그에 접속 URL과 토큰이 찍힙니다. DB 파일을 찾지 못하면 경로 안내 메시지를 출력하고 종료합니다. 브라우저 페이지가 최초 1회 대화상자(prompt)로 토큰을 입력받아 localStorage 에 저장하고, 이후 모든 요청은 Authorization: Bearer 헤더로 자동 전송합니다. 토큰이 틀리면(401) 저장분을 지우고 다시 입력 대화상자를 띄웁니다. 1. 데스크톱을 돌린 적 있는 PC에서 pnpm status-web --host 0.0.0.0 --token 실행. 2. 폰을 같은 네트워크 에 두고 브라우저로 http:// :4319/ 접속. 3. 프롬프트에 토큰 입력. 이후 10초마다 자동 갱신, 상단 "새로고침" 버튼으로 수동 갱신. 4. 생성 N초 전 · 오래됨(stale) 표시는 데스크톱 쓰기와 충돌해 최신 스냅샷을 못 만들

## Content map

- **실행**
- **기본값: 127.0.0.1:4319, DB는 데스크톱 userData 경로 추정, 토큰 자동 생성 후 출력** — pnpm status-web
- **DB 경로를 명시(권장 — Electron userData 경로는 자동 추정이 어렵습니다)** — pnpm status-web --db /absolute/path/to/apc.db
- **폰/다른 PC에서 접속하려면 LAN 바인드(명시적 opt-in)** — pnpm status-web --host 0.0.0.0 --token my-secret-token
- **인증 / 토큰** — 브라우저 페이지가 최초 1회 대화상자(prompt)로 토큰을 입력받아 localStorage 에 저장하고, 이후 모든 요청은 Authorization: Bearer 헤더로 자동 전송합니다. 토큰이 틀리면(401) 저장분을 지우고 다시 입력 대화상자를 띄웁니다.
- **폰에서 보기** — 1. 데스크톱을 돌린 적 있는 PC에서 pnpm status-web --host 0.0.0.0 --token 실행. 2. 폰을 같은 네트워크 에 두고 브라우저로 http:// :4319/ 접속. 3. 프롬프트에 토큰 입력. 이후 10초마다 자동 갱신, 상단 "새로고침" 버튼으로 수동 갱신. 4. 생성 N초 전 · 오래됨(stale) 표시는 데스크톱 쓰기와 충돌해 최신 스냅샷을 못 만들 때 마지막 정상 스냅샷을 보여주는 상태입니다.
- **보안 기본값** — host 0.0.0.0 등으로 외부에 바인드하면 bearer 토큰과 모든 응답 데이터가 암호화 없이 전송됩니다. 같은 네트워크의 누구든 패킷을 도청할 수 있으므로 신뢰된 사설 LAN 전용 으로만 사용하세요.
- **엔드포인트** — 그 외 경로는 404, 위 경로의 비-GET 요청은 405(읽기 전용).

## Related

- Source: `docs/status-web.md`
