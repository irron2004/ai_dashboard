// Pure graph traversal ported from AutoSci app/modules/graph.js (highlightBFS L524, path query L872).
export type Adjacency = Map<string, Set<string>>

export function buildAdjacency(edges: { source: string; target: string }[]): Adjacency {
  const adj: Adjacency = new Map()
  const add = (a: string, b: string) => { if (!adj.has(a)) adj.set(a, new Set()); adj.get(a)!.add(b) }
  for (const e of edges) { if (!e.source || !e.target) continue; add(e.source, e.target); add(e.target, e.source) }
  return adj
}

export function bfsNeighborhood(adj: Adjacency, startId: string, depth: number): Set<string> {
  const visited = new Set([startId])
  let frontier = new Set([startId])
  for (let d = 0; d < depth; d++) {
    const next = new Set<string>()
    for (const id of frontier) for (const n of adj.get(id) ?? []) if (!visited.has(n)) { visited.add(n); next.add(n) }
    frontier = next
  }
  return visited
}

export function findPaths(adj: Adjacency, startId: string, endId: string, maxDepth = 4, maxPaths = 20): string[][] {
  const paths: string[][] = []
  const stack: { node: string; path: string[]; visited: Set<string> }[] = [{ node: startId, path: [startId], visited: new Set([startId]) }]
  while (stack.length && paths.length < maxPaths) {
    const cur = stack.pop()!
    if (cur.path.length > maxDepth + 1) continue
    for (const n of adj.get(cur.node) ?? []) {
      if (n === endId) { if (cur.path.length <= maxDepth) paths.push([...cur.path, n]); continue }
      if (cur.visited.has(n)) continue
      const visited = new Set(cur.visited); visited.add(n)
      stack.push({ node: n, path: [...cur.path, n], visited })
    }
  }
  return paths
}
