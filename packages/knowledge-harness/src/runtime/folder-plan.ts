import type { SourceDoc } from './source-reader.js'
import { isCanonical } from './vault-fs.js'

export type FolderClassificationHint = { path: string; description?: string }
export type ProjectStructureHint = {
  projectCharacter?: string
  folderClassifications?: FolderClassificationHint[]
}
export type ResolvedFolderClassification = {
  path: string
  description: string
  source: 'user' | 'agent'
}

/**
 * A work unit = the set of sources one folder-worker processes (spec §6). Auto size-based partitioning:
 * a unit is one folder, a split-piece of an oversized folder (`splitOf`), or a greedy merge of small
 * folders — always sized to fit the prompt budget so a worker never overflows the model window.
 */
export type WorkUnit = {
  id: string
  label: string
  memberPaths: string[]        // repo-relative folder paths this unit covers (e.g. ['paper-A'])
  role: 'canonical' | 'reference' | 'scratch' | 'mixed'
  docSourceIds: string[]       // SourceDoc ids in this unit
  sessionIds: string[]         // conversation sessions matched to this unit (filled in a later phase)
  estChars: number             // serialized-size estimate used for bin-packing
  splitOf?: string             // parent folder path when this unit is a split-piece of an oversized folder
  /** One classification per member folder. Blank user descriptions deliberately route to the agent. */
  folderClassifications?: ResolvedFolderClassification[]
}

export type FolderPlan = {
  units: WorkUnit[]
  /** Sources not placed in any folder unit (conversations, out-of-repo context) — handled separately. */
  unplacedSourceIds: string[]
  /** The human hint used for this exact run, persisted with the plan so the UI can explain provenance. */
  projectContext?: ProjectStructureHint
}

/** Serialized-size estimate of a source, consistent with budgetSourcesForPrompt (which the worker uses). */
const sizeOf = (s: SourceDoc): number => JSON.stringify(s).length + 1

/**
 * The folder a project-doc source belongs to, or null if it is not a project doc (conversations,
 * context). `raw/project-docs/<i>/<rel>` → `<i>/<dirname(rel)>` (repo index keeps multi-repo folders
 * distinct; a repo-root file maps to `<i>/`).
 */
export function docFolder(sourcePath: string): string | null {
  const m = /^raw\/project-docs\/(\d+)\/(.+)$/.exec(sourcePath.replace(/\\/g, '/'))
  if (!m) return null
  const rel = m[2]
  const slash = rel.lastIndexOf('/')
  return `${m[1]}/${slash < 0 ? '' : rel.slice(0, slash)}`
}

/** Display/repo-relative form of a folder key (`0/paper-A` → `paper-A`, `0/` → `(root)`). */
function folderLabel(folderKey: string): string {
  const rel = folderKey.replace(/^\d+\//, '')
  return rel === '' ? '(root)' : rel
}

function normalizeFolderPath(path: string): string {
  const normalized = path.trim().replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '')
  return normalized === '' || normalized === '.' || normalized === '(root)' ? '(root)' : normalized
}

function normalizedContext(context: ProjectStructureHint | undefined): ProjectStructureHint | undefined {
  if (!context) return undefined
  const projectCharacter = context.projectCharacter?.trim() ?? ''
  const folderClassifications = (context.folderClassifications ?? [])
    .map((hint) => ({ path: normalizeFolderPath(hint.path), description: hint.description?.trim() ?? '' }))
    .filter((hint) => hint.path.length > 0)
  return { projectCharacter, folderClassifications }
}

function classificationFor(path: string, context: ProjectStructureHint | undefined): ResolvedFolderClassification {
  const normalized = normalizeFolderPath(path)
  const rules = context?.folderClassifications ?? []
  // A parent rule (e.g. docs/) covers descendants; the most-specific rule wins.
  const match = rules
    .filter((rule) => {
      const rulePath = normalizeFolderPath(rule.path)
      return normalized === rulePath || (rulePath !== '(root)' && normalized.startsWith(rulePath + '/'))
    })
    .sort((a, b) => normalizeFolderPath(b.path).length - normalizeFolderPath(a.path).length)[0]
  const description = match?.description?.trim() ?? ''
  return { path: normalized, description, source: description ? 'user' : 'agent' }
}

/** A unit's role: 'canonical' if it holds a canonical doc (current.md/PRD.md/ADR-*), else 'reference'.
 *  Deterministic — derived from paths, no LLM. (source_id === source_path for materialized sources.) */
const roleOf = (sourcePaths: string[]): WorkUnit['role'] =>
  sourcePaths.some(isCanonical) ? 'canonical' : 'reference'

/** Greedily pack docs into sub-groups each ≤ maxChars (for splitting an oversized single folder). */
function packDocs(docs: SourceDoc[], maxChars: number): SourceDoc[][] {
  const groups: SourceDoc[][] = []
  let cur: SourceDoc[] = []
  let curChars = 0
  for (const d of docs) {
    const c = sizeOf(d)
    if (cur.length && curChars + c > maxChars) { groups.push(cur); cur = []; curChars = 0 }
    cur.push(d); curChars += c
  }
  if (cur.length) groups.push(cur)
  return groups
}

/**
 * Partition the project-doc sources into folder-aligned work units sized to `maxChars` (spec §3, §7.2):
 *   - a folder larger than maxChars is split into multiple units (`splitOf`),
 *   - consecutive small folders are merged greedily until the budget,
 *   - non-project-doc sources (conversations, context) are returned as `unplacedSourceIds`.
 * Deterministic: folders are processed in sorted order and unit ids are index-based.
 */
export function planFolders(sources: SourceDoc[], maxChars: number, contextInput?: ProjectStructureHint): FolderPlan {
  const context = normalizedContext(contextInput)
  const byFolder = new Map<string, SourceDoc[]>()
  const unplaced: string[] = []
  for (const s of sources) {
    const folder = docFolder(s.source_path)
    if (folder === null) { unplaced.push(s.source_id); continue }
    const list = byFolder.get(folder) ?? []
    list.push(s)
    byFolder.set(folder, list)
  }

  const units: WorkUnit[] = []
  let nextId = 0
  const id = (): string => `unit-${nextId++}`

  // Open bin for merging small folders (reset whenever it would overflow or an oversized folder splits).
  let bin: { paths: string[]; ids: string[]; chars: number } | null = null
  const flush = (): void => {
    if (!bin) return
    const multi = bin.paths.length > 1
    units.push({
      id: id(),
      label: multi ? `misc (${bin.paths.length} folders)` : folderLabel(bin.paths[0]),
      memberPaths: bin.paths.map(folderLabel),
      role: roleOf(bin.ids),
      docSourceIds: bin.ids,
      sessionIds: [],
      estChars: bin.chars,
      folderClassifications: bin.paths.map((path) => classificationFor(folderLabel(path), context)),
    })
    bin = null
  }

  for (const folder of [...byFolder.keys()].sort()) {
    const docs = byFolder.get(folder)!
    const folderChars = docs.reduce((n, d) => n + sizeOf(d), 0)

    if (folderChars > maxChars) {
      flush() // an oversized folder starts fresh
      const groups = packDocs(docs, maxChars)
      groups.forEach((group, i) => {
        units.push({
          id: id(),
          label: groups.length > 1 ? `${folderLabel(folder)} (${i + 1}/${groups.length})` : folderLabel(folder),
          memberPaths: [folderLabel(folder)],
          role: roleOf(group.map((d) => d.source_path)),
          docSourceIds: group.map((d) => d.source_id),
          sessionIds: [],
          estChars: group.reduce((n, d) => n + sizeOf(d), 0),
          splitOf: folderLabel(folder),
          folderClassifications: [classificationFor(folderLabel(folder), context)],
        })
      })
      continue
    }

    if (bin && bin.chars + folderChars > maxChars) flush()
    if (!bin) bin = { paths: [], ids: [], chars: 0 }
    bin.paths.push(folder)
    bin.ids.push(...docs.map((d) => d.source_id))
    bin.chars += folderChars
  }
  flush()

  return { units, unplacedSourceIds: unplaced, ...(context ? { projectContext: context } : {}) }
}
