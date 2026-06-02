export type SecretFinding = { source: string; rule: string; match_preview: string }

/** Mask a matched secret: keep the first 4 chars, redact the rest. */
function mask(s: string): string {
  const head = s.slice(0, 4)
  return `${head}${'*'.repeat(Math.max(3, Math.min(8, s.length - 4)))}`
}

const RULES: { rule: string; re: RegExp }[] = [
  { rule: 'aws_access_key_id', re: /AKIA[0-9A-Z]{16}/ },
  { rule: 'google_api_key', re: /AIza[0-9A-Za-z_\-]{35}/ },
  { rule: 'openai_key', re: /sk-[A-Za-z0-9]{20,}/ },
  { rule: 'bearer_token', re: /bearer\s+[A-Za-z0-9._\-]{20,}/i },
  { rule: 'private_key', re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/ },
  { rule: 'password_assignment', re: /password\s*[:=]\s*\S{6,}/i },
]

/**
 * Deterministic regex catalog for obvious secrets. NOT a semantic detector — the optional LLM
 * meaning-judgment layer (design §7.2) is Phase-3-excluded and off by default. Previews are masked.
 */
export class SecretScanner {
  readonly name = 'secret-scanner'

  scan(text: string, source = ''): SecretFinding[] {
    if (!text) return []
    const findings: SecretFinding[] = []
    for (const { rule, re } of RULES) {
      const m = text.match(re)
      if (m) findings.push({ source, rule, match_preview: mask(m[0]) })
    }
    return findings
  }
}
