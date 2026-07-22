import { describe, expect, test } from 'vitest'
import { redact, redactWithResult } from './redact.js'

describe('redact', () => {
  test('masks an OpenAI-style key', () => {
    expect(redact('key sk-abcdef0123456789abcdef0123')).toContain('[REDACTED]')
    expect(redact('key sk-abcdef0123456789abcdef0123')).not.toContain('sk-abcdef')
  })
  test('masks bearer tokens and emails', () => {
    expect(redact('Authorization: Bearer ABC.def-123')).toContain('[REDACTED]')
    expect(redact('mail me at a.b@example.com')).toContain('[REDACTED]')
  })
  test('leaves ordinary text untouched', () => {
    expect(redact('just normal text 42')).toBe('just normal text 42')
  })
  test('reports whether redaction happened and covers common credential assignments', () => {
    expect(redactWithResult('password=hunter2')).toEqual({ text: '[REDACTED]', changed: true })
    expect(redactWithResult('api_key: abcdef123456')).toEqual({ text: '[REDACTED]', changed: true })
    expect(redactWithResult('ordinary question')).toEqual({ text: 'ordinary question', changed: false })
  })
})
