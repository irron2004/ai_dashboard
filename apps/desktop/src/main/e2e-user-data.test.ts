import { afterEach, describe, expect, test, vi } from 'vitest'
import { existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { configureE2EUserDataPath } from './e2e-user-data.js'

const created: string[] = []

afterEach(() => {
  for (const directory of created.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('configureE2EUserDataPath', () => {
  test('환경변수가 없으면 userData를 변경하지 않는다', () => {
    const setPath = vi.fn()
    expect(configureE2EUserDataPath({ setPath }, undefined)).toBeNull()
    expect(setPath).not.toHaveBeenCalled()
  })

  test('ready 전에 사용할 절대 임시 경로를 만들고 userData로 지정한다', () => {
    const directory = join(tmpdir(), `apc-e2e-user-data-${process.pid}-${Date.now()}`)
    created.push(directory)
    const setPath = vi.fn()

    const configured = configureE2EUserDataPath({ setPath }, directory)

    expect(configured).toBe(directory)
    expect(existsSync(directory)).toBe(true)
    expect(setPath).toHaveBeenCalledWith('userData', directory)
  })
})
