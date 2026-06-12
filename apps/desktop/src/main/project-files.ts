import { readdirSync, realpathSync, statSync, readFileSync } from 'node:fs'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'

const MAX_DOC_BYTES = 512 * 1024
const TEXT_EXT = /\.(md|mdx|txt)$/i
// Never expose build output or VCS internals to the renderer.
const SKIP_DIRS = new Set(['node_modules', '.git', 'out', 'dist', '.harness-runs'])
const LIST_LIMIT = 2_000
const DEPTH_LIMIT = 12

export type ReadDocResult = { ok: true; content: string } | { ok: false; reason: string }
export type ProjectDocEntry = { relPath: string; mtimeMs: number }

/** root의 realpath 내부로 확정된 절대 경로를 돌려주거나 null. 심링크 탈출도 realpath로 잡는다. */
function containedPath(root: string, relPath: string): string | null {
  let realRoot: string
  try { realRoot = realpathSync(root) } catch { return null }
  const candidate = isAbsolute(relPath) ? relPath : resolve(realRoot, relPath)
  let real: string
  try { real = realpathSync(candidate) } catch { return null }
  if (real !== realRoot && !real.startsWith(realRoot + sep)) return null
  return real
}

export function readProjectDoc(roots: readonly string[], relPath: string): ReadDocResult {
  if (!TEXT_EXT.test(relPath)) return { ok: false, reason: 'md/mdx/txt만 열 수 있습니다' }
  for (const root of roots) {
    const real = containedPath(root, relPath)
    if (!real) continue
    let st: import('node:fs').Stats
    try { st = statSync(real) } catch { continue }
    if (!st.isFile()) continue
    if (st.size > MAX_DOC_BYTES) return { ok: false, reason: `파일 크기 초과 (${Math.round(st.size / 1024)}KB > 512KB)` }
    try { return { ok: true, content: readFileSync(real, 'utf8') } } catch (e) { return { ok: false, reason: String(e) } }
  }
  return { ok: false, reason: '허용되지 않는 경로이거나 파일이 없습니다' }
}

export function listProjectDocs(roots: readonly string[]): ProjectDocEntry[] {
  const docs: ProjectDocEntry[] = []
  const visit = (dir: string, base: string, depth: number): void => {
    if (docs.length >= LIST_LIMIT || depth > DEPTH_LIMIT) return
    let entries: import('node:fs').Dirent[]
    try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name) && !entry.name.startsWith('.')) visit(full, base, depth + 1)
        continue
      }
      if (!entry.isFile() || !TEXT_EXT.test(entry.name)) continue
      let st: import('node:fs').Stats
      try { st = statSync(full) } catch { continue }
      docs.push({ relPath: relative(base, full).split(sep).join('/'), mtimeMs: st.mtimeMs })
      if (docs.length >= LIST_LIMIT) return
    }
  }
  for (const root of roots) visit(root, root, 0)
  return docs.sort((a, b) => a.relPath.localeCompare(b.relPath))
}
