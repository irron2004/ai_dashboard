import { entityColor, workflowFor, directionFor } from './graph-style.js'
import type { GraphNode, GraphLink, GraphData, GraphNodeType } from './graph-types.js'

/** A typed edge from autosci's wiki/graph/edges.jsonl */
export type PaperGraphEdge = { from: string; to: string; type: string } & Record<string, unknown>

function uniquePush<T>(list: T[], item: T, key: (value: T) => string): void {
  if (!list.some((existing) => key(existing) === key(item))) list.push(item)
}

export function labelFromPath(path: string): string {
  const base = path.split(/[\\/]/).pop() ?? path
  return base.replace(/\.[^.]+$/, '')
}

export function colorForNode(type: GraphNodeType | 'concept' | 'decision' | 'experiment' | 'ghost'): string {
  switch (type) {
    case 'task': return '#f59e0b'
    case 'evidence': return '#34d399'
    case 'run': return '#60a5fa'
    case 'document': return '#94a3b8'
    case 'concept': return '#7dd3fc'
    case 'decision': return '#fbbf24'
    case 'experiment': return '#c084fc'
    case 'ghost': return '#475569'
    default: return '#94a3b8'
  }
}

export function addNode(map: Map<string, GraphNode>, node: GraphNode): void {
  if (!map.has(node.id)) map.set(node.id, node)
}

export function addLink(links: GraphLink[], link: GraphLink): void {
  uniquePush(links, link, (item) => item.id)
}

type WikiNodeInput = { ref: string; type: string; title: string; relPath: string }

/** Build the graph from a project's published wiki (<repo>/wiki) */
export function buildWikiGraphData(nodes: WikiNodeInput[], edges: PaperGraphEdge[]): GraphData {
  const nodeMap = new Map<string, GraphNode>()
  const links: GraphLink[] = []

  for (const n of nodes) {
    addNode(nodeMap, {
      id: n.ref,
      label: n.title || n.ref,
      type: n.type as GraphNode['type'],
      shape: 'circle',
      color: entityColor(n.type),
      details: n.type,
      data: { path: n.relPath },
    })
  }

  const ensure = (ref: string): void => {
    if (nodeMap.has(ref)) return
    const type = ref.includes('/') ? ref.slice(0, ref.indexOf('/')) : 'document'
    addNode(nodeMap, {
      id: ref, label: ref.slice(ref.indexOf('/') + 1), type: type as GraphNode['type'],
      shape: 'circle', color: '#475569', details: `${type} (미생성)`,
    })
  }

  for (const e of edges) {
    if (!e?.from || !e?.to) continue
    ensure(e.from); ensure(e.to)
    const confidence = typeof e.confidence === 'string' ? e.confidence : undefined
    addLink(links, {
      id: `rel:${e.from}->${e.to}:${e.type}`, source: e.from, target: e.to, kind: 'rel',
      label: e.type, confidence, direction: directionFor(e.type), workflow: workflowFor(e.type),
    })
  }
  return { nodes: [...nodeMap.values()], links }
}

export type WorkTaskInput = { id: string; title: string; status: string; linkedWikiPages: string[]; blockedBy?: string[]; data?: unknown }

/** True if the wiki relPath is the tail of an edited file path (session literally edited that wiki file). */
function touchedWikiNode(touched: string[], relPath: string): boolean {
  return touched.some((t) => t === relPath || t.endsWith('/' + relPath) || t.endsWith('\\' + relPath))
}

/** Work↔wiki graph: request-Task nodes + the wiki nodes they edited + work→wiki edges.
 *  Tasks that edited no wiki file appear as isolated task nodes; wiki nodes are deduped. */
export function buildWorkGraphData(tasks: WorkTaskInput[], wikiNodes: WikiNodeInput[]): GraphData {
  const nodeMap = new Map<string, GraphNode>()
  const links: GraphLink[] = []
  for (const task of tasks) {
    addNode(nodeMap, {
      id: task.id, label: task.title || task.id, type: 'task', shape: 'circle',
      color: colorForNode('task'), details: task.status, data: task.data,
    })
    for (const w of wikiNodes) {
      if (!touchedWikiNode(task.linkedWikiPages, w.relPath)) continue
      addNode(nodeMap, {
        id: w.ref, label: w.title || w.ref, type: w.type as GraphNode['type'],
        shape: 'circle', color: entityColor(w.type), details: w.type, data: { path: w.relPath },
      })
      addLink(links, { id: `work:${task.id}->${w.ref}`, source: task.id, target: w.ref, kind: 'work', label: 'touched' })
    }
  }
  // task→task dependency edges: X blocks T when T.blockedBy contains X. Only draw when both
  // endpoints are task nodes already in this graph (avoid ghost dependency nodes).
  for (const task of tasks) {
    for (const blockerId of task.blockedBy ?? []) {
      if (!nodeMap.has(blockerId) || !nodeMap.has(task.id)) continue
      addLink(links, {
        id: `blocks:${blockerId}->${task.id}`, source: blockerId, target: task.id,
        kind: 'blocks', label: 'blocks', direction: 'directed',
      })
    }
  }
  return { nodes: [...nodeMap.values()], links }
}
