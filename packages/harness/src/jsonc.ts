// Minimal JSONC: strips // and block comments, preserving comment-like sequences inside strings.
export function parseJsonc(src: string): unknown {
  let out = ''
  let inStr = false, esc = false, i = 0
  while (i < src.length) {
    const ch = src[i], next = src[i + 1]
    if (inStr) {
      out += ch
      if (esc) esc = false
      else if (ch === '\\') esc = true
      else if (ch === '"') inStr = false
      i++; continue
    }
    if (ch === '"') { inStr = true; out += ch; i++; continue }
    if (ch === '/' && next === '/') { while (i < src.length && src[i] !== '\n') i++; continue }
    if (ch === '/' && next === '*') { i += 2; while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++; i += 2; continue }
    out += ch; i++
  }
  return JSON.parse(out)
}
