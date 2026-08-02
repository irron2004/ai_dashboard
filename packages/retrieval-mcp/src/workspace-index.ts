import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
} from 'node:fs'
import { readFile as readFileAsync, stat as statAsync } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { migrate, openDb, ProjectRegistry } from '@apc/core'
import { KnowledgeStore, migrateKnowledge } from '@apc/knowledge'
import type { Project } from '@apc/shared'
import { parse } from 'yaml'
import { z } from 'zod'
import type { RetrievalMcpConfig } from './config.js'

const MAX_PROJECT_FILES = 7_500
const MAX_PROJECT_BYTES = 128 * 1024 * 1024
const MAX_FILE_BYTES = 1024 * 1024
const MAX_DEPTH = 24
const INDEXED_EXTENSIONS = new Set(['.md', '.mdx', '.txt'])
const STANDARD_PROJECT_FILES = ['README.md', 'AGENTS.md', 'CLAUDE.md', 'NEXT.md', 'ASSETS.md']
const STANDARD_WORKSPACE_SOURCES = ['AGENTS.md', 'CLAUDE.md', 'README.md', 'NEXT.md', 'ASSETS.md', 'docs']

const ManifestProjectSchema = z.object({
  key: z.string().regex(/^[a-z0-9_-]+$/),
  name: z.string().min(1),
  path: z.string().min(1),
  tier: z.string().min(1),
  rule_doc: z.string().min(1),
  wiki: z.string().min(1).optional(),
  next: z.string().min(1).optional(),
  desc: z.string().min(1),
}).passthrough()

const WorkspaceManifestSchema = z.object({
  version: z.number().int().min(1),
  projects: z.array(ManifestProjectSchema).min(1),
}).passthrough()

type ManifestProject = z.infer<typeof ManifestProjectSchema>

type ProjectPlan = {
  id: string
  name: string
  description: string
  rootPath: string
  requiredSources: string[]
  optionalSources: string[]
}

type ScannedProject = {
  plan: ProjectPlan
  documents: ScannedDocument[]
}

type PreviousSourceState = {
  size: number
  mtimeMs: number
}

type ScannedDocument = {
  relPath: string
  path: string
  size: number
  mtimeMs: number
  updatedAt: string
  markdown?: string
}

export type WorkspaceIndexProjectResult = {
  id: string
  rootPath: string
  total: number
  inserted: number
  updated: number
  deleted: number
  unchanged: number
}

export type WorkspaceIndexRefreshResult = {
  dbPath: string
  indexedAt: string
  totalDocuments: number
  projects: WorkspaceIndexProjectResult[]
  removedProjects: string[]
  skipped: Array<{ id: string; reason: string }>
  warnings: string[]
}

export class WorkspaceIndexError extends Error {
  constructor(readonly code: string, message: string) {
    super(message)
    this.name = 'WorkspaceIndexError'
  }
}

function isInside(root: string, candidate: string): boolean {
  const rel = relative(root, candidate)
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel))
}

function safeRelativePath(input: string, label: string): string {
  const normalized = input.trim().replace(/\\/g, '/')
  if (
    !normalized
    || normalized.includes('\0')
    || normalized.startsWith('/')
    || /^[A-Za-z]:/.test(normalized)
    || normalized.split('/').some((part) => part === '' || part === '.' || part === '..')
  ) {
    throw new WorkspaceIndexError('unsafe-manifest-path', `${label} is not a safe relative path: ${input}`)
  }
  return normalized
}

function resolveWorkspacePath(root: string, input: string, label: string): string {
  const rel = safeRelativePath(input, label)
  const candidate = resolve(root, ...rel.split('/'))
  if (!isInside(root, candidate)) {
    throw new WorkspaceIndexError('path-escape', `${label} escapes the workspace root`)
  }
  return candidate
}

function assertProjectChild(project: ManifestProject, input: string, field: string): void {
  const projectPath = `${safeRelativePath(project.path, `${project.key}.path`).replace(/\/$/, '')}/`
  const child = `${safeRelativePath(input, `${project.key}.${field}`).replace(/\/$/, '')}/`
  if (!child.startsWith(projectPath)) {
    throw new WorkspaceIndexError(
      'source-outside-project',
      `${project.key}.${field} must stay inside ${project.path}`,
    )
  }
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)]
}

function loadPlans(config: RetrievalMcpConfig): ProjectPlan[] {
  const workspaceRoot = realpathSync(config.workspaceRoot)
  const manifestPath = resolve(config.manifestPath)
  if (!isInside(workspaceRoot, manifestPath)) {
    throw new WorkspaceIndexError('manifest-outside-workspace', 'workspace manifest must be inside workspace root')
  }
  if (!existsSync(manifestPath)) {
    throw new WorkspaceIndexError('manifest-not-found', `workspace manifest not found: ${manifestPath}`)
  }
  const manifest = WorkspaceManifestSchema.parse(parse(readFileSync(manifestPath, 'utf8')))
  const ids = manifest.projects.map((project) => project.key)
  if (ids.includes('workspace')) {
    throw new WorkspaceIndexError('reserved-project-id', 'project id "workspace" is reserved for root documents')
  }
  if (new Set(ids).size !== ids.length) {
    throw new WorkspaceIndexError('duplicate-project-id', 'workspace manifest contains duplicate project ids')
  }

  const plans: ProjectPlan[] = [{
    id: 'workspace',
    name: 'ruahverce workspace',
    description: 'Workspace-wide policies, maps, decisions, specifications, and plans',
    rootPath: workspaceRoot,
    requiredSources: [resolveWorkspacePath(workspaceRoot, 'AGENTS.md', 'workspace.AGENTS.md')],
    optionalSources: STANDARD_WORKSPACE_SOURCES
      .filter((source) => source !== 'AGENTS.md')
      .map((source) => resolveWorkspacePath(workspaceRoot, source, `workspace.${source}`)),
  }]

  for (const project of manifest.projects) {
    assertProjectChild(project, project.rule_doc, 'rule_doc')
    if (project.wiki) assertProjectChild(project, project.wiki, 'wiki')
    if (project.next) assertProjectChild(project, project.next, 'next')
    const rootPath = resolveWorkspacePath(workspaceRoot, project.path, `${project.key}.path`)
    const requiredSources = [resolveWorkspacePath(workspaceRoot, project.rule_doc, `${project.key}.rule_doc`)]
    if (project.wiki) {
      requiredSources.push(resolveWorkspacePath(workspaceRoot, project.wiki, `${project.key}.wiki`))
    }
    const optionalSources = STANDARD_PROJECT_FILES.map((source) => join(rootPath, source))
    if (project.next) optionalSources.push(join(dirname(resolveWorkspacePath(
      workspaceRoot,
      project.next,
      `${project.key}.next`,
    )), 'NEXT.md'))
    plans.push({
      id: project.key,
      name: project.name,
      description: project.desc,
      rootPath,
      requiredSources: unique(requiredSources),
      optionalSources: unique(optionalSources),
    })
  }
  return plans
}

function loadPreviousSourceState(config: RetrievalMcpConfig): Map<string, Map<string, PreviousSourceState>> {
  const result = new Map<string, Map<string, PreviousSourceState>>()
  if (!existsSync(config.dbPath)) return result
  const db = new DatabaseSync(config.dbPath, { readOnly: true })
  try {
    const rows = db.prepare(`
      SELECT s.project_id, s.rel_path, s.size, s.mtime_ms
      FROM workspace_retrieval_sources s
      JOIN knowledge_documents d
        ON d.project_id = s.project_id AND d.rel_path = s.rel_path
      ORDER BY s.project_id, s.rel_path
    `).all() as Array<{ project_id: string; rel_path: string; size: number; mtime_ms: number }>
    for (const row of rows) {
      const project = result.get(row.project_id) ?? new Map<string, PreviousSourceState>()
      project.set(row.rel_path, { size: Number(row.size), mtimeMs: Number(row.mtime_ms) })
      result.set(row.project_id, project)
    }
  } catch {
    return new Map()
  } finally {
    db.close()
  }
  return result
}

async function mapWithConcurrency<T, R>(
  values: readonly T[],
  concurrency: number,
  mapper: (value: T) => Promise<R>,
): Promise<R[]> {
  const output = new Array<R>(values.length)
  let cursor = 0
  const workers = Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (cursor < values.length) {
      const index = cursor++
      output[index] = await mapper(values[index])
    }
  })
  await Promise.all(workers)
  return output
}

async function scanProject(
  plan: ProjectPlan,
  previous: ReadonlyMap<string, PreviousSourceState> = new Map(),
): Promise<ScannedProject> {
  if (!existsSync(plan.rootPath)) {
    throw new WorkspaceIndexError('project-root-missing', `project root is unavailable: ${plan.rootPath}`)
  }
  const realRoot = realpathSync(plan.rootPath)
  const files = new Map<string, { path: string; size: number; mtimeMs: number; updatedAt: string }>()
  let totalBytes = 0

  const addFile = (candidate: string): void => {
    const extension = extname(candidate).toLowerCase()
    if (!INDEXED_EXTENSIONS.has(extension)) return
    const lexical = resolve(candidate)
    if (!isInside(resolve(plan.rootPath), lexical)) {
      throw new WorkspaceIndexError('path-escape', `source escapes project ${plan.id}: ${candidate}`)
    }
    const relPath = relative(realRoot, lexical).split(sep).join('/')
    if (!relPath || relPath.startsWith('../')) {
      throw new WorkspaceIndexError('path-escape', `source has no safe project-relative path: ${candidate}`)
    }
    const stats = statSync(lexical)
    if (!stats.isFile()) return
    if (stats.size > MAX_FILE_BYTES) {
      throw new WorkspaceIndexError('file-size-limit', `${plan.id}/${relPath} exceeds ${MAX_FILE_BYTES} bytes`)
    }
    if (!files.has(relPath)) {
      if (files.size >= MAX_PROJECT_FILES) {
        throw new WorkspaceIndexError('file-count-limit', `${plan.id} exceeds ${MAX_PROJECT_FILES} indexed files`)
      }
      totalBytes += stats.size
      if (totalBytes > MAX_PROJECT_BYTES) {
        throw new WorkspaceIndexError('project-size-limit', `${plan.id} exceeds ${MAX_PROJECT_BYTES} indexed bytes`)
      }
      files.set(relPath, {
        path: lexical,
        size: stats.size,
        mtimeMs: stats.mtimeMs,
        updatedAt: stats.mtime.toISOString(),
      })
    }
  }

  const visit = (candidate: string, depth: number, knownType?: 'file' | 'directory' | 'other'): void => {
    if (depth > MAX_DEPTH) {
      throw new WorkspaceIndexError('depth-limit', `${plan.id} exceeds scan depth ${MAX_DEPTH}: ${candidate}`)
    }
    const lexical = resolve(candidate)
    if (!isInside(resolve(plan.rootPath), lexical)) {
      throw new WorkspaceIndexError('path-escape', `source escapes project ${plan.id}: ${candidate}`)
    }
    const lexicalStats = knownType ? undefined : lstatSync(lexical)
    if (lexicalStats?.isSymbolicLink()) return
    const type = knownType
      ?? (lexicalStats?.isFile() ? 'file' : lexicalStats?.isDirectory() ? 'directory' : 'other')
    if (type === 'file') {
      addFile(lexical)
      return
    }
    if (type !== 'directory') return
    const entries = readdirSync(lexical, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name))
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue
      const entryType = entry.isFile() ? 'file' : entry.isDirectory() ? 'directory' : 'other'
      visit(join(lexical, entry.name), depth + 1, entryType)
    }
  }

  for (const source of plan.requiredSources) {
    if (!existsSync(source)) {
      throw new WorkspaceIndexError('required-source-missing', `${plan.id} required source is unavailable: ${source}`)
    }
    visit(source, 0)
  }
  for (const source of plan.optionalSources) {
    if (existsSync(source)) visit(source, 0)
  }

  const documents = await mapWithConcurrency(
    [...files.entries()].sort(([left], [right]) => left.localeCompare(right)),
    32,
    async ([relPath, file]): Promise<ScannedDocument> => {
      const old = previous.get(relPath)
      if (old?.size === file.size && old.mtimeMs === file.mtimeMs) {
        return { relPath, ...file }
      }
      const markdown = await readFileAsync(file.path, 'utf8')
      const after = await statAsync(file.path)
      if (file.size !== after.size || file.mtimeMs !== after.mtimeMs) {
        throw new WorkspaceIndexError('source-changed-during-scan', `${plan.id}/${relPath} changed during indexing`)
      }
      return { relPath, ...file, markdown }
    },
  )
  return { plan, documents }
}

function projectRecord(plan: ProjectPlan): Project {
  return {
    id: plan.id,
    name: plan.name,
    status: 'active',
    projectType: 'git',
    domain: 'project-docs',
    repoPaths: [plan.rootPath],
    vaultPaths: [],
    sourcePaths: unique([...plan.requiredSources, ...plan.optionalSources].filter(existsSync)),
  }
}

function assertCachePath(config: RetrievalMcpConfig): void {
  const workspaceRoot = resolve(config.workspaceRoot)
  const cacheRoot = resolve(workspaceRoot, '.autosci', 'cache')
  const dbPath = resolve(config.dbPath)
  if (isInside(workspaceRoot, dbPath) && !isInside(cacheRoot, dbPath)) {
    throw new WorkspaceIndexError(
      'db-outside-cache',
      `a retrieval DB inside the workspace must stay under ${cacheRoot}; received ${dbPath}`,
    )
  }
}

function assertDbOwnership(config: RetrievalMcpConfig): void {
  if (!existsSync(config.dbPath) || statSync(config.dbPath).size === 0) return
  let db: DatabaseSync | undefined
  try {
    db = new DatabaseSync(config.dbPath, { readOnly: true })
    const tables = db.prepare(`SELECT name FROM sqlite_master
      WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
      ORDER BY name`).all() as Array<{ name: string }>
    if (tables.length === 0) return
    if (!tables.some((table) => table.name === 'workspace_retrieval_meta')) {
      throw new WorkspaceIndexError(
        'unowned-db',
        `refusing to modify a database without a workspace retrieval ownership marker: ${config.dbPath}`,
      )
    }
    const owner = (db.prepare(`SELECT value FROM workspace_retrieval_meta
      WHERE key = 'workspace_root'`).get() as { value: string } | undefined)?.value
    const expected = realpathSync(config.workspaceRoot)
    if (!owner) {
      throw new WorkspaceIndexError(
        'incomplete-db-marker',
        `workspace retrieval database has no workspace_root marker: ${config.dbPath}`,
      )
    }
    if (owner !== expected) {
      throw new WorkspaceIndexError(
        'workspace-root-mismatch',
        `retrieval database belongs to ${owner}, not ${expected}`,
      )
    }
  } catch (error) {
    if (error instanceof WorkspaceIndexError) throw error
    throw new WorkspaceIndexError(
      'invalid-db',
      `cannot verify retrieval database ownership at ${config.dbPath}: ${error instanceof Error ? error.message : String(error)}`,
    )
  } finally {
    db?.close()
  }
}

function contentHash(markdown: string): string {
  return createHash('sha256').update(markdown, 'utf8').digest('hex')
}

function applyScannedProject(
  db: DatabaseSync,
  registry: ProjectRegistry,
  store: KnowledgeStore,
  entry: ScannedProject,
): WorkspaceIndexProjectResult {
  let begun = false
  try {
    db.exec('BEGIN IMMEDIATE')
    begun = true
    registry.register(projectRecord(entry.plan))
    const collectionId = `workspace:${entry.plan.id}`
    store.upsertCollection({
      id: collectionId,
      projectId: entry.plan.id,
      name: entry.plan.name,
      rootPath: entry.plan.rootPath,
      include: ['**/*.md', '**/*.mdx', '**/*.txt'],
      exclude: [],
      includeByDefault: true,
    })
    const existing = store.listProjectDocuments(entry.plan.id)
    const existingByPath = new Map(existing.map((document) => [document.relPath, document]))
    const expected = new Set(entry.documents.map((document) => document.relPath))
    let inserted = 0
    let updated = 0
    let unchanged = 0
    const upsertState = db.prepare(`INSERT INTO workspace_retrieval_sources
      (project_id, rel_path, size, mtime_ms)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(project_id, rel_path) DO UPDATE SET
        size = excluded.size,
        mtime_ms = excluded.mtime_ms`)

    for (const document of entry.documents) {
      const current = existingByPath.get(document.relPath)
      if (document.markdown === undefined) {
        if (!current) {
          throw new WorkspaceIndexError(
            'source-state-without-document',
            `${entry.plan.id}/${document.relPath} has cached state without an indexed document`,
          )
        }
        unchanged++
      } else if (current?.hash === contentHash(document.markdown)) {
        unchanged++
      } else {
        store.indexMarkdownDoc({
          collectionId,
          projectId: entry.plan.id,
          relPath: document.relPath,
          markdown: document.markdown,
          updatedAt: document.updatedAt,
        })
        if (current) updated++
        else inserted++
      }
      upsertState.run(entry.plan.id, document.relPath, document.size, document.mtimeMs)
    }

    let deleted = 0
    for (const document of existing) {
      if (!expected.has(document.relPath) && store.deleteDocument(document.id)) deleted++
    }
    db.prepare(`DELETE FROM workspace_retrieval_sources
      WHERE project_id = ?
        AND rel_path NOT IN (SELECT rel_path FROM knowledge_documents WHERE project_id = ?)`)
      .run(entry.plan.id, entry.plan.id)
    db.exec('COMMIT')
    begun = false
    return {
      id: entry.plan.id,
      rootPath: entry.plan.rootPath,
      total: entry.documents.length,
      inserted,
      updated,
      deleted,
      unchanged,
    }
  } catch (error) {
    if (begun) db.exec('ROLLBACK')
    throw error
  }
}

function removeStaleProjects(
  db: DatabaseSync,
  registry: ProjectRegistry,
  store: KnowledgeStore,
  expectedIds: ReadonlySet<string>,
): string[] {
  const managedIds = db.prepare(`SELECT project_id FROM knowledge_collections
    WHERE id = 'workspace:' || project_id
    ORDER BY project_id`).all() as Array<{ project_id: string }>
  const staleIds = managedIds
    .map((row) => row.project_id)
    .filter((id) => !expectedIds.has(id))
    .sort()
  for (const id of staleIds) {
    let begun = false
    try {
      db.exec('BEGIN IMMEDIATE')
      begun = true
      store.clearProject(id)
      db.prepare('DELETE FROM knowledge_collections WHERE project_id = ?').run(id)
      db.prepare('DELETE FROM workspace_retrieval_sources WHERE project_id = ?').run(id)
      registry.remove(id)
      db.exec('COMMIT')
      begun = false
    } catch (error) {
      if (begun) db.exec('ROLLBACK')
      throw error
    }
  }
  return staleIds
}

export async function refreshWorkspaceIndex(
  config: RetrievalMcpConfig,
  now: () => Date = () => new Date(),
): Promise<WorkspaceIndexRefreshResult> {
  assertCachePath(config)
  assertDbOwnership(config)
  const plans = loadPlans(config)
  const previous = loadPreviousSourceState(config)
  const scanned: ScannedProject[] = []
  const skipped: WorkspaceIndexRefreshResult['skipped'] = []
  for (const plan of plans) {
    try {
      scanned.push(await scanProject(plan, previous.get(plan.id)))
    } catch (error) {
      if (error instanceof WorkspaceIndexError) {
        skipped.push({ id: plan.id, reason: `${error.code}: ${error.message}` })
        continue
      }
      throw error
    }
  }
  if (!scanned.some((project) => project.plan.id === 'workspace')) {
    throw new WorkspaceIndexError('workspace-scan-incomplete', 'workspace control documents could not be indexed')
  }

  mkdirSync(dirname(config.dbPath), { recursive: true })
  const db = openDb(config.dbPath)
  try {
    migrate(db)
    migrateKnowledge(db)
    db.exec(`CREATE TABLE IF NOT EXISTS workspace_retrieval_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS workspace_retrieval_sources (
      project_id TEXT NOT NULL,
      rel_path TEXT NOT NULL,
      size INTEGER NOT NULL,
      mtime_ms REAL NOT NULL,
      PRIMARY KEY (project_id, rel_path)
    )`)
    const registry = new ProjectRegistry(db)
    const store = new KnowledgeStore(db)
    const projects: WorkspaceIndexProjectResult[] = []
    for (const entry of scanned) {
      projects.push(applyScannedProject(db, registry, store, entry))
    }
    const removedProjects = removeStaleProjects(
      db,
      registry,
      store,
      new Set(plans.map((plan) => plan.id)),
    )
    const indexedAt = now().toISOString()
    db.prepare(`INSERT INTO workspace_retrieval_meta (key, value)
      VALUES ('indexed_at', ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(indexedAt)
    db.prepare(`INSERT INTO workspace_retrieval_meta (key, value)
      VALUES ('workspace_root', ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(realpathSync(config.workspaceRoot))
    return {
      dbPath: config.dbPath,
      indexedAt,
      totalDocuments: projects.reduce((sum, project) => sum + project.total, 0),
      projects,
      removedProjects,
      skipped,
      warnings: skipped.map((entry) => `${entry.id}: ${entry.reason}`),
    }
  } finally {
    db.close()
  }
}
