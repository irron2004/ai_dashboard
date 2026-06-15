import { readdirSync, readFileSync, writeFileSync, mkdirSync, rmSync, type Dirent } from 'node:fs'
import { join, relative, extname, dirname, sep } from 'node:path'

export type MaterializeManifest = { files: Array<{ rel: string; bytes: number }>; scanned: number; skipped: string[] }

/** Fetch the docs a remote (ssh://) wiki run reasons over — repo docs AND the governance/memory the
 *  agent auto-loads — each with its ABSOLUTE remote path. Injected by the desktop layer (which owns
 *  the ssh binary); app-services stays transport-agnostic. */
export type RemoteDocFetcher = (sshRepoPath: string) => Promise<Array<{ absPath: string; content: string }>>

const DOC_EXT = new Set(['.md', '.markdown', '.txt'])
const EXCLUDE_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.worktrees'])

/** Recursively collect doc files under `root`, skipping excluded dirs and the vault itself. */
function walkDocs(root: string, vaultRoot: string): string[] {
  const out: string[] = []
  let entries: Dirent[]
  try { entries = readdirSync(root, { withFileTypes: true }) } catch { return out }
  for (const ent of entries) {
    const abs = join(root, ent.name)
    if (ent.isDirectory()) {
      if (EXCLUDE_DIRS.has(ent.name)) continue
      if (abs === vaultRoot || abs.startsWith(vaultRoot + sep)) continue  // never pull the vault back into raw/
      out.push(...walkDocs(abs, vaultRoot))
    } else if (ent.isFile() && DOC_EXT.has(extname(ent.name).toLowerCase())) {
      out.push(abs)
    }
  }
  return out
}

/** The remote filesystem path of an ssh:// repoPath (the URL pathname), or '' if unparseable. */
function sshRepoBase(sshRepoPath: string): string {
  try { return decodeURIComponent(new URL(sshRepoPath).pathname).replace(/\/+$/, '') } catch { return '' }
}

/**
 * Materialize the documents the wiki harness reasons over into `<vaultRoot>/raw/`, the trusted
 * immutable source area:
 *   - `raw/project-docs/<i>/<rel>` — docs INSIDE repoPaths[i].
 *   - `raw/context/<abs-without-leading-slash>` — files the agent auto-loads from OUTSIDE the repo
 *     (ancestor CLAUDE.md/AGENTS.md, Claude project memory). Preserving the absolute path lets the
 *     evidence normalizer map a cited absolute path to its raw/ copy by suffix.
 *
 * Idempotent: clears `raw/project-docs` and `raw/context` first so deleted sources disappear; other
 * `raw/` content (e.g. materialized conversations, manual sources) is untouched.
 *
 * Local repoPaths are walked on disk. An `ssh://` repoPath is fetched via the injected
 * `fetchRemoteDocs` (the desktop layer owns the ssh binary); without a fetcher it is recorded in
 * `skipped` rather than silently dropped — the gap that left `raw/` empty for SSH projects.
 */
export async function materializeProjectDocs(
  repoPaths: string[],
  vaultRoot: string,
  opts: { fetchRemoteDocs?: RemoteDocFetcher } = {},
): Promise<MaterializeManifest> {
  const rawRoot = join(vaultRoot, 'raw')
  rmSync(join(rawRoot, 'project-docs'), { recursive: true, force: true })
  rmSync(join(rawRoot, 'context'), { recursive: true, force: true })
  const files: Array<{ rel: string; bytes: number }> = []
  const skipped: string[] = []
  let scanned = 0

  const write = (rawRel: string, buf: Buffer): void => {
    const dest = join(rawRoot, rawRel)
    try {
      mkdirSync(dirname(dest), { recursive: true })
      writeFileSync(dest, buf)
      files.push({ rel: rawRel.replace(/\\/g, '/'), bytes: buf.byteLength })
    } catch {
      skipped.push(rawRel)
    }
  }

  for (let i = 0; i < repoPaths.length; i++) {
    const repoPath = repoPaths[i]
    if (repoPath.startsWith('ssh://')) {
      if (!opts.fetchRemoteDocs) { skipped.push(`${repoPath}: remote project, no ssh fetcher provided`); continue }
      let docs: Array<{ absPath: string; content: string }>
      try { docs = await opts.fetchRemoteDocs(repoPath) }
      catch (e) { skipped.push(`${repoPath}: remote fetch failed: ${String(e)}`); continue }
      const base = sshRepoBase(repoPath)
      for (const d of docs) {
        scanned++
        const abs = d.absPath.replace(/\\/g, '/')
        const buf = Buffer.from(d.content, 'utf8')
        if (base && (abs === base || abs.startsWith(`${base}/`))) {
          write(`project-docs/${i}/${abs.slice(base.length).replace(/^\/+/, '')}`, buf)
        } else {
          // outside the repo (ancestor CLAUDE.md, Claude memory) → preserve the absolute path
          write(`context/${abs.replace(/^\/+/, '')}`, buf)
        }
      }
    } else {
      for (const abs of walkDocs(repoPath, vaultRoot)) {
        scanned++
        const rel = relative(repoPath, abs).replace(/\\/g, '/')
        try { write(`project-docs/${i}/${rel}`, readFileSync(abs)) }
        catch { skipped.push(abs) }
      }
    }
  }
  return { files, scanned, skipped }
}
