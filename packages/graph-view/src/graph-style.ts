// Visualization style tables ported/adapted from AutoSci app/modules/graph.js (ENTITY_HEX) and
// app/modules/schema.js. Covers BOTH our graph schemas: project-docs provenance (run/task/evidence/
// file/document) and the paper entity types (papers/modules/pipelines/pipeline_trials).

const ENTITY_COLORS: Record<string, string> = {
  // paper entities (AutoSci hue trio + ours)
  papers: '#4A90D9', modules: '#84CC16', pipelines: '#C084FC', pipeline_trials: '#E74C3C',
  // AutoSci/OmegaWiki entity types (existing wikis)
  concepts: '#EC4899', topics: '#E67E22', people: '#2ECC71', ideas: '#F39C12',
  experiments: '#E74C3C', methods: '#84CC16', Summary: '#1ABC9C', foundations: '#95A5A6',
  outputs: '#9B59B6',
  // project-docs provenance buckets
  run: '#60A5FA', task: '#F59E0B', evidence: '#34D399', file: '#94A3B8', document: '#95A5A6',
}
const ENTITY_FALLBACK = '#95A5A6'
const ENTITY_ORDER = [
  'papers', 'concepts', 'topics', 'people', 'ideas', 'experiments', 'methods', 'foundations', 'Summary', 'outputs',
  'modules', 'pipelines', 'pipeline_trials',
  'run', 'task', 'evidence', 'file', 'document',
]

export function entityColor(type: string): string {
  return ENTITY_COLORS[type] ?? ENTITY_FALLBACK
}

// edge type -> workflow bucket. Buckets carry a color and group edges in the filter sidebar.
const EDGE_WORKFLOW: Record<string, string> = {
  uses_module: 'composition', pipeline_from_paper: 'provenance', alternative_to: 'relation',
  // project-docs edge kinds (from buildHarnessGraphData)
  'run-task': 'provenance', 'run-file': 'provenance', proposal: 'provenance',
  supports: 'evidence', source: 'evidence', 'claim-evidence': 'evidence',
  rel: 'relation', wiki: 'relation', 'action-file': 'composition', 'write-plan': 'composition', result: 'composition',
}
const WORKFLOW_COLORS: Record<string, string> = {
  composition: '#84CC16', provenance: '#4A90D9', evidence: '#34D399', relation: '#EC4899', other: '#999999',
}
const SYMMETRIC_EDGES = new Set(['alternative_to', 'rel'])

export function workflowFor(edgeType: string): string { return EDGE_WORKFLOW[edgeType] ?? 'other' }
export function edgeColor(edgeType: string): string { return WORKFLOW_COLORS[workflowFor(edgeType)] ?? WORKFLOW_COLORS.other }
export function directionFor(edgeType: string): 'directed' | 'symmetric' { return SYMMETRIC_EDGES.has(edgeType) ? 'symmetric' : 'directed' }

export function confidenceClass(conf?: string): 'conf-high' | 'conf-medium' | 'conf-low' | '' {
  const c = (conf ?? '').toLowerCase()
  return c === 'high' ? 'conf-high' : c === 'medium' ? 'conf-medium' : c === 'low' ? 'conf-low' : ''
}

export function presentEntityTypes(types: string[]): string[] {
  const present = new Set(types)
  return ENTITY_ORDER.filter((t) => present.has(t))
}

// Sidebar groups: canonical workflow buckets first, leftovers under "Other" (mirrors graph.js).
const EDGE_GROUPS: { group: string; workflow: string }[] = [
  { group: 'Provenance', workflow: 'provenance' },
  { group: 'Composition', workflow: 'composition' },
  { group: 'Evidence', workflow: 'evidence' },
  { group: 'Relations', workflow: 'relation' },
]

export function groupEdgeTypes(present: string[]): { group: string; types: string[] }[] {
  const uniq = [...new Set(present)]
  const out: { group: string; types: string[] }[] = []
  const claimed = new Set<string>()
  for (const { group, workflow } of EDGE_GROUPS) {
    const types = uniq.filter((t) => workflowFor(t) === workflow).sort()
    types.forEach((t) => claimed.add(t))
    if (types.length) out.push({ group, types })
  }
  const leftovers = uniq.filter((t) => !claimed.has(t)).sort()
  if (leftovers.length) out.push({ group: 'Other', types: leftovers })
  return out
}
