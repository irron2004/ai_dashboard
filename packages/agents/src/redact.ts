const PATTERNS: RegExp[] = [
  /\bsk-[A-Za-z0-9_-]{16,}\b/g,                      // OpenAI-style keys
  /\b(?:gh[pousr]|github_pat)_[A-Za-z0-9_]{20,}\b/g, // GitHub tokens
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g,               // Slack tokens
  /\bBearer\s+[A-Za-z0-9._-]{8,}/g,                  // bearer tokens
  /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, // emails
]

export function redact(text: string): string {
  let out = text
  for (const re of PATTERNS) out = out.replace(re, '[REDACTED]')
  return out
}
