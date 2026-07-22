import {
  type CSSProperties,
  type MouseEventHandler,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useRef,
  useState,
} from 'react'
import type {
  FilePreviewReadReq,
  FilePreviewReadRes,
  ResolvedFileReference,
} from '@apc/shared'
import { api } from '../api.js'
import { MarkdownContent } from './MarkdownContent.js'
import { PythonCodePreview } from './PythonCodePreview.js'
import { SandboxedHtmlPreview } from './SandboxedHtmlPreview.js'
import './file-preview.css'

export const FILE_PREVIEW_WIDTH_KEY = 'apc:file-preview-width'
const MIN_WIDTH = 280
const MAX_WIDTH = 720
const DEFAULT_WIDTH = 420

type Props = {
  reference: ResolvedFileReference | null
  onClose: () => void
  onOpenLocalPath?: (path: string) => void
  readPreview?: (req: FilePreviewReadReq) => Promise<FilePreviewReadRes>
}

type LoadedPreview = Extract<FilePreviewReadRes, { ok: true }>
type ResizeState = { startX: number; startWidth: number }

const defaultReadPreview = (req: FilePreviewReadReq) => api.filePreviewRead(req)

function clampWidth(value: number): number {
  return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(value)))
}

function readStoredWidth(): number {
  try {
    const parsed = Number(window.localStorage.getItem(FILE_PREVIEW_WIDTH_KEY))
    return Number.isFinite(parsed) && parsed > 0 ? clampWidth(parsed) : DEFAULT_WIDTH
  } catch {
    return DEFAULT_WIDTH
  }
}

function storeWidth(value: number): void {
  try { window.localStorage.setItem(FILE_PREVIEW_WIDTH_KEY, String(clampWidth(value))) } catch { /* preference is best-effort */ }
}

function isLocalMarkdownTarget(target: string): boolean {
  return !target.startsWith('#')
    && !target.startsWith('//')
    && !/^[A-Za-z][A-Za-z\d+.-]*:/u.test(target)
}

function PreviewBody({ preview, onOpenLocalPath }: { preview: LoadedPreview; onOpenLocalPath?: (path: string) => void }) {
  const { reference, content } = preview
  const onMarkdownClick: MouseEventHandler<HTMLDivElement> = (event) => {
    const element = event.target instanceof Element ? event.target.closest('a') : null
    const target = element?.getAttribute('href')
    if (!target || !isLocalMarkdownTarget(target) || !onOpenLocalPath) return
    event.preventDefault()
    onOpenLocalPath(target)
  }

  if (reference.kind === 'python') {
    return <PythonCodePreview code={content} targetLine={reference.line} />
  }
  if (reference.kind === 'html') {
    return <SandboxedHtmlPreview html={content} targetLine={reference.line} />
  }
  return (
    <div className="file-preview-panel__markdown markdown-viewer__body" onClick={onMarkdownClick}>
      <MarkdownContent
        markdown={content}
        onOpenWikiLink={(target) => onOpenLocalPath?.(target)}
      />
    </div>
  )
}

export function FilePreviewPanel({
  reference,
  onClose,
  onOpenLocalPath,
  readPreview = defaultReadPreview,
}: Props) {
  const [width, setWidth] = useState(readStoredWidth)
  const [resize, setResize] = useState<ResizeState | null>(null)
  const [preview, setPreview] = useState<LoadedPreview | null>(null)
  const [loading, setLoading] = useState(false)
  const [reason, setReason] = useState<string | null>(null)
  const requestGeneration = useRef(0)
  const widthRef = useRef(width)
  widthRef.current = width

  useEffect(() => {
    const generation = ++requestGeneration.current
    setPreview(null)
    setReason(null)
    if (!reference) {
      setLoading(false)
      return
    }
    setLoading(true)
    void readPreview({ projectId: reference.projectId, token: reference.token }).then((result) => {
      if (requestGeneration.current !== generation) return
      if (result.ok) setPreview(result)
      else setReason(result.reason)
    }).catch(() => {
      if (requestGeneration.current === generation) setReason('파일 미리보기를 불러오지 못했습니다.')
    }).finally(() => {
      if (requestGeneration.current === generation) setLoading(false)
    })
    return () => { requestGeneration.current += 1 }
  }, [readPreview, reference?.projectId, reference?.token])

  useEffect(() => {
    if (!reference) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose, reference])

  useEffect(() => {
    if (!resize) return
    const onPointerMove = (event: PointerEvent) => {
      setWidth(clampWidth(resize.startWidth + resize.startX - event.clientX))
    }
    const finish = () => {
      storeWidth(widthRef.current)
      setResize(null)
    }
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', finish, { once: true })
    window.addEventListener('pointercancel', finish, { once: true })
    return () => {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', finish)
      window.removeEventListener('pointercancel', finish)
    }
  }, [resize])

  if (!reference) return null
  const shownReference = preview?.reference ?? reference
  const style = { '--file-preview-width': `${width}px` } as CSSProperties

  const startResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    setResize({ startX: event.clientX, startWidth: widthRef.current })
  }
  const resizeByKeyboard = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    const direction = event.key === 'ArrowLeft' ? 1 : -1
    const next = clampWidth(widthRef.current + direction * 16)
    setWidth(next)
    storeWidth(next)
  }

  return (
    <aside
      className={`file-preview-panel${resize ? ' file-preview-panel--resizing' : ''}`}
      role="complementary"
      aria-label="파일 미리보기"
      style={style}
    >
      <div
        className="file-preview-panel__resize"
        role="separator"
        aria-label="미리보기 너비 조절"
        aria-orientation="vertical"
        aria-valuemin={MIN_WIDTH}
        aria-valuemax={MAX_WIDTH}
        aria-valuenow={width}
        tabIndex={0}
        onPointerDown={startResize}
        onKeyDown={resizeByKeyboard}
      />
      <header className="file-preview-panel__header">
        <div>
          <h2 title={shownReference.canonicalPath}>{shownReference.displayPath}</h2>
          <p title={shownReference.workspaceRoot}>{shownReference.workspaceRoot}</p>
        </div>
        <span>{shownReference.kind}</span>
        <button type="button" onClick={onClose} aria-label="파일 미리보기 닫기">✕</button>
      </header>
      <div className="file-preview-panel__meta">
        <span>{shownReference.size.toLocaleString()} bytes</span>
        {shownReference.line && (
          <span>line {shownReference.line}{shownReference.column ? `:${shownReference.column}` : ''}</span>
        )}
      </div>
      <div className="file-preview-panel__content" aria-live="polite">
        {loading && <div className="file-preview-panel__state">불러오는 중…</div>}
        {!loading && reason && <div className="file-preview-panel__state file-preview-panel__state--error" role="alert">{reason}</div>}
        {!loading && !reason && preview && <PreviewBody preview={preview} onOpenLocalPath={onOpenLocalPath} />}
      </div>
    </aside>
  )
}
