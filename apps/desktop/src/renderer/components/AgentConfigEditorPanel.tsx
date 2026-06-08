import { useState } from 'react'
import type { AgentProfile, ProfileEdits } from '@apc/shared'
import { api } from '../api.js'
import { DiffViewer } from './DiffViewer.js'

const MODES = ['primary', 'subagent', 'reviewer', 'planner', 'builder', 'custom']
const PERMS = ['', 'allow', 'ask', 'deny']
const PERM_KEYS = ['read', 'edit', 'bash', 'web', 'task'] as const

type Props = { profiles: AgentProfile[] }

export function AgentConfigEditorPanel({ profiles }: Props) {
  const editable = profiles.filter((p) => p.rawFormat === 'json' || p.rawFormat === 'markdown')
  const [selId, setSelId] = useState<string>(editable[0]?.id ?? '')
  const sel = editable.find((p) => p.id === selId) ?? editable[0]
  const [edits, setEdits] = useState<ProfileEdits>({})
  const [errors, setErrors] = useState<string[]>([])
  const [diff, setDiff] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)

  if (!sel) return <div className="config-editor">편집 가능한 OpenCode 프로필이 없습니다.</div>

  const req = () => ({
    rawConfigPath: sel.rawConfigPath,
    rawFormat: sel.rawFormat as 'json' | 'markdown',
    profileName: sel.name,
    edits,
  })
  const val = <K extends keyof ProfileEdits>(k: K, fallback: ProfileEdits[K]): ProfileEdits[K] =>
    (edits[k] !== undefined ? edits[k] : fallback)

  const onValidate = async () => { try { const r = await api.configPreview(req()); setErrors(r.errors); setMsg(r.ok ? '유효함' : null) } catch (e) { setErrors([String(e)]); setMsg(null) } }
  const onDiff = async () => { try { const r = await api.configPreview(req()); setErrors(r.errors); setDiff(r.diff || '(변경 없음)') } catch (e) { setErrors([String(e)]) } }
  const onApply = async () => { try { const r = await api.configApply(req()); setErrors(r.errors); setMsg(r.ok ? `적용됨 (백업: ${r.snapshotPath})` : null) } catch (e) { setErrors([String(e)]); setMsg(null) } }
  const onRollback = async () => { try { const r = await api.configRollback({ rawConfigPath: sel.rawConfigPath }); setMsg(r.ok ? `롤백됨 (${r.restoredFrom})` : `롤백 실패: ${r.error}`) } catch (e) { setMsg(`롤백 실패: ${e}`) } }

  return (
    <div className="config-editor">
      <select value={selId} onChange={(e) => { setSelId(e.target.value); setEdits({}); setDiff(null); setErrors([]); setMsg(null) }}>
        {editable.map((p) => <option key={p.id} value={p.id}>{p.provider}:{p.name} ({p.rawFormat})</option>)}
      </select>

      <label>model
        <input aria-label="model" value={String(val('model', sel.model ?? ''))} onChange={(e) => setEdits((s) => ({ ...s, model: e.target.value }))} />
      </label>
      <label>mode
        <select aria-label="mode" value={String(val('mode', sel.mode))} onChange={(e) => setEdits((s) => ({ ...s, mode: e.target.value }))}>
          {MODES.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
      </label>
      {PERM_KEYS.map((k) => (
        <label key={k}>{k}
          <select aria-label={`perm-${k}`} value={edits.permissions?.[k] ?? sel.permissions?.[k] ?? ''}
            onChange={(e) => setEdits((s) => ({ ...s, permissions: { ...s.permissions, [k]: e.target.value || undefined } }))}>
            {PERMS.map((p) => <option key={p} value={p}>{p || '(unset)'}</option>)}
          </select>
        </label>
      ))}
      <label>temperature
        <input aria-label="temperature" type="number" value={val('temperature', sel.temperature) ?? ''}
          onChange={(e) => setEdits((s) => ({ ...s, temperature: e.target.value === '' ? undefined : Number(e.target.value) }))} />
      </label>

      <div className="config-editor__actions">
        <button type="button" onClick={() => void onValidate()}>Validate</button>
        <button type="button" onClick={() => void onDiff()}>Diff</button>
        <button type="button" onClick={() => void onApply()}>Apply</button>
        <button type="button" onClick={() => void onRollback()}>Rollback</button>
      </div>

      {errors.length > 0 && <ul className="config-editor__errors">{errors.map((e, i) => <li key={i}>{e}</li>)}</ul>}
      {msg && <p className="config-editor__msg">{msg}</p>}
      {diff && <DiffViewer patch={diff} />}
    </div>
  )
}
