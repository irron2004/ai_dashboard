import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import matter from 'gray-matter'
import { AgentProfileSchema, type AgentProfile, type Permission } from '@apc/shared'
import type { AgentConfigAdapter } from './types.js'
import { parseJsonc } from './jsonc.js'

const PERM_KEYS = ['read', 'edit', 'bash', 'web', 'task'] as const
const VALID_MODES = new Set(['primary', 'subagent', 'reviewer', 'planner', 'builder', 'custom'])
const VALID_PERMS = new Set<Permission>(['allow', 'ask', 'deny'])

function mapPermissions(raw: unknown): AgentProfile['permissions'] | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const out: Record<string, Permission> = {}
  for (const k of PERM_KEYS) {
    const v = (raw as Record<string, unknown>)[k]
    if (typeof v === 'string' && VALID_PERMS.has(v as Permission)) out[k] = v as Permission
  }
  return Object.keys(out).length ? out : undefined
}

function normMode(raw: unknown): AgentProfile['mode'] {
  return typeof raw === 'string' && VALID_MODES.has(raw) ? (raw as AgentProfile['mode']) : 'custom'
}

export class OpenCodeConfigAdapter implements AgentConfigAdapter {
  readonly provider = 'opencode' as const

  async discoverProfiles(opts: { projectPath?: string }): Promise<AgentProfile[]> {
    const projectPath = opts.projectPath
    if (!projectPath) return []
    const ocDir = join(projectPath, '.opencode')
    if (!existsSync(ocDir)) return []
    const profiles: AgentProfile[] = []
    profiles.push(...this.readJsonAgents(ocDir))
    profiles.push(...this.readMarkdownAgents(ocDir))
    return profiles
  }

  private readJsonAgents(ocDir: string): AgentProfile[] {
    for (const file of ['opencode.jsonc', 'opencode.json']) {
      const path = join(ocDir, file)
      if (!existsSync(path)) continue
      let parsed: any
      try { parsed = parseJsonc(readFileSync(path, 'utf8')) } catch { return [] }
      const agents = parsed?.agent
      if (!agents || typeof agents !== 'object') return []
      return Object.entries(agents).map(([name, cfg]: [string, any]) =>
        AgentProfileSchema.parse({
          id: `opencode:json:${name}`, provider: 'opencode', name, scope: 'project',
          mode: normMode(cfg?.mode),
          model: typeof cfg?.model === 'string' ? cfg.model : undefined,
          description: typeof cfg?.description === 'string' ? cfg.description : undefined,
          permissions: mapPermissions(cfg?.permission),
          tools: Array.isArray(cfg?.tools) ? cfg.tools.filter((t: unknown) => typeof t === 'string')
            : (cfg?.tools && typeof cfg.tools === 'object' ? Object.keys(cfg.tools) : undefined),
          temperature: typeof cfg?.temperature === 'number' ? cfg.temperature : undefined,
          prompt: typeof cfg?.prompt === 'string' ? { inline: cfg.prompt } : undefined,
          rawConfigPath: path, rawFormat: 'json',
        }),
      )
    }
    return []
  }

  private readMarkdownAgents(ocDir: string): AgentProfile[] {
    const out: AgentProfile[] = []
    for (const sub of ['agent', 'agents']) {
      const dir = join(ocDir, sub)
      if (!existsSync(dir)) continue
      for (const f of readdirSync(dir)) {
        if (!f.endsWith('.md')) continue
        const path = join(dir, f)
        const parsed = matter(readFileSync(path, 'utf8'))
        const fm = parsed.data as Record<string, unknown>
        const name = basename(f, '.md')
        out.push(AgentProfileSchema.parse({
          id: `opencode:md:${name}`, provider: 'opencode', name, scope: 'project',
          mode: normMode(fm.mode),
          model: typeof fm.model === 'string' ? fm.model : undefined,
          description: typeof fm.description === 'string' ? fm.description : undefined,
          permissions: mapPermissions(fm.permission),
          tools: Array.isArray(fm.tools) ? (fm.tools as unknown[]).filter((t) => typeof t === 'string') as string[] : undefined,
          temperature: typeof fm.temperature === 'number' ? fm.temperature : undefined,
          prompt: parsed.content.trim() ? { inline: parsed.content.trim() } : undefined,
          rawConfigPath: path, rawFormat: 'markdown',
        }))
      }
    }
    return out
  }
}
