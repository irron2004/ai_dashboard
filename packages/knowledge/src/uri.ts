export function buildProjectDocUri(projectId: string, relPath: string): string {
  const clean = relPath.replace(/^\/+/, '')
  const encodedPath = clean.split('/').map((segment) => encodeURIComponent(segment)).join('/')
  return `pmw://project/${encodeURIComponent(projectId)}/${encodedPath}`
}

export function parseProjectDocUri(uri: string): { projectId: string; relPath: string; chunkOrdinal?: number } {
  const prefix = 'pmw://project/'
  if (!uri.startsWith(prefix)) throw new Error(`Unsupported pmw URI: ${uri}`)
  const rest = uri.slice(prefix.length)
  const hash = rest.indexOf('#')
  const locator = hash === -1 ? rest : rest.slice(0, hash)
  const fragment = hash === -1 ? undefined : rest.slice(hash + 1)
  const slash = locator.indexOf('/')
  if (slash === -1) throw new Error(`Invalid project document URI: ${uri}`)
  const chunkMatch = fragment === undefined ? undefined : /^chunk-(\d+)$/.exec(fragment)
  if (fragment !== undefined && !chunkMatch) throw new Error(`Invalid project document fragment: ${uri}`)
  return {
    projectId: decodeURIComponent(locator.slice(0, slash)),
    relPath: locator.slice(slash + 1).split('/').map((segment) => decodeURIComponent(segment)).join('/'),
    ...(chunkMatch ? { chunkOrdinal: Number(chunkMatch[1]) } : {}),
  }
}
