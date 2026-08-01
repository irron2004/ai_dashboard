import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { KnowledgeRetrieval, KnowledgeStore, migrateKnowledge } from '@apc/knowledge'
import { SearchIndex } from '@apc/search'
import type { KnowledgeStatus, NormalizedSession } from '@apc/shared'
import { KnowledgeFtsRetriever } from '../knowledge-retriever.js'
import { RetrievalService } from '../retrieval-service.js'
import { SessionFtsRetriever } from '../session-retriever.js'
import { evaluateRankings, releaseThresholdFailures } from './metrics.js'
import type {
  EvaluationRanking,
  LegacyEvaluationBaseline,
  RetrievalEvaluationFixture,
  RetrievalEvaluationReport,
} from './types.js'

const fixtureUrl = new URL('../../test/fixtures/retrieval-eval.yml', import.meta.url)
const baselineUrl = new URL('../../test/fixtures/legacy-baseline.json', import.meta.url)
const KNOWN_STATUSES = new Set<KnowledgeStatus>([
  'candidate', 'accepted', 'canonical', 'superseded', 'deprecated', 'conflict', 'unknown',
])

type Corpus = {
  fixture: RetrievalEvaluationFixture
  sessionDb: DatabaseSync
  sessions: SearchIndex
  knowledge: KnowledgeRetrieval
  service: RetrievalService
}

function readJson<T>(url: URL): T {
  return JSON.parse(readFileSync(url, 'utf8')) as T
}

function assertNonBlank(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be a non-blank string`)
}

function loadFixture(): RetrievalEvaluationFixture {
  const value = readJson<RetrievalEvaluationFixture>(fixtureUrl)
  if (!Number.isInteger(value.version) || value.version < 1) throw new Error('fixture version must be positive')
  if (!Array.isArray(value.projects) || new Set(value.projects).size !== value.projects.length) {
    throw new Error('fixture projects must be a unique array')
  }
  if (!Array.isArray(value.queries) || value.queries.length < 20) {
    throw new Error('fixture must contain at least 20 queries')
  }
  const projects = new Set(value.projects)
  const queryIds = new Set<string>()
  for (const project of value.projects) assertNonBlank(project, 'project id')
  for (const session of value.sessions) {
    assertNonBlank(session.id, 'session id')
    assertNonBlank(session.text, `session ${session.id} text`)
    if (!projects.has(session.projectId)) throw new Error(`unknown session project: ${session.projectId}`)
  }
  for (const document of value.documents) {
    assertNonBlank(document.relPath, 'document relPath')
    assertNonBlank(document.markdown, `document ${document.relPath} markdown`)
    if (!projects.has(document.projectId)) throw new Error(`unknown document project: ${document.projectId}`)
    if (!KNOWN_STATUSES.has(document.status)) throw new Error(`unknown document status: ${document.status}`)
  }
  for (const query of value.queries) {
    assertNonBlank(query.id, 'query id')
    assertNonBlank(query.text, `query ${query.id} text`)
    if (queryIds.has(query.id)) throw new Error(`duplicate query id: ${query.id}`)
    queryIds.add(query.id)
    if (!Array.isArray(query.scope) || query.scope.length === 0) throw new Error(`query ${query.id} has empty scope`)
    if (query.scope.some((project) => !projects.has(project))) throw new Error(`query ${query.id} has unknown scope`)
    if (!Array.isArray(query.relevantParents)) throw new Error(`query ${query.id} relevantParents must be an array`)
  }
  return value
}

function normalizedSession(input: RetrievalEvaluationFixture['sessions'][number]): NormalizedSession {
  return {
    id: input.id,
    agentType: 'claude',
    projectId: input.projectId,
    sourceMeta: {
      provider: 'claude',
      sourceKind: 'jsonl-file',
      rawLocator: `/synthetic/${input.id}.jsonl`,
      sessionHeader: {},
    },
    turns: [{
      uuid: `${input.id}:0`,
      role: 'user',
      text: input.text,
      timestamp: '2026-08-02T00:00:00Z',
      toolCalls: [],
    }],
    filesTouched: [],
  }
}

function buildCorpus(fixture: RetrievalEvaluationFixture): Corpus {
  const sessionDb = new DatabaseSync(':memory:')
  const sessions = new SearchIndex(sessionDb)
  for (const input of fixture.sessions) sessions.indexSession(normalizedSession(input))

  const knowledgeDb = new DatabaseSync(':memory:')
  knowledgeDb.exec('PRAGMA foreign_keys = ON')
  migrateKnowledge(knowledgeDb)
  const store = new KnowledgeStore(knowledgeDb)
  for (const projectId of fixture.projects) {
    store.upsertCollection({
      id: `project:${projectId}`,
      projectId,
      name: projectId,
      rootPath: `/synthetic/${projectId}`,
      include: ['**/*.md'],
      exclude: [],
      includeByDefault: true,
    })
  }
  for (const document of fixture.documents) {
    store.upsertContext({
      collectionId: `project:${document.projectId}`,
      pathPrefix: `/${document.relPath}`,
      description: `synthetic ${document.status} evidence`,
      docType: 'wiki',
      statusHint: document.status,
    })
    store.indexMarkdownDoc({
      collectionId: `project:${document.projectId}`,
      projectId: document.projectId,
      relPath: document.relPath,
      markdown: document.markdown,
      updatedAt: '2026-08-02T00:00:00Z',
    })
  }
  const knowledge = new KnowledgeRetrieval(knowledgeDb)
  const registry = { list: () => fixture.projects.map((id) => ({ id })) }
  const service = new RetrievalService({
    registry,
    retrievers: [new SessionFtsRetriever(sessions), new KnowledgeFtsRetriever(knowledge)],
  })
  return { fixture, sessionDb, sessions, knowledge, service }
}

function legacySessionResults(corpus: Corpus, text: string, scope: string[]) {
  const predicates = ['turn_fts MATCH ?']
  const params: string[] = [text]
  if (scope.length === 1) {
    predicates.push('project_id = ?')
    params.push(scope[0]!)
  } else {
    predicates.push(`project_id IN (${scope.map(() => '?').join(', ')})`)
    params.push(...scope)
  }
  try {
    return corpus.sessionDb.prepare(`
      SELECT session_id, project_id
      FROM turn_fts
      WHERE ${predicates.join(' AND ')}
      ORDER BY rank, session_id
    `).all(...params) as Array<{ session_id: string; project_id: string }>
  } catch {
    return []
  }
}

function legacyRankings(corpus: Corpus): EvaluationRanking[] {
  return corpus.fixture.queries.map((query) => {
    const sessionResults = legacySessionResults(corpus, query.text, query.scope).map((row) => ({
      parentId: `session:${encodeURIComponent(row.session_id)}`,
      projectId: row.project_id,
      sourceKind: 'session' as const,
      uri: null,
    }))
    const knowledgeResults = query.scope.flatMap((projectId) => {
      try {
        return corpus.knowledge.search({ projectId, query: query.text, limit: 10 }).map((hit) => ({
          parentId: hit.doc.id,
          projectId: hit.doc.projectId,
          sourceKind: 'knowledge' as const,
          uri: null,
        }))
      } catch {
        return []
      }
    })
    return {
      queryId: query.id,
      scopeProjectIds: query.scope,
      relevantParentIds: query.relevantParents,
      results: [...sessionResults, ...knowledgeResults],
    }
  })
}

async function currentRankings(corpus: Corpus): Promise<EvaluationRanking[]> {
  const rankings: EvaluationRanking[] = []
  for (const query of corpus.fixture.queries) {
    const response = await corpus.service.search({
      text: query.text,
      scope: { projectIds: query.scope },
      limit: 10,
    })
    rankings.push({
      queryId: query.id,
      scopeProjectIds: query.scope,
      relevantParentIds: query.relevantParents,
      results: response.evidence.map((candidate) => ({
        parentId: candidate.parentId,
        projectId: candidate.projectId,
        sourceKind: candidate.sourceKind,
        uri: candidate.uri,
      })),
    })
  }
  return rankings
}

function stableJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`
}

async function main(): Promise<void> {
  const fixture = loadFixture()
  const corpus = buildCorpus(fixture)
  const computedLegacyRankings = legacyRankings(corpus)
  const computedLegacy: LegacyEvaluationBaseline = {
    fixtureVersion: fixture.version,
    rankings: computedLegacyRankings.map(({ queryId, results }) => ({ queryId, results })),
    metrics: evaluateRankings(computedLegacyRankings),
  }
  if (process.argv.includes('--print-legacy')) {
    process.stdout.write(stableJson(computedLegacy))
    return
  }

  const recordedLegacy = readJson<LegacyEvaluationBaseline>(baselineUrl)
  if (stableJson(recordedLegacy) !== stableJson(computedLegacy)) {
    throw new Error('legacy baseline drifted; inspect the corpus/gold diff and update it explicitly')
  }
  const current = evaluateRankings(await currentRankings(corpus))
  const thresholds = {
    maxParentOccupancy: 1,
    minimumCitationCompleteness: 1,
    maximumScopeLeakage: 0,
  }
  const failures = releaseThresholdFailures(current, recordedLegacy.metrics, thresholds)
  const report: RetrievalEvaluationReport = {
    fixtureVersion: fixture.version,
    queryCount: fixture.queries.length,
    legacy: recordedLegacy.metrics,
    current,
    thresholds,
    passed: failures.length === 0,
    failures,
  }
  process.stdout.write(stableJson(report))
  if (failures.length > 0) process.exitCode = 1
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`)
  process.exitCode = 1
})
