// Host-agnostic graph data shape. Lives here (not in harness-utils) so the graph/ folder can be
// lifted out as a standalone package. The host app adapts its data into these types.
export type GraphNodeType = 'run' | 'task' | 'evidence' | 'file' | 'document' | 'papers' | 'modules' | 'pipelines' | 'pipeline_trials'
export type GraphShape = 'circle' | 'diamond' | 'square'
export type GraphNode = { id: string; label: string; type: GraphNodeType; shape: GraphShape; color: string; details?: string; data?: unknown }
export type GraphLink = {
  id: string; source: string; target: string; label?: string; kind: string
  confidence?: string; direction?: 'directed' | 'symmetric'; workflow?: string
}
export type GraphData = { nodes: GraphNode[]; links: GraphLink[] }
