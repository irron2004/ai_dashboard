# Diff 패널 설계 — 변경사항 한눈에 보기

**날짜:** 2026-07-14
**참조:** [UI 사용성 진단](../../handoffs/2026-07-14-ui-usability-diagnosis.md) · 목업 이미지 [diff-panel-mockup.svg](../../mockups/2026-07-14-diff-panel-mockup.svg)
**모티프:** Claude Code 데스크톱의 Diff 패널 (Ctrl+Shift+D → 우측 패널, 파일별 +N −N, 클릭 시 펼침)

---

## 1. 배경과 목표

에이전트가 코드를 바꾸는 앱인데, "지금 워킹트리에 무엇이 얼마나 바뀌었나"를 보려면
문서 탭 → 변경분 피드 → 파일 하나씩 클릭해야 한다. 파일별 증감량(+N −N)은 아예 없다.

**목표:** 어느 탭에 있든 단축키/버튼 한 번으로 우측에 Diff 패널이 열리고,
변경 파일 목록이 +N −N 스탯과 함께 보이며, 파일을 클릭하면 그 자리에서 diff가 펼쳐진다.

**비전 연결:** 비전 2(전후 작업 빠른 파악) — 에이전트 작업 결과를 리뷰하는 핵심 루프의 일부.

## 2. 기존 재료 (전부 재사용)

| 재료 | 위치 | 상태 |
|---|---|---|
| `changesList` IPC (`q:changesList`) | `apps/desktop/src/main/project-changes.ts` `listProjectChanges` | 파일 목록+상태. **증감량 없음** |
| `changesDiff` IPC (`q:changesDiff`) | 동일 파일 `diffProjectFile` | 파일 1개 patch. **삭제 파일 미지원** |
| `parseUnifiedDiff` | `apps/desktop/src/renderer/harness-utils.ts:951` | patch → rows(kind/left/right/lineNo) |
| preload `invoke` | `apps/desktop/src/preload/index.ts` | 채널 무관 통과 — **응답 타입 확장 시 preload/api 수정 불필요** |

신규 IPC 채널은 만들지 않는다. 기존 `changesList` 응답에 필드를 추가하는 것이므로
CLAUDE.md의 "IPC 채널 추가 시 4곳 배선" 규칙은 해당 없음 (contract 타입 + main 구현만 수정).

## 3. UX 스펙

### 진입점
- 툴바(탭 행 우측, 🔎 옆)에 `±` Diff 버튼. title/aria-label: `변경사항 (Ctrl+Shift+D)`
- 단축키 **Ctrl+Shift+D** (기존 Ctrl+K, Ctrl+Shift+N, Ctrl+1..9, Shift+1..3과 충돌 없음)
- 토글: 열려 있으면 닫힘. **Esc**로도 닫힘

### 패널 (우측 오버레이)
- `position: fixed; right: 0; top: 0; bottom: 0;` 폭 `min(560px, 92vw)`. 독(터미널) 위에 떠도 무방
- 헤더: `변경사항` · `파일 N` · 총계 `+A`(초록) `−D`(빨강) · ⟳ 새로고침 · ✕ 닫기
- 파일 행: 상태 마커(`+` new / `±` modified / `−` deleted, 문서 탭 변경분 피드와 동일 관용구)
  + 경로(ellipsis) + `+N`/`−N` (binary·집계불가 파일은 `binary` 표기)
- 행 클릭 → 아래로 **unified diff 펼침** (한 번에 한 파일만 펼침, 재클릭 시 접힘)
  - patch는 펼칠 때 `changesDiff`로 lazy fetch, 패널이 열려 있는 동안 캐시
  - 렌더링은 `parseUnifiedDiff` rows 재사용: add=초록 배경, delete=빨강 배경, 좌우 줄번호
- 빈 상태: `변경분 없음 — working tree clean` / 에러: reason 그대로 표시
- 프로젝트 미선택: `프로젝트를 선택하세요`

### 접근성
- 패널 `role="dialog"` `aria-label="변경사항"` , 파일 행은 `<button aria-expanded>`
- Esc 닫기, 새로고침·닫기 버튼 aria-label

## 4. 기술 설계

### 4.1 main — 파일별 증감량 (`project-changes.ts`)

`git diff HEAD --numstat`으로 tracked 변경의 증감량을 얻고, porcelain 목록에 병합한다.

```
parseNumstat(stdout) → Map<path, { additions: number|null, deletions: number|null }>
  · "12\t3\tpath" 파싱, "-\t-\tpath"(binary) → null
  · rename "old => new" / "pre/{old => new}/post" → 새 경로 기준
```

- untracked(new) 파일은 numstat에 없음 → `countUntrackedAdditions(absPath)`:
  파일을 읽어 줄 수 계산. NUL 바이트 포함(binary) 또는 2MB 초과 시 `null`(집계 불가)
- 삭제 파일은 numstat에 `0\tN` 형태로 이미 포함됨
- 빈 repo(HEAD 없음)에서 numstat 실패 → 카운트 없이 목록만 반환 (기존 동작 유지)

`ChangedFile`에 `additions?: number; deletions?: number; binary?: boolean` 추가.

### 4.2 main — 삭제 파일 diff (`diffProjectFile`)

현재 `statSync` 선행 검사 때문에 삭제 파일은 `파일을 찾을 수 없음`으로 실패한다.
순서를 바꾼다: repo마다 ① `git diff HEAD -- <path>` 먼저 시도(디스크에 없어도 동작, 삭제 포함)
→ 비어 있지 않으면 반환, ② 실패/빈 결과면 기존 stat + `--no-index` untracked 폴백.

### 4.3 shared — 계약 확장 (`ipc-contract.ts`)

`ChangesListRes.files[]`에 `additions?: number; deletions?: number; binary?: boolean` 추가.
채널·요청 타입 불변. preload/renderer api는 통과 구조라 수정 불필요.

### 4.4 renderer — `DiffPanel.tsx` (신규)

```
Props: { open: boolean; projectId: string | null; onClose: () => void }
상태: files | reason | expanded(path 1개) | patches(경로→{patch|error} 캐시)
open 또는 projectId 변경 시 changesList 재조회. 행 클릭 시 changesDiff lazy fetch.
```

App.tsx: `diffOpen` state + 툴바 버튼 + Ctrl+Shift+D 리스너 + `<DiffPanel …/>` 렌더.
스타일: `app.css`에 `.diff-panel*` 블록 추가 (기존 panel/토큰 관용구 준수).

## 5. 엣지 케이스

| 케이스 | 처리 |
|---|---|
| binary 파일 (`-\t-`) | `binary: true`, UI에 `binary` 뱃지, 펼침 시 patch 없으면 "표시할 diff 없음" |
| rename (`R` porcelain) | 기존대로 새 경로를 new로 취급. numstat rename 경로 정규화로 카운트 매칭 |
| 빈 repo (HEAD 없음) | numstat 스킵 → 카운트 없는 목록. diff는 `--no-index` 폴백 (기존 동작) |
| 다중 repoPaths | repo별 numstat 실행 후 병합 (porcelain 루프와 동일 구조) |
| 대용량 untracked (>2MB) | 줄 수 세지 않고 `binary: true`(집계 불가로 표기) |
| ssh:// 프로젝트 | 기존 changesList와 동일 제약(로컬 repoPaths 기준). 원격 diff는 비범위 |
| 삭제 파일 펼침 | 4.2로 지원 — 전체가 `-` 라인인 patch |

## 6. 비범위 (YAGNI)

- 스테이징/커밋/discard 액션 (GitSyncPanel의 역할, 여기서는 읽기 전용)
- side-by-side 토글, 워드 단위 diff, 파일 간 이동 단축키
- ssh 원격 워킹트리 diff
- 패널 폭 리사이즈·상태 영속화

## 7. 테스트 전략

- **main 단위:** `parseNumstat`(일반/binary/rename 2형), `countUntrackedAdditions`(텍스트/빈 파일/NUL binary)
- **main 통합(real git):** listProjectChanges가 modified에 +/−, untracked에 줄 수를 붙이는지;
  diffProjectFile이 삭제 파일 patch를 반환하는지 (기존 통합 테스트 패턴 재사용)
- **renderer:** DiffPanel — 목록+스탯 렌더, 클릭 펼침 시 changesDiff 호출·rows 렌더,
  에러/빈 상태, Esc·✕ 닫기 (HomeView.test.tsx의 api Proxy mock 패턴 재사용)
- **회귀:** ipc.test.ts의 changesList 계약 테스트는 additive 확장이라 영향 없음 확인
