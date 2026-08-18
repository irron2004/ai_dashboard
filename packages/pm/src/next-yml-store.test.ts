import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Ajv2020 from 'ajv/dist/2020.js'
import { parse, stringify } from 'yaml'
import {
  NextYmlJsonSchema,
  NextYmlSchema,
  type NextYml,
  type Project,
  type Task,
} from '@apc/shared'
import {
  NextYmlStore,
  atomicWriteFile,
  findCanonicalNextYmlSchema,
} from './next-yml-store.js'

const DOCUMENT: NextYml = {
  project: 'demo',
  status: 'active',
  focus: 'File-backed work',
  updated: '2026-07-26',
  tasks: [{
    id: 'contract',
    title: 'Lock the contract',
    priority: 'P0',
    status: 'doing',
    source: 'agent:codex',
    note: 'Keep it deterministic',
  }, {
    id: 'ui',
    title: 'Wire the UI',
    priority: 'P1',
    status: 'blocked',
    blocked_by: 'contract',
    due: '2026-07-31',
  }],
}

function project(id: string, repoPaths: string[]): Project {
  return {
    id,
    name: id,
    status: 'active',
    projectType: 'git',
    domain: 'project-docs',
    repoPaths,
    vaultPaths: [],
    sourcePaths: [],
  }
}

describe('NextYmlStore', () => {
  let dir: string
  let projects: Map<string, Project>

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'apc-next-yml-'))
    projects = new Map([['p1', project('p1', [dir])]])
    writeFileSync(join(dir, 'next.yml'), stringify(DOCUMENT), 'utf8')
  })

  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  function store(overrides: ConstructorParameters<typeof NextYmlStore>[2] = {}): NextYmlStore {
    return new NextYmlStore(
      { get: (id) => projects.get(id) },
      undefined,
      {
        now: () => new Date('2026-07-27T09:00:00.000Z'),
        nextTaskId: () => 'dashboard-task',
        ...overrides,
      },
    )
  }

  test('reads next.yml as the canonical Task surface and maps every field', () => {
    const snapshot = store().readProject('p1')
    expect(snapshot.managed).toBe(true)
    if (!snapshot.managed) return
    expect(snapshot.tasks).toEqual([
      expect.objectContaining({
        id: 'next:p1:contract',
        projectId: 'p1',
        status: 'in_progress',
        priority: 'high',
        source: 'system',
        sourceRef: 'next.yml#contract',
        acceptanceCriteria: ['Keep it deterministic'],
      }),
      expect.objectContaining({
        id: 'next:p1:ui',
        status: 'todo',
        priority: 'medium',
        dueDate: '2026-07-31',
        blockedBy: ['next:p1:contract'],
      }),
    ])
  })

  test('keeps an unquoted YAML date as the contract string', () => {
    writeFileSync(join(dir, 'next.yml'), [
      'project: demo',
      'status: active',
      'updated: 2026-07-27',
      'tasks: []',
      '',
    ].join('\n'), 'utf8')
    const snapshot = store().readProject('p1')
    expect(snapshot.managed && snapshot.document.updated).toBe('2026-07-27')
  })

  test('treats a project without next.yml as legacy', () => {
    projects.set('legacy', project('legacy', [join(dir, 'missing')]))
    expect(store().readProject('legacy')).toEqual({ managed: false })
  })

  test('rejects ambiguous repositories instead of choosing a write target', () => {
    const other = mkdtempSync(join(tmpdir(), 'apc-next-yml-other-'))
    try {
      writeFileSync(join(other, 'next.yml'), stringify(DOCUMENT), 'utf8')
      projects.set('p1', project('p1', [dir, other]))
      expect(() => store().readProject('p1')).toThrow('ambiguous-next-yml')
    } finally {
      rmSync(other, { recursive: true, force: true })
    }
  })

  test.each([
    [{ ...DOCUMENT, updated: '2026-02-30' }],
    [{ ...DOCUMENT, focus: 'two\nlines' }],
    [{ ...DOCUMENT, tasks: [...DOCUMENT.tasks, DOCUMENT.tasks[0]!] }],
    [{ ...DOCUMENT, tasks: [{ ...DOCUMENT.tasks[0], status: 'blocked', blocked_by: undefined }] }],
    [{ ...DOCUMENT, tasks: [{ ...DOCUMENT.tasks[0], blocked_by: 'ghost' }] }],
  ])('rejects semantic values rejected by the root validator', (document) => {
    writeFileSync(join(dir, 'next.yml'), stringify(document), 'utf8')
    expect(() => store().readProject('p1')).toThrow('invalid-next-yml')
  })

  test('creates a proposal without changing canonical and approves only the shown hash', () => {
    const before = readFileSync(join(dir, 'next.yml'), 'utf8')
    const proposed = store().createTask('p1', {
      title: 'Add roundtrip coverage',
      status: 'todo',
      priority: 'high',
      dueDate: '2026-08-01',
    })
    expect(proposed).toEqual(expect.objectContaining({
      ok: true,
      pendingApproval: true,
      task: expect.objectContaining({ id: 'next:p1:dashboard-task' }),
    }))
    expect(readFileSync(join(dir, 'next.yml'), 'utf8')).toBe(before)
    expect(readFileSync(join(dir, 'next.proposal.yml'), 'utf8')).toContain('base_sha256')
    if (!proposed.ok) return

    expect(store().approve('p1', '0'.repeat(64))).toEqual({
      ok: false,
      reason: 'proposal-changed',
    })
    expect(store().approve('p1', proposed.proposalHash).ok).toBe(true)
    const written = NextYmlSchema.parse(parse(readFileSync(join(dir, 'next.yml'), 'utf8')))
    expect(written.updated).toBe('2026-07-27')
    expect(written.tasks.at(-1)).toEqual(expect.objectContaining({
      id: 'dashboard-task',
      priority: 'P0',
      due: '2026-08-01',
      source: 'manual',
    }))
  })

  test('merges later edits into a proposal sharing the same canonical base', () => {
    const created = store().createTask('p1', { title: 'New task' })
    expect(created.ok).toBe(true)
    const updated = store().updateTask('p1', {
      taskId: 'next:p1:contract',
      title: 'Lock the final contract',
      status: 'done',
      priority: 'low',
    })
    expect(updated.ok).toBe(true)
    const snapshot = store().readProject('p1')
    if (!snapshot.managed) throw new Error('expected managed')
    expect(snapshot.tasks.find((task) => task.id.endsWith(':contract'))?.title).toBe('Lock the contract')
    expect(snapshot.proposal?.tasks.find((task) => task.id.endsWith(':contract'))).toEqual(
      expect.objectContaining({ title: 'Lock the final contract', status: 'done', priority: 'low' }),
    )
    expect(snapshot.proposal?.tasks.some((task) => task.id.endsWith(':dashboard-task'))).toBe(true)
  })

  test('rejects Task-only review states even when the task is blocked', () => {
    expect(store().updateTask('p1', {
      taskId: 'next:p1:ui',
      title: 'Wire the UI',
      status: 'review',
      priority: 'medium',
    })).toEqual({ ok: false, reason: 'unsupported-status' })
  })

  test('preserves canonical and proposal when next.yml changes concurrently', () => {
    const proposed = store().updateTask('p1', {
      taskId: 'next:p1:contract',
      title: 'Proposed title',
      status: 'in_progress',
      priority: 'high',
    })
    if (!proposed.ok) throw new Error(proposed.reason)
    const external = { ...DOCUMENT, focus: 'External edit wins' }
    writeFileSync(join(dir, 'next.yml'), stringify(external), 'utf8')

    expect(store().approve('p1', proposed.proposalHash)).toEqual({
      ok: false,
      reason: 'proposal-conflict',
    })
    expect(parse(readFileSync(join(dir, 'next.yml'), 'utf8')).focus).toBe('External edit wins')
    expect(readFileSync(join(dir, 'next.proposal.yml'), 'utf8')).toContain('Proposed title')
  })

  test('routes extracted tasks into the same proposal', () => {
    const task = {
      id: 'todo:p1:session:1',
      projectId: 'p1',
      title: 'Follow up from chat',
      status: 'todo',
      assigneeType: 'agent',
      priority: 'medium',
      acceptanceCriteria: [],
      linkedWikiPages: [],
      blockedBy: [],
      reviewStatus: 'none',
      source: 'conversation',
    } satisfies Task
    const result = store().proposeDerivedTasks('p1', [task], 'chat:session-1', { replaceSource: true })
    expect(result.ok).toBe(true)
    const snapshot = store().readProject('p1')
    if (!snapshot.managed) throw new Error('expected managed')
    expect(snapshot.proposal?.document.tasks).toContainEqual(expect.objectContaining({
      id: expect.stringMatching(/^chat-todo-[0-9a-f]{16}$/),
      title: 'Follow up from chat',
      source: 'chat:session-1',
    }))
  })

  test('routes review completion and follow-ups into one proposal', () => {
    const result = store().applyReview('p1', {
      id: 'review-1',
      taskId: 'next:p1:contract',
      agentRunId: 'run-1',
      reviewer: 'human',
      status: 'approved',
      summary: 'Looks good',
      nextTasks: ['Document the decision'],
    })
    expect(result).toEqual(expect.objectContaining({
      ok: true,
      pendingApproval: true,
      tasks: [expect.objectContaining({ title: 'Document the decision', source: 'review' })],
    }))
    const snapshot = store().readProject('p1')
    if (!snapshot.managed) throw new Error('expected managed')
    expect(snapshot.document.tasks.find((task) => task.id === 'contract')?.status).toBe('doing')
    expect(snapshot.proposal?.document.tasks.find((task) => task.id === 'contract')?.status).toBe('done')
    expect(snapshot.proposal?.document.tasks).toContainEqual(expect.objectContaining({
      id: expect.stringMatching(/^review-[0-9a-f]{16}$/),
      source: 'review:review-1',
    }))
  })

  test('keeps note-conversion side effects attached while later edits merge', () => {
    const note = store().proposeNoteTask('p1', {
      noteId: 'note-1',
      title: 'Turn note into work',
      priority: 'high',
    })
    expect(note).toEqual(expect.objectContaining({
      ok: true,
      pendingApproval: true,
      task: expect.objectContaining({ source: 'note' }),
    }))
    const edit = store().updateTask('p1', {
      taskId: 'next:p1:contract',
      title: 'Edited alongside note',
      status: 'in_progress',
      priority: 'high',
    })
    if (!edit.ok) throw new Error(edit.reason)
    const approved = store().approve('p1', edit.proposalHash)
    expect(approved).toEqual(expect.objectContaining({
      ok: true,
      noteConversions: [{
        noteId: 'note-1',
        nextTaskId: expect.stringMatching(/^note-[0-9a-f]{16}$/),
      }],
    }))
  })

  test('blocks career email, phone, and local denylist values without echoing them', () => {
    const career = { ...DOCUMENT, project: 'career', tasks: [{
      ...DOCUMENT.tasks[0]!,
      title: 'Contact person!tag@example.com',
    }] }
    writeFileSync(join(dir, 'next.yml'), stringify(career), 'utf8')
    expect(() => store().readProject('p1')).toThrow('career-pii-detected')

    career.tasks[0]!.title = 'Call 010-1234-5678'
    writeFileSync(join(dir, 'next.yml'), stringify(career), 'utf8')
    expect(() => store().readProject('p1')).toThrow('career-pii-detected')

    writeFileSync(join(dir, '.pii-denylist.txt'), 'Secret Employer\n', 'utf8')
    career.tasks[0]!.title = 'Prepare Secret Employer packet'
    writeFileSync(join(dir, 'next.yml'), stringify(career), 'utf8')
    try {
      store().readProject('p1')
      throw new Error('expected PII rejection')
    } catch (error) {
      expect(String(error)).toContain('career-pii-detected')
      expect(String(error)).not.toContain('Secret Employer')
    }
  })

  test('scans comments in a career next.yml just like the root PII validator', () => {
    const text = stringify({ ...DOCUMENT, project: 'career' })
    writeFileSync(join(dir, 'next.yml'), `# Contact leak@example.com\n${text}`, 'utf8')
    expect(() => store().readProject('p1')).toThrow('career-pii-detected')
  })

  test('applies career PII checks by repository identity even if project metadata is wrong', () => {
    const careerDir = join(dir, 'career')
    mkdirSync(careerDir)
    writeFileSync(join(careerDir, 'next.yml'), stringify({
      ...DOCUMENT,
      project: 'misnamed',
      tasks: [{ ...DOCUMENT.tasks[0]!, title: 'Email leak@example.com' }],
    }), 'utf8')
    projects.set('career-project', project('career-project', [careerDir]))
    expect(() => store().readProject('career-project')).toThrow('career-pii-detected')
  })

  test('leaves canonical intact and removes temp files when rename fails', () => {
    const file = join(dir, 'atomic.yml')
    writeFileSync(file, 'old\n', 'utf8')
    expect(() => atomicWriteFile(file, 'new\n', () => {
      throw new Error('rename failed')
    })).toThrow('rename failed')
    expect(readFileSync(file, 'utf8')).toBe('old\n')
    expect(readdirSync(dir).filter((name) => name.includes('.atomic.yml.') && name.endsWith('.tmp'))).toEqual([])
  })

  test('refreshes the SQLite adapter as a derived cache only after canonical reads', () => {
    const replaceNextYmlTasks = vi.fn()
    const cached = new NextYmlStore(
      { get: (id) => projects.get(id) },
      { replaceNextYmlTasks },
      { now: () => new Date('2026-07-27T09:00:00.000Z') },
    )
    cached.readProject('p1')
    expect(replaceNextYmlTasks).toHaveBeenCalledWith('p1', expect.arrayContaining([
      expect.objectContaining({ id: 'next:p1:contract' }),
    ]))
  })

  test('never hides canonical file truth when the disposable cache fails', () => {
    const uncached = new NextYmlStore(
      { get: (id) => projects.get(id) },
      { replaceNextYmlTasks: () => { throw new Error('cache unavailable') } },
    )
    const snapshot = uncached.readProject('p1')
    expect(snapshot.managed && snapshot.tasks.map((task) => task.title)).toContain('Lock the contract')
  })
})

describe('NextYml contract equivalence', () => {
  const corpus: unknown[] = [
    DOCUMENT,
    { ...DOCUMENT, status: 'maintenance' },
    { ...DOCUMENT, extra: true },
    { ...DOCUMENT, tasks: [{ ...DOCUMENT.tasks[0], id: 'Uppercase' }] },
    { ...DOCUMENT, tasks: [{ ...DOCUMENT.tasks[0], priority: 'high' }] },
    { project: 'demo', status: 'active', updated: '2026-07-27' },
  ]

  test('bundled runtime mirror matches the root canonical JSON Schema when available', () => {
    const canonicalPath = findCanonicalNextYmlSchema()
    if (!canonicalPath) return
    expect(NextYmlJsonSchema).toEqual(JSON.parse(readFileSync(canonicalPath, 'utf8')))
  })

  test('Zod and JSON Schema accept the same structural corpus', () => {
    const validate = new Ajv2020({ strict: true }).compile(NextYmlJsonSchema)
    for (const input of corpus) {
      expect(NextYmlSchema.safeParse(input).success).toBe(validate(input))
    }
  })
})
