---
name: read-source-documents
description: Use when ingesting raw documents (HTML / Markdown / CSV / PDF) into the wiki, checking why a source was quarantined, or configuring per-format parsing — e.g. "raw 문서 읽기", "PDF가 위키에 안 들어가", "왜 격리됐지", "adapters.yaml 설정", "문서 정규화".
---

# 소스 문서 읽기 (read-source-documents)

## 개요
`vault/raw/` 아래 문서를 형식별 어댑터로 읽어 **하나의 깨끗한 정규화 텍스트**(`SourceRecord`)로 만들고
`raw/.derived/<경로>.md`에 materialize한다. core는 "파일 → 정규화 텍스트"까지만 책임지고, 도메인 해석
(extractor)은 소비 프로젝트가 맡는다. [[extract-session-transcripts]]와 짝 — 트랜스크립트는 세션을 `raw/`에
넣고, 이 어댑터가 `raw/` 전체를 읽어 위키 입력으로 만든다.

## 언제 쓰나
- HTML/Markdown/CSV/PDF 소스를 위키 파이프라인에 넣기 전 정규화·점검
- 어떤 소스가 왜 격리(quarantine)됐는지 확인
- 형식별 파싱 설정(임계값·도구 순서·크기 cap)을 프로젝트별로 조정
- **NOT:** `SourceRecord` → 도메인 엔티티 변환(프로젝트 extractor), 세션 대화 변환([[extract-session-transcripts]])

## 사용법
```bash
# vault의 raw/ 를 형식별로 읽어 ok/격리 상태를 출력 (= python -m autosci_core.adapters)
autosci-read --vault .
```
리포트: `ok <format> <path> (tool, conf=..)` / `<status> <format> <path> [why]` + `total= ok= quarantined= by_status=`.
- 0바이트 파일(`.gitkeep` 등 placeholder)은 vault 스캔·tally에서 제외된다(단일 파일 지정
  `read_source`는 그대로 처리).
- PDF 기본 추출은 **읽기 순서 모드**다(poppler 레이아웃 분석 — 2단 컬럼 논문에서 인용
  가능한 연속 텍스트 산출). 구 `-layout` 모드가 필요하면 프로젝트 `runtime/adapters.yaml`에
  `pdf: {options: {layout: true}}`를 선언한다.
- `autosci-read`는 vault 루트의 `wiki-kernel.yaml`을 자동 인식해 `runtime/adapters.yaml`
  overlay를 반영한다(없으면 core 기본값).

## 핵심 동작 (Quick Reference)
| 항목 | 동작 |
|---|---|
| 입력 | `<vault>/raw/` 재귀 스캔(확장자로 형식 판별, `.derived/`는 건너뜀) |
| 출력 | 통과분만 `raw/.derived/<경로>.md`로 기록 + `SourceRecord`(text·confidence·status·tool·hash) |
| 파싱 | **외부 도구 우선**(pdftotext/pandoc 있으면 사용) → 없으면 **순수 Python fallback** |
| PDF | 순수 Python fallback은 `[pdf]` extra: `pip install autosci-core[pdf]`(pypdf) |
| 품질 게이트 | 저신뢰/실패 소스는 **격리**(materialize 안 함) + 리포트에 사유 |
| 캐시 | `raw/.derived/manifest.json`(content-hash + 추출 구성 지문 `extract_config`) — 소스가 그대로여도 추출 옵션·어댑터 버전이 바뀌면 자동 재파생 |
| 설정 override | `adapters.yaml` overlay(extensions·external_tools·max_bytes·max_input_bytes·min_confidence·options)를 ProjectContext로 주입 |

API: `from autosci_core.adapters import SourceReader; SourceReader(vault).read()` (또는 `read_source(path, vault)` 단일 파일).

## 흔한 실수
- 소스는 반드시 **`raw/` 아래**에 둔다. `raw/.derived/`는 **생성물**이라 직접 수정 금지(다음 실행에 덮어씀).
- 격리됐다고 버그가 아니다 — 저신뢰/파싱실패는 의도된 게이트. 리포트의 `[why]`를 보고 원본/도구를 점검.
- 외부 도구(pdftotext/pandoc)를 깔면 품질이 올라간다. 없으면 fallback이 자동으로 쓰이지만 신뢰도가 낮을 수 있음.
- 형식별 동작을 바꾸려면 core 코드가 아니라 **프로젝트 `adapters.yaml`**을 고친다.
