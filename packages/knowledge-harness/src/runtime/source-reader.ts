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

/**
 * Cap the TOTAL serialized size of the source set embedded in an LLM prompt. SourceReader caps each file
 * (maxBytes), but a project with many files still produces a multi-MB `sources` array — and an engine
 * rejects an over-long prompt outright (codex: "Input exceeds the maximum length of 1048576 characters").
 *
 * Whole sources are kept in order until `maxJsonChars` is reached; the source that crosses the boundary
 * is included truncated (so its `source_path` stays citable and its early content is still visible), and
 * the remainder dropped. Dropped sources still appear in the coverage report (built from the FULL set),
 * so the cap surfaces as uncovered sources rather than silently vanishing. Returns the kept sources and
 * how many were dropped.
 */
export function budgetSourcesForPrompt(sources: SourceDoc[], maxJsonChars: number): { sources: SourceDoc[]; dropped: number } {
  const kept: SourceDoc[] = []
  let used = 2 // the enclosing "[]"
  for (let i = 0; i < sources.length; i++) {
    const s = sources[i]
    const size = JSON.stringify(s).length + 1 // + the separating comma
    if (used + size <= maxJsonChars) { kept.push(s); used += size; continue }
    // Boundary source: include a truncated copy if meaningful room remains, then stop.
    const overhead = JSON.stringify({ ...s, text: '' }).length
    const room = maxJsonChars - used - overhead - 64 // headroom for the truncation marker + envelope
    if (room > 500) kept.push({ ...s, text: s.text.slice(0, room) + '\n…[truncated: prompt size budget]' })
    return { sources: kept, dropped: sources.length - kept.length }
  }
  return { sources: kept, dropped: 0 }
}
