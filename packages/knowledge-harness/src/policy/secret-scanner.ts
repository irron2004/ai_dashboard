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
  // #23: a header-less private-key/cert BODY. Base64 of DER `30 82 …` (SEQUENCE) always starts `MII`, so
  // a long `MII…` base64 run is a key/cert body even when the `-----BEGIN…-----` armor was stripped.
  { rule: 'private_key_body', re: /MII[A-Za-z0-9+/]{40,}={0,2}/g },
  // Only UNAMBIGUOUS credential key names — NOT a bare `token` or benign schema prose (primary_key:,
  // session token:, client_secret: word) — matched regardless of value.
  { rule: 'secret_assignment', re: /(?:password|passwd|api[_-]?key|secret[_-]?key|access[_-]?token|auth[_-]?token|aws_secret_access_key)\s*[:=]\s*\S{6,}/gi },
  // #23: generic `*_secret` / `*_token` assignments (client_secret, refresh_token, …). To stay off benign
  // config/prose where these names appear with plain values, the VALUE must be secret-SHAPED: >=16 chars
  // from the secret alphabet AND containing a digit AND an uppercase letter (so `snake_case_word`,
  // `build_2024_candidate`, `see_auth_docs` are all ignored). NOTE: deliberately NOT /i — the uppercase
  // lookahead must stay case-sensitive; key suffixes spell both lower and SCREAMING forms explicitly.
  { rule: 'credential_assignment', re: /[A-Za-z][A-Za-z0-9]*(?:[_-][A-Za-z0-9]+)*[_-](?:secret|SECRET|token|TOKEN)\s*[:=]\s*["']?(?=[A-Za-z0-9_\-./+=]*[0-9])(?=[A-Za-z0-9_\-./+=]*[A-Z])[A-Za-z0-9_\-./+=]{16,}/g },
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
