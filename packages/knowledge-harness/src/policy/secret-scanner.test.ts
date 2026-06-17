import { describe, expect, test } from 'vitest'
import { SecretScanner, redactSecrets } from './secret-scanner.js'

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
      ["xoxb-" + "1234567890" + "-" + "abcdefghijklmnop", 'slack_token'],
      ['eyJhbGc.eyJzdWIiOiIxMjM0.SflKxwRJSMeKKF2QT4', 'jwt'],
      ['postgres://user:p4ssw0rd@db.example.com:5432/x', 'connection_string_credentials'],
      ['Authorization: Bearer abcdefghij0123456789xyz', 'bearer_token'],
      ['-----BEGIN RSA PRIVATE KEY-----', 'private_key'],
      ['-----BEGIN PGP PRIVATE KEY BLOCK-----', 'private_key'],
      ['password=hunter2secret', 'secret_assignment'],
      ['api_key = abcdef123456', 'secret_assignment'],
      ['SECRET_KEY=supersecretvalue', 'secret_assignment'],
      ["sk_live_" + "abcdefghij0123456789ABCD", 'stripe_key'],
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

  // #23: client_secret / generic *_token bodies and header-less private-key bodies. These catch real
  // credential values while staying off benign config/prose — the discriminator is the VALUE shape
  // (mixed-case + digit + length), not the key name, so the benign cases below must still be clean.
  test('detects client_secret / generic *_token assignments with secret-shaped values (#23)', () => {
    const cases: [string, string][] = [
      ['client_secret=GOCSPX-AbCdEf0123456789AbCdEfGh', 'credential_assignment'],
      ['client_secret: aB3dEfGh1jKlMn0pQrStUv', 'credential_assignment'],
      ['CLIENT_SECRET=GOCSPX-Ab12Cd34Ef56Gh78Ij90Kl', 'credential_assignment'],
      ['refresh_token = 1ABcd3Fghi5Jklm7Nopq9Rstu', 'credential_assignment'],
      ['app_refresh_token: Zx9Yw8Vu7Ts6Rq5Po4Nm3', 'credential_assignment'],
    ]
    for (const [text, rule] of cases) {
      const f = scanner.scan(text, 'src')
      expect(f.map(x => x.rule), `expected ${rule} in "${text}"`).toContain(rule)
      expect(f.find(x => x.rule === rule)!.match_preview).toContain('*')
    }
  })

  test('detects a header-less private-key body (DER/base64 MII… block) (#23)', () => {
    const body = 'MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQDtAbCdEf0123456789'
    const f = scanner.scan(body, 'src')
    expect(f.map(x => x.rule)).toContain('private_key_body')
    expect(f.find(x => x.rule === 'private_key_body')!.match_preview).toContain('*')
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
      // #23 boundary: credential-named keys whose VALUE is not secret-shaped (no digit, or no uppercase)
      'refresh_token: see_auth_docs_below',
      'access_token field stores the bearer value',
      'release_token: build_2024_candidate',
      'client_secret: lowercase_only_value',
      // a word ending in "sk" before a dashed slug must NOT look like an OpenAI key (\b guard)
      'raw/project-docs/0/.sisyphus/evidence/task-1-executable-inventory.md',
      'the risk-1-2-3-mitigation-plan-2026 covers everything',
    ]) {
      expect(scanner.scan(benign, 'doc.md'), benign).toEqual([])
    }
  })

  test('reports every occurrence per rule (global), not just the first', () => {
    const f = scanner.scan('AKIAIOSFODNN7EXAMPL1 and AKIAIOSFODNN7EXAMPL2', 'src')
    expect(f.filter(x => x.rule === 'aws_access_key_id')).toHaveLength(2)
  })
})

describe('redactSecrets', () => {
  test('masks real secrets but leaves benign text (incl. task-* paths) intact', () => {
    expect(redactSecrets('key=sk-abcdefghij0123456789ABCDEFGHIJ here')).not.toContain('sk-abcdefghij0123456789ABCDEFGHIJ')
    expect(redactSecrets('see raw/.sisyphus/evidence/task-1-executable-inventory.md'))
      .toBe('see raw/.sisyphus/evidence/task-1-executable-inventory.md') // unchanged — not a secret
    expect(scanner.scan(redactSecrets('token AKIAIOSFODNN7EXAMPLE end'))).toEqual([]) // redacted → no longer scans
  })
})
