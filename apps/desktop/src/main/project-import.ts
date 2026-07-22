import { constants } from 'node:fs'
import { access, copyFile, cp, lstat, realpath, rm } from 'node:fs/promises'
import { basename, extname, isAbsolute, join, relative, sep } from 'node:path'
import type { ProjectImportItem, ProjectImportKind, ProjectImportRes } from '../shared/ipc-contract.js'

type PlannedImport = ProjectImportItem & {
  sourcePath: string
  destinationPath: string
}

function isSameOrInside(parent: string, candidate: string): boolean {
  const rel = relative(parent, candidate)
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

function reservationKey(path: string): string {
  return process.platform === 'win32' ? path.toLocaleLowerCase('en-US') : path
}

function suffixedName(name: string, index: number, kind: 'file' | 'folder'): string {
  if (kind === 'folder') return `${name} (${index})`
  const extension = extname(name)
  const stem = extension ? name.slice(0, -extension.length) : name
  return `${stem} (${index})${extension}`
}

async function uniqueDestination(
  root: string,
  sourceName: string,
  kind: 'file' | 'folder',
  reserved: Set<string>,
): Promise<{ path: string; name: string; renamed: boolean }> {
  for (let index = 0; index < 10_000; index += 1) {
    const name = index === 0 ? sourceName : suffixedName(sourceName, index, kind)
    const path = join(root, name)
    const key = reservationKey(path)
    if (!reserved.has(key) && !(await exists(path))) {
      reserved.add(key)
      return { path, name, renamed: index > 0 }
    }
  }
  throw new Error(`사용 가능한 이름을 만들 수 없습니다: ${sourceName}`)
}

/**
 * Copy user-picked files or one directory into a local project root.
 *
 * Existing entries are never overwritten. A conflict receives a numbered sibling name, which keeps
 * importing non-destructive and also makes repeated selections deterministic from the user's point of
 * view. Every source is validated before the first write, and paths created by a failed batch are
 * removed so a multi-file import does not leave a half-finished result behind.
 */
export async function importProjectSources(
  destinationRoot: string,
  sourcePaths: readonly string[],
  expectedKind: ProjectImportKind,
): Promise<ProjectImportRes> {
  let root: string
  try {
    root = await realpath(destinationRoot)
    const rootStat = await lstat(root)
    if (!rootStat.isDirectory()) return { ok: false, reason: '프로젝트 경로가 폴더가 아닙니다' }
  } catch {
    return { ok: false, reason: `프로젝트 경로를 찾을 수 없습니다: ${destinationRoot}` }
  }

  if (sourcePaths.length === 0) return { ok: true, canceled: true, items: [] }
  if (expectedKind === 'folder' && sourcePaths.length !== 1) {
    return { ok: false, reason: '폴더는 한 번에 하나만 가져올 수 있습니다' }
  }

  const reserved = new Set<string>()
  const plan: PlannedImport[] = []
  try {
    for (const selectedPath of sourcePaths) {
      const sourcePath = await realpath(selectedPath)
      const sourceStat = await lstat(sourcePath)
      const kind = sourceStat.isDirectory() ? 'folder' : sourceStat.isFile() ? 'file' : null
      if (!kind) throw new Error(`일반 파일 또는 폴더만 가져올 수 있습니다: ${selectedPath}`)
      if (expectedKind === 'files' && kind !== 'file') throw new Error(`파일이 아닙니다: ${selectedPath}`)
      if (expectedKind === 'folder' && kind !== 'folder') throw new Error(`폴더가 아닙니다: ${selectedPath}`)

      // Copying an ancestor into its own descendant can recurse forever as the destination appears in
      // the source walk. A folder already inside the project is safe: it receives a sibling name.
      if (kind === 'folder' && isSameOrInside(sourcePath, root)) {
        throw new Error('프로젝트 경로 자신이나 그 상위 폴더는 프로젝트 안으로 가져올 수 없습니다')
      }

      const sourceName = basename(sourcePath)
      if (!sourceName) throw new Error(`가져올 항목의 이름을 확인할 수 없습니다: ${selectedPath}`)
      const destination = await uniqueDestination(root, sourceName, kind, reserved)
      plan.push({
        sourcePath,
        destinationPath: destination.path,
        sourceName,
        relativePath: destination.name,
        kind,
        renamed: destination.renamed,
      })
    }
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) }
  }

  const created: string[] = []
  try {
    for (const item of plan) {
      created.push(item.destinationPath)
      if (item.kind === 'folder') {
        await cp(item.sourcePath, item.destinationPath, {
          recursive: true,
          force: false,
          errorOnExist: true,
          preserveTimestamps: true,
        })
      } else {
        await copyFile(item.sourcePath, item.destinationPath, constants.COPYFILE_EXCL)
      }
    }
  } catch (error) {
    await Promise.allSettled(created.map((path) => rm(path, { recursive: true, force: true })))
    return { ok: false, reason: `복사하지 못했습니다: ${error instanceof Error ? error.message : String(error)}` }
  }

  return {
    ok: true,
    canceled: false,
    destination: root,
    items: plan.map(({ sourceName, relativePath, kind, renamed }) => ({
      sourceName,
      relativePath,
      kind,
      renamed,
    })),
  }
}
