# LLM Wiki 생성 에이전트 스펙

- **Date:** 2026-06-02
- **Status:** Draft
- **Scope:** Evidence-based Knowledge Harness / PM Memory Consolidation Harness

---

## 1. 목적

LLM Wiki 생성 에이전트의 목적은 대화/작업/결정/실험의 흔적을 읽고, **evidence가 붙은 wiki proposal**을 만드는 것이다.

이 에이전트는 문서를 직접 완성하지 않는다. 대신 아래만 수행한다.

- 원본 source 읽기
- 문서 후보 식별
- 노드/링크/요약 proposal 생성
- evidence 첨부
- 정책 위반 여부 표시
- Lead agent가 병합할 수 있도록 입력 정리

핵심 원칙:

> Worker agent는 지식을 쓰지 않는다. Worker agent는 evidence가 붙은 proposal만 만든다.

---

## 2. 역할 정의

### Agent 이름

- **LLM Wiki Generator Agent**

### 책임 범위

- raw source와 기존 문서를 읽는다.
- LLM Wiki에 추가/수정할 수 있는 후보를 추출한다.
- 각 주장에 evidence를 붙인다.
- Proposal만 출력한다.

### 비책임 범위

- canonical/shared 문서 직접 수정
- raw source 변경
- shared 자동 승격
- 삭제 판단
- human approval 없이 write 실행

---

## 3. 입력

### 필수 입력

- `project_id`
- `run_id`
- `source_paths[]`
- `source_type`
- `target_vault_scope` (`shared` / `project` / `canonical_candidate`)
- `policy_bundle`

### source 예시

- `raw/claude/*`
- `raw/codex/*`
- `raw/opencode/*`
- 기존 wiki 문서
- code diff / experiment log / paper note

### 입력 조건

- source는 읽기 전용이어야 한다.
- 비밀정보가 포함될 수 있으므로 redaction 전제를 가진다.
- source가 불완전하면 `partial`로 표시한다.

---

## 4. 출력

### 필수 산출물

1. `NodeProposal[]`
2. `DocumentIntentReport`
3. `TaskMappingReport` (필요 시)
4. `EvidenceReport`
5. `SafetyFlags`

### 출력 형태

- machine-readable YAML/JSON
- human-readable summary
- evidence reference 목록

### 금지 출력

- 직접 수정된 wiki 파일
- 승인되지 않은 write plan
- evidence 없는 claim

---

## 5. 핵심 동작

### 5.1 문서 의도 분류

입력 source가 다음 중 무엇인지 판별한다.

- concept
- decision
- task
- experiment
- summary
- conflict
- current-state update 후보

### 5.2 노드 추출

다음 요소를 추출한다.

- node id
- title
- type
- summary
- tags
- related links
- project relevance

### 5.3 evidence 연결

모든 claim은 최소 하나 이상의 source reference를 가져야 한다.

- source path
- source id
- quote 또는 요약
- confidence

### 5.4 정책 검사

다음을 탐지한다.

- secret / privacy 위험
- raw 직접 수정 시도
- canonical 직접 overwrite 시도
- shared 자동 승격 가능성
- duplicate node 가능성

---

## 6. 운영 규칙

### 반드시 지켜야 할 규칙

- raw source는 수정하지 않는다.
- 직접 문서를 쓰지 않는다.
- evidence 없는 주장은 proposal에만 둔다.
- shared 승격은 자동으로 하지 않는다.
- canonical 문서는 human review 전까지 유지한다.

### 권장 규칙

- claim마다 evidence 2개 이상이면 우선순위를 높인다.
- 불확실한 내용은 inference_note로 분리한다.
- 충돌 가능성이 있으면 conflict flag를 세운다.

---

## 7. 처리 흐름

1. source scan
2. document intent classification
3. node extraction
4. evidence binding
5. policy screening
6. proposal assembly
7. lead handoff

---

## 8. 성공 기준

에이전트가 성공한 상태는 다음과 같다.

- 모든 주요 claim에 evidence가 붙어 있다.
- proposal이 Lead agent 입력으로 바로 사용 가능하다.
- policy violation이 명시되어 있다.
- 문서 직접 수정 없이 결과가 생성된다.

---

## 9. 비목표

이 에이전트는 다음을 하지 않는다.

- 최종 위키를 단독 생성
- canonical 문서 자동 병합
- 삭제/deprecated 자동 처리
- human review 대체

---

## 10. Lead / Writer와의 경계

### Worker → Lead

- Worker는 proposal만 만든다.
- Lead는 proposal을 병합하고 write plan을 만든다.

### Lead → Writer

- Writer는 승인된 write plan만 실행한다.
- Writer는 판단하지 않는다.

### Writer → Validator

- Validator가 링크, YAML, graph integrity, secret scan을 확인한다.

---

## 11. 최소 스키마

```yaml
node_proposal:
  proposal_id: "NP-YYYYMMDD-001"
  proposal_type: create_or_update_node
  source_type: agent_session
  node:
    id: "..."
    type: ConceptNode
    scope: project_candidate
    title: "..."
    summary: "..."
  claims:
    - claim_id: "CL-001"
      text: "..."
      evidence_ids: ["EV-001"]
  evidence:
    - evidence_id: "EV-001"
      source_id: "..."
      source_path: "raw/..."
      quote_or_summary: "..."
      confidence: high
  review:
    requires_human_review: true
```

---

## 12. 요약

LLM Wiki 생성 에이전트는 **문서를 쓰는 에이전트가 아니라, evidence-backed proposal을 만드는 에이전트**다.

이 에이전트의 품질은 “얼마나 많이 썼는가”가 아니라,

- evidence가 충분한가
- 정책 위반을 잘 잡는가
- Lead가 바로 병합할 수 있는가
- human review 비용을 줄이는가

로 평가해야 한다.
