import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent, type WheelEvent } from 'react'
import { type HarnessGraphData, type HarnessGraphNode, type HarnessGraphLink } from '../harness-utils.js'

type Props = {
  data: HarnessGraphData
  onNodeClick: (node: HarnessGraphNode) => void
}

type LayoutNode = HarnessGraphNode & { x: number; y: number; vx: number; vy: number }

const NODE_TYPES: HarnessGraphNode['type'][] = ['run', 'task', 'evidence', 'file', 'document']
const LAYOUT_ITERATIONS = 80

function layoutGraph(nodes: HarnessGraphNode[], links: HarnessGraphLink[], width = 1200, height = 760): LayoutNode[] {
  const positioned: LayoutNode[] = nodes.map((node, index) => {
    const angle = (index / Math.max(nodes.length, 1)) * Math.PI * 2
    const radius = 120 + (index % 5) * 18
    return {
      ...node,
      x: width / 2 + Math.cos(angle) * radius,
      y: height / 2 + Math.sin(angle) * radius,
      vx: 0,
      vy: 0,
    }
  })
  const byId = new Map(positioned.map((node) => [node.id, node] as const))
  const adjacency = links
    .map((link) => [byId.get(link.source), byId.get(link.target)] as const)
    .filter((pair): pair is [LayoutNode, LayoutNode] => Boolean(pair[0] && pair[1]))

  for (let iter = 0; iter < LAYOUT_ITERATIONS; iter += 1) {
    for (let i = 0; i < positioned.length; i += 1) {
      for (let j = i + 1; j < positioned.length; j += 1) {
        const a = positioned[i]
        const b = positioned[j]
        const dx = a.x - b.x
        const dy = a.y - b.y
        const distanceSq = Math.max(dx * dx + dy * dy, 0.01)
        const force = 3200 / distanceSq
        const fx = (dx / Math.sqrt(distanceSq)) * force
        const fy = (dy / Math.sqrt(distanceSq)) * force
        a.vx += fx
        a.vy += fy
        b.vx -= fx
        b.vy -= fy
      }
    }

    for (const [a, b] of adjacency) {
      const dx = b.x - a.x
      const dy = b.y - a.y
      const distance = Math.max(Math.sqrt(dx * dx + dy * dy), 0.01)
      const desired = 140
      const force = (distance - desired) * 0.008
      const fx = (dx / distance) * force
      const fy = (dy / distance) * force
      a.vx += fx
      a.vy += fy
      b.vx -= fx
      b.vy -= fy
    }

    for (const node of positioned) {
      const dx = width / 2 - node.x
      const dy = height / 2 - node.y
      node.vx += dx * 0.0008
      node.vy += dy * 0.0008
      node.vx *= 0.88
      node.vy *= 0.88
      node.x += node.vx
      node.y += node.vy
      node.x = Math.max(40, Math.min(width - 40, node.x))
      node.y = Math.max(40, Math.min(height - 40, node.y))
    }
  }

  return positioned
}

export function GraphVisualization({ data, onNodeClick }: Props) {
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [filters, setFilters] = useState<Record<HarnessGraphNode['type'], boolean>>({ run: true, task: true, evidence: true, file: true, document: true })
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [zoom, setZoom] = useState({ scale: 1, x: 0, y: 0 })
  const pointer = useRef<{ x: number; y: number; startX: number; startY: number; startZoom: typeof zoom } | null>(null)
  const layoutCache = useRef(new Map<string, LayoutNode[]>())

  useEffect(() => {
    setSelectedId(null)
    setHoveredId(null)
  }, [data])

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 120)
    return () => clearTimeout(t)
  }, [search])

  const filtered = useMemo(() => {
    const query = debouncedSearch.trim().toLowerCase()
    const nodes = data.nodes.filter((node) => filters[node.type] && (!query || `${node.label} ${node.details ?? ''}`.toLowerCase().includes(query)))
    const allowed = new Set(nodes.map((node) => node.id))
    const links = data.links.filter((link) => allowed.has(link.source) && allowed.has(link.target))
    return { nodes, links }
  }, [data, filters, debouncedSearch])

  const graphSignature = useMemo(
    () => `${filtered.nodes.map((node) => node.id).join('\u0000')}|${filtered.links.map((link) => `${link.source}->${link.target}`).join('\u0000')}`,
    [filtered.nodes, filtered.links],
  )
  const positioned = useMemo(() => {
    const cached = layoutCache.current.get(graphSignature)
    if (cached) return cached
    const next = layoutGraph(filtered.nodes, filtered.links)
    layoutCache.current.set(graphSignature, next)
    if (layoutCache.current.size > 20) {
      const oldest = layoutCache.current.keys().next().value
      if (oldest) layoutCache.current.delete(oldest)
    }
    return next
  }, [filtered.nodes, filtered.links, graphSignature])
  const nodeById = useMemo(() => new Map(positioned.map((node) => [node.id, node] as const)), [positioned])
  const adjacency = useMemo(() => {
    const map = new Map<string, Set<string>>()
    for (const link of filtered.links) {
      map.set(link.source, new Set([...(map.get(link.source) ?? []), link.target]))
      map.set(link.target, new Set([...(map.get(link.target) ?? []), link.source]))
    }
    return map
  }, [filtered.links])

  const connected = hoveredId ? new Set([hoveredId, ...(adjacency.get(hoveredId) ?? [])]) : null

  const handleWheel = (event: WheelEvent<SVGSVGElement>) => {
    event.preventDefault()
    const nextScale = Math.max(0.4, Math.min(2.4, zoom.scale - event.deltaY * 0.0015))
    const rect = event.currentTarget.getBoundingClientRect()
    const cursorX = event.clientX - rect.left
    const cursorY = event.clientY - rect.top
    const ratio = nextScale / zoom.scale
    setZoom((current) => ({
      scale: nextScale,
      x: cursorX - ((cursorX - current.x) * ratio),
      y: cursorY - ((cursorY - current.y) * ratio),
    }))
  }

  const beginPan = (event: PointerEvent<SVGSVGElement>) => {
    pointer.current = { x: event.clientX, y: event.clientY, startX: zoom.x, startY: zoom.y, startZoom: zoom }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const movePan = (event: PointerEvent<SVGSVGElement>) => {
    if (!pointer.current) return
    const dx = event.clientX - pointer.current.x
    const dy = event.clientY - pointer.current.y
    setZoom({ ...pointer.current.startZoom, x: pointer.current.startX + dx, y: pointer.current.startY + dy })
  }

  const endPan = () => { pointer.current = null }

  const activateNode = (node: HarnessGraphNode) => {
    setSelectedId(node.id)
    onNodeClick(node)
  }

  const handleNodeKey = (node: HarnessGraphNode) => (event: KeyboardEvent<SVGGElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    activateNode(node)
  }

  return (
    <section className="panel graph-visualization">
      <header className="panel__header graph-visualization__header">
        <div>
          <h2>Graph Visualization</h2>
          <p>Zoom, pan, search, and hover connected nodes</p>
        </div>
        <label className="graph-visualization__search">
          <span>Search</span>
          <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="node, path, evidence..." />
        </label>
      </header>

      <div className="graph-visualization__filters">
        {NODE_TYPES.map((type) => (
          <button
            key={type}
            type="button"
            className={filters[type] ? 'graph-visualization__filter graph-visualization__filter--active' : 'graph-visualization__filter'}
            onClick={() => setFilters((current) => ({ ...current, [type]: !current[type] }))}
          >
            {type}
          </button>
        ))}
      </div>

      <div className="graph-visualization__canvas">
        <svg
          viewBox="0 0 1200 760"
          role="img"
          aria-label="Harness graph visualization"
          onWheel={handleWheel}
          onPointerDown={beginPan}
          onPointerMove={movePan}
          onPointerUp={endPan}
          onPointerLeave={endPan}
        >
          <defs>
            <filter id="graph-glow">
              <feGaussianBlur stdDeviation="4" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>
          <g transform={`translate(${zoom.x}, ${zoom.y}) scale(${zoom.scale})`}>
            {filtered.links.map((link) => {
              const source = nodeById.get(link.source)
              const target = nodeById.get(link.target)
              if (!source || !target) return null
              const active = !hoveredId || connected?.has(source.id) || connected?.has(target.id)
              return (
                <line
                  key={link.id}
                  className={active ? 'graph-visualization__link' : 'graph-visualization__link graph-visualization__link--muted'}
                  x1={source.x}
                  y1={source.y}
                  x2={target.x}
                  y2={target.y}
                />
              )
            })}

            {positioned.map((node) => {
              const active = !hoveredId || connected?.has(node.id)
              const selected = selectedId === node.id
              const title = node.details ? `${node.label} · ${node.details}` : node.label
              return (
                <g
                  key={node.id}
                  transform={`translate(${node.x}, ${node.y})`}
                  className={active ? 'graph-visualization__node' : 'graph-visualization__node graph-visualization__node--muted'}
                  role="button"
                  tabIndex={0}
                  aria-label={title}
                  onPointerEnter={() => setHoveredId(node.id)}
                  onPointerLeave={() => setHoveredId(null)}
                  onFocus={() => setHoveredId(node.id)}
                  onBlur={() => setHoveredId(null)}
                  onKeyDown={handleNodeKey(node)}
                  onClick={() => activateNode(node)}
                >
                  {node.shape === 'diamond' ? (
                    <polygon points="0,-18 18,0 0,18 -18,0" fill={node.color} filter="url(#graph-glow)" />
                  ) : node.shape === 'square' ? (
                    <rect x="-18" y="-18" width="36" height="36" rx="8" fill={node.color} filter="url(#graph-glow)" />
                  ) : (
                    <circle r="18" fill={node.color} filter="url(#graph-glow)" />
                  )}
                  <circle r="22" className={selected ? 'graph-visualization__ring graph-visualization__ring--active' : 'graph-visualization__ring'} />
                  <text className="graph-visualization__label" y="34">{node.label}</text>
                  <title>{title}</title>
                </g>
              )
            })}
          </g>
        </svg>
      </div>

      {hoveredId && nodeById.get(hoveredId) && (
        <footer className="graph-visualization__details">
          <strong>{nodeById.get(hoveredId)?.label}</strong>
          <span>{nodeById.get(hoveredId)?.details}</span>
        </footer>
      )}
    </section>
  )
}
