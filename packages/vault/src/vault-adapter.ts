import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import matter from 'gray-matter'

export type VaultDoc = {
  frontmatter: Record<string, unknown>
  body: string
}

const WIKI_LINK = /\[\[([^\]]+)\]\]/g

export class VaultAdapter {
  constructor(private readonly root: string) {}

  private abs(relPath: string): string {
    if (isAbsolute(relPath)) return relPath
    return resolve(this.root, relPath)
  }

  readDoc(relPath: string): VaultDoc {
    const file = this.abs(relPath)
    if (!existsSync(file)) {
      throw new Error(`Vault document not found: ${relPath}`)
    }
    const raw = readFileSync(file, 'utf8')
    const parsed = matter(raw)
    return { frontmatter: parsed.data, body: parsed.content }
  }

  writeDoc(relPath: string, doc: VaultDoc): void {
    const file = this.abs(relPath)
    mkdirSync(dirname(file), { recursive: true })
    const out = matter.stringify(doc.body, doc.frontmatter)
    writeFileSync(file, out, 'utf8')
  }

  extractWikiLinks(body: string): string[] {
    const links: string[] = []
    for (const match of body.matchAll(WIKI_LINK)) {
      links.push(match[1].trim())
    }
    return links
  }
}
