import { closeSync, openSync, readSync, readdirSync, statSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'

type FileSignature = { size: number; mtimeMs: number }
type MetadataCacheEntry = FileSignature & { value: unknown }
const SOURCE_METADATA_CACHE_LIMIT = 4096
const sourceMetadataCache = new Map<string, MetadataCacheEntry>()

function asAbsolute(path: string): string {
  return isAbsolute(path) ? path : resolve(path)
}

function walkDir(root: string, accept: (path: string) => boolean, out: string[]): void {
  let entries: import('node:fs').Dirent[]
  try {
    entries = readdirSync(root, { withFileTypes: true })
  } catch {
    return
  }

  for (const entry of entries) {
    const abs = join(root, entry.name)
    if (entry.isDirectory()) {
      walkDir(abs, accept, out)
      continue
    }
    if (entry.isFile() && accept(abs)) out.push(abs)
  }
}

export function normalizeRoots(roots: string | readonly string[]): string[] {
  const list = Array.isArray(roots) ? roots : [roots]
  return [...new Set(list.map((root) => asAbsolute(root)).filter((root) => root.length > 0))]
}

export function walkFiles(roots: string | readonly string[], accept: (path: string) => boolean): string[] {
  const out: string[] = []
  for (const root of normalizeRoots(roots)) {
    let st: import('node:fs').Stats
    try {
      st = statSync(root)
    } catch {
      continue
    }
    if (st.isDirectory()) walkDir(root, accept, out)
    else if (st.isFile() && accept(root)) out.push(root)
  }
  return [...new Set(out)].sort()
}

/** Read only the beginning of a transcript so discovery can expose cwd/repoPath without loading the
 * whole conversation. Codex and Claude put their session metadata near the first JSONL line. */
export function readFilePrefix(path: string, maxBytes = 64 * 1024): string {
  let fd: number | undefined
  try {
    fd = openSync(path, 'r')
    const buffer = Buffer.allocUnsafe(maxBytes)
    const bytesRead = readSync(fd, buffer, 0, maxBytes, 0)
    return buffer.toString('utf8', 0, bytesRead)
  } catch {
    return ''
  } finally {
    if (fd !== undefined) {
      try { closeSync(fd) } catch { /* best-effort metadata read */ }
    }
  }
}

/** Cache small derived metadata, never transcript bodies, and invalidate it by the file signature. */
export function cachedSourceMetadata<T>(
  namespace: string,
  path: string,
  signature: FileSignature,
  load: () => T,
): T {
  const key = `${namespace}\u0000${path}`
  const cached = sourceMetadataCache.get(key)
  if (cached && cached.size === signature.size && cached.mtimeMs === signature.mtimeMs) {
    // Refresh insertion order so the bounded map behaves as an LRU.
    sourceMetadataCache.delete(key)
    sourceMetadataCache.set(key, cached)
    return cached.value as T
  }
  const value = load()
  sourceMetadataCache.delete(key)
  sourceMetadataCache.set(key, { ...signature, value })
  while (sourceMetadataCache.size > SOURCE_METADATA_CACHE_LIMIT) {
    const oldest = sourceMetadataCache.keys().next().value as string | undefined
    if (oldest === undefined) break
    sourceMetadataCache.delete(oldest)
  }
  return value
}

export function clearSourceMetadataCache(): void {
  sourceMetadataCache.clear()
}

export function folderPathFor(locator: string): string {
  return dirname(locator)
}
