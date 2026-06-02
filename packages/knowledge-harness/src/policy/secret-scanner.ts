export type SecretFinding = { source: string; rule: string; match_preview: string }

/** Mask a matched secret: keep the first 4 chars, redact the rest. */
function mask(s: string): string {
  const head = s.slice(0, 4)
  return `${head}${'*'.repeat(Math.max(3, Math.min(8, s.length - 4)))}`
}

// All patterns are global (/g) so scan() reports EVERY occurrence, not just the first per rule.
// matchAll creates its own iterator, so sharing these module-level regexes across calls is safe.
const RULES: { rule: string; re: RegExp }[] = [
  { rule: 'aws_access_key_id', re: /AKIA[0-9A-Z]{16}/g },
  { rule: 'google_api_key', re: /AIza[0-9A-Za-z_\-]{35}/g },
  { rule: 'openai_key', re: /sk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}/g },
  { rule: 'github_token', re: /gh[pousr]_[A-Za-z0-9]{36}/g },
  { rule: 'github_pat', re: /github_pat_[A-Za-z0-9_]{22,}/g },
  { rule: 'slack_token', re: /xox[baprs]-[A-Za-z0-9-]{10,}/g },
  { rule: 'stripe_key', re: /sk_(?:live|test)_[A-Za-z0-9]{20,}/g },
  { rule: 'gitlab_pat', re: /glpat-[A-Za-z0-9_-]{20}/g },
  { rule: 'azure_account_key', re: /AccountKey=[A-Za-z0-9+/=]{40,}/g },
  { rule: 'jwt', re: /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g },
  { rule: 'connection_string_credentials', re: /\w+:\/\/[^/\s:@]+:[^/\s:@]+@/g },
  { rule: 'bearer_token', re: /bearer\s+[A-Za-z0-9._\-]{20,}/gi },
  { rule: 'private_key', re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY(?: BLOCK)?-----/g },
  { rule: 'secret_assignment', re: /(?:password|secret|api[_-]?key|access[_-]?token|token|[a-z0-9]+_key|[a-z0-9]+_token|[a-z0-9]+_secret)\s*[:=]\s*\S{6,}/gi },
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
      for (const m of text.matchAll(re)) findings.push({ source, rule, match_preview: mask(m[0]) })
    }
    return findings
  }
}
