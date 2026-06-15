import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join, relative } from 'node:path'
import { listFiles } from './vault-fs.js'

/** `hash` is the SHA-256 of the file's full on-disk content (pre-truncation), so a changed source
 *  produces a different hash — the signal the SourceLedger uses to re-process only what changed. */
export type SourceDoc = { source_id: string; source_path: string; text: string; hash: string }

/**
 * A1 (Step-5 spec): the deterministic source-ingestion boundary the pipeline was missing. It materializes
 * the real text of every immutable source under `<vaultRoot>/raw/` so the LLM agents reason over actual
 * content and cite `source_path`s that genuinely exist — which is what makes the A2 evidence verifier (and
 * the "evidence-based" guarantee) meaningful rather than decorative.
 *
 * Per-file text is capped (`maxBytes`) so a large transcript can't blow up the prompt; the cap is recorded
 * by a trailing truncation marker rather than silently dropping content.
 */
export class SourceReader {
  constructor(private readonly vaultRoot: string, private readonly maxBytes = 64 * 1024) {}

  read(): SourceDoc[] {
    const rawRoot = join(this.vaultRoot, 'raw')
    return listFiles(rawRoot).map((abs) => {
      // source_path is vault-relative and always starts with `raw/` (forward slashes) — the same shape
      // the extractor must cite in evidence and the EvidenceVerifier resolves back against the vault.
      const source_path = relative(this.vaultRoot, abs).replace(/\\/g, '/')
      const raw = readFileSync(abs, 'utf8')
      const hash = createHash('sha256').update(raw, 'utf8').digest('hex')
      let text = raw
      if (Buffer.byteLength(text, 'utf8') > this.maxBytes) {
        text = text.slice(0, this.maxBytes) + `\n…[truncated at ${this.maxBytes} bytes]`
      }
      return { source_id: source_path, source_path, text, hash }
    })
  }
}
