import { beforeEach, describe, expect, test } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { LocalWorkerRunner } from './local-worker-runner.js'

describe('LocalWorkerRunner', () => {
  let runner: LocalWorkerRunner

  beforeEach(() => {
    runner = new LocalWorkerRunner(new DatabaseSync(':memory:'))
  })

  test('runs a registered handler and records a completed job', async () => {
    runner.register('echo', async (input) => ({ echoed: input }))
    const jobId = await runner.start('echo', { hi: 1 })
    const job = runner.getJobStatus(jobId)
    expect(job?.status).toBe('completed')
    expect(job?.result).toEqual({ echoed: { hi: 1 } })
  })

  test('records a failed job when the handler throws', async () => {
    runner.register('boom', async () => {
      throw new Error('kaboom')
    })
    const jobId = await runner.start('boom', {})
    const job = runner.getJobStatus(jobId)
    expect(job?.status).toBe('failed')
    expect(job?.error).toContain('kaboom')
  })

  test('throws when starting an unregistered job type', async () => {
    await expect(runner.start('nope', {})).rejects.toThrow(/no handler/i)
  })
})
