import matter from 'gray-matter'
import type { ProfileEdits } from '@apc/shared'
import { parseJsonc } from './jsonc.js'

export type ConfigValidation = { ok: boolean; errors: string[] }

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
}
