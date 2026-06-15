import { readdirSync, readFileSync, writeFileSync, mkdirSync, rmSync, type Dirent } from 'node:fs'
import { join, relative, extname, dirname, sep } from 'node:path'

export type MaterializeManifest = { files: Array<{ rel: string; bytes: number }>; scanned: number; skipped: string[] }

/** Fetch project docs from a remote (ssh://) repoPath. Returns repo-relative paths + UTF-8 content.
 *  Injected by the desktop layer (which owns the ssh binary); app-services stays transport-agnostic. */
export type RemoteDocFetcher = (sshRepoPath: string) => Promise<Array<{ rel: string; content: string }>>

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

/**
 * Copy every project document (.md/.markdown/.txt) under each repoPath into
 * `<vaultRoot>/raw/project-docs/<i>/<relative>`, the trusted immutable source area the harness reads.
 * Idempotent: clears `raw/project-docs/` first so deleted docs disappear. Does NOT touch other `raw/` content.
 *
 * Local repoPaths are walked on disk. An `ssh://` repoPath is fetched via the injected
 * `fetchRemoteDocs` (the desktop layer owns the ssh binary); without a fetcher it is recorded in
 * `skipped` rather than silently dropped — this is exactly the gap that left `raw/` empty for SSH
 * projects, so the LLM had no local sources to cite and EvidenceVerifier blocked the run.
 */
export async function materializeProjectDocs(
  repoPaths: string[],
  vaultRoot: string,
  opts: { fetchRemoteDocs?: RemoteDocFetcher } = {},
): Promise<MaterializeManifest> {
  const destRoot = join(vaultRoot, 'raw', 'project-docs')
  rmSync(destRoot, { recursive: true, force: true })
  const files: Array<{ rel: string; bytes: number }> = []
  const skipped: string[] = []
  let scanned = 0

  const writeDoc = (i: number, rel: string, buf: Buffer): void => {
    const dest = join(destRoot, String(i), rel)
    try {
      mkdirSync(dirname(dest), { recursive: true })
      writeFileSync(dest, buf)
      files.push({ rel: `project-docs/${i}/${rel}`, bytes: buf.byteLength })
    } catch {
      skipped.push(rel)
    }
  }

  for (let i = 0; i < repoPaths.length; i++) {
    const repoPath = repoPaths[i]
    if (repoPath.startsWith('ssh://')) {
      if (!opts.fetchRemoteDocs) { skipped.push(`${repoPath}: remote project, no ssh fetcher provided`); continue }
      let docs: Array<{ rel: string; content: string }>
      try { docs = await opts.fetchRemoteDocs(repoPath) }
      catch (e) { skipped.push(`${repoPath}: remote fetch failed: ${String(e)}`); continue }
      for (const d of docs) {
        scanned++
        const rel = d.rel.replace(/\\/g, '/').replace(/^\.\//, '')
        writeDoc(i, rel, Buffer.from(d.content, 'utf8'))
      }
    } else {
      for (const abs of walkDocs(repoPath, vaultRoot)) {
        scanned++
        const rel = relative(repoPath, abs).replace(/\\/g, '/')
        try { writeDoc(i, rel, readFileSync(abs)) }
        catch { skipped.push(abs) }
      }
    }
  }
  return { files, scanned, skipped }
}
