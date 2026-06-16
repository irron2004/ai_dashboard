import { readdirSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'

/** Trees that are NOT part of the generated wiki and must never be graph/link/markdown validated:
 *  raw/ (immutable source docs — their sibling `[[links]]` and orphan status are irrelevant and would
 *  false-fail the graph integrity gate), a nested vault-staging/ (a prior run's staging leaked into the
 *  vault), and infra dirs. Matches the segment anywhere in the path (separator-normalized). */
const NON_WIKI_SEGMENT = /(^|\/)(raw|vault-staging|node_modules|\.git)(\/|$)/

/** List the GENERATED-wiki *.md files under a directory (absolute paths), excluding immutable source
 *  (raw/) and infra trees — see NON_WIKI_SEGMENT. Empty if the dir is absent. */
export function listMarkdown(dir: string): string[] {
  const out: string[] = []
  let entries: Array<{ name: string; parentPath?: string; path?: string; isFile(): boolean }>
  try {
    entries = readdirSync(dir, { withFileTypes: true, recursive: true }) as never
  } catch {
    return out  // dir does not exist
  }
  const root = resolve(dir)
  for (const ent of entries) {
    if (!ent.isFile() || !ent.name.endsWith('.md')) continue
    const abs = join(ent.parentPath ?? ent.path ?? dir, ent.name)
    if (NON_WIKI_SEGMENT.test(relative(root, abs).replace(/\\/g, '/'))) continue
    out.push(abs)
  }
  return out
}

/** List all files (any extension) under a directory (absolute paths). Empty if the dir is absent. */
export function listFiles(dir: string): string[] {
  const out: string[] = []
  let entries: Array<{ name: string; parentPath?: string; path?: string; isFile(): boolean }>
  try {
    entries = readdirSync(dir, { withFileTypes: true, recursive: true }) as never
  } catch {
    return out  // dir does not exist
  }
  for (const ent of entries) {
    if (ent.isFile()) out.push(join(ent.parentPath ?? ent.path ?? dir, ent.name))
  }
  return out
}

/** Normalize Windows back-slashes so path predicates are separator-independent (this app ships on Windows). */
const norm = (p: string): string => p.replace(/\\/g, '/')

/** Canonical docs that must never be auto-overwritten: current.md, PRD.md, ADR-*.md. */
export const CANONICAL_RE = /(^|\/)(current\.md|PRD\.md|ADR-[^/]*\.md)$/i

export function isCanonical(path: string): boolean {
  return CANONICAL_RE.test(norm(path))
}

/** Immutable raw sources — never written or overwritten. */
export function isRaw(path: string): boolean {
  const p = norm(path)
  return p.startsWith('raw/') || p.includes('/raw/')
}

/**
 * Resolve `rel` against `base` and assert the result stays inside `base`. The `sep` boundary is
 * essential: a plain prefix check lets a sibling dir sharing the prefix (e.g. `../base-evil/x`)
 * pass. The base dir itself is allowed. Throws on escape; returns the resolved absolute path.
 */
export function resolveInside(base: string, rel: string): string {
  const root = resolve(base)
  const abs = resolve(root, rel)
  if (abs !== root && !abs.startsWith(root + sep)) {
    throw new Error(`path escapes ${base}: ${rel}`)
  }
  return abs
}
