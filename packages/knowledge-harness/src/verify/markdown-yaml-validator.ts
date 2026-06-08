import { readFileSync } from 'node:fs'
import { relative } from 'node:path'
import { KhMarkdownYamlValidationReportSchema, type KhMarkdownYamlValidationReport } from '@apc/shared'
import { listMarkdown } from '../runtime/vault-fs.js'

type Problem = { path: string; kind: string; detail: string }

/** Validate a doc's frontmatter (parseable key: value subset) and code-fence balance. No LLM. */
export function validateMarkdownYaml(text: string, path = ''): Problem[] {
  const problems: Problem[] = []

  // frontmatter: must open AND close with ---, and every non-blank line must be `key: value`.
  if (text.startsWith('---\n')) {
    const end = text.indexOf('\n---', 4)
    if (end === -1) problems.push({ path, kind: 'frontmatter', detail: 'unterminated frontmatter block' })
    else {
      for (const line of text.slice(4, end).split('\n')) {
        const t = line.trim()
        if (!t || t.startsWith('#') || t.startsWith('- ')) continue
        if (!/^[A-Za-z0-9_.-]+:\s?.*$/.test(t)) problems.push({ path, kind: 'frontmatter', detail: `unparseable frontmatter line: ${t}` })
      }
    }
  }

  // code fences must be balanced (even count of ``` lines).
  const fences = (text.match(/^```/gm) ?? []).length
  if (fences % 2 !== 0) problems.push({ path, kind: 'code_fence', detail: 'unbalanced code fence (```)' })

  return problems
}

export class MarkdownYamlValidator {
  readonly name = 'markdown-yaml-validator'

  validate(vaultDir: string): KhMarkdownYamlValidationReport {
    const problems: Problem[] = []
    for (const abs of listMarkdown(vaultDir)) {
      problems.push(...validateMarkdownYaml(readFileSync(abs, 'utf8'), relative(vaultDir, abs)))
    }
    return KhMarkdownYamlValidationReportSchema.parse({ ok: problems.length === 0, problems })
  }
}
