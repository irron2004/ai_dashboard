# autosci paper 도메인 실제 생성 (도메인 팩 오버레이) — 설계

- **날짜:** 2026-06-20
- **상태:** 설계 승인됨 (구현 계획 대기)
- **하위 프로젝트:** 로드맵 #2(도메인 overlay 최소판) + #3(생성 정렬)의 첫 실현 — paper 도메인 한정
- **선행:** `2026-06-19-autosci-core-wiki-substrate-integration-design.md`(#1 이음매, 완료), `2026-06-19-interactive-node-confirmation-design.md`(확인 모드, 완료)

---

## 1. 배경 / 문제

autosci-core 이음매(#1)는 완료됐다: `WikiSubstrate` 포트 + `PythonKernelAdapter`(kernel lint/ingest), `wiki-domains/paper/` 계약, 골든 vault fixture, "kernel 게이트가 run을 실제로 FAILED시킨다"는 음성 테스트. **그러나 생성 단계는 골든 fixture(상수)** 라, 실제 워크스페이스 문서로 LLM이 paper 위키를 만드는 경로는 미구현이다(#3).

사용자의 실제 요구: **이미 존재하는 papers 워크스페이스(원격 `/home/hskim/work/papers`, ML 연구 — 논문/모듈/파이프라인/실험 결과/가설)의 문서들을 autosci로 정리해 타입드 위키로 생성**하고 싶다. 현재 "위키 생성" 버튼은 범용 project-docs 파이프라인을 돌릴 뿐 paper 계약/생성을 쓰지 않는다.

## 2. 확정된 결정 (브레인스토밍 산출)

1. **범위:** papers 프로젝트 end-to-end — 원격 워크스페이스 문서 → autosci-read 인제스트 → paper 계약으로 LLM 타입드 노드 생성 → kernel lint 게이트 → 기존 검수/promote/UI 렌더까지 실제 동작.
2. **스키마:** 기존 동결 paper 계약을 **그대로** 사용(`papers`/`modules`/`pipelines`/`pipeline_trials` + `uses_module`/`pipeline_from_paper`/`alternative_to`). 가설/실험 결과는 `pipeline_trials`(status/metrics/success_reason) + 모듈 `evidence`로 매핑. 스키마 재설계 없음.
3. **도메인 라우팅:** **프로젝트별 `domain` 설정**(기본 `project-docs`, papers=`paper`).
4. **생성 구조 = A안(도메인 팩 오버레이):** 기존 파이프라인(폴더 팬아웃, 인터랙티브 확인, promote, UI 그래프)을 **도메인 팩**으로 매개변수화해 재사용. `project-docs` 팩 = 현 동작 무변경, `paper` 팩 = 신규.
5. **실행 환경:** autosci ingest + kernel lint는 로컬 `uv` venv(`.venv-substrate`, #1 경로 해석 재사용). LLM 생성은 기존 라우팅 러너(SSH→원격 엔진).

## 3. 목표와 범위

### 범위 안
- `DomainPack` 추상화 + 두 구현(`project-docs`, `paper`).
- `Project.domain` 영속(DB/IPC/UI) + container/harness-service 라우팅.
- paper 생성 드라이버 경로: 실제 autosci-read 인제스트 → paper 팩 프롬프트/스키마로 타입드 노드 추출(팬아웃) → 타입드 엣지 병합 → autosci vault 레이아웃 + UI frontmatter 렌더 → **kernel lint 게이트** → rebuild-index → 검수/promote.
- 제네릭 NodeProposal → 타입드(node_type + 도메인 스키마 검증) 일반화. PolicyGuard 도메인-인지.
- 테스트: 팩 선택 / paper 추출기(mock 엔진) / render / VALIDATED 음성(venv-gated) / e2e / project-docs 불변 회귀.

### 범위 밖 (명시적 연기)
- project-docs 위키를 도메인 팩으로 "이관"하는 전면 리팩터(#2 완성) — 본 작업은 `project-docs` 팩을 **현 코드 위임 래퍼**로만 둔다.
- 다른 신규 도메인(논문 외) overlay.
- TS 검증기 은퇴(#3 후반). paper 도메인만 kernel lint를 권위 게이트로; project-docs는 기존 TS 검증기 유지.
- 배포용 `TsKernelAdapter`(#5).
- "제목으로 새 노드 추가"(evidence 없는 합성) — 기존 연기 유지.

## 4. 아키텍처

### 4.1 DomainPack (오버레이 경계)
```
type DomainPack = {
  id: 'project-docs' | 'paper'
  contractDir?: string                       // paper: wiki-domains/paper/runtime ; project-docs: undefined
  nodeSchema: ZodType<TypedNodeProposal>     // 이 도메인 노드 제안의 검증 스키마
  buildExtractorPrompt(args): string         // sources + (paper) entities/edges/conventions + autosci skill 주입
  renderNode(node): { path: string; frontmatter: Record<string,unknown>; body: string }
  validate(vault: WikiVault | StagingRoot): Promise<ValidationReport>  // paper=WikiSubstrate.lint, project-docs=기존 TS 검증기
}
```
- 호출부(make-drivers, container, UI 어댑터)는 `DomainPack`만 소비 — 도메인 추가/교체 시 호출부 불변.
- 위치: `packages/knowledge-harness/src/domains/` (`project-docs-pack.ts`, `paper-pack.ts`, `index.ts`). paper 팩의 lint/ingest 호출은 `packages/wiki-substrate`의 `WikiSubstrate`로 위임.

### 4.2 도메인 라우팅
- `Project`에 `domain: 'project-docs' | 'paper'` 추가. DB `projects.domain` 컬럼(기본 `'project-docs'`, 마이그레이션 = 누락 시 기본값), `registerProject`/`updateProject` IPC 필드, ProjectSidebar 도메인 선택 UI.
- `container.ts`가 `project.domain` → `domainPackFor(domain)` → `DriverDeps.domainPack`로 주입.

### 4.3 상태머신 (그대로 재사용, 드라이버만 도메인-인지)
`makeDrivers(deps)`가 `deps.domainPack`을 받아 각 상태에서 팩에 위임:
- **SOURCES_EXTRACTED:** paper 팩이면 `WikiSubstrate` ingest(autosci-read)로 `raw/` 문서를 실제 파싱 → SourceRecord. (현 `checkSources(ok/output)` → 파싱 결과(레코드/텍스트) 반환까지 확장.)
- **NODE_PROPOSALS_CREATED:** 폴더 팬아웃 추출기를 `domainPack.buildExtractorPrompt` + `domainPack.nodeSchema`로 구동 → 타입드 노드 제안. 팬아웃/dedupe/인터랙티브 확인 재사용.
- **LEAD_MERGED:** 병합 + 타입드 엣지(`uses_module`/`pipeline_from_paper`/`alternative_to`).
- **STAGING_WRITTEN:** `domainPack.renderNode` → autosci vault(`wiki/<type>/<slug>.md` + `wiki/graph/edges.jsonl`) + UI frontmatter(`node_id`/`node_type`, `substrate-graph-adapter`).
- **VALIDATED:** `domainPack.validate` = paper면 `WikiSubstrate.lint`(권위 게이트). issue 시 `DriverResult{status:'failed', artifacts:[리포트]}`(§4a-1 계약 존재) → 러너가 리포트 보존 후 FAILED.
- **INDEX:** `rebuildIndex` → index.md/graph.
- **HUMAN_REVIEW_REQUIRED / promote:** 무변경 — 워크스페이스 vault로 promote → 원격 `.apc-wiki`(+ export 시 `wiki/`).

### 4.4 타입드 NodeProposal
제네릭 `KhNodeProposal`(generic ConceptNode 등)을 `node_type` + 도메인 스키마로 검증되는 타입드 노드로 일반화. paper 노드의 필수 필드(`title`/`slug`/타입별 enum/`evidence`/`source_papers`)는 `nodeSchema`로 강제. PolicyGuard는 **도메인-인지**: project-docs의 shared-floor/no_evidence 규칙을 paper에 그대로 적용하지 않고, paper는 스키마 `evidence`/`source_papers` 충족을 근거 규칙으로 본다(세부는 구현 계획에서 확정).

## 5. 데이터 흐름 (papers end-to-end)
```
[0] 부트스트랩(1회): uv venv .venv-substrate + autosci-core[pdf]  (이미 있으면 빠름)
[1] MATERIALIZE: 원격 /home/hskim/work/papers 문서 → 로컬 raw/papers/ (기존 SSH materialize)
[2] SOURCES_EXTRACTED: WikiSubstrate ingest(autosci-read) → SourceRecord
[3] NODE_PROPOSALS_CREATED: 팬아웃 추출기(paper 팩 프롬프트+스키마) → 타입드 노드 제안 + evidence
    └ 확인 모드면 일시정지 → 사용자 keep/remove/rename → 「이대로 생성」
[4] LEAD_MERGED: 병합 + 타입드 엣지
[5] STAGING_WRITTEN: renderNode → wiki/<type>/<slug>.md + edges.jsonl + UI frontmatter
[6] VALIDATED: WikiSubstrate.lint(vault)  → issue 0 green / issue 시 FAILED+리포트
[7] INDEX: rebuildIndex → index.md/graph
[8] HUMAN_REVIEW → promote → 워크스페이스 .apc-wiki (export 시 wiki/)
```

## 6. 에러 처리
- venv/python 부재: paper 도메인은 lint 필수 → 조용한 통과 금지, 실행 가능한 에러(부트스트랩 안내) + run FAILED.
- kernel lint issue: FAILED + `kernel-lint-report` artifacts 보존(§4a-1).
- 파싱 실패 문서: materialize/ingest manifest에 기록, 라이브 로그 노출(빈 raw/ 은닉 금지).
- 타입드 스키마 위반(LLM 출력): `nodeSchema` 파싱 실패 → 해당 노드 drop + 로그(런 전체 실패 아님), 0개면 추출 단계 실패.

## 7. 테스트
| 레벨 | 테스트 | 통과 기준 |
|---|---|---|
| 단위 | `domainPackFor('paper'\|'project-docs')` 선택 | 올바른 팩/계약 dir |
| 단위 | paper 추출기(mock 엔진, 골든 소스) | `nodeSchema` 적합 타입드 제안, evidence 포함 |
| 단위 | `paperPack.renderNode` | wiki/<type>/<slug>.md + edges.jsonl + UI frontmatter(node_id/node_type) |
| e2e | papers-유사 fixture 전체 [2]~[7] | HUMAN_REVIEW + index/graph, 스냅샷 안정 |
| 음성 | 깬 타입드 노드 → VALIDATED | run FAILED + kernel-lint-report 보존 (venv-gated) |
| 회귀 | project-docs run | **현재와 100% 동일**(팩 위임 무변경) |
| UI 스모크 | 생성 vault → 그래프 뷰어 | 타입드 노드/엣지 렌더, 클릭→문서 |

## 8. 성공 기준
1. papers 프로젝트에 `domain=paper` 설정 후 "위키 생성" → 원격 문서를 인제스트해 **실제 LLM**이 타입드 paper 노드/엣지를 생성(고정 fixture 아님).
2. 생성 vault가 **kernel lint** 게이트를 통과(정상) / 위반 시 run FAILED + 리포트 보존.
3. 생성 결과가 기존 인터랙티브 확인 → promote → 워크스페이스 `.apc-wiki`(+export `wiki/`) 흐름으로 반영.
4. UI 그래프 뷰어에 타입드 노드/엣지 렌더.
5. project-docs 프로젝트 동작 불변(회귀 0), 전체 스위트 green + typecheck 0.

## 9. 리스크
| 리스크 | 완화 |
|---|---|
| LLM이 paper 계약 필드/enum을 정확히 못 채움 | `nodeSchema`로 강제 파싱 + 추출 프롬프트에 entities/edges/conventions + autosci skill 주입 + 위반 노드 drop |
| 제네릭→타입드 일반화가 project-docs 회귀 유발 | `project-docs` 팩을 현 코드 위임 래퍼로 두고 회귀 스위트로 봉인 |
| SSH 원격 문서 인제스트(파싱 대상이 raw/에 안 옴) | 기존 SSH materialize 경로 재사용([1]); ingest manifest로 가시화 |
| PolicyGuard 규칙이 타입드 노드와 충돌 | PolicyGuard 도메인-인지 분기(구현 계획에서 규칙 확정) |
| venv/Windows 경로 | #1의 PythonKernelAdapter 경로 해석 재사용; 부트스트랩 보장 |
