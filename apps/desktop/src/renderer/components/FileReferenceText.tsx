import {
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  parseFileReferences,
  type FileRefsResolveReq,
  type FileRefsResolveRes,
  type ParsedFileReference,
  type ResolvedFileReference,
} from '@apc/shared'
import { api } from '../api.js'
import './file-reference.css'

export type ResolveFileReferences = (req: FileRefsResolveReq) => Promise<FileRefsResolveRes>

type ResolutionState = {
  key: string
  loading: boolean
  resolved: ResolvedFileReference[]
  unresolved: FileRefsResolveRes['unresolved']
  reason?: string
}

type ResolutionOptions = {
  text: string
  projectId?: string | null
  activeWorktreePath?: string
  sessionWorkspacePath?: string
  resolveReferences?: ResolveFileReferences
  enabled?: boolean
}

export type FileReferenceResolution = {
  candidates: ParsedFileReference[]
  resolved: ResolvedFileReference[]
  unresolved: FileRefsResolveRes['unresolved']
  loading: boolean
  reason?: string
}

const defaultResolveReferences: ResolveFileReferences = (req) => api.fileRefsResolve(req)

function referenceKey(reference: ParsedFileReference): string {
  return JSON.stringify([
    reference.start,
    reference.end,
    reference.raw,
    reference.path,
    reference.line ?? null,
    reference.column ?? null,
    reference.form,
  ])
}

function resolutionKey(options: ResolutionOptions): string {
  return JSON.stringify([
    options.enabled !== false,
    options.projectId ?? null,
    options.activeWorktreePath ?? null,
    options.sessionWorkspacePath ?? null,
    options.text,
  ])
}

/** Resolve every path in one renderer request and discard responses from an earlier scope. */
export function useResolvedFileReferences(options: ResolutionOptions): FileReferenceResolution {
  const {
    text,
    projectId,
    activeWorktreePath,
    sessionWorkspacePath,
    resolveReferences = defaultResolveReferences,
    enabled = true,
  } = options
  const candidates = useMemo(() => parseFileReferences(text), [text])
  const key = resolutionKey(options)
  const generation = useRef(0)
  const [state, setState] = useState<ResolutionState>({
    key,
    loading: false,
    resolved: [],
    unresolved: [],
  })

  useEffect(() => {
    const currentGeneration = ++generation.current
    if (!enabled || !projectId || candidates.length === 0) {
      setState({ key, loading: false, resolved: [], unresolved: [] })
      return
    }

    setState({ key, loading: true, resolved: [], unresolved: [] })
    void resolveReferences({
      projectId,
      ...(activeWorktreePath ? { activeWorktreePath } : {}),
      ...(sessionWorkspacePath ? { sessionWorkspacePath } : {}),
      candidates,
    }).then((response) => {
      if (generation.current !== currentGeneration) return
      const expected = new Set(candidates.map(referenceKey))
      const resolved = response.resolved.filter((reference) => (
        reference.projectId === projectId && expected.has(referenceKey(reference))
      ))
      const unresolved = response.unresolved.filter(({ candidate }) => expected.has(referenceKey(candidate)))
      const accountedFor = new Set([
        ...resolved.map(referenceKey),
        ...unresolved.map(({ candidate }) => referenceKey(candidate)),
      ])
      for (const candidate of candidates) {
        if (!accountedFor.has(referenceKey(candidate))) {
          unresolved.push({ candidate, reason: '파일 경로 검증 결과를 확인하지 못했습니다.' })
        }
      }
      setState({
        key,
        loading: false,
        // The main process is authoritative, but retain only entries that correspond to this exact batch.
        resolved,
        unresolved,
      })
    }).catch(() => {
      if (generation.current !== currentGeneration) return
      setState({
        key,
        loading: false,
        resolved: [],
        unresolved: [],
        reason: '파일 경로를 확인하지 못했습니다.',
      })
    })

    return () => { generation.current += 1 }
  }, [activeWorktreePath, candidates, enabled, key, projectId, resolveReferences, sessionWorkspacePath])

  if (state.key !== key) {
    return { candidates, resolved: [], unresolved: [], loading: Boolean(enabled && projectId && candidates.length) }
  }
  return { candidates, ...state }
}

type Props = ResolutionOptions & {
  className?: string
  onOpenReference: (reference: ResolvedFileReference) => void
}

function FileReferenceControl({
  reference,
  onOpenReference,
}: {
  reference: ResolvedFileReference
  onOpenReference: (reference: ResolvedFileReference) => void
}) {
  const open = () => onOpenReference(reference)
  const onClick = (event: ReactMouseEvent<HTMLSpanElement>) => {
    if (!event.ctrlKey && !event.metaKey) return
    event.preventDefault()
    event.stopPropagation()
    open()
  }
  const onKeyDown = (event: ReactKeyboardEvent<HTMLSpanElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    event.stopPropagation()
    open()
  }

  return (
    <span
      role="link"
      tabIndex={0}
      className="file-reference-text__control"
      aria-label={`${reference.raw} 파일 미리보기`}
      title={`${reference.displayPath} · Ctrl/Cmd+클릭 또는 Enter로 미리보기`}
      onClick={onClick}
      onKeyDown={onKeyDown}
    >
      {reference.raw}
    </span>
  )
}

function resolutionNotice(resolution: FileReferenceResolution): string | undefined {
  if (resolution.reason) return resolution.reason
  const reasons = [...new Set(resolution.unresolved.map((item) => item.reason))]
  if (reasons.length === 0) return undefined
  return reasons.length === 1
    ? `파일 미리보기를 열 수 없습니다: ${reasons[0]}`
    : `파일 ${resolution.unresolved.length}개를 미리 볼 수 없습니다: ${reasons[0]}`
}

export function FileReferenceText({
  text,
  projectId,
  activeWorktreePath,
  sessionWorkspacePath,
  resolveReferences,
  enabled = true,
  className,
  onOpenReference,
}: Props) {
  const resolution = useResolvedFileReferences({
    text,
    projectId,
    activeWorktreePath,
    sessionWorkspacePath,
    resolveReferences,
    enabled,
  })
  const resolvedByRange = new Map(resolution.resolved.map((reference) => [referenceKey(reference), reference]))
  const content: ReactNode[] = []
  let cursor = 0

  for (const candidate of resolution.candidates) {
    if (candidate.start > cursor) content.push(text.slice(cursor, candidate.start))
    const reference = resolvedByRange.get(referenceKey(candidate))
    content.push(reference
      ? <FileReferenceControl key={referenceKey(candidate)} reference={reference} onOpenReference={onOpenReference} />
      : candidate.raw)
    cursor = candidate.end
  }
  if (cursor < text.length) content.push(text.slice(cursor))
  if (content.length === 0) content.push(text)

  const notice = resolutionNotice(resolution)
  return (
    <span className={className ? `file-reference-text ${className}` : 'file-reference-text'}>
      <span className="file-reference-text__source">{content}</span>
      {resolution.loading && resolution.candidates.length > 0 && (
        <span className="file-reference-text__notice" role="status">파일 경로 확인 중…</span>
      )}
      {notice && <span className="file-reference-text__notice" role="status">{notice}</span>}
    </span>
  )
}
