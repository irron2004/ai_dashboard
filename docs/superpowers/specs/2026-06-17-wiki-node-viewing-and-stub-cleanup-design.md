# Wiki 노드 뷰잉 + 잔재 stub 청소 — 설계

작성일: 2026-06-17
상태: 설계 승인 대기 → (승인 시) 구현 계획(writing-plans)으로

---

## 0. 대화 요약 (이 스펙에 이르기까지)

이 설계는 사용자와의 brainstorming 대화에서 나왔다. 흐름을 그대로 남긴다 — 결론만큼 **경로**가 중요하기 때문이다.

1. **출발점(불만):** "사용성이 매우 떨어진다. wiki가 잘 생성됐는지도 모르겠고, 노드를 누르면 '허용되지 않는 경로'라고 뜬다. 고치라는 게 아니라, 한 번에 너무 많은 기능을 만들어서 어디서부터 잡아야 할지 모르겠다."
2. **툴의 정체성:** "PM도 사용하는 vibe coding 툴" + "ontology 구축 harness".
3. **북극성(이상):** task 하나를 누르면 그 task의 코드 변경(git diff) + 작업 내용(handoff·대화) + 거기서 정리된 지식(wiki)이 한 화면에 모이고, LLM이 그 wiki를 읽고 답한다.
4. **추가 요구(가독성):** 노드가 많이 생기니 폴더별 필터, 폴더/task별 군집 배치 등 가독성 작업이 필요.
5. **진짜 핵심 페인:** "결정적으로, 지금 문서가 잘 생성되고 있나? 대화에서 내용이 잘 추출되고 있나? 이게 **안 보여서** 확신이 없다."
6. **우선순위 선택:** 사용자는 "내용 채우기가 우선"이라고 판단.
7. **코드·데이터를 직접 깐 결과 — 전제가 뒤집힘:** 현재 코드는 **이미 진짜 문서를 잘 생성하고 있었다**(아래 §2). 사용자가 stub만 본 것은 ① 스크린샷이 구버전 run이고 ② 새 문서를 클릭해서 못 열고 ③ 옛 stub이 섞여 있었기 때문. "content 채우기"를 새로 만드는 것은 **이미 된 일을 다시 만드는 헛수고**.
8. **첫 타깃 재조정(증거 기반):** "이미 생성된 113개 문서를 **보이게** 만들고, **잔재 stub을 청소**한다." (사용자 선택)
9. **접근법 확정:** A1(디스크에서 staged 목록 직접 읽기) + B1(진짜 노드만 필터) + 신뢰 신호 배지.

> **북극성은 유지하되 이번 스펙의 범위는 아니다.** 이번 작업은 "이미 있는 지식을 신뢰 가능하게 보이도록" 하는 한 걸음이다. task 중심 묶기·폴더 필터·군집·LLM Q&A는 백로그(§7).

---

## 1. 문제 정의

사용자는 wiki harness가 제대로 동작하는지 **확신할 수 없다**. 두 가지 증상:

- **(증상 A) 못 본다:** 그래프/트리에서 노드를 클릭하면 "허용되지 않는 경로" 또는 "원문 없음"이 떠서 생성된 문서를 열 수 없다.
- **(증상 B) 비어 보인다:** 화면에 한 줄짜리 stub 노드가 섞여 있어, 좋은 문서가 있어도 "대충 만든 것"처럼 보인다.

두 증상 모두 **"생성·추출 품질이 눈에 안 보인다"**는 한 가지 근본 불안으로 수렴한다.

---

## 2. 진단 (코드 + 실제 데이터 증거)

데이터 위치: **Windows** `~/AppData/Roaming/@apc/desktop/apc-harness-runs` (live). Linux `~/.config/@apc/desktop`는 stale.

### 2.1 엔진은 동작하고, 내용도 이미 잘 채워진다

- 파이프라인은 `materialize → project-discovery → conversation-history → document-intent → node-extractor → wiki-graph-lead → policy-guard → human-review`로 HUMAN_REVIEW_REQUIRED까지 완주한다.
- 대화는 `vault-staging/raw/conversations/<engine>/<session>/NNNq_a.txt`로 추출된다.
- **노드 문서는 `make-drivers.ts`의 `STAGING_WRITTEN` 드라이버(약 410행)에서 `renderNodeDoc`(`agents/render-node-doc.ts`)로 결정적으로 렌더링된다.** LLM은 한 줄 stub만 쓰므로, 실제 문서는 proposal의 `claims`·`evidence`·그래프 엣지로부터 코드가 만든다. 결과물엔 YAML frontmatter(`node_id`/`node_type`/`scope`/`tags`) + H1 + 요약 + `## 핵심 주장` + `## 관련 노드`([[node-id]]) + `## 근거`(출처 인용)가 들어간다.

### 2.2 결정적 증거 — 구버전 vs 현재 코드

| | RUN 08:10 (사용자 스크린샷) | RUN 15:02 (현재 코드) |
|---|---|---|
| 노드 파일 | 23개 | 136개 |
| **renderNodeDoc 포맷(진짜 문서)** | **0개** | **113개** |
| 본문 크기 | 70–114 B (한 줄 stub) | min 1408 · median 2172 · max 3445 B |
| 근거 | 없음 | 출처 대화/문서 **인용 포함** |
| 파일명 규칙 | kebab (`anomaly-transformer-…`) | node.id (`decision.paper_d_…`) |

`chamber_leak_shared_loader_contract.md`(2443 B)는 frontmatter + 핵심 주장 4개 + 근거 4건(대화·문서 인용)을 갖춘 완전한 문서다 — 사용자의 "대화에서 잘 추출됐나"에 직접 답한다.

### 2.3 그래서 두 증상의 진짜 원인

- **(A) 뷰잉:** 클릭 가능한 그래프는 **Knowledge 탭(`KnowledgeView.tsx`)**에만 있다(Wiki Gen 탭 `WikiGenDashboard.tsx`엔 클릭 그래프 없음). 노드→문서 경로 해석 체인이 취약하다: 그래프 노드 id가 `nodes/<id>.md`로 추론되는데 실제 파일명 규칙(kebab vs node.id의 dot/underscore)과 어긋나거나, staged→promoted 폴백 경로/절대·상대 경로 처리에서 깨진다. 정확한 문구 출처: "허용되지 않는 경로"는 `harness-service.ts`의 `readStagedDoc`(약 364–377행, `resolveInside` 예외)에서만, "…이거나 파일이 없습니다"는 `project-files.ts`의 `readProjectDoc`(약 36행)에서 나온다.
- **(B) stub 잔재:** 구버전(커밋 81831ea 이전)에서 만든 kebab-stub 23개가 vault에 promote되었고, `StagingVault`가 매 run마다 vault 전체를 staging으로 복사하므로 이후 모든 run의 staging에 그대로 딸려온다. 새 렌더 문서는 파일명 규칙이 달라(`node.id` 기반) 덮어쓰지 못하고 **공존**한다.

> 정확한 클릭 실패 라인은 구현 1단계에서 **실패 테스트로 재현·확정**한다(systematic-debugging Phase 1).

---

## 3. 요구사항

### 기능 요구
- R1. Knowledge 탭 **docs 모드 트리**에 현재 run이 생성한 **진짜 노드 문서만** 나열한다. (그래프는 §4 결정대로 구조를 바꾸지 않는다.)
- R2. 노드를 클릭하면(트리든 그래프든) 해당 문서가 **항상** 열려 본문 + `## 핵심 주장` + `## 근거`가 보인다.
- R3. 옛 kebab-stub 노드는 **docs 모드 트리·신뢰 카운트에 나타나지 않는다**.
- R4. "이 run: 진짜 노드 N개 · {상태}" **신뢰 신호**를 헤더에 표시한다.

### 비기능 요구
- N1. 경로는 `resolveInside`로 staging 디렉터리 밖을 벗어날 수 없다(기존 보안 가드 유지).
- N2. 변경은 작고 국소적이어야 한다(생성 파이프라인 불변).
- N3. 트리 클릭과 그래프 클릭은 **동일한 해석 경로**를 쓴다(불일치 재발 방지).

---

## 4. 설계 (A1 + B1 + 신뢰 신호)

### 4.1 데이터 흐름
```
[그래프 노드 클릭] / [트리 항목 클릭]
        │
        ▼
api.harnessListStagedDocs(runId)            ← 신규 IPC (A1)
   main: <run>/vault-staging/ 안의 .md를 안전하게 나열
   각 항목 → { relPath, isNode, title, nodeType }
        │      (isNode = frontmatter에 node_id: 존재)
        ▼
KnowledgeView(docs 트리): isNode === true 만 표시 (B1)
   + 헤더 배지 "진짜 노드 N개 · {run 상태}" (R4)
   + 클릭 해석 매핑(node_id→relPath, stem(data.path)→relPath)을 트리·그래프가 공유 (N3)
   (그래프 캔버스 구조는 불변 — run/report/evidence/file 노드 그대로)
        │
        ▼
api.harnessReadStagedDoc(runId, relPath)    ← 실재 경로 → 항상 성공 (R2)
        ▼
MarkdownContent: 본문 + 핵심 주장 + 근거(소스 인용)
```

### 4.2 컴포넌트 / 변경 지점

**main 프로세스**
- `listStagedDocs(runId)` 추가: `resolveInside(runsRoot, '<runId>/vault-staging')` 하위를 훑어 `.md`만 수집. `raw/`·`runs/`·`reviews/`는 노드가 아니므로 제외(노드 디렉터리 `nodes/` 우선). 각 파일의 선두 frontmatter를 파싱해 `node_id`/`node_type`을, 본문 첫 H1에서 `title`을 뽑는다. frontmatter에 `node_id`가 없으면 `isNode: false`(=stub).
- IPC 채널 `harnessListStagedDocs` + preload `api` 노출.

**renderer `KnowledgeView.tsx`**
- 기존 `stagedDocs` 파생(applied-write-report/node-proposals에서 경로 추측)을 **`harnessListStagedDocs` 결과로 교체**. 디스크에 실재하는 relPath만 사용 → id 불일치 근본 제거.
- **docs 모드 트리**에 `isNode === true` 항목만 노출(B1, R3). 각 항목에 `nodeType` 태그(Decision/Concept/Experiment) 표기(가독성 보너스).
- **그래프 캔버스는 구조를 바꾸지 않는다** (리뷰 #1 결정): `buildHarnessGraphData`는 run/report/evidence/source/file 노드를 함께 그리는 run 개요이므로 그대로 둔다. "그래프를 노드-문서만 보이게 재구성"은 별도 작업으로 §7 백로그.
- 그래프 `handleNodeClick`의 **클릭 해석만 견고화**(N3, R2): staged 목록을 두 키로 매핑 — ① `node.id`(접두어 제거) → `entry.nodeId`, ② `stem(node.data.path)` → `entry.relPath`. proposal 그래프 노드 id는 `task:<proposal_id>`이고 실제 경로는 `data.path = nodes/<node_id>.md`이므로 **②(data.path stem)가 필수**(리뷰 #2). 매핑에 걸리면 그 relPath로 `readStagedDoc`; 안 걸리면 프로젝트 문서용 기존 `fsReadDoc(node.data.path)` 폴백 유지.
- 헤더에 신뢰 신호 배지(R4): `진짜 노드 {N}개 · {run.runState.state 라벨}`.

### 4.3 에러 처리
- `listStagedDocs`: 디렉터리 없으면 `[]`(빈 트리 + "아직 노드 없음" 안내 유지).
- `readStagedDoc`: 기존 `resolveInside` 가드 유지(N1). 읽기 실패 시 뷰어에 명확한 사유 표시.
- IPC 채널 부재(dev 핫리로드) 시 기존 폴백 메시지 유지.

### 4.4 테스트 (TDD)
- **(1단계) 회귀 재현 테스트:** 현재 클릭 실패를 재현하는 실패 테스트 작성 → 정확한 원인 확정 후 진행.
- `listStagedDocs` 단위: `.md` 나열 / 진짜 노드 vs stub 판별(frontmatter) / `raw/`·`runs/` 무시 / 디렉터리 없음 / 경로 escape 거부.
- `KnowledgeView` 컴포넌트: 진짜 노드만 렌더 · 배지 카운트 정확 · 트리 클릭 시 본문 로드 · 그래프 클릭이 동일 문서로 해석.

---

## 5. 인수 기준 (Acceptance)

- [ ] 최신 run에서 Knowledge 탭 **docs 모드 트리**에 **진짜 노드만(이번 데이터 기준 113개)** 표시되고 stub 23개는 안 보인다. (그래프 캔버스 구조는 불변)
- [ ] 임의의 노드를 트리·그래프 어느 쪽에서 눌러도 본문 + 핵심 주장 + 근거가 열린다("허용되지 않는 경로"/"원문 없음" 사라짐). 특히 `task:<proposal_id>` 형태 그래프 노드도 `data.path` stem 매핑으로 열린다.
- [ ] 헤더에 "진짜 노드 N개 · 검수중" 배지가 보인다.
- [ ] 신규/수정 테스트가 모두 통과한다.

---

## 6. 위험 / 가정

- 가정: 사용자가 보는 환경은 현재 코드(렌더링 동작 버전)다. 만약 구버전 바이너리를 실행 중이면, 우선 최신 빌드로 한 번 재생성해야 113개 진짜 문서가 staging에 생긴다.
- 위험: `listStagedDocs`가 대형 vault 스냅샷을 훑을 때 비용 → `nodes/` 우선 + 깊이 제한으로 완화(기존 `listProjectDocs`의 `DEPTH_LIMIT`/`LIST_LIMIT` 패턴 재사용).

---

## 7. 범위 밖 / 백로그

이번 스펙은 **뷰잉 + 잔재 숨김**만 다룬다. 아래는 의도적으로 제외(추후 각각 별도 spec):

- **B2 — vault 영구 GC:** 화면 숨김이 아니라 vault의 stub 파일을 실제 삭제(파괴적, 신중 설계 필요).
- **그래프 노드-문서 뷰:** `buildHarnessGraphData`를 `harnessListStagedDocs` + graph-update-plan 기준으로 재구성해 그래프 캔버스에도 진짜 노드만 그리기(리뷰 #1에서 분리).
- **가독성 레이어:** 폴더별 필터, 폴더/task별 군집 배치.
- **task 중심 묶기:** task 클릭 → diff + handoff + 대화 + wiki 한 화면(북극성의 핵심 단위).
- **생성 단계 개선:** 폴더 스코프 생성 + 에이전트 사전 제안.
- **LLM Q&A:** wiki를 읽고 답하기.
