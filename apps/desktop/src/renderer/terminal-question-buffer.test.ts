import { describe, expect, test } from 'vitest'
import { TerminalQuestionBuffer } from './terminal-question-buffer.js'

describe('TerminalQuestionBuffer', () => {
  test('tracks IME printable text, Unicode backspace, and Enter submission', () => {
    const buffer = new TerminalQuestionBuffer()
    expect(buffer.push('테스트를 실헹')).toEqual([])
    expect(buffer.push('\x7f행해줘\r')).toEqual(['테스트를 실행해줘'])
    expect(buffer.peek()).toBe('')
  })

  test('handles CRLF once and known multiline paste without changing text', () => {
    const buffer = new TerminalQuestionBuffer()
    expect(buffer.pushPaste('첫 줄\r\n둘째 줄\n마지막')).toEqual(['첫 줄', '둘째 줄'])
    expect(buffer.peek()).toBe('마지막')
    expect(buffer.push('\r')).toEqual(['마지막'])
  })

  test('understands bracketed paste markers but discards arrow-edited ambiguous lines', () => {
    const buffer = new TerminalQuestionBuffer()
    expect(buffer.push('\x1b[200~한글 paste\x1b[201~\r')).toEqual(['한글 paste'])
    expect(buffer.push('abc\x1b[D수정\r')).toEqual([])
    expect(buffer.push('새 질문\r')).toEqual(['새 질문'])
  })

  test('models Ctrl+U/Ctrl+C and never submits secure-prompt input', () => {
    const buffer = new TerminalQuestionBuffer()
    buffer.push('지울 값\x15')
    expect(buffer.push('남길 값\r')).toEqual(['남길 값'])
    buffer.push('취소할 값\x03')
    expect(buffer.push('\r')).toEqual([])

    buffer.setSecurePrompt(true)
    expect(buffer.push('super-secret\r')).toEqual([])
    buffer.setSecurePrompt(false)
    expect(buffer.push('보이는 질문\r')).toEqual(['보이는 질문'])
  })
})
