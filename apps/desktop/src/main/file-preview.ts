import { randomUUID } from 'node:crypto'
import { readFileSync, realpathSync, statSync } from 'node:fs'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { TextDecoder } from 'node:util'
import type {
  FilePreviewReadReq,
  FilePreviewReadRes,
  FileRefsResolveReq,
  FileRefsResolveRes,
  ParsedFileReference,
  Project,
  ResolvedFileReference,
} from '@apc/shared'
import { filePreviewKindForPath } from '@apc/shared'
import type { GitWorktreesRes } from '../shared/ipc-contract.js'
import { listGitWorktrees } from './git-worktrees.js'

const DEFAULT_MAX_PREVIEW_BYTES = 1024 * 1024
const DEFAULT_TOKEN_TTL_MS = 60_000

type RootRecord = { input: string; canonical: string }
type ResolutionContext = {
  project: Project
  primaryRoots: RootRecord[]
  worktreeRoots: RootRecord[]
  roots: RootRecord[]
}
type StoredPreviewToken = {
  projectId: string
  reference: ResolvedFileReference
  requestedPath: string
  rootInput: string
  expiresAt: number
}
type Inspection = {
  canonicalPath: string
  requestedPath: string
  size: number
  content: string
}
type InspectionResult =
  | { ok: true; inspection: Inspection }
  | { ok: false; code: 'missing' | 'outside' | 'not-file' | 'oversize' | 'encoding' | 'unreadable'; reason: string }

export type LocalFilePreviewServiceDeps = {
  getProject(projectId: string): Project | undefined
  listWorktrees?: (repoPath: string) => Promise<GitWorktreesRes>
  platform?: NodeJS.Platform
  wslDistro?: string
  now?: () => number
  createToken?: () => string
  maxBytes?: number
  tokenTtlMs?: number
}

export function windowsPathToWslPath(input: string): string | null {
  const match = /^([A-Za-z]):[\\/](.*)$/u.exec(input)
  if (!match) return null
  const rest = match[2]!.replace(/\\/gu, '/')
  return `/mnt/${match[1]!.toLowerCase()}${rest ? `/${rest}` : ''}`
}

export function wslPathToWindowsPath(input: string): string | null {
  const match = /^\/mnt\/([A-Za-z])(?:\/(.*))?$/u.exec(input.replace(/\\/gu, '/'))
  if (!match) return null
  const rest = (match[2] ?? '').replace(/\//gu, '\\')
  return `${match[1]!.toUpperCase()}:\\${rest}`
}

export function parseWslUncPath(input: string): { distro: string; path: string } | null {
  const normalized = input.replace(/\//gu, '\\')
  const match = /^\\\\(?:wsl\$|wsl\.localhost)\\([^\\]+)(\\.*)?$/iu.exec(normalized)
  if (!match) return null
  const path = (match[2] ?? '\\').replace(/\\/gu, '/')
  return { distro: match[1]!, path: path.startsWith('/') ? path : `/${path}` }
}

/** Pure path-syntax mapping; existence and containment are intentionally checked later. */
export function mapFilePreviewPathForPlatform(
  input: string,
  platform: NodeJS.Platform,
  wslDistro?: string,
): string | null {
  const wslUnc = parseWslUncPath(input)
  if (wslUnc) {
    if (platform === 'win32') return input.replace(/\//gu, '\\')
    if (wslDistro && wslUnc.distro.toLowerCase() !== wslDistro.toLowerCase()) return null
    return wslUnc.path
  }

  const drive = windowsPathToWslPath(input)
  if (drive) return platform === 'win32' ? input.replace(/\//gu, '\\') : drive

  const mountedDrive = wslPathToWindowsPath(input)
  if (mountedDrive && platform === 'win32') return mountedDrive

  if (platform === 'win32') return input.replace(/\//gu, '\\')
  return input.replace(/\\/gu, '/')
}

function isRemoteRoot(root: string): boolean {
  return root.startsWith('ssh://')
}

function isWithin(root: string, target: string): boolean {
  const fromRoot = relative(root, target)
  return fromRoot === '' || (!fromRoot.startsWith(`..${sep}`) && fromRoot !== '..' && !isAbsolute(fromRoot))
}

function canonicalDirectory(input: string): RootRecord | null {
  try {
    const canonical = realpathSync(input)
    if (!statSync(canonical).isDirectory()) return null
    return { input, canonical }
  } catch {
    return null
  }
}

function distinctRoots(roots: readonly RootRecord[]): RootRecord[] {
  const seen = new Set<string>()
  return roots.filter((root) => {
    const key = process.platform === 'win32' ? root.canonical.toLowerCase() : root.canonical
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function sameCanonical(left: string, right: string): boolean {
  return process.platform === 'win32'
    ? left.toLowerCase() === right.toLowerCase()
    : left === right
}

function strictUtf8(buffer: Buffer): string | null {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer)
  } catch {
    return null
  }
}

export class LocalFilePreviewService {
  private readonly getProject: LocalFilePreviewServiceDeps['getProject']
  private readonly listWorktrees: NonNullable<LocalFilePreviewServiceDeps['listWorktrees']>
  private readonly platform: NodeJS.Platform
  private readonly wslDistro?: string
  private readonly now: () => number
  private readonly createToken: () => string
  private readonly maxBytes: number
  private readonly tokenTtlMs: number
  private readonly tokens = new Map<string, StoredPreviewToken>()

  constructor(deps: LocalFilePreviewServiceDeps) {
    this.getProject = deps.getProject
    this.listWorktrees = deps.listWorktrees ?? listGitWorktrees
    this.platform = deps.platform ?? process.platform
    this.wslDistro = deps.wslDistro ?? process.env.WSL_DISTRO_NAME
    this.now = deps.now ?? Date.now
    this.createToken = deps.createToken ?? randomUUID
    this.maxBytes = deps.maxBytes ?? DEFAULT_MAX_PREVIEW_BYTES
    this.tokenTtlMs = deps.tokenTtlMs ?? DEFAULT_TOKEN_TTL_MS
  }

  private nativePath(input: string): string | null {
    return mapFilePreviewPathForPlatform(input, this.platform, this.wslDistro)
  }

  private rootFromInput(input: string): RootRecord | null {
    const native = this.nativePath(input)
    if (!native || !isAbsolute(native)) return null
    return canonicalDirectory(native)
  }

  private async baseContext(projectId: string): Promise<ResolutionContext | { reason: string }> {
    const project = this.getProject(projectId)
    if (!project) return { reason: '프로젝트를 찾을 수 없습니다.' }

    const localRepoPaths = project.repoPaths.filter((root) => !isRemoteRoot(root))
    const primaryRoots = distinctRoots(
      [...localRepoPaths, ...project.vaultPaths]
        .map((root) => this.rootFromInput(root))
        .filter((root): root is RootRecord => root !== null),
    )
    const listedRoots: RootRecord[] = []
    for (const repoPath of localRepoPaths) {
      try {
        const listed = await this.listWorktrees(repoPath)
        for (const worktree of listed.worktrees) {
          const root = this.rootFromInput(worktree.path)
          if (root) listedRoots.push(root)
        }
      } catch {
        // The registered primary root remains valid; an unverified linked worktree never does.
      }
    }
    const worktreeRoots = distinctRoots(listedRoots)
    return {
      project,
      primaryRoots,
      worktreeRoots,
      roots: distinctRoots([...primaryRoots, ...worktreeRoots]),
    }
  }

  private async resolutionContext(req: Pick<FileRefsResolveReq, 'projectId' | 'activeWorktreePath' | 'sessionWorkspacePath'>): Promise<ResolutionContext | { reason: string }> {
    const base = await this.baseContext(req.projectId)
    if ('reason' in base) return base
    if (base.roots.length === 0) return { reason: '등록된 로컬 프로젝트 경로를 찾을 수 없습니다.' }

    let active: RootRecord | undefined
    if (req.activeWorktreePath) {
      const requested = this.rootFromInput(req.activeWorktreePath)
      active = requested
        ? [...base.worktreeRoots, ...base.primaryRoots].find((root) => sameCanonical(root.canonical, requested.canonical))
        : undefined
      if (!active) return { reason: '등록되지 않은 worktree 경로입니다.' }
    }

    let session: RootRecord | undefined
    if (req.sessionWorkspacePath) {
      const requested = this.rootFromInput(req.sessionWorkspacePath)
      session = requested && base.roots.some((root) => isWithin(root.canonical, requested.canonical))
        ? requested
        : undefined
      if (!session) return { reason: 'session workspace가 현재 프로젝트 범위를 벗어납니다.' }
    }

    return {
      ...base,
      roots: distinctRoots([
        ...(session ? [session] : []),
        ...(active ? [active] : []),
        ...base.primaryRoots,
      ]),
    }
  }

  private inspect(root: RootRecord, requestedPath: string): InspectionResult {
    let canonicalPath: string
    try {
      canonicalPath = realpathSync(requestedPath)
    } catch {
      return { ok: false, code: 'missing', reason: '파일이 없거나 읽을 수 없습니다.' }
    }
    if (!isWithin(root.canonical, canonicalPath)) {
      return { ok: false, code: 'outside', reason: '현재 프로젝트 범위를 벗어난 경로입니다.' }
    }

    let size: number
    try {
      const stat = statSync(canonicalPath)
      if (!stat.isFile()) return { ok: false, code: 'not-file', reason: '일반 파일만 미리 볼 수 있습니다.' }
      size = stat.size
    } catch {
      return { ok: false, code: 'unreadable', reason: '파일 정보를 읽을 수 없습니다.' }
    }
    if (size > this.maxBytes) {
      return { ok: false, code: 'oversize', reason: '미리보기 파일은 1 MiB 이하여야 합니다.' }
    }

    let buffer: Buffer
    try {
      buffer = readFileSync(canonicalPath)
    } catch {
      return { ok: false, code: 'unreadable', reason: '파일을 읽을 수 없습니다.' }
    }
    // Re-check the bytes actually read in case a file changed between stat and read.
    if (buffer.byteLength > this.maxBytes) {
      return { ok: false, code: 'oversize', reason: '미리보기 파일은 1 MiB 이하여야 합니다.' }
    }
    const content = strictUtf8(buffer)
    if (content === null) return { ok: false, code: 'encoding', reason: 'UTF-8 텍스트 파일만 미리 볼 수 있습니다.' }
    return { ok: true, inspection: { canonicalPath, requestedPath, size: buffer.byteLength, content } }
  }

  private resolveCandidate(candidate: ParsedFileReference, roots: readonly RootRecord[]):
    | { ok: true; root: RootRecord; inspection: Inspection }
    | { ok: false; reason: string } {
    if (!filePreviewKindForPath(candidate.path)) return { ok: false, reason: '지원하지 않는 파일 확장자입니다.' }
    const nativeCandidate = this.nativePath(candidate.path)
    if (!nativeCandidate) return { ok: false, reason: '현재 환경에서 해석할 수 없는 경로입니다.' }

    let lastReason = '허용된 프로젝트 경로에서 파일을 찾을 수 없습니다.'
    for (const root of roots) {
      const requestedPath = isAbsolute(nativeCandidate) ? resolve(nativeCandidate) : resolve(root.canonical, nativeCandidate)
      const inspected = this.inspect(root, requestedPath)
      if (inspected.ok) return { ok: true, root, inspection: inspected.inspection }
      lastReason = inspected.reason
      if (!['missing', 'outside'].includes(inspected.code)) return { ok: false, reason: inspected.reason }
    }
    return { ok: false, reason: lastReason }
  }

  private pruneExpiredTokens(): void {
    const now = this.now()
    for (const [token, stored] of this.tokens) {
      if (stored.expiresAt < now) this.tokens.delete(token)
    }
  }

  async resolve(req: FileRefsResolveReq): Promise<FileRefsResolveRes> {
    this.pruneExpiredTokens()
    const context = await this.resolutionContext(req)
    if ('reason' in context) {
      return {
        resolved: [],
        unresolved: req.candidates.map((candidate) => ({ candidate, reason: context.reason })),
      }
    }

    const resolved: ResolvedFileReference[] = []
    const unresolved: FileRefsResolveRes['unresolved'] = []
    for (const candidate of req.candidates) {
      const found = this.resolveCandidate(candidate, context.roots)
      if (!found.ok) {
        unresolved.push({ candidate, reason: found.reason })
        continue
      }
      const kind = filePreviewKindForPath(candidate.path)!
      const token = this.createToken()
      const displayPath = relative(found.root.canonical, found.inspection.canonicalPath).split(sep).join('/')
      const reference: ResolvedFileReference = {
        ...candidate,
        token,
        projectId: context.project.id,
        canonicalPath: found.inspection.canonicalPath,
        displayPath: displayPath || candidate.path,
        workspaceRoot: found.root.canonical,
        kind,
        size: found.inspection.size,
      }
      this.tokens.set(token, {
        projectId: context.project.id,
        reference,
        requestedPath: found.inspection.requestedPath,
        rootInput: found.root.input,
        expiresAt: this.now() + this.tokenTtlMs,
      })
      resolved.push(reference)
    }
    return { resolved, unresolved }
  }

  async read(req: FilePreviewReadReq): Promise<FilePreviewReadRes> {
    const stored = this.tokens.get(req.token)
    if (!stored || stored.projectId !== req.projectId) return { ok: false, reason: '유효하지 않은 미리보기 요청입니다.' }
    if (stored.expiresAt < this.now()) {
      this.tokens.delete(req.token)
      return { ok: false, reason: '미리보기 요청이 만료되었습니다. 경로를 다시 여세요.' }
    }

    const current = await this.baseContext(req.projectId)
    if ('reason' in current) return { ok: false, reason: current.reason }
    const root = canonicalDirectory(stored.rootInput)
    if (!root || !sameCanonical(root.canonical, stored.reference.workspaceRoot)) {
      return { ok: false, reason: '미리보기 작업 경로가 변경되었습니다.' }
    }
    if (!current.roots.some((allowed) => isWithin(allowed.canonical, root.canonical))) {
      return { ok: false, reason: '현재 프로젝트에서 더 이상 허용되지 않는 작업 경로입니다.' }
    }
    if (!filePreviewKindForPath(stored.requestedPath)) return { ok: false, reason: '지원하지 않는 파일 확장자입니다.' }

    const inspected = this.inspect(root, stored.requestedPath)
    if (!inspected.ok) return { ok: false, reason: inspected.reason }
    if (!sameCanonical(inspected.inspection.canonicalPath, stored.reference.canonicalPath)) {
      return { ok: false, reason: '미리보기 파일 경로가 변경되었습니다.' }
    }

    return {
      ok: true,
      reference: { ...stored.reference, size: inspected.inspection.size },
      content: inspected.inspection.content,
      encoding: 'utf8',
    }
  }
}
