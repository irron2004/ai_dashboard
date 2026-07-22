import type { ClipboardReadTextRes } from '../shared/ipc-contract.js'

export const TERMINAL_PASTE_MAX_BYTES = 1024 * 1024

export type TerminalNotice = {
  kind: 'info' | 'warning' | 'error'
  message: string
}

export type PasteKeyEvent = Pick<KeyboardEvent, 'type' | 'key' | 'ctrlKey' | 'shiftKey' | 'metaKey' | 'altKey'>

export function isTerminalPasteShortcut(event: PasteKeyEvent, platform = ''): boolean {
  if (event.type !== 'keydown' || event.altKey) return false
  const key = event.key.toLowerCase()
  if (event.shiftKey && key === 'insert') return true
  if (event.ctrlKey && key === 'v') return true
  return (platform.toLowerCase().includes('mac') || event.metaKey) && event.metaKey && key === 'v'
}

export function multilinePasteMessage(text: string): string {
  const lines = text.split(/\r\n|\r|\n/)
  const preview = lines.slice(0, 6).join('\n').slice(0, 600)
  const suffix = lines.length > 6 || preview.length < text.length ? '\n…' : ''
  return `여러 줄(${lines.length}줄)을 terminal에 붙여넣을까요?\n\n${preview}${suffix}`
}

type ControllerDeps = {
  readClipboard: () => Promise<ClipboardReadTextRes>
  writeClipboard: (text: string) => Promise<void>
  paste: (text: string) => void
  bracketedPasteEnabled: () => boolean
  confirmMultiline: (text: string) => boolean | Promise<boolean>
  onNotice: (notice: TerminalNotice) => void
  maxBytes?: number
}

/** User-gesture clipboard boundary. Clipboard content is never logged or copied into notices. */
export class TerminalPasteController {
  private pending = false
  private disposed = false
  private readonly maxBytes: number

  constructor(private readonly deps: ControllerDeps) {
    this.maxBytes = deps.maxBytes ?? TERMINAL_PASTE_MAX_BYTES
  }

  async requestPaste(): Promise<boolean> {
    if (this.pending || this.disposed) return false
    this.pending = true
    try {
      const result = await this.deps.readClipboard()
      if (this.disposed) return false
      if (!result.ok) {
        this.deps.onNotice({ kind: 'error', message: this.readFailureMessage(result.reason) })
        return false
      }
      const text = result.text ?? ''
      if (text.length === 0) {
        this.deps.onNotice({ kind: 'warning', message: '클립보드가 비어 있습니다.' })
        return false
      }
      if (new TextEncoder().encode(text).byteLength > this.maxBytes) {
        this.deps.onNotice({ kind: 'error', message: '붙여넣을 텍스트가 너무 큽니다.' })
        return false
      }
      if (/\r|\n/.test(text) && !this.deps.bracketedPasteEnabled()) {
        const confirmed = await this.deps.confirmMultiline(text)
        if (this.disposed) return false
        if (!confirmed) {
          this.deps.onNotice({ kind: 'warning', message: '여러 줄 붙여넣기를 취소했습니다.' })
          return false
        }
      }
      this.deps.paste(text)
      this.deps.onNotice({ kind: 'info', message: '클립보드 내용을 붙여넣었습니다.' })
      return true
    } catch {
      if (!this.disposed) this.deps.onNotice({ kind: 'error', message: '클립보드를 읽지 못했습니다.' })
      return false
    } finally {
      this.pending = false
    }
  }

  async requestCopy(text: string): Promise<boolean> {
    if (this.disposed) return false
    if (!text) {
      this.deps.onNotice({ kind: 'warning', message: '복사할 terminal 선택 영역이 없습니다.' })
      return false
    }
    try {
      await this.deps.writeClipboard(text)
      if (!this.disposed) this.deps.onNotice({ kind: 'info', message: '선택한 텍스트를 복사했습니다.' })
      return !this.disposed
    } catch {
      if (!this.disposed) this.deps.onNotice({ kind: 'error', message: '클립보드에 복사하지 못했습니다.' })
      return false
    }
  }

  handleKey(event: PasteKeyEvent, platform = ''): boolean {
    if (!isTerminalPasteShortcut(event, platform)) return true
    void this.requestPaste()
    return false
  }

  dispose(): void {
    this.disposed = true
  }

  private readFailureMessage(reason: string | undefined): string {
    if (reason === 'permission-denied') return '클립보드 읽기 권한이 거부되었습니다.'
    if (reason === 'clipboard-empty') return '클립보드가 비어 있습니다.'
    if (reason === 'clipboard-too-large') return '붙여넣을 텍스트가 너무 큽니다.'
    return '클립보드를 읽지 못했습니다.'
  }
}
