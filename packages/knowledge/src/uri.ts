export function buildProjectDocUri(projectId: string, relPath: string): string {
  const clean = relPath.replace(/^\/+/, '')
  return `pmw://project/${encodeURIComponent(projectId)}/${clean}`
}

export function parseProjectDocUri(uri: string): { projectId: string; relPath: string } {
  const prefix = 'pmw://project/'
  if (!uri.startsWith(prefix)) throw new Error(`Unsupported pmw URI: ${uri}`)
  const rest = uri.slice(prefix.length)
  const slash = rest.indexOf('/')
  if (slash === -1) throw new Error(`Invalid project document URI: ${uri}`)
  return { projectId: decodeURIComponent(rest.slice(0, slash)), relPath: rest.slice(slash + 1) }
}
