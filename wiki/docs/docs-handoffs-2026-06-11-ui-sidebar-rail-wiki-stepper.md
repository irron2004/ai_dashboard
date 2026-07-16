---
title: "핸드오프 — UI 재디자인: 접이식 사이드바 레일 + 위키 생성 세로 스테퍼"
slug: docs-handoffs-2026-06-11-ui-sidebar-rail-wiki-stepper
sources: [docs/handoffs/2026-06-11-ui-sidebar-rail-wiki-stepper.md]
topic: [desktop-experience]
---

## Summary

사용자 요청 2건: (1) 프로젝트 리스트 바가 너무 커서 다른 화면이 좁다 → 접고 펼 수 있게, (2) "위키 생성" 진행 화면이 알아보기 힘들다 → 단계를 쪼개고 요약 로그만 표시. 기존 다크 테마(파란 패널 시스템)는 그대로 두고, 사이드바를 56px 아이콘 레일로 접을 수 있게 만들고, 위키 생성 진행을 raw 로그 10줄 dump → 세로 단계 스테퍼 로 교체했다. 인터랙션 방향(레일 형태 vs 완전 숨김 / 스테퍼 vs 컴팩트 바)은 작업 전 사용자에게 확인받아 레일 + 세로 스테퍼 로 확정. 로 전환( effectiveSidebarW ). toggleSidebar() 가 상태+localStorage를 같이 갱신. app-layout sidebar--rail 클래스 부여. 이름·status, 우클릭 편집/삭제 메뉴 동작) → 하단 + (새 프로젝트, flex로 바닥 정렬). 프로젝트 스캔 / 소스 추출 / 문서 분류 / 노드 제안 생성 / 리드 병합 / 작성 계획 / 아직 도달 안 한 첫 단계 = 진행중(●, 펄스) , 그 이전 = 완료(✓ 초록), 이후 = 대기(○). state===null → 첫 단계 진행중, state==='FAILED' → 전용 에러 뷰. (없으면 단계 hint). raw 전체 로그는 자세히 ▾ 토글 안에 접

## Content map

- **0. 한 줄 요약** — 기존 다크 테마(파란 패널 시스템)는 그대로 두고, 사이드바를 56px 아이콘 레일로 접을 수 있게 만들고, 완전 숨김 / 스테퍼 vs 컴팩트 바)은 작업 전 사용자에게 확인받아 레일 + 세로 스테퍼 로 확정.
- **1. 변경 내용**
- **1.1 접이식 사이드바 — 아이콘 레일** — 로 전환( effectiveSidebarW ). toggleSidebar() 가 상태+localStorage를 같이 갱신. app-layout sidebar--rail 클래스 부여. 이름·status, 우클릭 편집/삭제 메뉴 동작) → 하단 + (새 프로젝트, flex로 바닥 정렬).
- **1.2 위키 생성 진행 — 세로 단계 스테퍼** — 프로젝트 스캔 / 소스 추출 / 문서 분류 / 노드 제안 생성 / 리드 병합 / 작성 계획 / 위키 작성·스테이징 / 검증 / 리뷰 대기. state===null → 첫 단계 진행중, state==='FAILED' → 전용 에러 뷰. (없으면 단계 hint). raw 전체 로그는 자세히 ▾ 토글 안에 접어둠(기본 숨김). 로 교체. store 셀렉터는 이미 노출돼 있어 배선만 교체. .project-sidebar--rail / rail-toggle / rail-list / rail-dot(--selected) / rail-add , 그리고 .wiki-progress
- **2. 동작/구현 메모 (다음 사람이 헷갈릴 지점)** — refresh/resume/promote에서도 true가 되므로 그 동안에도 스테퍼가 보이는데, 진행 단계는 단계가 안 움직여도 정상. 내보내면 모든 단계가 '대기'로 표시된다(안전한 폴백). 끝에 한 번에 출력 → 진행중 단계의 요약 한 줄이 직전 청크에 머무를 수 있다(codex는 스트리밍됨). 이전 핸드오프( 2026-06-11-harness-wiki-end-to-end.md §4-3)와 동일한 알려진 제약. 좁은 창에서도 레일/스테퍼는 정상 동작하나, 격리 미리보기를 만들 때 이 그리드를 통째로 쓰면 무너지므로 컴포넌트를 분리해서 보는 게 낫다(검증 때 한 번
- **3. 검증** — (AgentConfigEditorPanel의 act() 경고는 변경과 무관한 기존 노이즈). 펼친 사이드바(◂)·접은 레일(▸/이니셜 dot/＋)·세로 스테퍼(✓/●+요약/○, 연결선, 자세히 ▾ )가 의도대로 렌더됨을 확인. 실제 Electron 기동으로는 아직 안 봄 (WSL 네이티브 리빌드 비용 때문에 보류 — 절차는 memory dev-env-node-pnpm.md §"Running the desktop app in WSL").
- **4. 후속/잔여** — 잘리는지) 미세 조정 여지. ( statusFor / currentStepIdx )에 대한 가벼운 테스트가 후보.
- **5. 핵심 파일**

## Related

- Source: `docs/handoffs/2026-06-11-ui-sidebar-rail-wiki-stepper.md`
