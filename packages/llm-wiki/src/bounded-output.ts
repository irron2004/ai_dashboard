export const DEFAULT_OUTPUT_CAPTURE_BYTES = 10 * 1024 * 1024

const GROUP_SIZE = 256

/** Return the longest Unicode-safe prefix whose UTF-8 encoding fits in maxBytes. */
export function takeUtf8Prefix(text: string, maxBytes: number): string {
  if (maxBytes <= 0 || !text) return ''
  if (Buffer.byteLength(text) <= maxBytes) return text
  const chars: string[] = []
  let bytes = 0
  for (const char of text) {
    const charBytes = Buffer.byteLength(char)
    if (bytes + charBytes > maxBytes) break
    chars.push(char)
    bytes += charBytes
  }
  return chars.join('')
}

export function outputTruncationMarker(maxBytes: number): string {
  return `\n…[truncated at ${maxBytes} bytes]\n`
}

/**
 * Keeps at most maxBytes of UTF-8 payload without repeatedly copying the full accumulated string.
 * Callers may still stream every original chunk while retaining only this bounded diagnostic view.
 */
export class BoundedOutputBuffer {
  private readonly segments: string[] = []
  private group: string[] = []
  private capturedBytes = 0
  private truncated = false

  constructor(private readonly maxBytes = DEFAULT_OUTPUT_CAPTURE_BYTES) {
    if (!Number.isFinite(maxBytes) || maxBytes < 0) throw new Error('maxBytes must be a non-negative finite number')
  }

  append(text: string): void {
    if (!text || this.truncated) return
    const remaining = this.maxBytes - this.capturedBytes
    const accepted = takeUtf8Prefix(text, remaining)
    if (accepted) {
      this.group.push(accepted)
      this.capturedBytes += Buffer.byteLength(accepted)
      if (this.group.length >= GROUP_SIZE) {
        this.segments.push(this.group.join(''))
        this.group = []
      }
    }
    if (accepted !== text) this.truncated = true
  }

  get didTruncate(): boolean { return this.truncated }
  get byteLength(): number { return this.capturedBytes }

  toString(): string {
    const payload = [...this.segments, this.group.join('')].join('')
    return this.truncated ? payload + outputTruncationMarker(this.maxBytes) : payload
  }
}

export function truncateOutput(text: string, maxBytes = DEFAULT_OUTPUT_CAPTURE_BYTES): string {
  const output = new BoundedOutputBuffer(maxBytes)
  output.append(text)
  return output.toString()
}
