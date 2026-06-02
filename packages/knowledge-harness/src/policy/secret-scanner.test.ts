import { describe, expect, test } from 'vitest'
import { SecretScanner } from './secret-scanner.js'

const scanner = new SecretScanner()

describe('SecretScanner', () => {
  test('clean text yields no findings', () => {
    expect(scanner.scan('just a normal summary about grid backtesting', 'raw/a.md')).toEqual([])
    expect(scanner.scan('', 'x')).toEqual([])
  })

  test('detects each secret kind with a masked preview', () => {
    const cases: [string, string][] = [
      ['AKIAIOSFODNN7EXAMPLE', 'aws_access_key_id'],
      ['AIzaSyD-1234567890123456789012345678901', 'google_api_key'],
      ['sk-abcdefghij0123456789ABCDEFGHIJ', 'openai_key'],
      ['Authorization: Bearer abcdefghij0123456789xyz', 'bearer_token'],
      ['-----BEGIN RSA PRIVATE KEY-----', 'private_key'],
      ['password=hunter2secret', 'password_assignment'],
    ]
    for (const [text, rule] of cases) {
      const f = scanner.scan(text, 'src')
      expect(f.map(x => x.rule)).toContain(rule)
      // preview is masked: never contains the full secret body
      const finding = f.find(x => x.rule === rule)!
      expect(finding.match_preview).toContain('*')
    }
  })
})
