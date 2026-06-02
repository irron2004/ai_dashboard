import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join, relative } from 'node:path'
import { KhLinkValidationReportSchema, type KhLinkValidationReport } from '@apc/shared'

type Broken = { path: string; detail: string }

function listMarkdown(dir: string): string[] {
  if (!existsSync(dir)) return []
  const out: string[] = []
  for (const ent of readdirSync(dir, { withFileTypes: true, recursive: true }) as Array<{ name: string; parentPath?: string; path?: string; isFile(): boolean }>) {
    if (ent.isFile() && ent.name.endsWith('.md')) out.push(join(ent.parentPath ?? ent.path ?? dir, ent.name))
  }
  return out
}

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
