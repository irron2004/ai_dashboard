---
title: autosci paper 도메인 실제 생성 (도메인 팩 오버레이) — 설계
slug: docs-superpowers-specs-2026-06-20-autosci-paper-domain-generation-design
sources: [docs/superpowers/specs/2026-06-20-autosci-paper-domain-generation-design.md]
status: accepted
date: 2026-06-20
topic: [paper-domain]
---

## Context

autosci-core 이음매( 1)는 완료됐다: WikiSubstrate 포트 + PythonKernelAdapter (kernel lint/ingest), wiki-domains/paper/ 계약, 골든 vault fixture, "kernel 게이트가 run을 실제로 FAILED시킨다"는 음성 테스트. 그러나 생성 단계는 골든 fixture(상수) 라, 실제 워크스페이스 문서로 LLM이 paper 위키를 만드는 경로는 미구현이다( 3). 사용자의 실제 요구: 이미 존재하는 papers 워크스페이스(원격 /home/hskim/work/papers , ML 연구 — 논문/모듈/파이프라인/실험 결과/가설)의 문서들을 autosci로 정리해 타입드 위키로 생성 하고 싶다. 현재 "위키 생성" 버튼은 범용 project-docs 파이프라인을 돌릴 뿐 paper 계약/생성을 쓰지 않는다. 1. 범위: papers 프로젝트 end-to-end — 원격 워크스페이스 문서 → autosci-read 인제스트 → paper 계약으로 LLM 타입드 노드 생성 → kernel lint 게이트 → 기존 검수/promote/UI 렌더까지 실제 동작. 2. 스키마: 기존 동결 paper 계약을 그대로 사용( papers / modules / pipelines / pi

## Decision

- **1. 배경 / 문제** — autosci-core 이음매( 1)는 완료됐다: WikiSubstrate 포트 + PythonKernelAdapter (kernel lint/ingest), wiki-domains/paper/ 계약, 골든 vault fixture, "kernel 게이트가 run을 실제로 FAILED시킨다"는 음성 테스트. 그러나 생성 단계는 골든 fixture(상수) 라, 실제 워크스페이스 문서로 LLM이 paper 위키를 만드는 경로는 미구현이다( 3). 사용자의 실제 요구: 이미 존재하는 papers 워크스페이스(원격 /home/hskim/work/papers , ML 연구 —
- **2. 확정된 결정 (브레인스토밍 산출)** — 1. 범위: papers 프로젝트 end-to-end — 원격 워크스페이스 문서 → autosci-read 인제스트 → paper 계약으로 LLM 타입드 노드 생성 → kernel lint 게이트 → 기존 검수/promote/UI 렌더까지 실제 동작. 2. 스키마: 기존 동결 paper 계약을 그대로 사용( papers / modules / pipelines / pipeline trials + uses module / pipeline from paper / alternative to ). 가설/실험 결과는 pipeline trials (status/metrics/su
- **3. 목표와 범위**
- **범위 안**
- **범위 밖 (명시적 연기)**
- **4. 아키텍처**
- **4.1 DomainPack (오버레이 경계)**
- **4.2 도메인 라우팅**

## Consequences

- Consequences and validation details remain traceable to the source document.

## Related

- Source: `docs/superpowers/specs/2026-06-20-autosci-paper-domain-generation-design.md`
