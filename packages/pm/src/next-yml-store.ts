import { createHash, randomUUID } from 'node:crypto'
import {
  closeSync,
  existsSync,
  fsyncSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import Ajv2020 from 'ajv/dist/2020.js'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import { z } from 'zod'
import {
  NextYmlJsonSchema,
  NextYmlSchema,
  ReviewSchema,
  TaskSchema,
  type NextYml,
  type NextYmlTask,
  type Project,
  type Review,
  type Task,
} from '@apc/shared'

const NEXT_FILE = 'next.yml'
const PROPOSAL_FILE = 'next.proposal.yml'
const MANAGED_TASK_PREFIX = 'next:'
const SHA256 = /^[0-9a-f]{64}$/

const ProposalFileSchema = z.object({
  apc: z.object({
    format: z.literal(1),
    base_sha256: z.string().regex(SHA256),
    proposal_sha256: z.string().regex(SHA256),
    created_at: z.string().min(1),
    note_conversions: z.array(z.object({
      note_id: z.string().min(1),
      next_task_id: z.string().regex(/^[a-z0-9_-]+$/),
    }).strict()).optional(),
  }).strict(),
  next: NextYmlSchema,
}).strict()

type ProposalFile = z.infer<typeof ProposalFileSchema>
type Registry = Pick<{ get(id: string): Project | undefined }, 'get'>

export type NextYmlErrorCode =
  | 'project-not-found'
  | 'ambiguous-next-yml'
  | 'invalid-next-yml'
  | 'invalid-proposal'
  | 'proposal-not-found'
  | 'proposal-conflict'
  | 'proposal-changed'
  | 'task-not-found'
  | 'invalid-task-id'
  | 'invalid-due-date'
  | 'empty-title'
  | 'unsupported-status'
  | 'multiple-blockers'
  | 'career-pii-detected'

export class NextYmlStoreError extends Error {
  constructor(readonly code: NextYmlErrorCode) {
    super(code)
    this.name = 'NextYmlStoreError'
  }
}

export type NextYmlProposal = {
  baseHash: string
  proposalHash: string
  document: NextYml
  tasks: Task[]
  conflict: boolean
  noteConversions: Array<{ noteId: string; nextTaskId: string }>
}

export type NextYmlProjectSnapshot =
  | { managed: false }
  | {
    managed: true
    filePath: string
    canonicalHash: string
    document: NextYml
    tasks: Task[]
    proposal?: NextYmlProposal
    proposalError?: 'invalid-proposal'
  }

export type NextYmlTaskCache = {
  replaceNextYmlTasks(projectId: string, tasks: Task[]): void
}

export type ManagedTaskMutationResult =
  | { ok: true; task: Task; pendingApproval: true; proposalHash: string }
  | { ok: false; reason: NextYmlErrorCode }

export type ProposalDecisionResult =
  | { ok: true; tasks: Task[]; noteConversions?: Array<{ noteId: string; nextTaskId: string }> }
  | { ok: false; reason: NextYmlErrorCode }

export type ManagedReviewResult =
  | { ok: true; tasks: Task[]; pendingApproval: true; proposalHash: string }
  | { ok: false; reason: NextYmlErrorCode }

export type ManagedNoteTaskResult =
  | { ok: true; task: Task; pendingApproval: true; proposalHash: string }
  | { ok: false; reason: NextYmlErrorCode }

export type CreateManagedTaskInput = {
  title: string
  status?: Task['status']
  priority?: Task['priority']
  dueDate?: string
  source?: string
  note?: string
}

export type UpdateManagedTaskInput = {
  taskId: string
  title: string
  status: Task['status']
  priority: Task['priority']
  dueDate?: string
}

type LocatedProject =
  | { managed: false }
  | { managed: true; project: Project; repoPath: string; filePath: string; proposalPath: string }

type StoreOptions = {
  now?: () => Date
  nextTaskId?: () => string
  rename?: typeof renameSync
}

const ajv = new Ajv2020({ allErrors: true, strict: true })
const validateJsonSchema = ajv.compile(NextYmlJsonSchema)

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function isLocalPath(value: string): boolean {
  // Keep Windows drive paths local while excluding ssh://, file://, and other URI targets.
  return /^[A-Za-z]:[\\/]/.test(value) || !/^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(value)
}

function isRealIsoDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return false
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day
}

function isOneLine(value: string | undefined): boolean {
  return value === undefined || (!value.includes('\n') && !value.includes('\r'))
}

function validateSemantics(document: NextYml): void {
  if (!isRealIsoDate(document.updated) || !isOneLine(document.focus)) {
    throw new NextYmlStoreError('invalid-next-yml')
  }
  const ids = new Set<string>()
  for (const task of document.tasks) {
    if (ids.has(task.id)) throw new NextYmlStoreError('invalid-next-yml')
    ids.add(task.id)
    if (!isOneLine(task.title) || !isOneLine(task.source) || !isOneLine(task.note)) {
      throw new NextYmlStoreError('invalid-next-yml')
    }
    if (task.due && !isRealIsoDate(task.due)) throw new NextYmlStoreError('invalid-next-yml')
  }
  for (const task of document.tasks) {
    if (task.blocked_by && (!ids.has(task.blocked_by) || task.blocked_by === task.id)) {
      throw new NextYmlStoreError('invalid-next-yml')
    }
    if (task.status === 'blocked' && !task.blocked_by) {
      throw new NextYmlStoreError('invalid-next-yml')
    }
  }
}

function careerText(document: NextYml, rawText?: string): string {
  // Match the root validator's fail-closed behavior for comments and every scalar too.
  return rawText ?? JSON.stringify(document)
}

function validateCareerPii(document: NextYml, repoPath: string, rawText?: string): void {
  if (document.project !== 'career' && basename(repoPath).toLocaleLowerCase() !== 'career') return
  const text = careerText(document, rawText)
  const email = /[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/
  const phone = /(?<!\d)(?:(?:\+?82[-.\s]?)?0?1[016789]|0(?:2|[3-6][1-5]))[-.\s]?\d{3,4}[-.\s]?\d{4}(?!\d)/
  if (email.test(text) || phone.test(text)) throw new NextYmlStoreError('career-pii-detected')

  const denylistPath = join(repoPath, '.pii-denylist.txt')
  if (!existsSync(denylistPath)) return
  const denied = readFileSync(denylistPath, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
  const lowered = text.toLocaleLowerCase()
  if (denied.some((term) => lowered.includes(term.toLocaleLowerCase()))) {
    throw new NextYmlStoreError('career-pii-detected')
  }
}

function validateDocument(input: unknown, repoPath: string, rawText?: string): NextYml {
  if (!validateJsonSchema(input)) throw new NextYmlStoreError('invalid-next-yml')
  const parsed = NextYmlSchema.safeParse(input)
  if (!parsed.success) throw new NextYmlStoreError('invalid-next-yml')
  validateSemantics(parsed.data)
  validateCareerPii(parsed.data, repoPath, rawText)
  return parsed.data
}

function renderNextYml(document: NextYml): string {
  return stringifyYaml(document, { lineWidth: 0 })
}

function proposalDigest(
  document: NextYml,
  noteConversions: Array<{ noteId: string; nextTaskId: string }> = [],
): string {
  return sha256(`${renderNextYml(document)}\0${JSON.stringify(noteConversions)}`)
}

function managedTaskId(projectId: string, nextTaskId: string): string {
  return `${MANAGED_TASK_PREFIX}${projectId}:${nextTaskId}`
}

function rawNextTaskId(projectId: string, taskId: string): string | undefined {
  const prefix = `${MANAGED_TASK_PREFIX}${projectId}:`
  return taskId.startsWith(prefix) ? taskId.slice(prefix.length) : undefined
}

function taskSource(source: string | undefined): Task['source'] {
  if (!source || source === 'manual') return 'manual'
  if (source.startsWith('chat:')) return 'conversation'
  if (source.startsWith('note:')) return 'note'
  if (source.startsWith('review:')) return 'review'
  return 'system'
}

export function nextYmlTaskToTask(projectId: string, task: NextYmlTask, updated: string): Task {
  const blocker = task.blocked_by ? [managedTaskId(projectId, task.blocked_by)] : []
  return TaskSchema.parse({
    id: managedTaskId(projectId, task.id),
    projectId,
    title: task.title,
    status: task.status === 'doing' ? 'in_progress' : task.status === 'done' ? 'done' : 'todo',
    assigneeType: 'human',
    priority: task.priority === 'P0' ? 'high' : task.priority === 'P1' ? 'medium' : 'low',
    dueDate: task.due,
    acceptanceCriteria: task.note ? [task.note] : [],
    blockedBy: blocker,
    reviewStatus: 'none',
    source: taskSource(task.source),
    sourceRef: `${NEXT_FILE}#${task.id}`,
    contextPackage: task.source?.startsWith('chat:') ? task.source.slice('chat:'.length) : undefined,
    updatedAt: `${updated}T00:00:00.000Z`,
  })
}

export function nextYmlToTasks(projectId: string, document: NextYml): Task[] {
  return document.tasks.map((task) => nextYmlTaskToTask(projectId, task, document.updated))
}

function nextPriority(priority: Task['priority']): NextYmlTask['priority'] {
  return priority === 'high' ? 'P0' : priority === 'medium' ? 'P1' : 'P2'
}

function nextStatus(status: Task['status'], blocked: boolean): NextYmlTask['status'] {
  if (status === 'review' || status === 'rejected') {
    throw new NextYmlStoreError('unsupported-status')
  }
  if (blocked) return 'blocked'
  if (status === 'todo') return 'todo'
  if (status === 'in_progress') return 'doing'
  if (status === 'done') return 'done'
  throw new NextYmlStoreError('unsupported-status')
}

function normalizeDueDate(value: string | undefined): string | undefined {
  const normalized = value?.trim()
  if (!normalized) return undefined
  if (!isRealIsoDate(normalized)) throw new NextYmlStoreError('invalid-due-date')
  return normalized
}

function cloneDocument(document: NextYml): NextYml {
  return NextYmlSchema.parse(structuredClone(document))
}

function localIsoDate(date: Date): string {
  const year = String(date.getFullYear()).padStart(4, '0')
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function proposalToYaml(proposal: ProposalFile): string {
  return stringifyYaml(proposal, { lineWidth: 0 })
}

export function atomicWriteFile(
  filePath: string,
  content: string,
  rename: typeof renameSync = renameSync,
): void {
  const directory = dirname(filePath)
  const temporary = join(directory, `.${basename(filePath)}.${process.pid}.${randomUUID()}.tmp`)
  let descriptor: number | undefined
  try {
    descriptor = openSync(temporary, 'wx', statMode(filePath))
    writeFileSync(descriptor, content, 'utf8')
    fsyncSync(descriptor)
    closeSync(descriptor)
    descriptor = undefined
    rename(temporary, filePath)
    try {
      const directoryDescriptor = openSync(directory, 'r')
      try { fsyncSync(directoryDescriptor) } finally { closeSync(directoryDescriptor) }
    } catch {
      // Windows does not fsync directories. The file itself was fsynced before rename.
    }
  } catch (error) {
    if (descriptor !== undefined) closeSync(descriptor)
    if (existsSync(temporary)) unlinkSync(temporary)
    throw error
  }
}

function statMode(filePath: string): number {
  try {
    return statSync(filePath).mode & 0o777
  } catch {
    return 0o666
  }
}

function walkParents(start: string): string[] {
  const paths: string[] = []
  let current = resolve(start)
  while (true) {
    paths.push(current)
    const parent = dirname(current)
    if (parent === current) return paths
    current = parent
  }
}

/** Locate the root-workspace canonical contract, including from a linked Git worktree. */
export function findCanonicalNextYmlSchema(start = process.cwd()): string | undefined {
  const roots = new Set(walkParents(start))
  const gitFile = join(start, '.git')
  if (existsSync(gitFile)) {
    try {
      const gitText = readFileSync(gitFile, 'utf8').trim()
      const match = /^gitdir:\s*(.+)$/i.exec(gitText)
      if (match?.[1]) {
        const gitDir = isAbsolute(match[1]) ? match[1] : resolve(start, match[1])
        for (const parent of walkParents(gitDir)) roots.add(parent)
      }
    } catch {
      // A .git directory is normal; only linked-worktree pointer files are useful here.
    }
  }
  for (const root of roots) {
    const candidate = join(root, 'shared', 'contracts', 'next-actions', 'next.schema.json')
    if (existsSync(candidate)) return candidate
  }
  return undefined
}

export class NextYmlStore {
  private readonly now: () => Date
  private readonly nextTaskId: () => string
  private readonly rename: typeof renameSync

  constructor(
    private readonly registry: Registry,
    private readonly cache?: NextYmlTaskCache,
    options: StoreOptions = {},
  ) {
    this.now = options.now ?? (() => new Date())
    this.nextTaskId = options.nextTaskId ?? (() => `task-${randomUUID()}`)
    this.rename = options.rename ?? renameSync
  }

  locate(projectId: string): LocatedProject {
    const project = this.registry.get(projectId)
    if (!project) throw new NextYmlStoreError('project-not-found')
    const candidates = project.repoPaths
      .filter(isLocalPath)
      .map((repoPath) => resolve(repoPath))
      .filter((repoPath) => existsSync(join(repoPath, NEXT_FILE)))
    if (candidates.length === 0) return { managed: false }
    if (candidates.length > 1) throw new NextYmlStoreError('ambiguous-next-yml')
    const repoPath = candidates[0]!
    return {
      managed: true,
      project,
      repoPath,
      filePath: join(repoPath, NEXT_FILE),
      proposalPath: join(repoPath, PROPOSAL_FILE),
    }
  }

  isManaged(projectId: string): boolean {
    return this.locate(projectId).managed
  }

  readProject(projectId: string): NextYmlProjectSnapshot {
    const location = this.locate(projectId)
    if (!location.managed) return location
    const canonicalText = readFileSync(location.filePath, 'utf8')
    const document = this.parseCanonical(canonicalText, location.repoPath)
    const canonicalHash = sha256(canonicalText)
    const tasks = nextYmlToTasks(projectId, document)
    this.refreshCache(projectId, tasks)

    if (!existsSync(location.proposalPath)) {
      return { managed: true, filePath: location.filePath, canonicalHash, document, tasks }
    }
    try {
      const proposal = this.readProposal(location, projectId, canonicalHash)
      return { managed: true, filePath: location.filePath, canonicalHash, document, tasks, proposal }
    } catch (error) {
      if (error instanceof NextYmlStoreError && error.code === 'invalid-proposal') {
        return {
          managed: true,
          filePath: location.filePath,
          canonicalHash,
          document,
          tasks,
          proposalError: 'invalid-proposal',
        }
      }
      throw error
    }
  }

  createTask(projectId: string, input: CreateManagedTaskInput): ManagedTaskMutationResult {
    try {
      const title = input.title.trim()
      if (!title) throw new NextYmlStoreError('empty-title')
      const id = this.nextTaskId()
      if (!/^[a-z0-9_-]+$/.test(id)) throw new NextYmlStoreError('invalid-task-id')
      const task: NextYmlTask = {
        id,
        title,
        priority: nextPriority(input.priority ?? 'medium'),
        status: nextStatus(input.status ?? 'todo', false),
        due: normalizeDueDate(input.dueDate),
        source: input.source ?? 'manual',
        note: input.note?.trim() || undefined,
      }
      const proposal = this.propose(projectId, (document) => {
        if (document.tasks.some((existing) => existing.id === id)) {
          throw new NextYmlStoreError('invalid-task-id')
        }
        document.tasks.push(task)
        return document
      })
      return {
        ok: true,
        task: nextYmlTaskToTask(projectId, task, proposal.document.updated),
        pendingApproval: true,
        proposalHash: proposal.proposalHash,
      }
    } catch (error) {
      return this.mutationFailure(error)
    }
  }

  proposeNoteTask(
    projectId: string,
    input: { noteId: string; title: string; priority?: Task['priority']; dueDate?: string },
  ): ManagedNoteTaskResult {
    try {
      const title = input.title.trim()
      if (!title) throw new NextYmlStoreError('empty-title')
      const id = `note-${sha256(input.noteId).slice(0, 16)}`
      const task: NextYmlTask = {
        id,
        title,
        priority: nextPriority(input.priority ?? 'medium'),
        status: 'todo',
        due: normalizeDueDate(input.dueDate),
        source: `note:${input.noteId}`,
      }
      const proposal = this.propose(projectId, (document) => {
        const index = document.tasks.findIndex((existing) => existing.id === id)
        if (index < 0) document.tasks.push(task)
        else document.tasks[index] = { ...document.tasks[index]!, ...task }
        return document
      }, [{ noteId: input.noteId, nextTaskId: id }])
      return {
        ok: true,
        task: nextYmlTaskToTask(projectId, task, proposal.document.updated),
        pendingApproval: true,
        proposalHash: proposal.proposalHash,
      }
    } catch (error) {
      return { ok: false, reason: this.errorCode(error) }
    }
  }

  updateTask(projectId: string, input: UpdateManagedTaskInput): ManagedTaskMutationResult {
    try {
      const title = input.title.trim()
      if (!title) throw new NextYmlStoreError('empty-title')
      const rawId = rawNextTaskId(projectId, input.taskId)
      if (!rawId) throw new NextYmlStoreError('invalid-task-id')
      let updated: NextYmlTask | undefined
      const proposal = this.propose(projectId, (document) => {
        const index = document.tasks.findIndex((task) => task.id === rawId)
        if (index < 0) throw new NextYmlStoreError('task-not-found')
        const current = document.tasks[index]!
        const blockedBy = input.status === 'done' ? undefined : current.blocked_by
        updated = {
          ...current,
          title,
          priority: nextPriority(input.priority),
          status: nextStatus(input.status, Boolean(blockedBy)),
          due: normalizeDueDate(input.dueDate),
          blocked_by: blockedBy,
        }
        document.tasks[index] = updated
        return document
      })
      return {
        ok: true,
        task: nextYmlTaskToTask(projectId, updated!, proposal.document.updated),
        pendingApproval: true,
        proposalHash: proposal.proposalHash,
      }
    } catch (error) {
      return this.mutationFailure(error)
    }
  }

  deleteTask(projectId: string, taskId: string): ManagedTaskMutationResult {
    try {
      const rawId = rawNextTaskId(projectId, taskId)
      if (!rawId) throw new NextYmlStoreError('invalid-task-id')
      let deleted: NextYmlTask | undefined
      const proposal = this.propose(projectId, (document) => {
        const index = document.tasks.findIndex((task) => task.id === rawId)
        if (index < 0) throw new NextYmlStoreError('task-not-found')
        if (document.tasks.some((task) => task.blocked_by === rawId)) {
          throw new NextYmlStoreError('proposal-conflict')
        }
        deleted = document.tasks[index]
        document.tasks.splice(index, 1)
        return document
      })
      return {
        ok: true,
        task: nextYmlTaskToTask(projectId, deleted!, proposal.document.updated),
        pendingApproval: true,
        proposalHash: proposal.proposalHash,
      }
    } catch (error) {
      return this.mutationFailure(error)
    }
  }

  setBlockedBy(projectId: string, taskId: string, blockers: string[]): ManagedTaskMutationResult {
    try {
      if (blockers.length > 1) throw new NextYmlStoreError('multiple-blockers')
      const rawId = rawNextTaskId(projectId, taskId)
      const rawBlocker = blockers[0] ? rawNextTaskId(projectId, blockers[0]) : undefined
      if (!rawId || (blockers[0] && !rawBlocker)) throw new NextYmlStoreError('invalid-task-id')
      let updated: NextYmlTask | undefined
      const proposal = this.propose(projectId, (document) => {
        const index = document.tasks.findIndex((task) => task.id === rawId)
        if (index < 0) throw new NextYmlStoreError('task-not-found')
        if (rawBlocker && (rawBlocker === rawId || !document.tasks.some((task) => task.id === rawBlocker))) {
          throw new NextYmlStoreError('proposal-conflict')
        }
        const current = document.tasks[index]!
        updated = {
          ...current,
          status: rawBlocker ? 'blocked' : current.status === 'blocked' ? 'todo' : current.status,
          blocked_by: rawBlocker,
        }
        document.tasks[index] = updated
        return document
      })
      return {
        ok: true,
        task: nextYmlTaskToTask(projectId, updated!, proposal.document.updated),
        pendingApproval: true,
        proposalHash: proposal.proposalHash,
      }
    } catch (error) {
      return this.mutationFailure(error)
    }
  }

  applyReview(projectId: string, review: Review): ManagedReviewResult {
    try {
      const parsedReview = ReviewSchema.parse(review)
      const rawId = rawNextTaskId(projectId, parsedReview.taskId)
      if (!rawId) throw new NextYmlStoreError('invalid-task-id')
      const followupIds = parsedReview.nextTasks.map((title, index) => (
        `review-${sha256(`${parsedReview.id}\0${index}\0${title}`).slice(0, 16)}`
      ))
      const proposal = this.propose(projectId, (document) => {
        const parentIndex = document.tasks.findIndex((task) => task.id === rawId)
        if (parentIndex < 0) throw new NextYmlStoreError('task-not-found')
        const parent = document.tasks[parentIndex]!
        document.tasks[parentIndex] = {
          ...parent,
          status: parsedReview.status === 'needs_changes' ? 'doing' : 'done',
          blocked_by: undefined,
        }
        parsedReview.nextTasks.forEach((title, index) => {
          const id = followupIds[index]!
          const nextTask: NextYmlTask = {
            id,
            title: title.trim(),
            priority: 'P1',
            status: 'todo',
            source: `review:${parsedReview.id}`,
          }
          const existing = document.tasks.findIndex((task) => task.id === id)
          if (existing < 0) document.tasks.push(nextTask)
          else document.tasks[existing] = nextTask
        })
        return document
      })
      const created = proposal.document.tasks
        .filter((task) => followupIds.includes(task.id))
        .map((task) => nextYmlTaskToTask(projectId, task, proposal.document.updated))
      return {
        ok: true,
        tasks: created,
        pendingApproval: true,
        proposalHash: proposal.proposalHash,
      }
    } catch (error) {
      return { ok: false, reason: this.errorCode(error) }
    }
  }

  proposeDerivedTasks(
    projectId: string,
    tasks: readonly Task[],
    source: string,
    options: { replaceSource?: boolean } = {},
  ): { ok: true; proposalHash: string } | { ok: false; reason: NextYmlErrorCode } {
    try {
      const proposal = this.propose(projectId, (document) => {
        const keep = new Set<string>()
        for (const task of tasks) {
          const kind = task.id.startsWith('req:') ? 'chat-request' : 'chat-todo'
          const id = `${kind}-${sha256(task.id).slice(0, 16)}`
          keep.add(id)
          const nextTask: NextYmlTask = {
            id,
            title: task.title.trim(),
            priority: nextPriority(task.priority),
            status: nextStatus(task.status, task.blockedBy.length > 0),
            due: normalizeDueDate(task.dueDate),
            source,
            note: task.acceptanceCriteria[0],
          }
          const index = document.tasks.findIndex((existing) => existing.id === id)
          if (index < 0) document.tasks.push(nextTask)
          else document.tasks[index] = { ...document.tasks[index]!, ...nextTask }
        }
        if (options.replaceSource) {
          document.tasks = document.tasks.filter((task) => task.source !== source || keep.has(task.id))
        }
        return document
      })
      return { ok: true, proposalHash: proposal.proposalHash }
    } catch (error) {
      return { ok: false, reason: this.errorCode(error) }
    }
  }

  approve(projectId: string, expectedProposalHash: string): ProposalDecisionResult {
    try {
      const location = this.locate(projectId)
      if (!location.managed || !existsSync(location.proposalPath)) {
        throw new NextYmlStoreError('proposal-not-found')
      }
      const canonicalText = readFileSync(location.filePath, 'utf8')
      const canonicalHash = sha256(canonicalText)
      const proposal = this.readProposal(location, projectId, canonicalHash)
      if (proposal.proposalHash !== expectedProposalHash) {
        throw new NextYmlStoreError('proposal-changed')
      }
      if (proposal.conflict) throw new NextYmlStoreError('proposal-conflict')
      atomicWriteFile(location.filePath, renderNextYml(proposal.document), this.rename)
      const tasks = nextYmlToTasks(projectId, proposal.document)
      this.refreshCache(projectId, tasks)
      try { unlinkSync(location.proposalPath) } catch { /* canonical write already succeeded */ }
      return {
        ok: true,
        tasks,
        noteConversions: proposal.noteConversions.length > 0 ? proposal.noteConversions : undefined,
      }
    } catch (error) {
      return { ok: false, reason: this.errorCode(error) }
    }
  }

  discard(projectId: string, expectedProposalHash: string): ProposalDecisionResult {
    try {
      const location = this.locate(projectId)
      if (!location.managed || !existsSync(location.proposalPath)) {
        throw new NextYmlStoreError('proposal-not-found')
      }
      const canonicalHash = sha256(readFileSync(location.filePath, 'utf8'))
      const proposal = this.readProposal(location, projectId, canonicalHash)
      if (proposal.proposalHash !== expectedProposalHash) {
        throw new NextYmlStoreError('proposal-changed')
      }
      unlinkSync(location.proposalPath)
      return { ok: true, tasks: nextYmlToTasks(projectId, this.parseCanonical(
        readFileSync(location.filePath, 'utf8'),
        location.repoPath,
      )) }
    } catch (error) {
      return { ok: false, reason: this.errorCode(error) }
    }
  }

  private parseCanonical(text: string, repoPath: string): NextYml {
    try {
      return validateDocument(parseYaml(text, { maxAliasCount: 0 }), repoPath, text)
    } catch (error) {
      if (error instanceof NextYmlStoreError) throw error
      throw new NextYmlStoreError('invalid-next-yml')
    }
  }

  private readProposal(
    location: Extract<LocatedProject, { managed: true }>,
    projectId: string,
    canonicalHash: string,
  ): NextYmlProposal {
    try {
      const input = parseYaml(readFileSync(location.proposalPath, 'utf8'), { maxAliasCount: 0 })
      const parsed = ProposalFileSchema.parse(input)
      const document = validateDocument(parsed.next, location.repoPath)
      const noteConversions = (parsed.apc.note_conversions ?? []).map((action) => ({
        noteId: action.note_id,
        nextTaskId: action.next_task_id,
      }))
      const proposalHash = proposalDigest(document, noteConversions)
      if (proposalHash !== parsed.apc.proposal_sha256) throw new Error('digest mismatch')
      return {
        baseHash: parsed.apc.base_sha256,
        proposalHash,
        document,
        tasks: nextYmlToTasks(projectId, document),
        conflict: parsed.apc.base_sha256 !== canonicalHash,
        noteConversions,
      }
    } catch (error) {
      if (error instanceof NextYmlStoreError && error.code === 'career-pii-detected') throw error
      throw new NextYmlStoreError('invalid-proposal')
    }
  }

  private propose(
    projectId: string,
    mutate: (document: NextYml) => NextYml,
    noteConversions: Array<{ noteId: string; nextTaskId: string }> = [],
  ): NextYmlProposal {
    const snapshot = this.readProject(projectId)
    if (!snapshot.managed) throw new NextYmlStoreError('invalid-next-yml')
    if (snapshot.proposalError) throw new NextYmlStoreError('invalid-proposal')
    if (snapshot.proposal?.conflict) throw new NextYmlStoreError('proposal-conflict')
    const document = cloneDocument(snapshot.proposal?.document ?? snapshot.document)
    const mutated = mutate(document)
    mutated.updated = localIsoDate(this.now())
    const location = this.locate(projectId)
    if (!location.managed) throw new NextYmlStoreError('invalid-next-yml')
    const validated = validateDocument(mutated, location.repoPath)
    const mergedConversions = [
      ...(snapshot.proposal?.noteConversions ?? []),
      ...noteConversions,
    ].filter((action, index, all) => (
      all.findIndex((candidate) => candidate.noteId === action.noteId) === index
    ))
    const proposalHash = proposalDigest(validated, mergedConversions)
    const proposalFile: ProposalFile = {
      apc: {
        format: 1,
        base_sha256: snapshot.canonicalHash,
        proposal_sha256: proposalHash,
        created_at: this.now().toISOString(),
        note_conversions: mergedConversions.length > 0
          ? mergedConversions.map((action) => ({
            note_id: action.noteId,
            next_task_id: action.nextTaskId,
          }))
          : undefined,
      },
      next: validated,
    }
    atomicWriteFile(location.proposalPath, proposalToYaml(proposalFile), this.rename)
    return {
      baseHash: snapshot.canonicalHash,
      proposalHash,
      document: validated,
      tasks: nextYmlToTasks(projectId, validated),
      conflict: false,
      noteConversions: mergedConversions,
    }
  }

  private mutationFailure(error: unknown): ManagedTaskMutationResult {
    return { ok: false, reason: this.errorCode(error) }
  }

  private errorCode(error: unknown): NextYmlErrorCode {
    return error instanceof NextYmlStoreError ? error.code : 'invalid-next-yml'
  }

  private refreshCache(projectId: string, tasks: Task[]): void {
    try {
      this.cache?.replaceNextYmlTasks(projectId, tasks)
    } catch {
      // The cache is disposable. A cache failure must never hide or invalidate canonical file truth.
    }
  }
}
