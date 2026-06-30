# S1: langgraph-agent 공유 하네스 submodule 정식화 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 느슨한 nested clone으로 흩어진 공유 하네스 `irron2004/langgraph-agent`를 정식 git submodule로 규격화하고, calculate_math를 레퍼런스로 전환해 동작 패리티를 증명한다.

**Architecture:** 엔진(orchestrator)은 `langgraph-agent`에 단일 진실원으로 두고 각 프로젝트가 `agents/` 경로에 핀된 submodule로 소비한다. 프로젝트 전용 graph profile은 엔진 밖 `<project>/.harness/graph_profiles.json` 오버레이로 분리하며, 엔진은 이 오버레이를 기본 프로필 위에 per-key 병합한다. 콘솔(ai_dashboard) 구동은 기존 `agents_up_cli.sh` CLI seam을 통해 후속 spec(S3)에서 붙인다.

**Tech Stack:** Python 3 (엔진, pytest) · Bash (`agents_up*.sh`) · git submodule.

## Global Constraints

- **엔진 코드 들여쓰기 = 2-space** (`orchestrate_tmux.py` 전체가 2-space; PEP8 4-space 아님). 새 코드도 2-space로 맞춘다.
- **`.env`는 절대 커밋 금지.** 엔진엔 `.env.example`만 존재. 프로젝트-로컬 `.env`는 submodule working dir에서 gitignore.
- **엔진 변경은 가산·최소.** 기존 `load_graph_profiles` 동작은 보존하고 오버레이만 추가(기존 `agents/tests/` green 유지).
- **엔진 레포 URL:** `https://github.com/irron2004/langgraph-agent.git`. 작업은 calc의 기존 clone(`calculate_math/agents`, `main@f46638d`, origin과 0/0)에서 진행.
- **pytest는 `agents/` 디렉토리에서 실행** (테스트가 `orchestrate_tmux`를 top-level 모듈로 import).
- 레퍼런스 프로젝트 = `calculate_math`. calc 전용 프로필 = `curriculum_viewer_v1`, `curriculum_research_3r` (나머지 9개는 범용 엔진 기본).
- 경로 기준: 워크스페이스 루트 = `/mnt/c/Users/irron/Desktop/my/ruahverce`. calc = `<ws>/calculate_math`.

---

## Phase A — 엔진(langgraph-agent) 변경
> calc의 기존 clone `calculate_math/agents`에서 작업한다. 시작 전 작업 브랜치를 만든다:
> ```bash
> cd /mnt/c/Users/irron/Desktop/my/ruahverce/calculate_math/agents
> git checkout -b feat/harness-overlay-and-task-tier
> ```

### Task 1: calc 로컬 드리프트(task_tier 기능) upstream + `.env` 위생

calc가 로컬에서만 들고 있던 4개 변경을 분류·정식화한다: `task_spec.py`·`agents_up.sh`·`README.md` = `task_tier`(lightweight/complex) 기능(엔진 개선 → 커밋), `.env` = 프로젝트-로컬(추적 해제).

**Files:**
- Modify: `calculate_math/agents/.gitignore` (add `.env`)
- Untrack: `calculate_math/agents/.env` (`git rm --cached`, working copy 유지)
- Commit-as-is: `calculate_math/agents/task_spec.py`, `agents_up.sh`, `README.md` (이미 로컬에 작성된 task_tier diff)

**Interfaces:**
- Produces: 엔진 `main` 계보에 `task_tier` 필드(`TaskSpec.task_tier: str | None`)와 `TASK_TIER` env 처리. 이후 태스크는 이 파일들을 더 안 건드린다.

- [ ] **Step 1: 드리프트 4건 내용 확인**

Run:
```bash
cd /mnt/c/Users/irron/Desktop/my/ruahverce/calculate_math/agents
git diff --stat
git diff -- task_spec.py agents_up.sh
```
Expected: `task_spec.py`(+`task_tier` 필드), `agents_up.sh`(+`TASK_TIER`/`normalize_task_tier`), `README.md`, `.env` 4개만 수정됨.

- [ ] **Step 2: `.env` 추적 해제 + gitignore**

Run:
```bash
grep -qxF '.env' .gitignore || printf '\n.env\n' >> .gitignore
git rm --cached .env
```
Expected: `.env`가 staged-deletion, working copy는 그대로 남음(`ls -la .env` 성공).

- [ ] **Step 3: 엔진 테스트 green 확인(회귀 없음)**

Run: `python -m pytest tests/ -q`
Expected: PASS (기존 스위트 전부 통과; `.env`/task_tier 변경이 깨지 않음).

- [ ] **Step 4: 커밋**

```bash
git add .gitignore .env task_spec.py agents_up.sh README.md
git commit -m "feat: task_tier orchestration tier + stop tracking .env"
```

---

### Task 2: `.harness/graph_profiles.json` 오버레이 메커니즘 (TDD)

엔진이 기본(non-explicit) 경로일 때 `$ROOT/.harness/graph_profiles.json`을 엔진 기본 프로필 위에 per-key 병합하도록 한다. 명시적 `--graph-profiles-path`는 종전대로 그 파일만 사용.

**Files:**
- Create: `calculate_math/agents/tests/test_load_graph_profiles_overlay.py`
- Modify: `calculate_math/agents/orchestrate_tmux.py` (상수 추가 ~line 139, `load_graph_profiles` 615–657 리팩터)

**Interfaces:**
- Consumes: 기존 `add_graph_profile_aliases`, `normalize_templates`, `ensure_str_list`, `DEFAULT_GRAPH_PROFILES`, `DEFAULT_GRAPH_PROFILES_PATH`.
- Produces: `load_graph_profiles(root: Path, raw_path: str | None) -> dict[str, dict[str, Any]]` (시그니처 불변) + 신규 헬퍼 `_parse_graph_profiles_file(candidate: Path) -> dict[str, dict[str, Any]]`, 신규 상수 `PROJECT_PROFILE_OVERLAY_PATH = Path(".harness/graph_profiles.json")`.

- [ ] **Step 1: 실패하는 테스트 작성**

Create `calculate_math/agents/tests/test_load_graph_profiles_overlay.py`:
```python
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from orchestrate_tmux import load_graph_profiles  # noqa: E402


def _write(path: Path, profiles: dict) -> None:
  path.parent.mkdir(parents=True, exist_ok=True)
  path.write_text(json.dumps(profiles), encoding="utf-8")


def test_overlay_profile_is_loaded_and_wins(tmp_path: Path):
  _write(tmp_path / "agents" / "config" / "graph_profiles.json", {
    "universal": {"stages": ["plan"], "ticket_roles": ["PM"]},
  })
  _write(tmp_path / ".harness" / "graph_profiles.json", {
    "curriculum_viewer_v1": {"stages": ["design"], "ticket_roles": ["RESEARCH"]},
    "universal": {"stages": ["plan", "build"], "ticket_roles": ["PM", "BE"]},
  })

  profiles = load_graph_profiles(tmp_path, None)

  assert "curriculum_viewer_v1" in profiles
  assert profiles["universal"]["stages"] == ["plan", "build"]


def test_no_overlay_falls_back_to_engine_default(tmp_path: Path):
  _write(tmp_path / "agents" / "config" / "graph_profiles.json", {
    "universal": {"stages": ["plan"], "ticket_roles": ["PM"]},
  })
  profiles = load_graph_profiles(tmp_path, None)
  assert "curriculum_viewer_v1" not in profiles
  assert profiles["universal"]["stages"] == ["plan"]


def test_explicit_path_ignores_overlay(tmp_path: Path):
  _write(tmp_path / ".harness" / "graph_profiles.json", {
    "curriculum_viewer_v1": {"stages": ["design"], "ticket_roles": ["RESEARCH"]},
  })
  explicit = tmp_path / "custom.json"
  _write(explicit, {"universal": {"stages": ["plan"], "ticket_roles": ["PM"]}})
  profiles = load_graph_profiles(tmp_path, str(explicit))
  assert "curriculum_viewer_v1" not in profiles
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd /mnt/c/Users/irron/Desktop/my/ruahverce/calculate_math/agents && python -m pytest tests/test_load_graph_profiles_overlay.py -v`
Expected: `test_overlay_profile_is_loaded_and_wins` FAIL (오버레이 미적용 → `curriculum_viewer_v1` 없음). 나머지 둘은 PASS일 수 있음.

- [ ] **Step 3: 상수 추가**

`orchestrate_tmux.py`의 `DEFAULT_GRAPH_PROFILES_PATH = Path("agents/config/graph_profiles.json")`(line 139) 바로 아래에 추가:
```python
PROJECT_PROFILE_OVERLAY_PATH = Path(".harness/graph_profiles.json")
```

- [ ] **Step 4: 파싱 헬퍼 추출 + 오버레이 병합 구현**

`orchestrate_tmux.py`의 `load_graph_profiles`(615–657)를 아래로 교체(2-space 들여쓰기 유지):
```python
def _parse_graph_profiles_file(candidate: Path) -> dict[str, dict[str, Any]]:
  try:
    payload = json.loads(candidate.read_text(encoding="utf-8"))
  except json.JSONDecodeError as exc:
    raise ValueError(f"Invalid graph profiles JSON: {candidate}") from exc

  if not isinstance(payload, dict):
    raise ValueError(f"Graph profiles must be a JSON object: {candidate}")

  profiles: dict[str, dict[str, Any]] = {}
  for name, raw in payload.items():
    if not isinstance(raw, dict):
      raise ValueError(f"Graph profile '{name}' must be an object")
    stages_raw = raw.get("stages", [])
    roles_raw = raw.get("ticket_roles", [])
    if not isinstance(stages_raw, list) or not isinstance(roles_raw, list):
      raise ValueError(f"Graph profile '{name}' must define stages/ticket_roles lists")
    stages = [str(s).strip().lower() for s in stages_raw if str(s).strip()]
    roles = [str(r).strip().upper() for r in roles_raw if str(r).strip()]
    templates = normalize_templates(raw.get("templates"))
    flow = ensure_str_list(raw.get("flow") or raw.get("ticket_flow"))
    transitions = raw.get("transitions") if isinstance(raw.get("transitions"), dict) else {}
    profiles[str(name).strip().lower()] = {
      "stages": stages,
      "ticket_roles": roles,
      "templates": templates,
      "flow": flow,
      "transitions": transitions,
    }
  return profiles


def load_graph_profiles(root: Path, raw_path: str | None) -> dict[str, dict[str, Any]]:
  candidate = Path(raw_path) if raw_path else DEFAULT_GRAPH_PROFILES_PATH
  if not candidate.is_absolute():
    candidate = root / candidate
  if not candidate.exists():
    if raw_path is None:
      fallback = root / "config" / "graph_profiles.json"
      if fallback.exists():
        base = _parse_graph_profiles_file(fallback)
      else:
        base = DEFAULT_GRAPH_PROFILES.copy()
    else:
      return add_graph_profile_aliases(DEFAULT_GRAPH_PROFILES.copy())
  else:
    base = _parse_graph_profiles_file(candidate)

  # Project overlay: $ROOT/.harness/graph_profiles.json wins per-key over engine
  # defaults. Only applied on the default (non-explicit) path — an explicit
  # --graph-profiles-path is honored verbatim above.
  if raw_path is None:
    overlay_path = root / PROJECT_PROFILE_OVERLAY_PATH
    if overlay_path.exists():
      base.update(_parse_graph_profiles_file(overlay_path))

  return add_graph_profile_aliases(base)
```

- [ ] **Step 5: 전체 엔진 테스트 통과 확인**

Run: `python -m pytest tests/ -q`
Expected: PASS (신규 3개 + 기존 스위트 전부).

- [ ] **Step 6: 커밋**

```bash
git add orchestrate_tmux.py tests/test_load_graph_profiles_overlay.py
git commit -m "feat: project .harness/graph_profiles.json overlay in load_graph_profiles"
```

---

### Task 3: 엔진 config에서 프로젝트 전용 프로필 제거

`agents/config/graph_profiles.json`에 섞인 calc 전용 프로필(`curriculum_viewer_v1`, `curriculum_research_3r`)을 엔진에서 분리한다. 제거분 JSON은 Phase B(Task 4)에서 `calc/.harness/`로 재배치하므로 **임시 백업 파일**로 보존한다.

**Files:**
- Modify: `calculate_math/agents/config/graph_profiles.json` (curriculum_* 두 키 제거)
- Create: `calculate_math/agents/CLI_CONTRACT.md` (S3 콘솔이 의존할 CLI seam 계약 — 스펙 §5)
- Create(임시, 커밋 안 함): `/tmp/calc-harness-profiles.json` (제거한 두 프로필 보존)

**Interfaces:**
- Produces: 엔진 config = 범용 프로필 9종만. 분리된 calc 프로필 2종은 `/tmp/calc-harness-profiles.json`에 보존(Task 4가 소비). 엔진에 `CLI_CONTRACT.md`가 동봉되어 submodule과 함께 이동(S3가 소비).

- [ ] **Step 1: calc 전용 프로필을 백업으로 추출**

Run:
```bash
cd /mnt/c/Users/irron/Desktop/my/ruahverce/calculate_math/agents
python3 -c "
import json
p='config/graph_profiles.json'; d=json.load(open(p))
keys=['curriculum_viewer_v1','curriculum_research_3r']
json.dump({k:d[k] for k in keys if k in d}, open('/tmp/calc-harness-profiles.json','w'), ensure_ascii=False, indent=2)
for k in keys: d.pop(k, None)
json.dump(d, open(p,'w'), ensure_ascii=False, indent=2)
print('engine keys now:', list(d.keys()))
print('backed up:', list(json.load(open('/tmp/calc-harness-profiles.json')).keys()))
"
```
Expected: `engine keys now:` 목록에 curriculum_* 없음. `backed up:` = `['curriculum_viewer_v1', 'curriculum_research_3r']`.

- [ ] **Step 2: 엔진 테스트 green 확인**

Run: `python -m pytest tests/ -q`
Expected: PASS (범용 프로필만으로도 스위트 통과).

- [ ] **Step 3: 커밋**

```bash
git add config/graph_profiles.json
git commit -m "refactor: drop project-specific curriculum profiles from engine config (moved to project .harness)"
```

- [ ] **Step 4: CLI 계약 문서 작성 + 커밋 (스펙 §5)**

Create `calculate_math/agents/CLI_CONTRACT.md`:
```markdown
# 하네스 CLI 계약 (agents_up_cli.sh)

콘솔(ai_dashboard, S3)이 이 하네스를 구동할 때 의존하는 안정 계약. 변경 시 SemVer 주의.

## 진입점
`agents_up_cli.sh <task_id> [--workflow <wf>] [--graph-profile <profile>]`
(프로젝트 루트의 thin `agents_up.sh`가 이를 호출)

## 입력
- env `ROOT` — 프로젝트 루트 절대경로(미설정 시 스크립트가 자동 해석).
- `<project>/.env` — 안전 로더(KEY=VALUE만, 코드 실행 없음). 우선순위: 환경변수 > .env > 기본값.
- task 콘텐츠 — `$ROOT/tasks/<task_id>/…` 또는 `$ROOT/tasks/<task_id>.md`.
- `--graph-profile <profile>` — 미지정 시 `$ROOT/.harness/graph_profiles.json` 오버레이 → 엔진 기본 순으로 해석.

## 출력
- 패널 로그(tmux capture) — 실행 중 stdout/stderr.
- state 파일 — 런 진행 상태.
- handoff inbox — `$ROOT/.agents/inbox/…` (역할 간 메시지).

## 종료코드
- `0` = 성공. 비-`0` = 실패(사유는 stderr).

## S3 소비 방식(참고)
콘솔은 이 CLI를 shell-out하여 stdout/stderr를 스트리밍하고, `pm` AgentRunStore에
run 레코드(시작/종료/transcript 경로)를 기록한다. 본 계약 외 내부 구현에 의존하지 않는다.
```

Run:
```bash
git add CLI_CONTRACT.md
git commit -m "docs: harness CLI contract for console (S3) integration seam"
```

- [ ] **Step 5: 브랜치 push + main 병합(핀 확정)**

```bash
git push -u origin feat/harness-overlay-and-task-tier
git checkout main
git merge --ff-only feat/harness-overlay-and-task-tier
git push origin main
git rev-parse HEAD   # ← 이 SHA = <ENGINE_PIN> (Task 5에서 사용)
```
Expected: fast-forward 병합 성공, `git rev-parse HEAD`가 새 main SHA 출력. 이 값을 `<ENGINE_PIN>`으로 기록.

---

## Phase B — 레퍼런스 프로젝트(calculate_math) 전환

### Task 4: calc `.harness/graph_profiles.json` 생성 + 오버레이 스모크

**Files:**
- Create: `calculate_math/.harness/graph_profiles.json` (Task 3에서 백업한 calc 전용 프로필)

**Interfaces:**
- Consumes: `/tmp/calc-harness-profiles.json` (Task 3 산출), 엔진의 오버레이 동작(Task 2).
- Produces: calc 루트 오버레이 파일. `load_graph_profiles(calc_root, None)`이 `curriculum_viewer_v1`을 포함.

- [ ] **Step 1: 오버레이 파일 배치**

Run:
```bash
cd /mnt/c/Users/irron/Desktop/my/ruahverce/calculate_math
mkdir -p .harness
cp /tmp/calc-harness-profiles.json .harness/graph_profiles.json
cat .harness/graph_profiles.json | python3 -c "import json,sys; print(list(json.load(sys.stdin).keys()))"
```
Expected: `['curriculum_viewer_v1', 'curriculum_research_3r']`.

- [ ] **Step 2: 오버레이 스모크 테스트(현재 clone으로)**

Run:
```bash
cd /mnt/c/Users/irron/Desktop/my/ruahverce/calculate_math
python3 -c "
import sys; sys.path.insert(0,'agents')
from pathlib import Path
from orchestrate_tmux import load_graph_profiles
p = load_graph_profiles(Path('.'), None)
assert 'curriculum_viewer_v1' in p, sorted(p)
assert 'universal' in p, sorted(p)
print('overlay OK:', 'curriculum_viewer_v1' in p)
"
```
Expected: `overlay OK: True` (오버레이의 curriculum_* + 엔진 범용 universal 둘 다 존재).

> 커밋은 Task 5에서 submodule 핀과 함께 부모에 한 번에 기록한다.

---

### Task 5: 느슨한 clone → 핀된 submodule 전환

**Files:**
- Delete(작업트리): `calculate_math/agents` (nested clone)
- Create: `calculate_math/.gitmodules` (submodule 등록)
- Modify(부모 index): `calculate_math/agents` (submodule 핀), `.harness/`

**Interfaces:**
- Consumes: `<ENGINE_PIN>` (Task 3 Step 5).
- Produces: calc 부모 repo가 `.gitmodules` + `agents` 핀(`<ENGINE_PIN>`) + `.harness/` 기록. `?? agents/` 해소.

- [ ] **Step 1: 프로젝트-로컬 `.env` 백업**

Run:
```bash
cd /mnt/c/Users/irron/Desktop/my/ruahverce/calculate_math
cp agents/.env /tmp/calc-agents-env.bak 2>/dev/null && echo "env backed up" || echo "no .env (ok)"
```
Expected: `env backed up` (또는 `.env` 없으면 ok).

- [ ] **Step 2: nested clone 제거 후 핀된 submodule 추가**

Run:
```bash
cd /mnt/c/Users/irron/Desktop/my/ruahverce/calculate_math
rm -rf agents
git submodule add https://github.com/irron2004/langgraph-agent.git agents
git -C agents checkout <ENGINE_PIN>
```
Expected: `.gitmodules` 생성, `agents`가 `<ENGINE_PIN>`에서 detached HEAD.

- [ ] **Step 3: 프로젝트-로컬 `.env` 복원**

Run:
```bash
cp /tmp/calc-agents-env.bak agents/.env 2>/dev/null && echo "env restored" || echo "no .env to restore (ok)"
git -C agents status --short   # .env는 submodule .gitignore로 무시되어야 함
```
Expected: `git -C agents status --short`에 `.env` 안 나옴(gitignore 적용).

- [ ] **Step 4: 부모 repo에 submodule 핀 + .harness 커밋**

```bash
cd /mnt/c/Users/irron/Desktop/my/ruahverce/calculate_math
git add .gitmodules agents .harness
git commit -m "chore: convert agents/ to pinned langgraph-agent submodule + project .harness overlay"
```

- [ ] **Step 5: 핀 기록 확인**

Run: `git submodule status`
Expected: `agents`가 `<ENGINE_PIN>`로 핀되어 한 줄 출력(앞에 공백 또는 `+`).

---

### Task 6: 수용 검증 (golden-run 패리티)

**Files:** (없음 — 검증 전용)

**Interfaces:**
- Consumes: Task 1–5 산출 전체.

- [ ] **Step 1: 엔진 테스트 스위트 green (submodule 경유)**

Run: `cd /mnt/c/Users/irron/Desktop/my/ruahverce/calculate_math/agents && python -m pytest tests/ -q`
Expected: PASS (submodule 경유로도 동일 스위트 통과).

- [ ] **Step 2: 오버레이 해석 스모크(전환 후)**

Run:
```bash
cd /mnt/c/Users/irron/Desktop/my/ruahverce/calculate_math
python3 -c "
import sys; sys.path.insert(0,'agents')
from pathlib import Path
from orchestrate_tmux import load_graph_profiles
p = load_graph_profiles(Path('.'), None)
assert 'curriculum_viewer_v1' in p, sorted(p)   # .harness 오버레이
assert 'universal' in p, sorted(p)              # 엔진 기본
print('ACCEPT: overlay+engine profiles resolved via submodule')
"
```
Expected: `ACCEPT: overlay+engine profiles resolved via submodule`.

- [ ] **Step 3: 부모 핀 기록 + `?? agents/` 해소 확인**

Run:
```bash
cd /mnt/c/Users/irron/Desktop/my/ruahverce/calculate_math
git submodule status
git status --short | grep -E 'agents' || echo "no stray agents/ untracked (good)"
```
Expected: submodule status에 `agents` 핀 표시, `?? agents/` 없음.

- [ ] **Step 4: (수동) 실제 tmux 멀티에이전트 golden-run**

> 자동화 불가(LLM + tmux + WSL 필요). 사용자가 직접 실행해 동작 패리티를 확인:
```bash
cd /mnt/c/Users/irron/Desktop/my/ruahverce/calculate_math
./agents_up.sh <existing_task_id>   # 예: tasks/ 하위 기존 task
```
Expected: 전환 전과 동일하게 오케스트레이터가 기동·진행. 확인 포인트: graph profile 해석(`curriculum_viewer_v1` 등), 패널 기동, handoff inbox 생성.

---

## Self-Review (작성자 체크)

- **Spec coverage:** ① canonical 정식화=Task 3 Step 5(병합/핀) · ② core/project 경계=Task 2(오버레이)+Task 3(엔진 분리)+Task 4(.harness) · ③ clone→submodule=Task 5 · ④ 드리프트 화해=Task 1 · ⑤ CLI 계약=Task 3 Step 4(`CLI_CONTRACT.md` 산출, 스펙 §5)+seam 무결성 Task 6 Step 4 · ⑥ golden-run/수용=Task 6. **S2/S3/english_egg/blog는 의도적 범위 외**(스펙 §2와 일치).
- **Placeholder scan:** `<ENGINE_PIN>`은 Task 3 Step 4에서 `git rev-parse HEAD`로 산출되는 실값(런타임 캡처). 그 외 TBD/TODO 없음.
- **Type consistency:** `load_graph_profiles(root, raw_path)` 시그니처 불변, 신규 `_parse_graph_profiles_file(candidate)`·상수 `PROJECT_PROFILE_OVERLAY_PATH`는 Task 2에서 정의되어 동일 이름으로만 참조됨. 테스트가 쓰는 `curriculum_viewer_v1`은 Task 3/4의 실제 분리 대상과 일치.
