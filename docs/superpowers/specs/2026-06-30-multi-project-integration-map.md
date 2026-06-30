# Multi-Project Integration Map — 4 프로젝트 → ai_dashboard 고도화

**날짜:** 2026-06-30
**상태:** 설계 지도(map). 축별 상세 스펙은 후속 문서로 분기.
**목적:** 사용자의 4개 메인 프로젝트(coin / calculate_math / blog / ai_dashboard)에서 나온 기능·산출물을 ai_dashboard("agent-project-console")로 흡수해 고도화한다. 각 프로젝트를 **도메인**으로 콘솔에 끼우는 것이 골격이며, 이는 그린필드가 아니라 **이미 존재하는 추상화의 슬롯을 채우는 작업**이다.

---

## 1. 네 프로젝트 현재 상태

| 프로젝트 | 위치 | 핵심 기능 | wiki / 그래프 형태 | harness |
|---|---|---|---|---|
| **coin** | `ruahverce/coin` (submodule, `irron2004/coin`) | GDELT→예측 그래프, 주식/뉴스 분석 | **autosci 커널** — `vault/` + `edges.jsonl` + kernel-lint | `agents/`, tasks, `epics/2026-05-14-llm-wiki-graph` |
| **calculate_math** | `ruahverce/calculate_math` | 교육과정 커리큘럼 뷰어 | **폴더 MD** (`02_데이터/curriculum_wiki/` 학년군/영역/단원) + 별도 `graph.json` | `agents_up.sh`+tmux, `roles/`, `tasks/` |
| **blog** | GitHub `irron2004/blog` → `blog.ruahverce.com` | Astro5/MDX 정적 블로그(17편, 시리즈/태그) + `sns/` 크로스포스팅 | wiki 없음 → **콘텐츠 코퍼스 + 시리즈/태그 택소노미** | `.claude/skills` 7종(blog-orchestrator/research/review/writing, competitor-analysis, post-diagnosis, publish-blog) + agents 5종 |
| **ai_dashboard** | `ruahverce/ai_dashboard-main` (`irron2004/ai_dashboard`) | 콘솔: 프로젝트·하네스 관리 + LLM wiki 생성 | `.apc-wiki/` (autosci, `paper` 도메인) | `harness` + `pm` 패키지 |

> 주의: blog의 GitHub `irron2004/blog`는 로컬 `my/sns_blog`(codex 콘텐츠 생성 파이프라인)와 **별개**다. 후자는 업스트림 생성기일 가능성.

---

## 2. ai_dashboard = 흡수 substrate (이미 파인 슬롯)

```
ProjectRegistry (packages/core/src/project-registry.ts)   ← 각 프로젝트 = 1 row
  ├ domain: 'project-docs' | 'paper'   ← DomainPack 키 (★ 확장 지점)
  ├ repoPaths[]    → 프로젝트 git 레포
  ├ vaultPaths[]   → 프로젝트 위키/콘텐츠
  └ sourcePaths[]  → 소스 문서 · 하네스 설정

app-services (packages/app-services)
  harness-service(fanout/interactive/workspace) · generate-service
  · ingest-service · knowledge-indexer · current-promotion-service

패키지   wiki-substrate(autosci 커널 래핑) · knowledge(chunker/retrieval=RAG)
        · harness(agent-config/task-profile) · pm(task/run/review/vault-writer)
        · graph-view(GraphVisualization/build-graph/graph-layout/algorithms)
        · llm-wiki · search · workflow
앱       apps/desktop(Electron) · apps/graph-web
```

**레퍼런스 구현:** `paper` 도메인(2026-06-21 main 머지) — 추출→렌더→kernel-lint→PDF인제스트→타입드 엣지. 신규 도메인(coin/calc/blog)은 이 패턴(추출기+렌더러+validator 세트 = DomainPack)을 복제한다.

---

## 3. 3축 통합 매핑 (확정 방향)

```
                 ① 위키→도메인 인제스트      ② harness/PM 흡수         ③ 그래프 시각화 커스텀
coin    거의 drop-in                  agents→harness/pm         예측 그래프 뷰
        (동일 autosci substrate)      task-store                (epistemic grading 색)
calc    변환 필요                      agents_up.sh+tmux         학년군/영역 트리 뷰
        (폴더MD+graph.json→substrate) →harness 표준화            (435 성취기준 커버맵)
blog    콘텐츠→knowledge(RAG)          .claude/skills 7종         시리즈/태그 토픽 그래프
        (시리즈/태그 택소노미)          +agents→harness 자산화
```

### 축별 플러그 지점 / 난이도

- **① 위키→도메인 인제스트**
  - coin: ai_dashboard와 **동일 autosci 커널** → 사실상 `vaultPaths` 연결 + 도메인 등록. (최저 난이도)
  - calc: 폴더MD + `graph.json` → substrate 변환 어댑터/DomainPack 필요.
  - blog: 지식 위키가 아니라 발행 콘텐츠 → `knowledge` RAG 인제스트 + 시리즈/태그를 그래프 노드/엣지로.
- **② harness/PM 흡수** — 네 프로젝트 공통 패턴(`agents_up.sh` + tmux + `roles/` + `tasks/`)을 `harness`+`pm`으로 표준화. blog의 `.claude/skills` 7종 = 즉시 재사용 가능한 하네스 자산. **횡단 레버리지(한 번 표준화 → 전 프로젝트 콘솔 편입).**
- **③ 그래프 시각화 커스텀** — `graph-view`가 도메인별 스타일·레이아웃 커스텀 지점. coin=epistemic grading 색, calc=커버맵 트리, blog=토픽맵.

---

## 4. 핵심 통찰

1. **substrate는 이미 있다** — `ProjectRegistry` + `DomainPack`이 정확히 이 통합용 구조. 신규 도메인 = 추출기+렌더러+validator 세트.
2. **coin이 최저 난이도 진입점** — 동일 autosci 커널이라 ① 위키 인제스트가 거의 경로 연결.
3. **harness 흡수가 횡단 레버리지** — 네 프로젝트 공통 → 한 번 표준화하면 전 프로젝트 콘솔 구동·전환(= ai_dashboard 본래 목적).
4. **포맷 이질성이 유일한 마찰** — calc(폴더MD)·blog(콘텐츠)는 substrate 어댑터가 필요.

---

## 5. 후속 분기 (축별 상세 스펙)

각 축은 별도 spec으로 분기하여 brainstorming → writing-plans 흐름으로 진행:

- [ ] `spec: coin → prediction 도메인 DomainPack` (① 축, 레퍼런스 복제, 최저 난이도)
- [ ] `spec: harness/PM 표준화 — 4프로젝트 공통 패턴 흡수` (② 축, 횡단 레버리지)
- [ ] `spec: calc 폴더MD+graph.json → substrate 어댑터` (① 축, 변환)
- [ ] `spec: blog 콘텐츠 → knowledge RAG + 토픽 그래프` (①·② 축)
- [ ] `spec: graph-view 도메인별 시각화 커스텀` (③ 축, 위 도메인들 의존)

> 작업 원칙: 코드 착수 전 brainstorming으로 각 spec의 요구사항·설계를 먼저 확정한다. 증거 없는 선수관계(엣지)는 만들지 않는다(autosci 원칙).
