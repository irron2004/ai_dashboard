import { describe, expect, test } from 'vitest'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'

const lockPath = 'core.lock'
const venvPython = existsSync(lockPath)
  ? JSON.parse(readFileSync(lockPath, 'utf8')).venv_python as string
  : ''
const haveVenv = venvPython !== '' && existsSync(venvPython)
const d = haveVenv ? describe : describe.skip

d('substrate bootstrap', () => {
  const lock = JSON.parse(readFileSync(lockPath, 'utf8'))

  test('submodule HEAD matches core.lock.core_commit', () => {
    const head = execFileSync('git', ['-C', 'vendor/autosci-core', 'rev-parse', 'HEAD']).toString().trim()
    expect(head).toBe(lock.core_commit)
  })

  test('venv python resolves kernel under vendor/autosci-core', () => {
    const out = execFileSync(venvPython, ['-c', 'import kernel; print(kernel.__file__)']).toString().trim()
    expect(out.replace(/\\/g, '/')).toContain('vendor/autosci-core')
  })

  test('venv package version matches core.lock.core_version', () => {
    const version = execFileSync(venvPython, [
      '-c',
      'from importlib.metadata import version; print(version("autosci-core"))',
    ]).toString().trim()
    expect(version).toBe(lock.core_version)
  })
})
