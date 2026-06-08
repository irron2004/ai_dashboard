import { describe, expect, test } from 'vitest'
import { validateMarkdownYaml } from './markdown-yaml-validator.js'
import { validateObsidianLinks } from './obsidian-link-validator.js'

describe('validateMarkdownYaml', () => {
  test('clean doc with good frontmatter + balanced fences has no problems', () => {
    const doc = '---\nnode_id: a\ntitle: A\n---\nbody\n```\ncode\n```\n'
    expect(validateMarkdownYaml(doc, 'a.md')).toEqual([])
  })

  test('flags unterminated frontmatter, bad frontmatter line, and unbalanced fence', () => {
    expect(validateMarkdownYaml('---\nnode_id: a\n', 'a.md').some(p => p.kind === 'frontmatter')).toBe(true)
    expect(validateMarkdownYaml('---\nthis is not yaml\n---\n', 'b.md').some(p => p.detail.includes('unparseable'))).toBe(true)
    expect(validateMarkdownYaml('text\n```\nopen fence never closed\n', 'c.md').some(p => p.kind === 'code_fence')).toBe(true)
  })
})

describe('validateObsidianLinks', () => {
  test('balanced, non-empty links are clean', () => {
    expect(validateObsidianLinks('see [[a]] and [[b|alias]]', 'x.md')).toEqual([])
  })

  test('flags empty link and unbalanced brackets', () => {
    expect(validateObsidianLinks('broken [[]] here', 'x.md').some(b => b.detail.includes('empty'))).toBe(true)
    expect(validateObsidianLinks('open [[a without close', 'y.md').some(b => b.detail.includes('unbalanced'))).toBe(true)
  })
})
