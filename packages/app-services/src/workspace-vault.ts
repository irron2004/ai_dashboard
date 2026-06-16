import { cpSync, existsSync, mkdirSync, readdirSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

/** Result of publishing the human-readable wiki into the workspace's `wiki/` area. */
export type WorkspaceExportResult =
  | { ok: true; target: string; files: number }
  | { ok: false; reason: string }

/**
 * The per-project home of a wiki, living IN the project's workspace (so it is portable across the
 * machines a user connects from, instead of being tied to one desktop's local app data):
 *   - `<workspace>/.apc-wiki/` — internal generation state (raw/, graph, proposals, runs, projects).
 *   - `<workspace>/wiki/`      — the published, human-readable wiki (written only on explicit export).
 *
 * `localRoot` is ALWAYS a local path the harness reads/writes during a run — EvidenceVerifier must
 * open cited files locally, so even an ssh-backed workspace runs against a local working copy.
 * `pull()` brings the canonical workspace state into `localRoot` before a run; `pushInternal()` writes
 * it back after; `exportWiki()` publishes the readable wiki. For a local project the workspace IS the
 * local fs, so pull/push are no-ops (see LocalWorkspaceVault); for ssh:// the desktop layer backs
 * these with ssh transfers (see SshWorkspaceVault).
 */
export interface WorkspaceVault {
  readonly localRoot: string
  pull(): Promise<void>
  pushInternal(): Promise<void>
  /** Push ONLY the `runs/` subtree (pipeline transcripts) to the workspace, additively — used so a
   *  FAILED run's transcript still travels for later study without re-pushing the (unchanged) wiki. */
  pushRuns(): Promise<void>
  exportWiki(): Promise<WorkspaceExportResult>
}

/** Top-level dirs under `.apc-wiki/` that are NOT part of the portable state: `raw/` is
 *  re-materialized from the workspace docs on every run, so it never needs to travel. */
export const INTERNAL_EXCLUDE_TOP = new Set(['raw'])

/** List files under `root` as relative POSIX paths. `skip(rel)` drops a single file (a returned
 *  directory is recursed; skipping is by path so a whole subtree can be excluded by its prefix). */
export function walkVaultFiles(root: string, skip: (rel: string) => boolean = () => false): string[] {
  const out: string[] = []
  const rec = (dir: string): void => {
    let entries: import('node:fs').Dirent[]
    try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      const abs = join(dir, e.name)
      const rel = relative(root, abs).split(sep).join('/')
      if (skip(rel)) continue
      if (e.isDirectory()) rec(abs)
      else if (e.isFile()) out.push(rel)
    }
  }
  rec(root)
  return out
}

/** The internal-state files to sync to/from the workspace: everything under `.apc-wiki/` EXCEPT the
 *  re-derivable `raw/` tree (re-materialized each run, so syncing it would waste a large transfer). */
export function internalStateFiles(localRoot: string): string[] {
  return walkVaultFiles(localRoot, (rel) => INTERNAL_EXCLUDE_TOP.has(rel.split('/')[0]))
}

/** Files under the `runs/` subtree (pipeline transcripts) — for an additive transcript-only push. */
export function runTranscriptFiles(localRoot: string): string[] {
  return walkVaultFiles(localRoot, (rel) => rel.split('/')[0] !== 'runs')
}

/** Is `rel` a publishable wiki file? Human-readable docs only — excludes draft proposals
 *  (`*.proposal.md`) and the `agent-runs/` run-summary history. */
export function isPublishable(rel: string): boolean {
  if (rel === 'agent-runs' || rel.startsWith('agent-runs/') || rel.includes('/agent-runs/')) return false
  if (rel.endsWith('.proposal.md')) return false
  return /\.(md|mdx|txt)$/i.test(rel)
}

/**
 * The readable wiki files to publish on export: every publishable doc under the vault EXCEPT the `raw/`
 * source tree. The harness writes promoted nodes at the vault root (e.g. `concepts/x.md`, `current.md`)
 * per its write plan — NOT under a `projects/<id>/` subdir — so we publish the whole vault minus raw/.
 */
export function publishableWikiFiles(localRoot: string): string[] {
  return walkVaultFiles(localRoot, (rel) => rel.split('/')[0] === 'raw').filter(isPublishable)
}

/**
 * Local (non-ssh) workspace vault: the canonical copy IS the local fs, so pull/push are no-ops.
 * `localRoot` is `<repo>/.apc-wiki`; export copies the publishable docs from
 * `<repo>/.apc-wiki/projects/<projectId>/` into `<repo>/wiki/`.
 */
export class LocalWorkspaceVault implements WorkspaceVault {
  readonly localRoot: string
  constructor(private readonly repoPath: string, private readonly projectId: string) {
    this.localRoot = join(repoPath, '.apc-wiki')
  }
  async pull(): Promise<void> { /* canonical store is the local fs */ }
  async pushInternal(): Promise<void> { /* canonical store is the local fs */ }
  async pushRuns(): Promise<void> { /* canonical store is the local fs */ }
  async exportWiki(): Promise<WorkspaceExportResult> {
    if (!existsSync(this.localRoot)) return { ok: false, reason: 'no generated wiki to export (run a generation first)' }
    const rels = publishableWikiFiles(this.localRoot)
    if (!rels.length) return { ok: false, reason: 'no publishable wiki files yet' }
    const dest = join(this.repoPath, 'wiki')
    for (const rel of rels) {
      const to = join(dest, rel)
      mkdirSync(join(to, '..'), { recursive: true })
      cpSync(join(this.localRoot, rel), to)
    }
    return { ok: true, target: dest, files: rels.length }
  }
}
