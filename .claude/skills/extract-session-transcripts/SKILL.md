---
name: extract-session-transcripts
description: Use when the user wants to add Claude Code / Codex / OpenCode CLI session conversations to the wiki, or to convert/archive AI chat sessions as documents — e.g. "세션 대화를 위키에 추가", "convert sessions to documents", "대화 기록을 문서로 추출".
---

# 세션 트랜스크립트 추출 (extract-session-transcripts)

## 개요
Claude Code·Codex·OpenCode CLI가 각자 다르게 저장한 세션 대화를 **충실도 높은 Markdown**으로 변환해
`raw/transcripts/<tool>/<id>-<hash>.md`에 materialize한다. 이 변환기는 **raw source materializer**다 —
ingestion adapter가 아니다. 산출 `.md`는 기존 Markdown adapter(`autosci_core.adapters`)가 위키로 ingestion한다.
(메커니즘: `autosci_core.transcripts`, 설계: `docs/superpowers/specs/2026-06-18-transcript-converter-design.md`)

## 언제 쓰나
- 사용자가 claude/codex/opencode 세션 대화를 위키에 넣고 싶을 때
- CLI 대화를 문서로 변환·아카이브하고 싶을 때
- **NOT:** 세션 요약/후처리(원문 충실 기록만), 위키 페이지 자동 작성(소비 프로젝트 담당)

## 사용법
```bash
# 1) 먼저 dry-run — 무엇이 변환될지 + redaction 건수 확인 (아무것도 안 씀)
python -m autosci_core.transcripts --project-dir . --vault-root . --dry-run

# 2) 실제 변환 — 현재 프로젝트의 세션을 현재 vault로
python -m autosci_core.transcripts --project-dir . --vault-root .
```
설치 시 `autosci-transcripts` 콘솔 스크립트로도 동일하게 실행. 전체 플래그는 `--help`.
리포트 형식: `by_tool={...} written=N skipped=N redactions=N` + 기록된 파일 목록.

## 핵심 동작 (Quick Reference)
| 항목 | 동작 |
|---|---|
| 필터 | `--project-dir` (세션 cwd 기준). 미지정 시 `wiki-kernel.yaml` 루트 또는 cwd |
| 출력 | `--vault-root`의 `raw/transcripts/<tool>/<id>-<hash>.md` (`--out`으로 하위경로 변경) |
| 도구 | `--tool claude,codex,opencode` (쉼표 다중) |
| 세션 경로 | 기본 `~/.claude`·`~/.codex`·`~/.local/share/opencode`; `--{claude,codex,opencode}-root` 또는 `AUTOSCI_*_ROOT`로 override |
| 프라이버시 | redaction **기본 ON** (secret/API key/PII/경로 마스킹). 해제는 `--no-redact`만 |
| 재실행 | source+rendered hash manifest(`<vault>/.transcripts/`)로 변경분만 기록 (idempotent) |

## 다음 단계 (위키 ingestion)
변환된 `.md`는 `raw/` 안에 있으므로 기존 파이프라인이 그대로 읽는다:
```bash
python -m autosci_core.adapters   # (= autosci-read) raw/ 스캔 → SourceRecord
python -m kernel lint             # 위키 계약 검증
```

## 흔한 실수
- **항상 `--dry-run` 먼저.** 변환 대상과 redaction 건수를 확인한 뒤 실제 실행.
- `--project-dir`(어떤 세션을 고를지=필터)와 `--vault-root`(어디에 쓸지=출력)는 다른 개념 — 혼동 금지.
- `raw/transcripts/` 안에는 `.md` 외 파일을 두지 말 것 — adapter가 `unsupported`로 격리한다. manifest는 `raw/` 밖 `.transcripts/`에 있다(스캔되지 않음).
- 민감한 세션을 위키에 넣을 때 `--no-redact`를 쓰지 말 것. redaction은 위키 유출 방어선이다(기본 ON 유지).
