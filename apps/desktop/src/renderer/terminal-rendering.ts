import type { ITerminalAddon } from '@xterm/xterm'

export const TERMINAL_FONT_FAMILIES = [
  'Cascadia Mono',
  'D2Coding',
  'Noto Sans Mono CJK KR',
  'NanumGothicCoding',
  'Consolas',
] as const

export const DEFAULT_TERMINAL_FONT_FAMILY = TERMINAL_FONT_FAMILIES
  .map((family) => `"${family}"`)
  .concat('monospace')
  .join(', ')

export const TERMINAL_FONT_SAMPLE = '한글 ┌─┬─┐'

/** Golden strings used for manual tmux capture and Unicode cell-width regression checks. */
export const TMUX_UNICODE_FIXTURE = [
  { text: '한글 ABC', cells: 8 },
  { text: '┌─┬─┐', cells: 5 },
  { text: '│😀│', cells: 4 },
] as const

type UnicodeTerminal = {
  loadAddon(addon: ITerminalAddon): void
  unicode: { activeVersion: string }
}

export function activateUnicode11(
  terminal: UnicodeTerminal,
  addon: ITerminalAddon,
): void {
  terminal.loadAddon(addon)
  terminal.unicode.activeVersion = '11'
}

export type TerminalFontProbeResult = {
  installed: boolean
  glyphs: boolean
}

export type TerminalFontProbe = (family: string, sample: string) => TerminalFontProbeResult

export type TerminalFontDiagnostic = {
  status: 'ready' | 'fallback' | 'missing-glyph'
  fontFamily: string
  selectedFamily?: string
  unicodeVersion: '11'
  warnings: string[]
}

export function terminalFontCandidates(fontFamily: string): string[] {
  const matches = fontFamily.match(/"[^"]+"|'[^']+'|[^,]+/g) ?? []
  const candidates = matches
    .map((family) => family.trim().replace(/^(?:"([^"]+)"|'([^']+)')$/, '$1$2'))
    .filter((family) => family.length > 0 && !/^(?:monospace|serif|sans-serif)$/i.test(family))
  return candidates.length > 0 ? candidates : [...TERMINAL_FONT_FAMILIES]
}

export function inspectTerminalFonts(
  probe: TerminalFontProbe,
  fontFamily = DEFAULT_TERMINAL_FONT_FAMILY,
  candidates: readonly string[] = terminalFontCandidates(fontFamily),
): TerminalFontDiagnostic {
  let installedFallback: string | undefined
  const missingGlyphFamilies: string[] = []

  for (const family of candidates) {
    const result = probe(family, TERMINAL_FONT_SAMPLE)
    if (!result.installed) continue
    installedFallback ??= family
    if (result.glyphs) {
      return {
        status: family === candidates[0] ? 'ready' : 'fallback',
        fontFamily,
        selectedFamily: family,
        unicodeVersion: '11',
        warnings: family === candidates[0]
          ? []
          : [`기본 글꼴을 찾지 못해 ${family} 글꼴을 사용합니다.`],
      }
    }
    missingGlyphFamilies.push(family)
  }

  const detail = missingGlyphFamilies.length > 0
    ? `${missingGlyphFamilies.join(', ')} 글꼴에 해당 글리프 없음`
    : '한글과 wide glyph를 지원하는 고정폭 글꼴을 찾지 못했습니다.'
  return {
    status: 'missing-glyph',
    fontFamily,
    selectedFamily: installedFallback,
    unicodeVersion: '11',
    warnings: [detail],
  }
}

export type TerminalRenderCoordinatorOptions = {
  fit: () => void
  dimensions: () => { cols: number; rows: number }
  resize: (cols: number, rows: number) => void
  refresh: (start: number, end: number) => void
  requestFrame?: (callback: FrameRequestCallback) => number
  cancelFrame?: (handle: number) => void
  onError?: (error: unknown) => void
}

/** Coalesces layout triggers and preserves the only safe terminal layout order. */
export class TerminalRenderCoordinator {
  private frame: number | null = null
  private disposed = false
  private readonly requestFrame: (callback: FrameRequestCallback) => number
  private readonly cancelFrame: (handle: number) => void

  constructor(private readonly options: TerminalRenderCoordinatorOptions) {
    this.requestFrame = options.requestFrame ?? requestAnimationFrame
    this.cancelFrame = options.cancelFrame ?? cancelAnimationFrame
  }

  schedule(): void {
    if (this.disposed || this.frame !== null) return
    this.frame = this.requestFrame(() => {
      this.frame = null
      if (this.disposed) return
      try {
        this.options.fit()
        if (this.disposed) return
        const { cols, rows } = this.options.dimensions()
        if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols < 2 || rows < 1) return
        this.options.resize(cols, rows)
        if (this.disposed) return
        this.options.refresh(0, rows - 1)
      } catch (error) {
        this.options.onError?.(error)
      }
    })
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    if (this.frame !== null) {
      this.cancelFrame(this.frame)
      this.frame = null
    }
  }
}
