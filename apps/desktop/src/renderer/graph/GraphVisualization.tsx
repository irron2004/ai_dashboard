import { useEffect, useRef } from 'react'
import cytoscape from 'cytoscape'
import type { GraphData, GraphNode } from './graph-types.js'
import { obsidianForceLayout } from './graph-layout.js'
import { entityColor, edgeColor, confidenceClass, presentEntityTypes } from './graph-style.js'
import { buildAdjacency, bfsNeighborhood } from './graph-algorithms.js'

// Dark-only theme constants (brief: dark only)
const LABEL_COLOR = '#e6e6f0'
const LABEL_OUTLINE = 'rgba(0,0,0,0.55)'

/** Make an edge label safe for use as a CSS class name (mirrors AutoSci cssSafe). */
function cssSafe(s: string): string {
  return s.replace(/[^a-zA-Z0-9_-]/g, '_')
}

/** Build the Cytoscape stylesheet array from the entity types and edge labels present in data. */
function buildStylesheet(entityTypes: string[], edgeLabels: string[]): cytoscape.StylesheetStyle[] {
  const labelBaseStyle: cytoscape.Css.Node = {
    label: 'data(label)' as never,
    'font-size': '10px' as never,
    'font-weight': 'normal' as never,
    color: LABEL_COLOR as never,
    'text-outline-color': LABEL_OUTLINE as never,
    'text-outline-width': 1 as never,
    'text-valign': 'bottom' as never,
    'text-margin-y': 4 as never,
  }

  return [
    // Entity (node-type) selectors — background-color + size; label hidden by default
    ...entityTypes.map((et) => ({
      selector: '.' + et,
      style: {
        'background-color': entityColor(et),
        label: '',
        width: 'data(nodeW)' as never,
        height: 'data(nodeH)' as never,
        'border-width': 1,
        'border-color': 'rgba(127,127,127,0.18)',
        'overlay-opacity': 0,
      } as cytoscape.Css.Node,
    })),
    { selector: 'node:active', style: { 'overlay-opacity': 0 } as cytoscape.Css.Node },

    // Edge-label selectors — color per workflow bucket
    ...edgeLabels.map((et) => ({
      selector: '.' + cssSafe(et),
      style: {
        'line-color': edgeColor(et),
        'target-arrow-color': edgeColor(et),
        'target-arrow-shape': 'none',
        'curve-style': 'bezier',
        width: 1.0,
        opacity: 0.55,
      } as cytoscape.Css.Edge,
    })),

    // Direction selectors
    { selector: 'edge.dir-directed', style: { 'target-arrow-shape': 'triangle' } as cytoscape.Css.Edge },
    { selector: 'edge.dir-symmetric', style: { 'target-arrow-shape': 'none' } as cytoscape.Css.Edge },

    // Confidence-based weighting
    { selector: 'edge.conf-high',   style: { opacity: 0.95, width: 2.2 } as cytoscape.Css.Edge },
    { selector: 'edge.conf-medium', style: { opacity: 0.70, width: 1.5 } as cytoscape.Css.Edge },
    { selector: 'edge.conf-low',    style: { opacity: 0.40, width: 1.0 } as cytoscape.Css.Edge },

    // Hover: show full label
    { selector: 'node:hover',      style: { ...labelBaseStyle, label: 'data(labelFull)' as never } as cytoscape.Css.Node },
    // Zoom-aware: show label once zoomed in
    { selector: 'node.show-label', style: { ...labelBaseStyle } as cytoscape.Css.Node },

    // BFS highlight
    {
      selector: 'node.highlighted',
      style: {
        ...labelBaseStyle,
        'border-width': 2,
        'border-color': '#e94560',
        opacity: 1,
      } as cytoscape.Css.Node,
    },
    // Path query endpoints (Task 7 wires these; define here so Task 7 can just add classes)
    { selector: 'node.path-start', style: { ...labelBaseStyle, 'border-width': 3, 'border-color': '#22c55e' } as cytoscape.Css.Node },
    { selector: 'node.path-end',   style: { ...labelBaseStyle, 'border-width': 3, 'border-color': '#3b82f6' } as cytoscape.Css.Node },

    { selector: '.faded',          style: { opacity: 0.08 } as cytoscape.Css.Node },
    { selector: 'edge.highlighted',style: { opacity: 0.95, width: 2.5 } as cytoscape.Css.Edge },
    { selector: 'edge.faded',      style: { opacity: 0.04 } as cytoscape.Css.Edge },
    { selector: 'edge.filtered-out', style: { display: 'none' } as cytoscape.Css.Edge },
  ]
}

/** Map GraphData to Cytoscape element definitions, seeded with force-layout positions. */
function buildElements(data: GraphData, width: number, height: number): cytoscape.ElementDefinition[] {
  const { positions, sizes } = obsidianForceLayout(data.nodes, data.links, width, height)

  const nodeEls: cytoscape.ElementDefinition[] = data.nodes.map((node) => {
    const pos = positions[node.id] ?? { x: 0, y: 0 }
    const sz = sizes[node.id]
    return {
      data: {
        id: node.id,
        label: node.label.length > 30 ? node.label.slice(0, 30) + '…' : node.label,
        labelFull: node.label,
        entity: node.type,
        nodeW: sz ? sz.w : 20,
        nodeH: sz ? sz.h : 20,
      },
      classes: node.type,
      position: pos,
    }
  })

  const edgeEls: cytoscape.ElementDefinition[] = data.links.map((link) => {
    const dir = link.direction ?? 'directed'
    const confCls = confidenceClass(link.confidence)
    const classes = [cssSafe(link.label ?? link.kind), 'dir-' + dir, confCls].filter(Boolean).join(' ')
    return {
      data: {
        id: link.id,
        source: link.source,
        target: link.target,
        label: link.label ?? link.kind,
        direction: dir,
        confidence: link.confidence,
        workflow: link.workflow,
      },
      classes,
    }
  })

  return [...nodeEls, ...edgeEls]
}

/** Toggle zoom-aware label classes — mirrors AutoSci applyLabelVisibility (L804). */
function applyLabelVisibility(cy: cytoscape.Core): void {
  const z = cy.zoom()
  const allNodes = cy.nodes()
  if (z >= 1.4) {
    allNodes.addClass('show-label')
  } else {
    allNodes.removeClass('show-label')
  }
}

export type Props = {
  data: GraphData
  onNodeClick: (node: GraphNode) => void
}

/**
 * Cytoscape-based graph canvas with force-layout, BFS highlight on node tap,
 * double-tap node open, zoom-aware labels, and proper teardown.
 * Sidebar widgets (search, filters, path query) are wired in Task 7.
 */
export function GraphVisualization({ data, onNodeClick }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  // Keep a stable Map from id -> original GraphNode so onNodeClick gets the raw object
  const nodeMapRef = useRef<Map<string, GraphNode>>(new Map())
  // Ref pattern: always holds the latest onNodeClick without re-initializing cytoscape
  const onNodeClickRef = useRef(onNodeClick)
  useEffect(() => { onNodeClickRef.current = onNodeClick }, [onNodeClick])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    // Rebuild id -> node map for this data snapshot
    const nodeMap = new Map<string, GraphNode>(data.nodes.map((n) => [n.id, n]))
    nodeMapRef.current = nodeMap

    const W = container.clientWidth || 1000
    const H = container.clientHeight || 600

    // Collect distinct entity types and edge label strings for the stylesheet
    const entityTypes = presentEntityTypes(data.nodes.map((n) => n.type))
    const edgeLabels = [...new Set(data.links.map((l) => l.label ?? l.kind))]

    const elements = buildElements(data, W, H)
    const style = buildStylesheet(entityTypes, edgeLabels)

    const cy = cytoscape({
      container,
      elements,
      style,
      layout: { name: 'preset' },
      minZoom: 0.05,
      maxZoom: 8,
      wheelSensitivity: 0.3,
    })

    // Fit after a short delay to let Cytoscape settle
    const fitTimer = setTimeout(() => { try { cy.fit(cy.elements(), 60) } catch { /* ignore */ } }, 50)

    // Initial label visibility pass
    applyLabelVisibility(cy)

    // Build adjacency for BFS from the current data
    const adj = buildAdjacency(data.links.map((l) => ({ source: l.source, target: l.target })))

    // Node single-tap: BFS neighbourhood highlight
    cy.on('tap', 'node', (evt) => {
      const tapped = evt.target as cytoscape.NodeSingular
      const neighborhood = bfsNeighborhood(adj, tapped.id(), 2)

      cy.nodes().removeClass('highlighted faded')
      cy.edges().removeClass('highlighted faded')

      cy.nodes().forEach((n) => {
        if (neighborhood.has(n.id())) {
          n.addClass('highlighted')
        } else {
          n.addClass('faded')
        }
      })
      cy.edges().forEach((e) => {
        const src = e.source().id()
        const tgt = e.target().id()
        if (neighborhood.has(src) && neighborhood.has(tgt)) {
          e.addClass('highlighted')
        } else {
          e.addClass('faded')
        }
      })
    })

    // Background tap: clear highlight
    cy.on('tap', (evt) => {
      if (evt.target === cy) {
        cy.nodes().removeClass('highlighted faded')
        cy.edges().removeClass('highlighted faded')
      }
    })

    // Double-tap: open node via callback (uses ref so stale closure is never an issue)
    cy.on('dbltap', 'node', (evt) => {
      const id = (evt.target as cytoscape.NodeSingular).id()
      const original = nodeMapRef.current.get(id)
      if (original) onNodeClickRef.current(original)
    })

    // Zoom-aware labels
    cy.on('zoom', () => applyLabelVisibility(cy))

    return () => {
      clearTimeout(fitTimer)
      cy.destroy()
    }
  // Re-run (and re-init cy) only when data changes; onNodeClick is accessed via ref (no stale-closure risk)
  }, [data])

  return (
    <section className="panel graph-visualization">
      <header className="panel__header graph-visualization__header">
        <div>
          <h2>Graph Visualization</h2>
          <p>Zoom, pan, and explore connected nodes</p>
        </div>
      </header>

      <div className="graph-visualization__body">
        {/* cy-canvas: Cytoscape mounts into this div */}
        <div ref={containerRef} className="cy-canvas" style={{ width: '100%', height: '100%', minHeight: 500 }} />

        {/* Sidebar placeholder — widgets wired in Task 7 */}
        <aside className="graph-visualization__sidebar" aria-label="Graph controls">
          {/* Task 7: search, type filters, edge filters, path query, tooltip */}
        </aside>
      </div>
    </section>
  )
}
