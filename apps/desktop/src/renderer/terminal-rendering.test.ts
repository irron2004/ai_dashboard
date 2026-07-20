import { describe, expect, it, vi } from 'vitest'
import {
  TMUX_UNICODE_FIXTURE,
  TerminalRenderCoordinator,
  activateUnicode11,
  inspectTerminalFonts,
  terminalFontCandidates,
} from './terminal-rendering.js'

describe('activateUnicode11', () => {
  it('loads the provider before selecting Unicode version 11', () => {
    const events: string[] = []
    const terminal = {
      unicode: { activeVersion: '6' },
      loadAddon: vi.fn(() => events.push('load')),
    }
    const addon = { activate() {}, dispose() {} }

    activateUnicode11(terminal, addon)

    expect(events).toEqual(['load'])
    expect(terminal.unicode.activeVersion).toBe('11')
  })

  it('keeps the tmux Korean, box drawing, and wide-character cell contract explicit', () => {
    expect(TMUX_UNICODE_FIXTURE).toEqual([
      { text: '한글 ABC', cells: 8 },
      { text: '┌─┬─┐', cells: 5 },
      { text: '│😀│', cells: 4 },
    ])
  })
})

describe('inspectTerminalFonts', () => {
  it('probes a configured custom font before its CJK fallbacks', () => {
    expect(terminalFontCandidates('"JetBrains Mono", "D2Coding", monospace'))
      .toEqual(['JetBrains Mono', 'D2Coding'])
  })

  it('reports a usable CJK fallback separately from a missing glyph', () => {
    const diagnostic = inspectTerminalFonts((family) => ({
      installed: family === 'D2Coding',
      glyphs: family === 'D2Coding',
    }))

    expect(diagnostic).toMatchObject({
      status: 'fallback',
      selectedFamily: 'D2Coding',
      unicodeVersion: '11',
    })
    expect(diagnostic.warnings[0]).toContain('D2Coding')
  })

  it('exposes an actionable missing-glyph warning', () => {
    const diagnostic = inspectTerminalFonts((family) => ({
      installed: family === 'Cascadia Mono',
      glyphs: false,
    }))

    expect(diagnostic.status).toBe('missing-glyph')
    expect(diagnostic.warnings).toEqual(['Cascadia Mono 글꼴에 해당 글리프 없음'])
  })
})

describe('TerminalRenderCoordinator', () => {
  it('coalesces repeated triggers and performs fit, resize, then refresh', () => {
    const callbacks = new Map<number, FrameRequestCallback>()
    let nextFrame = 0
    const events: string[] = []
    const coordinator = new TerminalRenderCoordinator({
      fit: () => events.push('fit'),
      dimensions: () => ({ cols: 101, rows: 31 }),
      resize: (cols, rows) => events.push(`resize:${cols}x${rows}`),
      refresh: (start, end) => events.push(`refresh:${start}-${end}`),
      requestFrame: (callback) => {
        nextFrame += 1
        callbacks.set(nextFrame, callback)
        return nextFrame
      },
      cancelFrame: (handle) => { callbacks.delete(handle) },
    })

    coordinator.schedule()
    coordinator.schedule()
    coordinator.schedule()
    expect(callbacks.size).toBe(1)
    callbacks.get(1)?.(0)

    expect(events).toEqual(['fit', 'resize:101x31', 'refresh:0-30'])
  })

  it('cancels a pending frame and ignores a callback racing with disposal', () => {
    let callback: FrameRequestCallback | undefined
    const resize = vi.fn()
    const coordinator = new TerminalRenderCoordinator({
      fit: vi.fn(),
      dimensions: () => ({ cols: 80, rows: 24 }),
      resize,
      refresh: vi.fn(),
      requestFrame: (next) => { callback = next; return 17 },
      cancelFrame: vi.fn(),
    })

    coordinator.schedule()
    coordinator.dispose()
    callback?.(0)

    expect(resize).not.toHaveBeenCalled()
  })
})
