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
      ['sk-proj-abcdefghij0123456789ABCDEFGHIJ', 'openai_key'],
      ['ghp_0123456789abcdefghijklmnopqrstuvwxyz', 'github_token'],
      ['github_pat_0123456789abcdefghij_KLMNOPQRST', 'github_pat'],
      [`xoxb-${'1234567890'}-${'abcdefghijklmnop'}`, 'slack_token'],
      ['eyJhbGc.eyJzdWIiOiIxMjM0.SflKxwRJSMeKKF2QT4', 'jwt'],
      ['postgres://user:p4ssw0rd@db.example.com:5432/x', 'connection_string_credentials'],
      ['Authorization: Bearer abcdefghij0123456789xyz', 'bearer_token'],
      ['-----BEGIN RSA PRIVATE KEY-----', 'private_key'],
      ['-----BEGIN PGP PRIVATE KEY BLOCK-----', 'private_key'],
      ['password=hunter2secret', 'secret_assignment'],
      ['api_key = abcdef123456', 'secret_assignment'],
      ['SECRET_KEY=supersecretvalue', 'secret_assignment'],
      [`sk_live_${'abcdefghij0123456789ABCD'}`, 'stripe_key'],
      ['glpat-abcdefghij0123456789', 'gitlab_pat'],
      ['AccountKey=' + 'a'.repeat(44), 'azure_account_key'],
    ]
    for (const [text, rule] of cases) {
      const f = scanner.scan(text, 'src')
      expect(f.map(x => x.rule), `expected ${rule} in "${text}"`).toContain(rule)
      const finding = f.find(x => x.rule === rule)!
      expect(finding.match_preview).toContain('*')  // masked, never the full secret
    }
  })

  test('does NOT flag benign schema/prose vocabulary (no false-positive promotion blocks)', () => {
    for (const benign of [
      'primary_key: integer NOT NULL',
      'foreign_key = orders_table',
      'sort_key: timestamp_desc',
      'partition_key: region_code',
      'session token: expires after 30 minutes',
      'client_secret: snake_case_word',
      'The primary key is the id column',
    ]) {
      expect(scanner.scan(benign, 'doc.md'), benign).toEqual([])
    }
  })

  test('reports every occurrence per rule (global), not just the first', () => {
    const f = scanner.scan('AKIAIOSFODNN7EXAMPL1 and AKIAIOSFODNN7EXAMPL2', 'src')
    expect(f.filter(x => x.rule === 'aws_access_key_id')).toHaveLength(2)
  })
})
