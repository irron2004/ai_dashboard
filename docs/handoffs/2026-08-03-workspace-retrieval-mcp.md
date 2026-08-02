# Workspace Retrieval MCP handoff — 2026-08-03

## Outcome

`@apc/retrieval-mcp` exposes the released retrieval application service to external coding agents
over MCP STDIO. Codex and Claude can share a derived workspace evidence index without opening the
desktop UI.

## Public primitives

- `list_evidence_projects`
- `refresh_evidence_index`
- `search_evidence`
- `get_evidence_source`

No answer-generation tool was added. The agent plans the query, searches a project scope, and
resolves a bounded source URI before synthesis.

## Real workspace verification

- indexed scopes: 12 (`workspace` plus 11 manifest projects)
- indexed documents: 6,348
- `career`: 4 public control documents; a whole-directory scan is not used
- first 1,311-document pass: 79.12 s
- deferred coin snapshot: 5,037 documents, 424.68 s
- full no-op refresh: 62.11 s, 6,348 unchanged, zero writes
- real MCP STDIO `blog` query: 7.3 ms retrieval time; correct RRF article and stable URI returned
- direct source resolution returned the selected chunk with bounded neighboring context
- Codex CLI: an ephemeral read-only session launched from `blog/` called list, search, and source in
  order and returned `CODEX_MCP_OK` with the verified URI
- Claude Code: user-scope MCP health was `Connected`, and session initialization exposed all four
  tools; the model turn itself was blocked by the account's `oauth_org_not_allowed` 403 before any
  tool call, so Claude model-driven invocation still requires subscription/API-key enablement

The first coin pass was skipped because `coin/NEXT.md` changed between read and verification. A
second pass succeeded and demonstrated the intended fail-closed, last-good-snapshot behavior.

## Verification

```bash
pnpm --filter @apc/retrieval-mcp test
pnpm typecheck
```

The package suite includes configuration/cache containment, safe source selection, PII exclusion,
incremental update/delete, stale manifest cleanup, snapshot preservation, in-memory MCP protocol,
and real child-process STDIO coverage.

## Remaining gate

Embedding and reranking remain behind `retrieval-embedding-gate`. Current search is lexical FTS; a
sanitized real-query corpus must demonstrate failures worth the cost and privacy expansion before
semantic retrieval is added.
