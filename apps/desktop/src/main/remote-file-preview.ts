import { randomUUID } from 'node:crypto'
import { posix } from 'node:path'
import { TextDecoder } from 'node:util'
import type {
  FilePreviewKind,
  FilePreviewReadReq,
  FilePreviewReadRes,
  FileRefsResolveReq,
  FileRefsResolveRes,
  ParsedFileReference,
  Project,
  ResolvedFileReference,
} from '@apc/shared'
import { filePreviewKindForPath } from '@apc/shared'
import { parseSsh, sshExec, type SshExec, type SshTarget } from './ssh-exec.js'

export const REMOTE_PREVIEW_MARKER = '@@APCPREVIEW@@'
export const REMOTE_PREVIEW_END_MARKER = '@@APCPREVIEWEND@@'
const REMOTE_PREVIEW_TIMEOUT_MS = 20_000
const REMOTE_PREVIEW_MAX_BYTES = 1024 * 1024
const REMOTE_PREVIEW_TOKEN_TTL_MS = 60_000

type RemotePreviewPayload = {
  version: 1
  root: string
  bases: string[]
  items: Array<{ id: string; path: string }>
}

export type RemotePreviewBlock =
  | {
      id: string
      ok: true
      canonicalPath: string
      workspaceRoot: string
      size: number
      kind: FilePreviewKind
      content: string
    }
  | { id: string; ok: false; error: string }

type RemoteContext = { registeredPath: string; target: SshTarget; bases: string[] }
type StoredRemoteToken = {
  projectId: string
  reference: ResolvedFileReference
  candidate: ParsedFileReference
  context: RemoteContext
  expiresAt: number
}

export type RemoteFilePreviewServiceDeps = {
  getProject(projectId: string): Project | undefined
  exec?: SshExec
  now?: () => number
  createToken?: () => string
  tokenTtlMs?: number
}

const REMOTE_PREVIEW_PYTHON = String.raw`import base64, json, os, stat

MARKER = "@@APCPREVIEW@@"
END = "@@APCPREVIEWEND@@"
MAX_BYTES = 1048576

def emit(meta, data=b""):
    header = base64.b64encode(json.dumps(meta, ensure_ascii=False, separators=(",", ":")).encode("utf-8")).decode("ascii")
    print(MARKER + header)
    if data:
        print(base64.b64encode(data).decode("ascii"))
    print(END)

def inside(root, target):
    try:
        root_case = os.path.normcase(root)
        target_case = os.path.normcase(target)
        return os.path.commonpath([root_case, target_case]) == root_case
    except (ValueError, OSError):
        return False

def kind_for(path):
    lower = path.lower()
    if lower.endswith((".md", ".mdx", ".markdown")):
        return "markdown"
    if lower.endswith((".html", ".htm")):
        return "html"
    if lower.endswith(".py"):
        return "python"
    return None

try:
    payload = json.loads(base64.b64decode(os.environ["APC_PREVIEW_PAYLOAD_B64"]).decode("utf-8"))
    items = payload.get("items", [])
except Exception:
    payload = {}
    items = []

try:
    raw_root = payload["root"]
    root = os.path.realpath(raw_root)
    if not isinstance(raw_root, str) or not os.path.isdir(root):
        raise ValueError("root")
    bases = []
    for raw_base in payload.get("bases", []):
        if not isinstance(raw_base, str):
            raise ValueError("base")
        base = os.path.realpath(raw_base)
        if not os.path.isdir(base) or not inside(root, base):
            raise ValueError("base")
        if base not in bases:
            bases.append(base)
    if root not in bases:
        bases.append(root)
except Exception:
    for item in items:
        emit({"id": str(item.get("id", "")), "ok": False, "error": "invalid_context"})
    raise SystemExit(0)

for item in items:
    item_id = str(item.get("id", ""))
    path = item.get("path")
    if not isinstance(path, str) or not path or "\x00" in path:
        emit({"id": item_id, "ok": False, "error": "invalid_path"})
        continue
    kind = kind_for(path)
    if kind is None:
        emit({"id": item_id, "ok": False, "error": "extension"})
        continue

    selected = None
    escaped = False
    for base in bases:
        requested = path if os.path.isabs(path) else os.path.join(base, path)
        real = os.path.realpath(requested)
        if not inside(base, real):
            escaped = True
            continue
        if not os.path.exists(real):
            continue
        selected = (base, real)
        break
    if selected is None:
        emit({"id": item_id, "ok": False, "error": "outside" if escaped else "missing"})
        continue

    base, real = selected
    try:
        flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0)
        descriptor = os.open(real, flags)
        try:
            info = os.fstat(descriptor)
            if not stat.S_ISREG(info.st_mode):
                emit({"id": item_id, "ok": False, "error": "not_file"})
                continue
            if info.st_size > MAX_BYTES:
                emit({"id": item_id, "ok": False, "error": "oversize"})
                continue
            with os.fdopen(descriptor, "rb", closefd=False) as handle:
                data = handle.read(MAX_BYTES + 1)
            if len(data) > MAX_BYTES:
                emit({"id": item_id, "ok": False, "error": "oversize"})
                continue
            try:
                data.decode("utf-8", errors="strict")
            except UnicodeDecodeError:
                emit({"id": item_id, "ok": False, "error": "encoding"})
                continue
            emit({
                "id": item_id,
                "ok": True,
                "canonicalPath": real,
                "workspaceRoot": base,
                "size": len(data),
                "kind": kind,
            }, data)
        finally:
            os.close(descriptor)
    except OSError:
        emit({"id": item_id, "ok": False, "error": "unreadable"})`

/** The only dynamic shell fragment is a base64 alphabet string; raw paths never enter shell syntax. */
export function buildRemotePreviewScript(payload: RemotePreviewPayload): string {
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64')
  return [
    `APC_PREVIEW_PAYLOAD_B64='${encoded}'`,
    'export APC_PREVIEW_PAYLOAD_B64',
    'command -v python3 >/dev/null 2>&1 || exit 127',
    "python3 - <<'APC_PREVIEW_PY'",
    REMOTE_PREVIEW_PYTHON,
    'APC_PREVIEW_PY',
  ].join('\n')
}

function decodeHeader(value: string): Record<string, unknown> | null {
  try {
    const decoded = Buffer.from(value, 'base64').toString('utf8')
    const parsed = JSON.parse(decoded) as unknown
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null
  } catch {
    return null
  }
}

function decodeContent(lines: readonly string[]): { content: string; size: number } | null {
  try {
    const bytes = Buffer.from(lines.join(''), 'base64')
    if (bytes.byteLength > REMOTE_PREVIEW_MAX_BYTES) return null
    return {
      content: new TextDecoder('utf-8', { fatal: true }).decode(bytes),
      size: bytes.byteLength,
    }
  } catch {
    return null
  }
}

/** Parses collision-free metadata/content blocks while ignoring unrelated SSH banner output. */
export function parseRemotePreviewBlocks(stdout: string): RemotePreviewBlock[] {
  const blocks: RemotePreviewBlock[] = []
  let metadata: Record<string, unknown> | null = null
  let content: string[] = []

  for (const rawLine of stdout.split('\n')) {
    const line = rawLine.replace(/\r$/u, '')
    if (line.startsWith(REMOTE_PREVIEW_MARKER)) {
      metadata = decodeHeader(line.slice(REMOTE_PREVIEW_MARKER.length))
      content = []
      continue
    }
    if (line === REMOTE_PREVIEW_END_MARKER) {
      if (metadata && typeof metadata.id === 'string' && typeof metadata.ok === 'boolean') {
        if (metadata.ok === false && typeof metadata.error === 'string') {
          blocks.push({ id: metadata.id, ok: false, error: metadata.error })
        } else if (
          metadata.ok === true
          && typeof metadata.canonicalPath === 'string'
          && typeof metadata.workspaceRoot === 'string'
          && typeof metadata.size === 'number'
          && Number.isSafeInteger(metadata.size)
          && metadata.size >= 0
          && ['markdown', 'html', 'python'].includes(String(metadata.kind))
        ) {
          const decoded = decodeContent(content)
          if (decoded !== null && decoded.size === metadata.size) {
            blocks.push({
              id: metadata.id,
              ok: true,
              canonicalPath: metadata.canonicalPath,
              workspaceRoot: metadata.workspaceRoot,
              size: metadata.size,
              kind: metadata.kind as FilePreviewKind,
              content: decoded.content,
            })
          }
        }
      }
      metadata = null
      content = []
      continue
    }
    if (metadata) content.push(line.trim())
  }
  return blocks
}

const REMOTE_ERROR_REASON: Record<string, string> = {
  invalid_context: 'SSH workspace가 등록된 프로젝트 범위를 벗어납니다.',
  invalid_path: '원격 파일 경로가 올바르지 않습니다.',
  extension: '지원하지 않는 파일 확장자입니다.',
  outside: '현재 SSH 프로젝트 범위를 벗어난 경로입니다.',
  missing: '원격 파일이 없거나 읽을 수 없습니다.',
  not_file: '일반 파일만 미리 볼 수 있습니다.',
  oversize: '미리보기 파일은 1 MiB 이하여야 합니다.',
  encoding: 'UTF-8 텍스트 파일만 미리 볼 수 있습니다.',
  unreadable: '원격 파일을 읽을 수 없습니다.',
}

function remoteReason(code: string): string {
  return REMOTE_ERROR_REASON[code] ?? '원격 파일을 확인하지 못했습니다.'
}

function sameAuthority(left: SshTarget, right: SshTarget): boolean {
  return left.user === right.user
    && left.host.toLowerCase() === right.host.toLowerCase()
    && left.port === right.port
}

function sameRegisteredTarget(left: SshTarget, right: SshTarget): boolean {
  return sameAuthority(left, right) && left.path === right.path
}

function registeredTargets(project: Project): Array<{ registeredPath: string; target: SshTarget }> {
  const targets: Array<{ registeredPath: string; target: SshTarget }> = []
  for (const registeredPath of [...project.repoPaths, ...project.vaultPaths]) {
    const target = parseSsh(registeredPath)
    if (!target || targets.some((current) => sameRegisteredTarget(current.target, target))) continue
    targets.push({ registeredPath, target })
  }
  return targets
}

function hintTarget(hint: string | undefined, targets: readonly { target: SshTarget }[]):
  | { target?: SshTarget; path?: string }
  | { reason: string } {
  if (!hint) return {}
  const parsed = parseSsh(hint)
  if (parsed) {
    const registered = targets.find((entry) => sameAuthority(entry.target, parsed))
    return registered
      ? { target: registered.target, path: parsed.path }
      : { reason: '등록된 SSH host가 아닌 경로입니다.' }
  }
  if (/^[A-Za-z][A-Za-z\d+.-]*:\/\//u.test(hint)) return { reason: '등록된 SSH host가 아닌 경로입니다.' }
  return { path: hint }
}

export class RemoteFilePreviewService {
  private readonly getProject: RemoteFilePreviewServiceDeps['getProject']
  private readonly exec: SshExec
  private readonly now: () => number
  private readonly createToken: () => string
  private readonly tokenTtlMs: number
  private readonly tokens = new Map<string, StoredRemoteToken>()

  constructor(deps: RemoteFilePreviewServiceDeps) {
    this.getProject = deps.getProject
    this.exec = deps.exec ?? sshExec
    this.now = deps.now ?? Date.now
    this.createToken = deps.createToken ?? randomUUID
    this.tokenTtlMs = deps.tokenTtlMs ?? REMOTE_PREVIEW_TOKEN_TTL_MS
  }

  private contexts(req: Pick<FileRefsResolveReq, 'projectId' | 'activeWorktreePath' | 'sessionWorkspacePath'>):
    | { contexts: RemoteContext[] }
    | { reason: string } {
    const project = this.getProject(req.projectId)
    if (!project) return { reason: '프로젝트를 찾을 수 없습니다.' }
    const targets = registeredTargets(project)
    if (targets.length === 0) return { reason: '등록된 SSH 프로젝트 경로가 없습니다.' }
    const active = hintTarget(req.activeWorktreePath, targets)
    if ('reason' in active) return active
    const session = hintTarget(req.sessionWorkspacePath, targets)
    if ('reason' in session) return session
    if (active.target && session.target && !sameAuthority(active.target, session.target)) {
      return { reason: '서로 다른 SSH host의 workspace 힌트를 함께 사용할 수 없습니다.' }
    }
    const selectedTarget = session.target ?? active.target
    const selected = selectedTarget
      ? targets.filter((entry) => sameAuthority(entry.target, selectedTarget))
      : targets

    return {
      contexts: selected.map(({ registeredPath, target }) => {
        const normalizeHint = (path: string | undefined) => path
          ? (posix.isAbsolute(path) ? path : posix.resolve(target.path, path))
          : undefined
        const sessionPath = normalizeHint(session.path)
        const activePath = normalizeHint(active.path)
        return {
          registeredPath,
          target,
          bases: [sessionPath, activePath, target.path].filter((path, index, all): path is string => (
            Boolean(path) && all.indexOf(path) === index
          )),
        }
      }),
    }
  }

  private async runBatch(context: RemoteContext, items: RemotePreviewPayload['items']): Promise<
    | { ok: true; blocks: RemotePreviewBlock[] }
    | { ok: false; reason: string }
  > {
    const result = await this.exec(context.target, 'bash -s', {
      stdin: buildRemotePreviewScript({ version: 1, root: context.target.path, bases: context.bases, items }),
      timeoutMs: REMOTE_PREVIEW_TIMEOUT_MS,
    })
    if (!result.ok) {
      return {
        ok: false,
        reason: /timeout|timed out/iu.test(result.stderr)
          ? 'SSH 미리보기 응답 시간이 초과되었습니다.'
          : 'SSH 파일을 읽지 못했습니다. 연결 상태를 확인하세요.',
      }
    }
    return { ok: true, blocks: parseRemotePreviewBlocks(result.stdout) }
  }

  private pruneExpired(): void {
    const now = this.now()
    for (const [token, stored] of this.tokens) if (stored.expiresAt < now) this.tokens.delete(token)
  }

  async resolve(req: FileRefsResolveReq): Promise<FileRefsResolveRes> {
    this.pruneExpired()
    const prepared = this.contexts(req)
    if ('reason' in prepared) {
      return { resolved: [], unresolved: req.candidates.map((candidate) => ({ candidate, reason: prepared.reason })) }
    }

    const pending = new Set<number>()
    const reasons = new Map<number, string>()
    const successes = new Map<number, { block: Extract<RemotePreviewBlock, { ok: true }>; context: RemoteContext }>()
    req.candidates.forEach((candidate, index) => {
      const kind = filePreviewKindForPath(candidate.path)
      if (!kind) reasons.set(index, '지원하지 않는 파일 확장자입니다.')
      else if (parseSsh(candidate.path) || /^[A-Za-z][A-Za-z\d+.-]*:\/\//u.test(candidate.path)) {
        reasons.set(index, '파일 경로에 별도 SSH host를 지정할 수 없습니다.')
      } else pending.add(index)
    })

    for (const context of prepared.contexts) {
      if (pending.size === 0) break
      const batch = await this.runBatch(context, [...pending].map((index) => ({ id: String(index), path: req.candidates[index]!.path })))
      if (!batch.ok) {
        for (const index of pending) if (!reasons.has(index)) reasons.set(index, batch.reason)
        continue
      }
      const byId = new Map(batch.blocks.map((block) => [block.id, block]))
      for (const index of [...pending]) {
        const block = byId.get(String(index))
        if (!block) {
          if (!reasons.has(index)) reasons.set(index, 'SSH 미리보기 응답을 확인하지 못했습니다.')
          continue
        }
        if (!block.ok) {
          if (!reasons.has(index)) reasons.set(index, remoteReason(block.error))
          continue
        }
        const expectedKind = filePreviewKindForPath(req.candidates[index]!.path)
        const relativePath = posix.relative(block.workspaceRoot, block.canonicalPath)
        const safeMetadata = expectedKind === block.kind
          && block.size <= REMOTE_PREVIEW_MAX_BYTES
          && relativePath !== '..'
          && !relativePath.startsWith('../')
          && !posix.isAbsolute(relativePath)
        if (!safeMetadata) {
          reasons.set(index, 'SSH 미리보기 응답의 파일 범위가 올바르지 않습니다.')
          continue
        }
        successes.set(index, { block, context })
        pending.delete(index)
      }
    }

    const resolved: ResolvedFileReference[] = []
    const unresolved: FileRefsResolveRes['unresolved'] = []
    req.candidates.forEach((candidate, index) => {
      const success = successes.get(index)
      if (!success) {
        unresolved.push({ candidate, reason: reasons.get(index) ?? '등록된 SSH 프로젝트에서 파일을 찾을 수 없습니다.' })
        return
      }
      const token = this.createToken()
      const displayPath = posix.relative(success.block.workspaceRoot, success.block.canonicalPath) || candidate.path
      const reference: ResolvedFileReference = {
        ...candidate,
        token,
        projectId: req.projectId,
        canonicalPath: success.block.canonicalPath,
        displayPath,
        workspaceRoot: success.block.workspaceRoot,
        kind: success.block.kind,
        size: success.block.size,
      }
      this.tokens.set(token, {
        projectId: req.projectId,
        reference,
        candidate,
        context: success.context,
        expiresAt: this.now() + this.tokenTtlMs,
      })
      resolved.push(reference)
    })
    return { resolved, unresolved }
  }

  async read(req: FilePreviewReadReq): Promise<FilePreviewReadRes> {
    const stored = this.tokens.get(req.token)
    if (!stored || stored.projectId !== req.projectId) return { ok: false, reason: '유효하지 않은 미리보기 요청입니다.' }
    if (stored.expiresAt < this.now()) {
      this.tokens.delete(req.token)
      return { ok: false, reason: '미리보기 요청이 만료되었습니다. 경로를 다시 여세요.' }
    }
    const project = this.getProject(req.projectId)
    const stillRegistered = project && registeredTargets(project)
      .some(({ target }) => sameRegisteredTarget(target, stored.context.target))
    if (!stillRegistered) return { ok: false, reason: '등록된 SSH 프로젝트 경로가 변경되었습니다.' }

    const result = await this.runBatch(stored.context, [{ id: 'read', path: stored.candidate.path }])
    if (!result.ok) return { ok: false, reason: result.reason }
    const block = result.blocks.find((candidate) => candidate.id === 'read')
    if (!block) return { ok: false, reason: 'SSH 미리보기 응답을 확인하지 못했습니다.' }
    if (!block.ok) return { ok: false, reason: remoteReason(block.error) }
    if (
      block.canonicalPath !== stored.reference.canonicalPath
      || block.workspaceRoot !== stored.reference.workspaceRoot
      || block.kind !== stored.reference.kind
      || block.size > REMOTE_PREVIEW_MAX_BYTES
    ) return { ok: false, reason: '원격 미리보기 파일 경로가 변경되었습니다.' }

    return {
      ok: true,
      reference: { ...stored.reference, size: block.size },
      content: block.content,
      encoding: 'utf8',
    }
  }
}
