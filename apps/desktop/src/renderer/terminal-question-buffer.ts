export const TERMINAL_QUESTION_BUFFER_MAX_CHARS = 4096

/**
 * Reconstructs only simple, trustworthy shell input. Cursor-motion/TUI control sequences make the
 * line ambiguous, so that line is discarded on Enter instead of guessing a historical question.
 */
export class TerminalQuestionBuffer {
  private value = ''
  private reliable = true
  private securePrompt = false
  private bracketedPaste = false
  private skipNextLf = false

  setSecurePrompt(active: boolean): void {
    this.securePrompt = active
    if (active) this.resetLine()
  }

  push(data: string): string[] {
    return this.consume(data, false)
  }

  /** Paste is an explicit input source, so its printable content/newlines can be tracked safely. */
  pushPaste(text: string): string[] {
    return this.consume(text, true)
  }

  peek(): string {
    return this.reliable && !this.securePrompt ? this.value : ''
  }

  reset(): void {
    this.securePrompt = false
    this.bracketedPaste = false
    this.skipNextLf = false
    this.resetLine()
  }

  private consume(data: string, knownPaste: boolean): string[] {
    const submitted: string[] = []
    for (let index = 0; index < data.length;) {
      const codePoint = data.codePointAt(index)!
      const char = String.fromCodePoint(codePoint)
      index += char.length

      if (char === '\x1b') {
        const rest = data.slice(index)
        const sequence = rest.match(/^\[([0-9;?]*)([@-~])/)
        if (sequence) {
          index += sequence[0].length
          const marker = `${sequence[1]}${sequence[2]}`
          if (marker === '200~') this.bracketedPaste = true
          else if (marker === '201~') this.bracketedPaste = false
          else if (!this.bracketedPaste && !knownPaste) this.reliable = false
        } else if (!knownPaste) {
          this.reliable = false
        }
        continue
      }

      if (char === '\r') {
        this.submit(submitted)
        this.skipNextLf = true
        continue
      }
      if (char === '\n') {
        if (this.skipNextLf) this.skipNextLf = false
        else this.submit(submitted)
        continue
      }
      this.skipNextLf = false

      if (char === '\x7f' || char === '\b') {
        if (this.reliable) this.value = Array.from(this.value).slice(0, -1).join('')
        continue
      }
      if (char === '\x15') { // Ctrl+U: readline clears the current line.
        this.resetLine()
        continue
      }
      if (char === '\x03') { // Ctrl+C: cancel the line.
        this.resetLine()
        continue
      }
      if (codePoint < 0x20 || codePoint === 0x7f) {
        if (!knownPaste) this.reliable = false
        continue
      }

      if (this.value.length + char.length > TERMINAL_QUESTION_BUFFER_MAX_CHARS) {
        this.reliable = false
        continue
      }
      this.value += char
    }
    return submitted
  }

  private submit(target: string[]): void {
    if (!this.securePrompt && this.reliable && this.value.trim()) target.push(this.value)
    this.securePrompt = false
    this.resetLine()
  }

  private resetLine(): void {
    this.value = ''
    this.reliable = true
  }
}
