import { describe, expect, test } from 'vitest'
import { sanitizeWritePlan } from './make-drivers.js'
import type { KhWritePlan } from '@apc/shared'

const plan = (operations: unknown[]): KhWritePlan =>
  ({ write_plan_id: 'WP-1', created_by: 'lead', operations } as unknown as KhWritePlan)

describe('sanitizeWritePlan', () => {
  test('drops non-markdown authoring ops (lead plan JSONs), keeps the markdown wiki ops', () => {
    const { plan: out, dropped } = sanitizeWritePlan(plan([
      { op: 'create_file', path: 'vault-staging/inbox/graph_update_plans/g.json', content: '{}' },
      { op: 'create_file', path: 'vault-staging/nodes/decision-x.md', content: '# x' },
      { op: 'append_section', path: 'vault-staging/current.md', content: 'hi' },
      { op: 'add_backlink', path: 'vault-staging/nodes/decision-x.md' },
    ]))
    expect(out.operations.map((o: { path: string }) => o.path)).toEqual([
      'vault-staging/nodes/decision-x.md', 'vault-staging/current.md', 'vault-staging/nodes/decision-x.md',
    ])
    expect(dropped).toEqual([{ op: 'create_file', path: 'vault-staging/inbox/graph_update_plans/g.json', reason: 'non_markdown_write' }])
  })

  test('leaves raw-path and delete ops for PolicyGuard to hard-block (not silently dropped)', () => {
    const ops = [
      { op: 'create_file', path: 'raw/x.json', content: '{}' }, // raw write — dangerous, keep for the gate
      { op: 'delete_file', path: 'old.md' },                     // delete — keep for the gate
    ]
    const { plan: out, dropped } = sanitizeWritePlan(plan(ops))
    expect(out.operations).toEqual(ops)
    expect(dropped).toEqual([])
  })

  test('no offending ops → unchanged', () => {
    const ops = [{ op: 'create_file', path: 'vault-staging/nodes/n.md', content: '#' }]
    const { plan: out, dropped } = sanitizeWritePlan(plan(ops))
    expect(out.operations).toEqual(ops)
    expect(dropped).toEqual([])
  })
})
