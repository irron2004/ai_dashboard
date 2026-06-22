import { useEffect, useState } from 'react'
import { GraphVisualization, buildWikiGraphData, type GraphData, type GraphNode } from '@apc/graph-view'

type WikiNode = { ref: string; type: string; title: string; relPath: string }
type ApiRes =
  | { available: true; wikiDir: string; nodes: WikiNode[]; edges: Array<{ from: string; to: string; type: string } & Record<string, unknown>> }
  | { available: false; reason?: string }

export function App() {
  const [graph, setGraph] = useState<GraphData | null>(null)
  const [empty, setEmpty] = useState<string | null>(null)

  useEffect(() => {
    let stale = false
    void fetch('/api/graph')
      .then((r) => r.json() as Promise<ApiRes>)
      .then((res) => {
        if (stale) return
        if (res.available) {
          setGraph(buildWikiGraphData(res.nodes, res.edges))
          setEmpty(null)
        } else {
          setGraph(null)
          setEmpty(res.reason ?? 'No wiki found. Pass a wiki path via WIKI_DIR: pnpm graph-web <wikiPath>')
        }
      })
      .catch(() => {
        if (!stale) setEmpty('Failed to load /api/graph')
      })
    return () => { stale = true }
  }, [])

  const onNodeClick = (n: GraphNode) => {
    // v1: no-op (node ref is its id). Follow-up: open the md.
    void n
  }

  return (
    <div style={{ position: 'fixed', inset: 0 }}>
      {graph
        ? <GraphVisualization data={graph} onNodeClick={onNodeClick} />
        : <div style={{ padding: 24, color: '#aaa' }}>{empty ?? 'Loading…'}</div>}
    </div>
  )
}
