import { readFileSync } from 'node:fs'
import { relative } from 'node:path'
import { KhLinkValidationReportSchema, type KhLinkValidationReport } from '@apc/shared'
import { listMarkdown } from '../runtime/vault-fs.js'

type Broken = { path: string; detail: string }

/**
 * Validate `[[wiki-link]]` SYNTAX only — empty links `[[]]` and unclosed `[[`.
 * (Target existence is GraphIntegrity's job; this is purely lexical.)
 */
export function validateObsidianLinks(text: string, path = ''): Broken[] {
  const broken: Broken[] = []
  // empty links
  if (/\[\[\s*\]\]/.test(text)) broken.push({ path, detail: 'empty wiki-link [[]]' })
  // unclosed [[ : count opens vs closes
  const opens = (text.match(/\[\[/g) ?? []).length
  const closes = (text.match(/\]\]/g) ?? []).length
  if (opens !== closes) broken.push({ path, detail: `unbalanced wiki-link brackets (${opens} '[[' vs ${closes} ']]')` })
  return broken
}

export class ObsidianLinkValidator {
  readonly name = 'obsidian-link-validator'

  validate(vaultDir: string): KhLinkValidationReport {
    const broken: Broken[] = []
    for (const abs of listMarkdown(vaultDir)) {
      broken.push(...validateObsidianLinks(readFileSync(abs, 'utf8'), relative(vaultDir, abs)))
    }
    return KhLinkValidationReportSchema.parse({ ok: broken.length === 0, broken })
  }
}
