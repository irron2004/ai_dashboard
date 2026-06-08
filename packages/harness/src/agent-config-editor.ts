import matter from 'gray-matter'
import type { ProfileEdits } from '@apc/shared'
import { parseJsonc } from './jsonc.js'

export type ConfigValidation = { ok: boolean; errors: string[] }

const VALID_MODES = new Set(['primary', 'subagent', 'reviewer', 'planner', 'builder', 'custom'])
const VALID_PERMS = new Set(['allow', 'ask', 'deny'])

/** Editor for OpenCode agent configs: serialize form edits back to text, validate, diff, apply (snapshot), rollback. */
export class AgentConfigEditor {
  /** Merge form edits into the current config text. Markdown round-trips via gray-matter; json re-stringifies
   *  (comments reformatted — the caller shows the diff before applying). `undefined` edit fields are skipped. */
  serializeProfileEdit(currentText: string, rawFormat: 'json' | 'markdown', profileName: string, edits: ProfileEdits): string {
    if (rawFormat === 'markdown') {
      const parsed = matter(currentText)
      const data: Record<string, unknown> = { ...parsed.data }
      if (edits.model !== undefined) data.model = edits.model
      if (edits.mode !== undefined) data.mode = edits.mode
      if (edits.permissions !== undefined) data.permission = { ...((data.permission as object) ?? {}), ...edits.permissions }
      if (edits.tools !== undefined) data.tools = edits.tools
      if (edits.temperature !== undefined) data.temperature = edits.temperature
      if (edits.description !== undefined) data.description = edits.description
      const content = edits.prompt !== undefined ? edits.prompt : parsed.content
      return matter.stringify(content, data)
    }
    const obj = (parseJsonc(currentText) ?? {}) as Record<string, any>
    obj.agent = obj.agent ?? {}
    const a = (obj.agent[profileName] = obj.agent[profileName] ?? {})
    if (edits.model !== undefined) a.model = edits.model
    if (edits.mode !== undefined) a.mode = edits.mode
    if (edits.permissions !== undefined) a.permission = { ...(a.permission ?? {}), ...edits.permissions }
    if (edits.tools !== undefined) a.tools = edits.tools
    if (edits.temperature !== undefined) a.temperature = edits.temperature
    if (edits.description !== undefined) a.description = edits.description
    if (edits.prompt !== undefined) a.prompt = edits.prompt
    return JSON.stringify(obj, null, 2) + '\n'
  }

  validateConfigText(text: string, rawFormat: 'json' | 'markdown'): ConfigValidation {
    const errors: string[] = []
    if (rawFormat === 'json') {
      let obj: any
      try { obj = parseJsonc(text) } catch (e) { return { ok: false, errors: [`JSON parse error: ${e instanceof Error ? e.message : String(e)}`] } }
      const agents = obj?.agent
      if (agents && typeof agents === 'object') {
        for (const [name, cfg] of Object.entries<any>(agents)) {
          if (cfg?.mode !== undefined && !VALID_MODES.has(cfg.mode)) errors.push(`agent ${name}: invalid mode "${cfg.mode}"`)
          const perm = cfg?.permission
          if (perm && typeof perm === 'object') {
            for (const [k, v] of Object.entries<any>(perm)) {
              if (!VALID_PERMS.has(v)) errors.push(`agent ${name}: invalid permission ${k}="${v}"`)
            }
          }
        }
      }
    } else {
      try { matter(text) } catch (e) { errors.push(`frontmatter parse error: ${e instanceof Error ? e.message : String(e)}`) }
    }
    return { ok: errors.length === 0, errors }
  }

  /** Unified diff of the changed region only (common prefix/suffix trimmed). Empty string if identical. */
  diffText(current: string, proposed: string, path: string): string {
    if (current === proposed) return ''
    const a = current.split('\n'), b = proposed.split('\n')
    let p = 0
    while (p < a.length && p < b.length && a[p] === b[p]) p++
    let sa = a.length, sb = b.length
    while (sa > p && sb > p && a[sa - 1] === b[sb - 1]) { sa--; sb-- }
    const removed = a.slice(p, sa), added = b.slice(p, sb)
    const start = p + 1
    const header = `--- a/${path}\n+++ b/${path}\n@@ -${start},${removed.length} +${start},${added.length} @@\n`
    const body = [...removed.map((l) => `-${l}`), ...added.map((l) => `+${l}`)].join('\n') + '\n'
    return header + body
  }
}
