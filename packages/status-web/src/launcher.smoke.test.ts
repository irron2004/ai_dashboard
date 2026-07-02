/**
 * End-to-end smoke test for the status-web launcher.
 *
 * Regression guard for: vite-node non-`--script` mode never sets argv[1] to the
 * entry file, so the old `fileURLToPath(import.meta.url) === process.argv[1]` guard
 * in cli.ts was dead — `pnpm status-web` exited 0 silently without starting the server.
 *
 * This test spawns the REAL launcher (scripts/status-web.mjs → vite-node → run.ts)
 * with a nonexistent DB path and asserts:
 *   1. The process exits NON-ZERO  (proves main() actually ran)
 *   2. The describeMissingDb guidance appears on stderr/stdout  (proves the right code ran)
 *
 * Cold vite-node start on slow filesystems can take ~20 s; generous timeout applied.
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { describe, expect, test } from 'vitest'

const execFileAsync = promisify(execFile)

// packages/status-web/src  → ../../..  → repo root
const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '../../..')
const launcher = resolve(repoRoot, 'scripts/status-web.mjs')

const NONEXISTENT_DB = '/tmp/status-web-smoke-test-nonexistent.db'
const VITE_NODE_COLD_START_MS = 30_000

describe('launcher smoke (end-to-end)', () => {
  test(
    'exits non-zero with describeMissingDb guidance when DB does not exist',
    async () => {
      type ExecErr = Error & { code?: number; stdout?: string; stderr?: string }

      const result = await execFileAsync(
        process.execPath,
        [launcher, '--db', NONEXISTENT_DB],
        { cwd: repoRoot, timeout: VITE_NODE_COLD_START_MS },
      ).then(
        (ok) => ({ ok, err: null as ExecErr | null }),
        (err: ExecErr) => ({ ok: null, err }),
      )

      if (!result.err) {
        // Process exited 0 with no error — the auto-run guard is still dead.
        throw new Error(
          'Launcher exited 0 silently — main() did not run (FIX 1 not applied or guard still broken)',
        )
      }

      const combined = (result.err.stdout ?? '') + (result.err.stderr ?? '')

      expect(
        result.err.code,
        'launcher must exit non-zero when DB is missing',
      ).not.toBe(0)

      expect(combined, 'must contain --db guidance from describeMissingDb').toMatch(/--db/)
      expect(combined, 'must name the missing DB path').toContain(NONEXISTENT_DB)
    },
    VITE_NODE_COLD_START_MS + 5_000,
  )
})
