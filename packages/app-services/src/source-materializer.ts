import { readdirSync, readFileSync, writeFileSync, mkdirSync, rmSync, type Dirent } from 'node:fs'
import { join, relative, extname, dirname, sep } from 'node:path'

export type MaterializeManifest = { files: Array<{ rel: string; bytes: number }>; scanned: number; skipped: string[] }

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
 */
export function materializeProjectDocs(repoPaths: string[], vaultRoot: string): MaterializeManifest {
  const destRoot = join(vaultRoot, 'raw', 'project-docs')
  rmSync(destRoot, { recursive: true, force: true })
  const files: Array<{ rel: string; bytes: number }> = []
  const skipped: string[] = []
  let scanned = 0
  repoPaths.forEach((repoPath, i) => {
    for (const abs of walkDocs(repoPath, vaultRoot)) {
      scanned++
      const rel = relative(repoPath, abs).replace(/\\/g, '/')
      const dest = join(destRoot, String(i), rel)
      try {
        mkdirSync(dirname(dest), { recursive: true })
        const buf = readFileSync(abs)
        writeFileSync(dest, buf)
        files.push({ rel: `project-docs/${i}/${rel}`, bytes: buf.byteLength })
      } catch {
        skipped.push(abs)
      }
    }
  })
  return { files, scanned, skipped }
}
