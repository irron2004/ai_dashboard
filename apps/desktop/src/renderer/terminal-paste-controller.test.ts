import { describe, expect, test, vi } from 'vitest'
import {
  TerminalPasteController,
  isTerminalPasteShortcut,
  multilinePasteMessage,
} from './terminal-paste-controller.js'

const key = (over: Partial<KeyboardEvent>): KeyboardEvent => ({
  type: 'keydown', key: '', ctrlKey: false, shiftKey: false, metaKey: false, altKey: false, ...over,
}) as KeyboardEvent

describe('terminal paste shortcuts', () => {
  test('routes Ctrl+V, Ctrl+Shift+V, Shift+Insert, and Cmd+V to one request callback', async () => {
    const readClipboard = vi.fn(async () => ({ ok: true, text: 'value' }))
    const paste = vi.fn()
    const controller = new TerminalPasteController({
      readClipboard, paste, writeClipboard: async () => {}, bracketedPasteEnabled: () => true,
      confirmMultiline: () => true, onNotice: () => {},
    })
    const events = [
      key({ key: 'v', ctrlKey: true }),
      key({ key: 'V', ctrlKey: true, shiftKey: true }),
      key({ key: 'Insert', shiftKey: true }),
      key({ key: 'v', metaKey: true }),
    ]
    for (const [index, event] of events.entries()) {
      expect(controller.handleKey(event, event.metaKey ? 'MacIntel' : 'Win32')).toBe(false)
      await vi.waitFor(() => expect(paste).toHaveBeenCalledTimes(index + 1))
    }
    expect(readClipboard).toHaveBeenCalledTimes(4)
    expect(paste).toHaveBeenCalledTimes(4)
    expect(isTerminalPasteShortcut(key({ key: 'c', ctrlKey: true }), 'Win32')).toBe(false)
  })
})

describe('TerminalPasteController', () => {
  test.each([
    '한글 질문',
    'const value = `코드`;',
    'C:\\Users\\me\\repo\\TODO.md',
    '/mnt/c/Users/me/repo/app.py',
    '마지막 개행 유지\n',
  ])('passes clipboard content to term.paste without transformation: %s', async (text) => {
    const paste = vi.fn()
    const controller = new TerminalPasteController({
      readClipboard: async () => ({ ok: true, text }),
      writeClipboard: async () => {},
      paste,
      bracketedPasteEnabled: () => true,
      confirmMultiline: () => true,
      onNotice: () => {},
    })
    expect(await controller.requestPaste()).toBe(true)
    expect(paste).toHaveBeenCalledWith(text)
  })

  test('waits for explicit confirmation before non-bracketed multiline paste', async () => {
    let resolveConfirm!: (value: boolean) => void
    const paste = vi.fn()
    const confirmMultiline = vi.fn(() => new Promise<boolean>((resolve) => { resolveConfirm = resolve }))
    const controller = new TerminalPasteController({
      readClipboard: async () => ({ ok: true, text: 'one\ntwo' }), writeClipboard: async () => {}, paste,
      bracketedPasteEnabled: () => false, confirmMultiline, onNotice: () => {},
    })
    const pending = controller.requestPaste()
    await vi.waitFor(() => expect(confirmMultiline).toHaveBeenCalledWith('one\ntwo'))
    expect(paste).not.toHaveBeenCalled()
    resolveConfirm(true)
    expect(await pending).toBe(true)
    expect(paste).toHaveBeenCalledWith('one\ntwo')
    expect(multilinePasteMessage('one\ntwo')).toContain('2줄')
  })

  test('reports empty, permission, oversize, and read errors without pasting', async () => {
    const cases = [
      { read: async () => ({ ok: true, text: '' }), message: '비어' },
      { read: async () => ({ ok: false, reason: 'permission-denied' }), message: '권한' },
      { read: async () => ({ ok: true, text: 'too big' }), message: '너무 큽니다', maxBytes: 2 },
      { read: async () => { throw new Error('blocked') }, message: '읽지 못했습니다' },
    ]
    for (const item of cases) {
      const paste = vi.fn()
      const notices: string[] = []
      const controller = new TerminalPasteController({
        readClipboard: item.read, writeClipboard: async () => {}, paste, maxBytes: item.maxBytes,
        bracketedPasteEnabled: () => true, confirmMultiline: () => true,
        onNotice: (notice) => notices.push(notice.message),
      })
      expect(await controller.requestPaste()).toBe(false)
      expect(paste).not.toHaveBeenCalled()
      expect(notices.at(-1)).toContain(item.message)
    }
  })

  test('surfaces copy rejection and never puts selection content in the notice', async () => {
    const notices: string[] = []
    const controller = new TerminalPasteController({
      readClipboard: async () => ({ ok: true, text: '' }),
      writeClipboard: async () => { throw new Error('denied') },
      paste: () => {}, bracketedPasteEnabled: () => true, confirmMultiline: () => true,
      onNotice: (notice) => notices.push(notice.message),
    })
    expect(await controller.requestCopy('private selection')).toBe(false)
    expect(notices.at(-1)).toContain('복사하지 못했습니다')
    expect(notices.join(' ')).not.toContain('private selection')
  })
})
