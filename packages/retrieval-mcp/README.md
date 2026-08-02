# Workspace Retrieval MCP

Headless MCP adapter over APC's existing project registry, knowledge index, retrieval service, and
bounded source resolver. It lets Codex and Claude search workspace evidence without launching the
Electron application.

## Commands

```bash
pnpm --filter @apc/retrieval-mcp index -- --workspace-root /path/to/ruahverce
pnpm --filter @apc/retrieval-mcp start -- --workspace-root /path/to/ruahverce
pnpm --filter @apc/retrieval-mcp test
```

For STDIO clients, prefer invoking `node_modules/.bin/tsx src/cli.ts serve` directly or use the
workspace root wrapper. A package-manager script banner on stdout would corrupt the MCP protocol.

## Tools

- `list_evidence_projects`
- `refresh_evidence_index`
- `search_evidence`
- `get_evidence_source`

The server deliberately does not expose `answer_question`. Search excerpts are untrusted evidence;
agents should resolve the stable `pmw://` URI before making consequential claims.

## Source boundary

The indexer reads only manifest-declared rule/wiki sources and a small standard control-file set.
It skips symlinks and enforces project containment, depth, file-count, file-size, and total-byte
limits. In particular, it does not recursively scan `career/`; only its public control files enter
the index.

The default SQLite DB is a derived per-workspace cache under the user's cache directory. Refresh is
incremental by size and mtime, applies each project snapshot atomically, preserves the last good
snapshot when a required source is temporarily missing, and removes projects that leave the
manifest.
