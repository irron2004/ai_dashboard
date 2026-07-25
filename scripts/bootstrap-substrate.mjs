import { execFileSync } from 'node:child_process'
import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const repo = process.cwd()
const vendor = 'vendor/autosci-core'
const venv = '.venv-substrate'
const isWin = process.platform === 'win32'
const venvPython = isWin ? join(venv, 'Scripts', 'python.exe') : join(venv, 'bin', 'python')

const sh = (cmd, args) => execFileSync(cmd, args, { stdio: 'inherit', cwd: repo })

if (!existsSync(join(repo, vendor, 'pyproject.toml'))) {
  sh('git', ['submodule', 'update', '--init', vendor])
}
sh('uv', ['venv', venv])
sh('uv', ['pip', 'install', '--python', venvPython, '-e', `${vendor}[pdf]`])

const coreCommit = execFileSync('git', ['-C', vendor, 'rev-parse', 'HEAD'], { cwd: repo }).toString().trim()
const coreVersion = execFileSync(
  venvPython,
  ['-c', 'from importlib.metadata import version; print(version("autosci-core"))'],
  { cwd: repo },
).toString().trim()
writeFileSync(join(repo, 'core.lock'), JSON.stringify({
  core_repo: 'https://github.com/irron2004/autosci-core.git',
  core_version: coreVersion,
  core_commit: coreCommit,
  venv_python: venvPython,
}, null, 2) + '\n')
console.log('substrate bootstrapped:', venvPython, '@', coreCommit)
