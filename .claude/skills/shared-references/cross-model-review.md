# Reviewer Independence Principle

> Referenced by: `/paper-plan`, `/paper-draft` (and any future skill that uses a second-model reviewer).

---

## Core Rule

When using a Review LLM (any external model) as a reviewer or cross-verifier, **never share the primary model's own judgment, scores, or conclusions** with the reviewer before they form their independent assessment.

The reviewer must receive:
- The **artifact** being reviewed (paper outline, paper-section draft, results table)
- The **relevant context** (wiki pages, prior work, constraints)
- The **review criteria** (what to evaluate, at what difficulty level)

The reviewer must **NOT** receive:
- Claude's own score or rating of the artifact
- Claude's assessment of strengths/weaknesses
- Claude's recommendation (proceed/modify/abandon)
- Any framing that anchors the reviewer toward a particular conclusion

---

## Why This Matters

1. **Anchoring bias**: If the Review LLM sees "Claude rated this 7/10", its review will cluster around 7. Independent assessment catches blind spots that anchored assessment misses.
2. **Confirmation bias**: If Claude says "the main weakness is X", the Review LLM will focus on X and miss weakness Y. Unprimed reviewers explore the full space.
3. **Diversity of perspective**: The entire value of cross-model review is that different models have different biases. Sharing judgments before review collapses this diversity.

---

## How to Apply

### In `/paper-plan` (area-chair review of the outline)
- Send the outline + evidence map + figure/citation plan + review prompt to the Review LLM.
  Do NOT include any pre-assessment of how strong the outline is.

### In `/paper-draft` (per-section + full-paper review)
- Send the section (or full draft) + the pipelines/trials it is meant to support + the review
  prompt. Do NOT include Claude's own view of whether the section is convincing.

---

## Composing Independent Assessments

After both models have independently assessed:

1. **If scores agree** (within 1 point): Use the average. High confidence.
2. **If scores disagree** (2+ points apart): Flag the disagreement explicitly. Investigate which model missed what. Report both scores with reasoning.
3. **Conservative default**: When combining quality scores, take the **lower** score. Better to underestimate than to overcommit to a flawed draft.
4. **Never average away a critical finding**: If one model finds a fatal flaw (e.g., a claimed result has no succeeded trial behind it), that finding stands regardless of the other model's score.

---

## Review LLM Availability Check

Before calling `mcp__llm-review__chat`, the skill must check availability and handle it gracefully.

### Detection

A call to `mcp__llm-review__chat` will fail if:
- The MCP server is not configured (missing `.mcp.json` / `enableAllProjectMcpServers` not set)
- `LLM_API_KEY` or `LLM_BASE_URL` is not set in `.env`
- The API endpoint is unreachable

> Note: autosci-core does **not** ship a review MCP by default — its native quality gate is
> `kernel lint` + `module_bank validate-*`. Treat the Review LLM as an optional strengthener for
> writing-quality skills; the fallback below is the expected path unless the consuming project has
> configured one.

### Fallback Protocol

When the review MCP server is **unavailable**:

1. **Do NOT silently skip the review step.** Inform the user:
   > "Cross-model review is not configured. This skill works best with an independent review LLM. Proceed with Claude self-review?"
2. **If the user wants to configure it**, guide them: pick an OpenAI-compatible provider, set
   `LLM_API_KEY` / `LLM_BASE_URL` / `LLM_MODEL` in `.env`, restart Claude Code so the MCP server
   picks up the config.
3. **If the user wants to proceed without it**, continue in Claude-only mode:
   - Skip the `mcp__llm-review__chat` call
   - Perform the review/critique step using Claude itself (self-review)
   - Clearly mark the output as `[Claude self-review — no independent second opinion]`
   - The rest of the workflow proceeds normally

### When Review LLM IS Available

Proceed with the standard cross-model review protocol above. The `mcp__llm-review__chat` tool is provided by the `llm-review` MCP server (configured in `.mcp.json`), which works with any OpenAI-compatible API.
