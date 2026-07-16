---
name: view-wiki-graph
description: Use when viewing/exploring the wiki as an interactive graph in a browser, or debugging the viewer — e.g. "위키 그래프 보기", "그래프 시각화 서버 띄워", "노드 색·라벨 바꾸기", "viewer.yaml 설정", "autosci-view".
---

# 위키 그래프 뷰어 (view-wiki-graph)

## 개요
`autosci_core.viewer`는 위키(엔티티 페이지 + 관계)를 **로컬 브라우저에서 인터랙티브 그래프**로 보여주는
도메인 무관 **메커니즘**이다. core는 도메인 어휘(ticker/theme 등)를 모른다 — 노드 종류(kind)는 데이터의
frontmatter에서, 색·라벨은 자동 팔레트 또는 프로젝트 `viewer.yaml` override로 정해진다.
**core는 그래프를 그리고, 프로젝트는 무엇이 무슨 색·라벨인지 제안한다.**

## 언제 쓰나
- 위키 전체/이웃 관계를 브라우저 그래프로 탐색
- 노드 클릭 → 원문 .md를 패널에서 읽기
- kind별 색·라벨·표시필드·기본숨김을 `viewer.yaml`로 조정
- **NOT:** 위키 계약 검증·엣지 추가([[validate-wiki-contract]]), 소스 문서 ingestion([[read-source-documents]])

## 사용법
```bash
pip install autosci-core[viewer]            # web 의존성(extra)
python -m autosci_core.viewer serve         # http://127.0.0.1:8000
# 또는 콘솔 스크립트: autosci-view serve
```
| 옵션 | 의미 |
|---|---|
| `--config <path>` | `wiki-kernel.yaml` 경로(미지정=상위 자동 탐색). `wiki_dir`/`contract_dir` 해석 |
| `--loader markdown\|edges` | `markdown`(기본)=vault `[[wikilink]]` 파싱 · `edges`=커널 `edges.jsonl`(타입드) |
| `--host/--port` | 바인드 주소(기본 127.0.0.1:8000) |
| `--no-reload` | 파일변경 자동 리로드(SSE) 비활성 |

`viewer.yaml`(`wiki-kernel.yaml`과 같은 디렉터리, optional, 도메인 어휘는 여기에만):
```yaml
kind_field: type                    # frontmatter의 kind 필드명(기본 type)
node_types:
  ticker: {color: "#4E79A7", label: "종목"}   # kind별 색·라벨 override
show_fields: [region, state]        # 패널 노출 frontmatter 화이트리스트(비우면 전체)
default_hidden: [daily-note]         # 처음 숨길 kind(범례에서 다시 켜기)
```

## 동작 (Quick Reference)
| 경로 | 응답 |
|---|---|
| `GET /` | 정적 그래프 UI(cytoscape, no-build vendored) |
| `GET /api/graph` | `{nodes, edges, style}` — 색·라벨은 style.node_types |
| `GET /api/node/{id}` | `{id,kind,title,attrs,html}` — 원문 .md를 HTML 렌더, `[[wikilink]]`→앵커 |
| `GET /api/events` | SSE — wiki 변경 시 `reload` push(자동 새로고침) |

MVP 인터랙션: 노드 클릭→원문 패널, kind별 필터+범례, 파일변경 자동 리로드.
공개 API: `from autosci_core.viewer import MarkdownVaultLoader, EdgesJsonlLoader, Graph, Node, Edge`.

## 흔한 실수
- `[viewer]` extra 미설치 → fastapi/uvicorn ImportError. `pip install autosci-core[viewer]`.
- `wiki-kernel.yaml` 없음 → `--config`로 명시하거나 위키 루트 상위에 둔다.
- `edges` 로더는 `edges.jsonl` + contract가 있어야 함(없으면 `markdown` 사용).
- 색을 core 코드에 넣지 말 것 — 도메인 색·라벨은 `viewer.yaml`에만(불변 규칙: 도메인 어휘 0).
