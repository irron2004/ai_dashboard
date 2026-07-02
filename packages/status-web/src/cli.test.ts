import { afterEach, describe, expect, test } from 'vitest'
import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'
import { openDb, migrate, ProjectRegistry } from '@apc/core'
import { migratePm, TaskStore, AgentRunStore } from '@apc/pm'
import { createStatusServer } from './server.js'
import { makeBuildOverview, describeMissingDb } from './cli.js'

describe('makeBuildOverview (P3 seam wiring)', () => {
  let server: Server
  afterEach(() => new Promise<void>((res) => (server ? server.close(() => res()) : res())))

  test('serves real workspace data through /api/overview', async () => {
    const db = openDb(':memory:'); migrate(db); migratePm(db)
    const registry = new ProjectRegistry(db); const tasks = new TaskStore(db); const runs = new AgentRunStore(db)
    registry.register({ id: 'p1', name: 'Proj One', status: 'active', projectType: 'git', repoPaths: ['/p1'], vaultPaths: [], sourcePaths: [], domain: 'project-docs' })
    tasks.create({ id: 'T1', projectId: 'p1', title: 'active', status: 'in_progress', assigneeType: 'agent', priority: 'high', reviewStatus: 'none', acceptanceCriteria: [], linkedWikiPages: [], blockedBy: [] })

    const build = makeBuildOverview({ registry, tasks, runs })
    server = createStatusServer({ buildOverview: build, token: 't' })
    const base = await new Promise<string>((res) =>
      server.listen(0, '127.0.0.1', () => res(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)))

    const r = await fetch(`${base}/api/overview`, { headers: { authorization: 'Bearer t' } })
    expect(r.status).toBe(200)
    const body = await r.json()
    expect(typeof body.generatedAt).toBe('string')
    expect(body.projects.map((p: { project: { name: string } }) => p.project.name)).toContain('Proj One')
  })
})

describe('describeMissingDb', () => {
  test('names the missing path and how to fix it', () => {
    const msg = describeMissingDb('/nope/apc.db')
    expect(msg).toContain('/nope/apc.db')
    expect(msg).toMatch(/--db/)
  })
})
