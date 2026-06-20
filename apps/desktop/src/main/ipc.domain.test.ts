import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { handlers } from './ipc.js'
import { buildContainer } from './container.js'
import { CH } from '../shared/ipc-contract.js'

describe('registerProject domain', () => {
  let vaultDir: string
  let container: ReturnType<typeof buildContainer>

  beforeEach(() => {
    vaultDir = mkdtempSync(join(tmpdir(), 'apc-ipc-domain-'))
    container = buildContainer({ dbFile: ':memory:', vaultRoot: vaultDir })
  })

  afterEach(() => {
    rmSync(vaultDir, { recursive: true, force: true })
  })

  test('persists the chosen domain', async () => {
    const h = handlers(container)
    const created = await h[CH.registerProject]({ name: 'Papers', projectType: 'git', repoPath: 'ssh://u@h:22/p', domain: 'paper' })
    expect((created as { domain: string }).domain).toBe('paper')
  })

  test('defaults to project-docs when omitted', async () => {
    const h = handlers(container)
    const created = await h[CH.registerProject]({ name: 'Local', projectType: 'git', repoPath: '/tmp/x' })
    expect((created as { domain: string }).domain).toBe('project-docs')
  })
})

describe('updateProject domain', () => {
  let vaultDir: string
  let container: ReturnType<typeof buildContainer>

  beforeEach(() => {
    vaultDir = mkdtempSync(join(tmpdir(), 'apc-ipc-domain-upd-'))
    container = buildContainer({ dbFile: ':memory:', vaultRoot: vaultDir })
  })

  afterEach(() => {
    rmSync(vaultDir, { recursive: true, force: true })
  })

  test('persists the domain when supplied in update', async () => {
    const h = handlers(container)
    const created = (await h[CH.registerProject]({ name: 'X', projectType: 'git', repoPath: '/tmp/x' })) as { id: string; domain: string }
    const updated = await h[CH.updateProject]({ id: created.id, name: 'X2', projectType: 'git', repoPath: '/tmp/x', domain: 'paper' })
    expect((updated as { domain: string }).domain).toBe('paper')
  })

  test('preserves existing domain when omitted in update', async () => {
    const h = handlers(container)
    const created = (await h[CH.registerProject]({ name: 'Y', projectType: 'git', repoPath: '/tmp/y', domain: 'paper' })) as { id: string; domain: string }
    const updated = await h[CH.updateProject]({ id: created.id, name: 'Y2', projectType: 'git', repoPath: '/tmp/y' })
    expect((updated as { domain: string }).domain).toBe('paper')
  })
})
