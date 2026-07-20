const PATTERNS: RegExp[] = [
  /\bsk-[A-Za-z0-9_-]{16,}\b/g,                      // OpenAI-style keys
  /\b(?:gh[pousr]|github_pat)_[A-Za-z0-9_]{20,}\b/g, // GitHub tokens
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g,               // Slack tokens
  /\bBearer\s+[A-Za-z0-9._-]{8,}/g,                  // bearer tokens
  /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, // emails
  /\bAKIA[A-Z0-9]{16}\b/g,                           // AWS access key ids
  /\b(?:password|passwd|pwd|api[_-]?key|access[_-]?token|secret)\s*[:=]\s*[^\s'"`]+/gi,
]

export type RedactionResult = { text: string; changed: boolean }

export function redactWithResult(text: string): RedactionResult {
  let out = text
  for (const re of PATTERNS) out = out.replace(re, '[REDACTED]')
  return { text: out, changed: out !== text }
}

export function redact(text: string): string {
  return redactWithResult(text).text
}
