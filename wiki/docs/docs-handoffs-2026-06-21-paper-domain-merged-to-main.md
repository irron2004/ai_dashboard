---
title: Handoff — autosci paper 도메인 main 머지 완료 + 남은 단계
slug: docs-handoffs-2026-06-21-paper-domain-merged-to-main
sources: [docs/handoffs/2026-06-21-paper-domain-merged-to-main.md]
topic: [paper-domain]
---

## Summary

상태: main @ b1faa1d (origin 동기) — autosci paper 도메인(Plan 1~5) + SSH 수정이 main에 머지·푸시됨 . 선행 핸드오프: 2026-06-20-paper-domain-plans-1-2-3-and-session-state.md (상세 아키텍처·함정), 설계: docs/superpowers/specs/2026-06-20-autosci-paper-domain-generation-design.md , 계획: docs/superpowers/plans/2026-06-20-paper-domain-plan{1,2,3,3b,4}- .md + 2026-06-21-paper-domain-plan5- .md . autosci 기반 paper 위키 생성 파이프라인이 main에 들어갔고, domain=paper opt-in으로 게이트됨. 추출→렌더→kernel-lint→PDF인제스트→타입드 엣지까지 구현·단위/ WSL 검증 완료. 유일하게 안 된 것 = 실제 LLM end-to-end 실행(경험적 증명). 게이트: 전부 domain=paper 일 때만. 기존 project-docs 프로젝트는 byte-identical로 무영향. papers 프로젝트로 진짜 한 번 돌려서 증명한다. WSL/Linux 환경 필요 (venv가 L

## Content map

- **1. 지금 상태 (한 줄)**
- **2. main에 올라간 것 (b1faa1d 머지)**
- **3. ✅ 검증된 것 / ⬜ 안 된 것**
- **4. 남은 단계 = Plan 5 Task 5 (실제 LLM end-to-end)** — papers 프로젝트로 진짜 한 번 돌려서 증명한다. WSL/Linux 환경 필요 (venv가 Linux) 1. 앱에서 papers 프로젝트 domain=paper 설정(프로젝트 편집 다이얼로그). 2. "생성" 실행. 흐름: materialize(원격 문서→raw/) → SOURCES EXTRACTED (autosci-read로 PDF→raw/ parsed) → NODE PROPOSALS CREATED (LLM 추출, SourceReader 가 raw/ 텍스트 주입) → STAGING WRITTEN (renderNode + edges.jsonl) → VALIDATE
- **5. Plan 5 후속(non-blocking)**
- **6. 운영 메모**

## Related

- Source: `docs/handoffs/2026-06-21-paper-domain-merged-to-main.md`
