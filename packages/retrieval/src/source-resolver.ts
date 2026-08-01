import { existsSync, realpathSync, statSync } from 'node:fs'
import { extname, isAbsolute, relative, resolve } from 'node:path'
import {
  buildProjectDocUri,
  parseProjectDocUri,
  type KnowledgeChunkWithNeighbors,
} from '@apc/knowledge'
import type { KnowledgeChunk, KnowledgeDocument } from '@apc/shared'
import {
  parseSessionTurnUri,
  type SessionTurnContext,
} from '@apc/search'

const DEFAULT_MAX_BYTES = 64 * 1024
const DEFAULT_MAX_NEIGHBORS = 2
const ALLOWED_KNOWLEDGE_EXTENSIONS = new Set(['.md', '.mdx', '.txt'])

export type EvidenceSourceResolveRequest = {
  uri: string
  neighbors?: number
}

export type EvidenceSourceDetail = {
  uri: string
  sourceKind: 'session' | 'knowledge'
  projectId: string
  title: string
  selectedOrdinal: number
  content: string
  truncated: boolean
  warnings: string[]
}

export type EvidenceSourceErrorCode =
  | 'invalid-uri'
  | 'neighbor-limit'
  | 'unknown-project'
  | 'unknown-session'
  | 'source-not-found'
  | 'path-escape'
  | 'unsupported-extension'
  | 'source-unavailable'

export type EvidenceSourceResolveResult =
  | { ok: true; source: EvidenceSourceDetail }
  | { ok: false; error: { code: EvidenceSourceErrorCode; message: string } }

type SourceProject = { id: string }
type SourceProjectRegistry = { get(projectId: string): SourceProject | undefined }
type SourceKnowledgeStore = {
  getDocumentByUri(uri: string): KnowledgeDocument | undefined
  getChunkWithNeighbors(
    docId: string,
    ordinal: number,
    before: number,
    after: number,
  ): KnowledgeChunkWithNeighbors | undefined
}
type SourceSessionIndex = {
  resolveTurnContext(uri: string, before: number, after: number): SessionTurnContext | undefined
}

export type EvidenceSourceResolverOptions = {
  registry: SourceProjectRegistry
  projectRoots: (projectId: string) => string[]
  knowledge: SourceKnowledgeStore
  sessions: SourceSessionIndex
  maxBytes?: number
  maxNeighbors?: number
}

class SourceResolutionError extends Error {
  constructor(readonly code: EvidenceSourceErrorCode, message: string) {
    super(message)
    this.name = 'SourceResolutionError'
  }
}

function isInside(root: string, candidate: string): boolean {
  const rel = relative(root, candidate)
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) && !isAbsolute(rel))
}

function validateRelativeDocumentPath(relPath: string): void {
  if (
    !relPath
    || relPath.includes('\0')
    || relPath.includes('\\')
    || isAbsolute(relPath)
    || relPath.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')
  ) {
    throw new SourceResolutionError('path-escape', '문서 경로가 프로젝트 범위를 벗어납니다.')
  }
}

function resolveContainedSource(roots: readonly string[], relPath: string): { size: number } {
  for (const root of roots) {
    if (!root.trim() || root.startsWith('ssh://') || !existsSync(root)) continue
    const lexicalRoot = resolve(root)
    const lexicalCandidate = resolve(lexicalRoot, ...relPath.split('/'))
    if (!isInside(lexicalRoot, lexicalCandidate)) {
      throw new SourceResolutionError('path-escape', '문서 경로가 프로젝트 범위를 벗어납니다.')
    }
    if (!existsSync(lexicalCandidate)) continue
    let realRoot: string
    let realCandidate: string
    try {
      realRoot = realpathSync(lexicalRoot)
      realCandidate = realpathSync(lexicalCandidate)
    } catch {
      throw new SourceResolutionError('source-unavailable', '원문 경로를 안전하게 확인할 수 없습니다.')
    }
    if (!isInside(realRoot, realCandidate)) {
      throw new SourceResolutionError('path-escape', '심볼릭 링크가 프로젝트 범위를 벗어납니다.')
    }
    const stats = statSync(realCandidate)
    if (!stats.isFile()) continue
    return { size: stats.size }
  }
  throw new SourceResolutionError('source-not-found', '등록된 프로젝트 경로에서 원문을 찾을 수 없습니다.')
}

function truncateUtf8(content: string, maxBytes: number): { content: string; truncated: boolean } {
  const encoded = Buffer.from(content, 'utf8')
  if (encoded.byteLength <= maxBytes) return { content, truncated: false }
  const decoder = new TextDecoder('utf-8', { fatal: true })
  for (let end = maxBytes; end >= 0; end--) {
    try {
      return { content: decoder.decode(encoded.subarray(0, end)), truncated: true }
    } catch {
      // Back up to the previous complete UTF-8 code point.
    }
  }
  return { content: '', truncated: true }
}

function heading(chunk: KnowledgeChunk): string {
  return chunk.headingPath.length > 0 ? ` · ${chunk.headingPath.join(' / ')}` : ''
}

function formatKnowledgeContext(detail: KnowledgeChunkWithNeighbors): string {
  return [...detail.before, detail.chunk, ...detail.after]
    .map((chunk) => `[chunk ${chunk.ordinal}${heading(chunk)}]\n${chunk.body}`)
    .join('\n\n')
}

function formatSessionContext(detail: SessionTurnContext): string {
  return [...detail.before, detail.selected, ...detail.after]
    .map((turn) => `[turn ${turn.turnOrdinal} · ${turn.role}]\n${turn.body}`)
    .join('\n\n')
}

function unique(values: string[]): string[] {
  return [...new Set(values)]
}

export class EvidenceSourceResolver {
  private readonly maxBytes: number
  private readonly maxNeighbors: number

  constructor(private readonly options: EvidenceSourceResolverOptions) {
    this.maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES
    this.maxNeighbors = options.maxNeighbors ?? DEFAULT_MAX_NEIGHBORS
    if (!Number.isInteger(this.maxBytes) || this.maxBytes < 1) {
      throw new RangeError('maxBytes must be a positive integer')
    }
    if (!Number.isInteger(this.maxNeighbors) || this.maxNeighbors < 0 || this.maxNeighbors > 20) {
      throw new RangeError('maxNeighbors must be an integer between 0 and 20')
    }
  }

  resolve(request: EvidenceSourceResolveRequest): EvidenceSourceResolveResult {
    try {
      const uri = request.uri.trim()
      if (!uri) throw new SourceResolutionError('invalid-uri', '원문 URI가 비어 있습니다.')
      const neighbors = request.neighbors ?? 1
      if (!Number.isInteger(neighbors) || neighbors < 0 || neighbors > this.maxNeighbors) {
        throw new SourceResolutionError(
          'neighbor-limit',
          `주변 문맥 수는 0에서 ${this.maxNeighbors} 사이여야 합니다.`,
        )
      }
      if (uri.startsWith('pmw://')) return { ok: true, source: this.resolveKnowledge(uri, neighbors) }
      if (uri.startsWith('apc://')) return { ok: true, source: this.resolveSession(uri, neighbors) }
      throw new SourceResolutionError('invalid-uri', '지원하지 않는 원문 URI입니다.')
    } catch (error) {
      if (error instanceof SourceResolutionError) {
        return { ok: false, error: { code: error.code, message: error.message } }
      }
      return {
        ok: false,
        error: { code: 'source-unavailable', message: '원문을 안전하게 조회할 수 없습니다.' },
      }
    }
  }

  private resolveKnowledge(uri: string, neighbors: number): EvidenceSourceDetail {
    let parsed: ReturnType<typeof parseProjectDocUri>
    try {
      parsed = parseProjectDocUri(uri)
    } catch {
      throw new SourceResolutionError('invalid-uri', '유효하지 않은 프로젝트 문서 URI입니다.')
    }
    if (!Number.isSafeInteger(parsed.chunkOrdinal) || (parsed.chunkOrdinal ?? -1) < 0) {
      throw new SourceResolutionError('invalid-uri', '문서 URI에 유효한 chunk 위치가 필요합니다.')
    }
    if (!this.options.registry.get(parsed.projectId)) {
      throw new SourceResolutionError('unknown-project', '등록되지 않은 프로젝트의 원문입니다.')
    }
    validateRelativeDocumentPath(parsed.relPath)
    if (!ALLOWED_KNOWLEDGE_EXTENSIONS.has(extname(parsed.relPath).toLowerCase())) {
      throw new SourceResolutionError('unsupported-extension', '이 파일 형식은 원문 미리보기를 지원하지 않습니다.')
    }
    const physical = resolveContainedSource(this.options.projectRoots(parsed.projectId), parsed.relPath)
    const documentUri = buildProjectDocUri(parsed.projectId, parsed.relPath)
    const document = this.options.knowledge.getDocumentByUri(documentUri)
    if (!document || document.projectId !== parsed.projectId || document.relPath !== parsed.relPath) {
      throw new SourceResolutionError('source-not-found', '검색 인덱스에서 원문 문서를 찾을 수 없습니다.')
    }
    const detail = this.options.knowledge.getChunkWithNeighbors(
      document.id,
      parsed.chunkOrdinal!,
      neighbors,
      neighbors,
    )
    if (!detail) throw new SourceResolutionError('source-not-found', '검색 인덱스에서 해당 문맥을 찾을 수 없습니다.')
    const bounded = truncateUtf8(formatKnowledgeContext(detail), this.maxBytes)
    return {
      uri,
      sourceKind: 'knowledge',
      projectId: parsed.projectId,
      title: document.title,
      selectedOrdinal: parsed.chunkOrdinal!,
      content: bounded.content,
      truncated: bounded.truncated,
      warnings: unique([
        ...(bounded.truncated ? ['source-content-truncated'] : []),
        ...(physical.size > this.maxBytes ? ['source-file-exceeds-preview-cap'] : []),
      ]),
    }
  }

  private resolveSession(uri: string, neighbors: number): EvidenceSourceDetail {
    const parsed = parseSessionTurnUri(uri)
    if (!parsed || !Number.isSafeInteger(parsed.turnOrdinal)) {
      throw new SourceResolutionError('invalid-uri', '유효하지 않은 세션 URI입니다.')
    }
    const detail = this.options.sessions.resolveTurnContext(uri, neighbors, neighbors)
    if (!detail) throw new SourceResolutionError('unknown-session', '검색 인덱스에서 세션을 찾을 수 없습니다.')
    if (!this.options.registry.get(detail.projectId)) {
      throw new SourceResolutionError('unknown-project', '등록되지 않은 프로젝트의 세션입니다.')
    }
    const bounded = truncateUtf8(formatSessionContext(detail), this.maxBytes)
    return {
      uri,
      sourceKind: 'session',
      projectId: detail.projectId,
      title: `Session ${detail.sessionId}`,
      selectedOrdinal: detail.selected.turnOrdinal,
      content: bounded.content,
      truncated: bounded.truncated,
      warnings: bounded.truncated ? ['source-content-truncated'] : [],
    }
  }
}
