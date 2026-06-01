import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { OpenCodeConfigAdapter } from './opencode-config-adapter.js'

describe('OpenCodeConfigAdapter', () => {
  let proj: string
  beforeEach(() => {
    proj = mkdtempSync(join(tmpdir(), 'apc-oc-cfg-'))
    const oc = join(proj, '.opencode')
    mkdirSync(join(oc, 'agent'), { recursive: true })
    writeFileSync(join(oc, 'opencode.jsonc'), `{
      // agents
      "agent": {
        "build": { "model": "openai/gpt-5.5", "mode": "primary", "description": "builder",
                   "permission": { "edit": "allow", "bash": "ask" } }
      }
    }`)
    writeFileSync(join(oc, 'agent', 'review.md'),
      `---\ndescription: code reviewer\nmode: subagent\nmodel: anthropic/claude\npermission:\n  edit: deny\n---\nReview the diff for risks.\n`)
    // credential file that must NOT be read
    writeFileSync(join(oc, 'auth.json'), '{"apiKey":"sk-SECRET"}')
  })
  afterEach(() => rmSync(proj, { recursive: true, force: true }))

  test('reads the json agent map into a profile', async () => {
    const profiles = await new OpenCodeConfigAdapter().discoverProfiles({ projectPath: proj })
    const build = profiles.find((p) => p.name === 'build')!
    expect(build.provider).toBe('opencode')
    expect(build.model).toBe('openai/gpt-5.5')
    expect(build.mode).toBe('primary')
    expect(build.permissions?.bash).toBe('ask')
    expect(build.rawFormat).toBe('json')
  })

  test('reads a markdown agent (frontmatter + body prompt)', async () => {
    const profiles = await new OpenCodeConfigAdapter().discoverProfiles({ projectPath: proj })
    const review = profiles.find((p) => p.name === 'review')!
    expect(review.mode).toBe('subagent')
    expect(review.permissions?.edit).toBe('deny')
    expect(review.prompt?.inline).toContain('Review the diff')
    expect(review.rawFormat).toBe('markdown')
  })

  test('never surfaces auth.json content as a profile', async () => {
    const profiles = await new OpenCodeConfigAdapter().discoverProfiles({ projectPath: proj })
    expect(profiles.some((p) => p.rawConfigPath.endsWith('auth.json'))).toBe(false)
    expect(JSON.stringify(profiles)).not.toContain('sk-SECRET')
  })

  test('returns [] when there is no .opencode dir', async () => {
    expect(await new OpenCodeConfigAdapter().discoverProfiles({ projectPath: '/no/such/path' })).toEqual([])
  })
})
