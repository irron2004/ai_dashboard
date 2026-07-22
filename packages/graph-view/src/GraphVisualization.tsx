import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import cytoscape from 'cytoscape'
import type { GraphData, GraphLink, GraphNode } from './graph-types.js'
import { obsidianForceLayout } from './graph-layout.js'
import {
  entityColor, edgeColor, confidenceClass, presentEntityTypes, groupEdgeTypes, workflowFor,
} from './graph-style.js'
import { buildAdjacency, bfsNeighborhood, findPaths } from './graph-algorithms.js'

// Dark-only theme constants (brief: dark only)
const LABEL_COLOR = '#e6e6f0'
const LABEL_OUTLINE = 'rgba(0,0,0,0.55)'

// Preset name → workflow buckets that should be visible
const PRESET_WORKFLOWS: Record<string, string[]> = {
  Provenance: ['provenance'],
  Composition: ['composition'],
  Evidence:    ['evidence'],
  Relations:   ['relation'],
}
const PRESET_ORDER = ['Provenance', 'Composition', 'Evidence', 'Relations']

// Large graphs stay node-first: edge elements are materialized only for the hovered/pinned node. This
// avoids asking Cytoscape to paint thousands of mostly-invisible lines and keeps node selection responsive.
export const FOCUSED_EDGE_NODE_THRESHOLD = 80
export const FOCUSED_EDGE_LINK_THRESHOLD = 240
const FOCUSED_EDGE_CAP = 80

export function shouldUseFocusedEdges(data: GraphData): boolean {
  return data.nodes.length >= FOCUSED_EDGE_NODE_THRESHOLD || data.links.length >= FOCUSED_EDGE_LINK_THRESHOLD
}

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
    { selector: 'edge.hide-low',   style: { display: 'none' } as cytoscape.Css.Edge },
  ]
}

function buildEdgeElement(link: GraphLink): cytoscape.ElementDefinition {
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
}

/** Map GraphData to Cytoscape element definitions, seeded with force-layout positions. */
function buildElements(data: GraphData, width: number, height: number, includeEdges = true): cytoscape.ElementDefinition[] {
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

  const edgeEls: cytoscape.ElementDefinition[] = includeEdges ? data.links.map(buildEdgeElement) : []

  return [...nodeEls, ...edgeEls]
}

// ---------------------------------------------------------------------------
// Tooltip helpers — plain DOM, appended to body, torn down on hide/unmount
// ---------------------------------------------------------------------------

let tooltipEl: HTMLDivElement | null = null
let tooltipMoveHandler: ((e: MouseEvent) => void) | null = null

function showEdgeTooltip(data: Record<string, unknown>): void {
  hideEdgeTooltip()
  const parts: string[] = [
    `<strong>${esc(String(data.label ?? ''))}</strong>`,
  ]
  if (data.confidence) parts.push(`<span class="small">confidence: ${esc(String(data.confidence))}</span>`)
  if (data.workflow)   parts.push(`<span class="small">workflow: ${esc(String(data.workflow))}</span>`)

  tooltipEl = document.createElement('div')
  tooltipEl.className = 'edge-tooltip'
  tooltipEl.style.cssText = 'position:fixed;z-index:9999;background:#1e1e2e;color:#e6e6f0;border:1px solid #333;border-radius:4px;padding:6px 10px;font-size:11px;pointer-events:none;max-width:260px;'
  tooltipEl.innerHTML = parts.join('<br>')
  document.body.appendChild(tooltipEl)

  tooltipMoveHandler = (e: MouseEvent) => {
    if (!tooltipEl) return
    tooltipEl.style.left = (e.clientX + 12) + 'px'
    tooltipEl.style.top  = (e.clientY + 12) + 'px'
  }
  document.addEventListener('mousemove', tooltipMoveHandler)
}

function hideEdgeTooltip(): void {
  if (tooltipMoveHandler) {
    document.removeEventListener('mousemove', tooltipMoveHandler)
    tooltipMoveHandler = null
  }
  if (tooltipEl) { tooltipEl.remove(); tooltipEl = null }
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] ?? c))
}

// ---------------------------------------------------------------------------
// Sidebar sub-components
// ---------------------------------------------------------------------------

type SearchWidgetProps = {
  cyRef: React.MutableRefObject<cytoscape.Core | null>
  adjRef: React.MutableRefObject<ReturnType<typeof buildAdjacency>>
  onSelectNode?: (id: string) => void
}

function SearchWidget({ cyRef, adjRef, onSelectNode }: SearchWidgetProps) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<{ id: string; label: string; entity: string }[]>([])

  const handleInput = useCallback((q: string) => {
    setQuery(q)
    const cy = cyRef.current
    if (!cy || !q.trim()) { setResults([]); return }
    const lower = q.toLowerCase().trim()
    const matches: { id: string; label: string; entity: string }[] = []
    cy.nodes().forEach((n) => {
      if (matches.length >= 20) return
      const label = String(n.data('label') || '').toLowerCase()
      const fullLabel = String(n.data('labelFull') || '').toLowerCase()
      const id = String(n.id()).toLowerCase()
      if (label.includes(lower) || fullLabel.includes(lower) || id.includes(lower)) {
        matches.push({ id: n.id(), label: n.data('labelFull') || n.data('label'), entity: n.data('entity') })
      }
    })
    setResults(matches)
  }, [cyRef])

  const handleSelect = useCallback((id: string) => {
    const cy = cyRef.current
    if (!cy) return
    const node = cy.getElementById(id)
    if (!node.length) return
    cy.animate({ center: { eles: node }, zoom: 2 } as Parameters<typeof cy.animate>[0])
    if (onSelectNode) {
      onSelectNode(id)
      setResults([])
      setQuery('')
      return
    }
    // BFS highlight
    const neighborhood = bfsNeighborhood(adjRef.current, id, 2)
    cy.nodes().removeClass('highlighted faded')
    cy.edges().removeClass('highlighted faded')
    cy.nodes().forEach((n) => {
      if (neighborhood.has(n.id())) n.addClass('highlighted')
      else n.addClass('faded')
    })
    cy.edges().forEach((e) => {
      const s = e.source().id(), t = e.target().id()
      if (neighborhood.has(s) && neighborhood.has(t)) e.addClass('highlighted')
      else e.addClass('faded')
    })
    setResults([])
    setQuery('')
  }, [cyRef, adjRef, onSelectNode])

  return (
    <div className="sidebar-section">
      <input
        className="graph-search"
        type="search"
        placeholder="Search nodes…"
        value={query}
        onChange={(e) => handleInput(e.target.value)}
        aria-label="Search nodes"
      />
      {results.length > 0 && (
        <ul className="search-results" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {results.map((r) => (
            <li
              key={r.id}
              className="search-item"
              style={{ cursor: 'pointer', padding: '2px 4px', display: 'flex', alignItems: 'center', gap: 4 }}
              onClick={() => handleSelect(r.id)}
            >
              <span className="dot" style={{ background: entityColor(r.entity), width: 8, height: 8, borderRadius: '50%', display: 'inline-block' }} />
              <span>{r.label}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------

type EntityFilterProps = {
  entityTypes: string[]
  counts: Map<string, number>
  cyRef: React.MutableRefObject<cytoscape.Core | null>
}

function EntityFilters({ entityTypes, counts, cyRef }: EntityFilterProps) {
  const [checked, setChecked] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(entityTypes.map((t) => [t, true]))
  )

  const toggle = useCallback((et: string, on: boolean) => {
    setChecked((prev) => ({ ...prev, [et]: on }))
    const cy = cyRef.current
    if (!cy) return
    cy.nodes('.' + et).style('display', on ? 'element' : 'none')
  }, [cyRef])

  return (
    <div className="sidebar-section" id="graph-entity-filters">
      <h4 className="sidebar-section__title">Entity types</h4>
      {entityTypes.map((et) => {
        const count = counts.get(et) ?? 0
        return (
          <label key={et} className="entity-filter-row" style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
            <input
              type="checkbox"
              checked={checked[et] ?? true}
              data-entity={et}
              onChange={(e) => toggle(et, e.target.checked)}
              aria-label={et}
            />
            <span className="dot" style={{ background: entityColor(et), width: 10, height: 10, borderRadius: '50%', display: 'inline-block' }} />
            <span>{et}</span>
            <span className="muted" style={{ fontSize: '0.75em', color: '#888' }}> ({count})</span>
          </label>
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------------------

type EdgeGroup = { group: string; types: string[] }
type EdgeFilterProps = {
  groups: EdgeGroup[]
  counts: Map<string, number>
  cyRef: React.MutableRefObject<cytoscape.Core | null>
}

function setEdgeTypeVisible(cy: cytoscape.Core, edgeType: string, visible: boolean): void {
  const edges = cy.edges('.' + cssSafe(edgeType))
  edges.removeStyle('display')
  edges.toggleClass('filtered-out', !visible)
}

function EdgeFilters({ groups, counts, cyRef }: EdgeFilterProps) {
  const initTypeChecked = (): Record<string, boolean> => {
    const out: Record<string, boolean> = {}
    groups.forEach((g) => g.types.forEach((t) => { out[t] = true }))
    return out
  }
  const initGroupChecked = (): Record<string, boolean> =>
    Object.fromEntries(groups.map((g) => [g.group, true]))

  const [typeChecked, setTypeChecked] = useState<Record<string, boolean>>(initTypeChecked)
  const [groupChecked, setGroupChecked] = useState<Record<string, boolean>>(initGroupChecked)
  const [groupIndeterminate, setGroupIndeterminate] = useState<Record<string, boolean>>({})

  const syncGroup = useCallback((groupName: string, newTypeChecked: Record<string, boolean>, grpDef: EdgeGroup) => {
    const children = grpDef.types
    const allOn  = children.every((t) => newTypeChecked[t])
    const allOff = children.every((t) => !newTypeChecked[t])
    setGroupChecked((prev) => ({ ...prev, [groupName]: allOn }))
    setGroupIndeterminate((prev) => ({ ...prev, [groupName]: !allOn && !allOff }))
  }, [])

  const toggleType = useCallback((edgeType: string, on: boolean, groupName: string) => {
    const grpDef = groups.find((g) => g.group === groupName)!
    setTypeChecked((prev) => {
      const next = { ...prev, [edgeType]: on }
      syncGroup(groupName, next, grpDef)
      return next
    })
    const cy = cyRef.current
    if (cy) setEdgeTypeVisible(cy, edgeType, on)
  }, [cyRef, groups, syncGroup])

  const toggleGroup = useCallback((grp: EdgeGroup, on: boolean) => {
    setGroupChecked((prev) => ({ ...prev, [grp.group]: on }))
    setGroupIndeterminate((prev) => ({ ...prev, [grp.group]: false }))
    setTypeChecked((prev) => {
      const next = { ...prev }
      grp.types.forEach((t) => { next[t] = on })
      return next
    })
    const cy = cyRef.current
    if (cy) grp.types.forEach((t) => setEdgeTypeVisible(cy, t, on))
  }, [cyRef])

  return (
    <div className="sidebar-section" id="graph-edge-filters">
      <h4 className="sidebar-section__title">Edge types</h4>
      {groups.map((grp) => {
        const total = grp.types.reduce((s, t) => s + (counts.get(t) ?? 0), 0)
        return (
          <details key={grp.group} className="edge-group" open>
            <summary style={{ cursor: 'pointer', userSelect: 'none' }}>
              <label className="group-summary" onClick={(e) => e.stopPropagation()} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <input
                  type="checkbox"
                  checked={groupChecked[grp.group] ?? true}
                  ref={(el) => { if (el) el.indeterminate = groupIndeterminate[grp.group] ?? false }}
                  data-group={grp.group}
                  onChange={(e) => toggleGroup(grp, e.target.checked)}
                  aria-label={grp.group}
                />
                <strong>{grp.group}</strong>
                <span className="muted" style={{ fontSize: '0.75em', color: '#888' }}> ({total})</span>
              </label>
            </summary>
            {grp.types.map((et) => {
              const c = counts.get(et) ?? 0
              return (
                <label key={et} className="edge-type-row" style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 16, marginBottom: 2 }}>
                  <input
                    type="checkbox"
                    checked={typeChecked[et] ?? true}
                    data-edge={et}
                    data-group={grp.group}
                    onChange={(e) => toggleType(et, e.target.checked, grp.group)}
                    aria-label={et}
                  />
                  <span className="dot" style={{ background: edgeColor(et), width: 8, height: 8, borderRadius: '50%', display: 'inline-block' }} />
                  <span>{et}</span>
                  <span className="muted" style={{ fontSize: '0.75em', color: '#888' }}> · {c}</span>
                </label>
              )
            })}
          </details>
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Preset views widget
// ---------------------------------------------------------------------------

type PresetViewsProps = {
  edgeGroups: EdgeGroup[]
  cyRef: React.MutableRefObject<cytoscape.Core | null>
}

function PresetViews({ edgeGroups, cyRef }: PresetViewsProps) {
  const [active, setActive] = useState<Set<string>>(new Set())

  const applyPreset = useCallback((key: string) => {
    const cy = cyRef.current
    if (!cy) return

    setActive((prev) => {
      const next = new Set(prev)
      if (next.has(key)) {
        next.delete(key)
      } else {
        next.add(key)
      }

      if (next.size === 0) {
        // Reset all edges to visible
        edgeGroups.forEach((g) => g.types.forEach((t) => setEdgeTypeVisible(cy, t, true)))
        return next
      }

      // Build union of workflows from all active presets
      const wantWorkflows = new Set<string>()
      for (const p of next) {
        const wfs = PRESET_WORKFLOWS[p] ?? []
        wfs.forEach((w) => wantWorkflows.add(w))
      }

      edgeGroups.forEach((g) => {
        g.types.forEach((t) => {
          const wf = workflowFor(t)
          setEdgeTypeVisible(cy, t, wantWorkflows.has(wf))
        })
      })
      return next
    })
  }, [cyRef, edgeGroups])

  const resetAll = useCallback(() => {
    const cy = cyRef.current
    if (!cy) return
    setActive(new Set())
    edgeGroups.forEach((g) => g.types.forEach((t) => setEdgeTypeVisible(cy, t, true)))
  }, [cyRef, edgeGroups])

  return (
    <div className="sidebar-section" id="graph-presets">
      <h4 className="sidebar-section__title">Preset views</h4>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
        {PRESET_ORDER.map((key) => (
          <button
            key={key}
            type="button"
            className={'preset-btn' + (active.has(key) ? ' preset-btn--active' : '')}
            data-preset={key}
            onClick={() => applyPreset(key)}
            style={{
              padding: '2px 8px',
              fontSize: '0.78em',
              background: active.has(key) ? '#4A90D9' : '#2a2a3e',
              color: '#e6e6f0',
              border: '1px solid #444',
              borderRadius: 4,
              cursor: 'pointer',
            }}
          >
            {key}
          </button>
        ))}
        <button
          type="button"
          className="preset-btn preset-reset"
          onClick={resetAll}
          style={{ padding: '2px 8px', fontSize: '0.78em', background: '#2a2a3e', color: '#e6e6f0', border: '1px solid #444', borderRadius: 4, cursor: 'pointer' }}
        >
          ↺ All on
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Toggle widgets: low-confidence + always-show-labels
// ---------------------------------------------------------------------------

type TogglesProps = {
  cyRef: React.MutableRefObject<cytoscape.Core | null>
  alwaysLabelsRef: React.MutableRefObject<boolean>
  showConfidenceToggle?: boolean
}

function Toggles({ cyRef, alwaysLabelsRef, showConfidenceToggle = true }: TogglesProps) {
  const [hideLow, setHideLow] = useState(false)
  const [alwaysLabels, setAlwaysLabels] = useState(false)

  const handleLowConf = useCallback((on: boolean) => {
    setHideLow(on)
    const cy = cyRef.current
    if (!cy) return
    if (on) {
      cy.edges('.conf-low').addClass('hide-low')
    } else {
      cy.edges('.conf-low').removeClass('hide-low')
    }
  }, [cyRef])

  const handleAlwaysLabels = useCallback((on: boolean) => {
    setAlwaysLabels(on)
    alwaysLabelsRef.current = on
    const cy = cyRef.current
    if (!cy) return
    if (on || cy.zoom() >= 1.4) {
      cy.nodes().addClass('show-label')
    } else {
      cy.nodes().removeClass('show-label')
    }
  }, [cyRef, alwaysLabelsRef])

  return (
    <div className="sidebar-section">
      {showConfidenceToggle && (
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
          <input
            type="checkbox"
            checked={hideLow}
            onChange={(e) => handleLowConf(e.target.checked)}
            id="toggle-hide-low"
            aria-label="Hide low-confidence edges"
          />
          Hide low-confidence edges
        </label>
      )}
      <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <input
          type="checkbox"
          checked={alwaysLabels}
          onChange={(e) => handleAlwaysLabels(e.target.checked)}
          id="toggle-always-labels"
          aria-label="Always show labels"
        />
        Always show labels
      </label>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Path query widget
// ---------------------------------------------------------------------------

type PathState = { start: string | null; end: string | null; highlighted: boolean }

type PathQueryProps = {
  cyRef: React.MutableRefObject<cytoscape.Core | null>
  adjRef: React.MutableRefObject<ReturnType<typeof buildAdjacency>>
  pathClickRef: React.MutableRefObject<((nodeId: string) => void) | null>
}

function PathQuery({ cyRef, adjRef, pathClickRef }: PathQueryProps) {
  const pathStateRef = useRef<PathState>({ start: null, end: null, highlighted: false })
  const [status, setStatus] = useState('Right-click two nodes')

  // Expose handlePathClick so the main effect can wire cy.on('cxttap')
  const handlePathClick = useCallback((nodeId: string) => {
    const ps = pathStateRef.current
    const cy = cyRef.current
    if (!cy) return

    if (!ps.start) {
      ps.start = nodeId
      setStatus(`Start: ${shortId(nodeId)}. Right-click another node for end.`)
      refreshPathHighlight(cy, ps)
      return
    }
    if (!ps.end && nodeId !== ps.start) {
      ps.end = nodeId
      setStatus(`Computing paths…`)
      refreshPathHighlight(cy, ps)
      computeAndHighlightPaths(cy, adjRef.current, ps.start, nodeId, setStatus, ps)
      return
    }
    // Both set — reset start to new node
    ps.start = nodeId
    ps.end = null
    ps.highlighted = false
    clearPathHighlight(cy, ps)
    setStatus(`Start: ${shortId(nodeId)}. Right-click another node for end.`)
    refreshPathHighlight(cy, ps)
  }, [cyRef, adjRef])

  // Register on the pathQueryHandlerRef so the parent useEffect can wire the cy event
  const handleRef = useRef(handlePathClick)
  useEffect(() => { handleRef.current = handlePathClick }, [handlePathClick])

  // Expose via pathClickRef so the parent's cytoscape useEffect can call it without re-running
  useEffect(() => {
    pathClickRef.current = (nodeId: string) => handleRef.current(nodeId)
    return () => { pathClickRef.current = null }
  }, [pathClickRef])

  const clearQuery = useCallback(() => {
    const cy = cyRef.current
    const ps = pathStateRef.current
    if (cy) clearPathHighlight(cy, ps)
    ps.start = null; ps.end = null; ps.highlighted = false
    setStatus('Right-click two nodes')
    if (cy) cy.nodes().removeClass('path-start path-end')
  }, [cyRef])

  return (
    <div className="sidebar-section" id="graph-path-query">
      <h4 className="sidebar-section__title">Path query</h4>
      <p className="path-status" style={{ fontSize: '0.78em', color: '#aaa', margin: '2px 0 4px' }}>{status}</p>
      <button type="button" onClick={clearQuery} style={{ fontSize: '0.75em', padding: '2px 8px', background: '#2a2a3e', color: '#e6e6f0', border: '1px solid #444', borderRadius: 4, cursor: 'pointer' }}>
        Clear
      </button>
    </div>
  )
}

function refreshPathHighlight(cy: cytoscape.Core, ps: PathState): void {
  cy.nodes().removeClass('path-start path-end')
  if (ps.start) {
    const n = cy.getElementById(ps.start)
    if (n.length) n.addClass('path-start')
  }
  if (ps.end) {
    const n = cy.getElementById(ps.end)
    if (n.length) n.addClass('path-end')
  }
}

function clearPathHighlight(cy: cytoscape.Core, ps: PathState): void {
  if (!ps.highlighted) return
  cy.elements().removeClass('faded highlighted')
  ps.highlighted = false
}

function computeAndHighlightPaths(
  cy: cytoscape.Core,
  adj: ReturnType<typeof buildAdjacency>,
  startId: string,
  endId: string,
  setStatus: (s: string) => void,
  ps: PathState,
): void {
  const paths = findPaths(adj, startId, endId, 4, 20)
  if (paths.length === 0) {
    setStatus('No path within 4 hops between selected nodes.')
    return
  }
  const nodesOnPath = new Set<string>()
  for (const p of paths) for (const n of p) nodesOnPath.add(n)
  const edgesOnPath = new Set<string>()
  cy.edges().forEach((e) => {
    const s = e.data('source'), t = e.data('target')
    for (const p of paths) {
      for (let i = 0; i < p.length - 1; i++) {
        if ((p[i] === s && p[i + 1] === t) || (p[i] === t && p[i + 1] === s)) {
          edgesOnPath.add(e.id())
        }
      }
    }
  })
  cy.elements().addClass('faded')
  for (const nid of nodesOnPath) cy.getElementById(nid).removeClass('faded').addClass('highlighted')
  for (const eid of edgesOnPath) cy.getElementById(eid).removeClass('faded').addClass('highlighted')
  ps.highlighted = true
  refreshPathHighlight(cy, ps)
  setStatus(`${paths.length} path${paths.length === 1 ? '' : 's'} between selected (≤4 hops).`)
}

function shortId(id: string): string {
  const [, ...rest] = id.split(':')
  const slug = rest.join(':')
  return slug.length > 24 ? slug.slice(0, 22) + '…' : (slug || id)
}

// ---------------------------------------------------------------------------
// Node info panel
// ---------------------------------------------------------------------------

type NodeInfoPanelProps = {
  node: { id: string; label: string; entity: string } | null
  onNodeClickRef: React.MutableRefObject<(node: GraphNode) => void>
  nodeMapRef: React.MutableRefObject<Map<string, GraphNode>>
}

function NodeInfoPanel({ node, onNodeClickRef, nodeMapRef }: NodeInfoPanelProps) {
  if (!node) return null
  const original = nodeMapRef.current.get(node.id)
  return (
    <div className="sidebar-section node-info-panel" id="graph-info">
      <h4 className="sidebar-section__title">Node info</h4>
      <p style={{ fontWeight: 600, marginBottom: 2 }}>{node.label}</p>
      <p style={{ fontSize: '0.78em', color: '#aaa', marginBottom: 4 }}>
        <span className="dot" style={{ background: entityColor(node.entity), width: 8, height: 8, borderRadius: '50%', display: 'inline-block', marginRight: 4 }} />
        {node.entity}
      </p>
      {original && (
        <button
          type="button"
          onClick={() => onNodeClickRef.current(original)}
          style={{ fontSize: '0.75em', padding: '2px 8px', background: '#4A90D9', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}
        >
          Open in reader →
        </button>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Zoom-aware labels (moved here as internal helper for the effect)
// ---------------------------------------------------------------------------

function applyZoomLabels(cy: cytoscape.Core, alwaysShow: boolean): void {
  const z = cy.zoom()
  if (alwaysShow || z >= 1.4) {
    cy.nodes().addClass('show-label')
  } else {
    cy.nodes().removeClass('show-label')
  }
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export type Props = {
  data: GraphData
  onNodeClick: (node: GraphNode) => void
}

// Graph sidebar width bounds (px) for the draggable divider.
const SIDEBAR_MIN = 160
const SIDEBAR_MAX = 480
const SIDEBAR_DEFAULT = 220

/**
 * Cytoscape-based graph canvas with force-layout, BFS highlight on node tap,
 * double-tap node open, zoom-aware labels, proper teardown, and full sidebar:
 * search, entity/edge filters, preset views, toggles, path query, edge tooltips,
 * node info panel.
 */
export function GraphVisualization({ data, onNodeClick }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const cyRef = useRef<cytoscape.Core | null>(null)
  const adjRef = useRef<ReturnType<typeof buildAdjacency>>(new Map())
  const nodeMapRef = useRef<Map<string, GraphNode>>(new Map())
  const focusNodeRef = useRef<((nodeId: string) => void) | null>(null)
  const onNodeClickRef = useRef(onNodeClick)
  useEffect(() => { onNodeClickRef.current = onNodeClick }, [onNodeClick])
  const alwaysLabelsRef = useRef(false)
  const pathClickRef = useRef<((nodeId: string) => void) | null>(null)

  // Sidebar width — draggable, persisted. The sidebar sits on the RIGHT, so dragging the divider LEFT
  // widens it. localStorage is the only host touchpoint and is a browser global (keeps this module
  // self-contained / extractable).
  const [sidebarW, setSidebarW] = useState(() => {
    try { const v = Number(localStorage.getItem('apc:graphSidebarW')); return v >= SIDEBAR_MIN && v <= SIDEBAR_MAX ? v : SIDEBAR_DEFAULT } catch { return SIDEBAR_DEFAULT }
  })
  const sidebarDragRef = useRef<{ onMove: (e: MouseEvent) => void; onUp: () => void } | null>(null)
  useEffect(() => () => {
    if (sidebarDragRef.current) {
      window.removeEventListener('mousemove', sidebarDragRef.current.onMove)
      window.removeEventListener('mouseup', sidebarDragRef.current.onUp)
    }
  }, [])
  const startSidebarDrag = (e: React.MouseEvent) => {
    e.preventDefault()
    if (sidebarDragRef.current) {
      window.removeEventListener('mousemove', sidebarDragRef.current.onMove)
      window.removeEventListener('mouseup', sidebarDragRef.current.onUp)
    }
    const startX = e.clientX
    const startW = sidebarW
    const onMove = (ev: MouseEvent) => {
      setSidebarW(Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, startW + (startX - ev.clientX))))
      cyRef.current?.resize()   // reflow the canvas as it gains/loses width
    }
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      sidebarDragRef.current = null
      setSidebarW((w) => { try { localStorage.setItem('apc:graphSidebarW', String(w)) } catch { /* ignore */ } return w })
      cyRef.current?.resize()
    }
    sidebarDragRef.current = { onMove, onUp }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  // Info panel state
  const [infoNode, setInfoNode] = useState<{ id: string; label: string; entity: string } | null>(null)
  const focusedEdges = useMemo(() => shouldUseFocusedEdges(data), [data])

  // Derive entity types + edge groups from data (stable per data reference)
  const entityTypes = useMemo(() => presentEntityTypes(data.nodes.map((n) => n.type)), [data])
  const edgeLabels  = useMemo(() => [...new Set(data.links.map((l) => l.label ?? l.kind))], [data])
  const edgeGroups  = useMemo(() => groupEdgeTypes(edgeLabels), [edgeLabels])

  // Entity counts
  const entityCounts = useMemo(() => {
    const m = new Map<string, number>()
    data.nodes.forEach((n) => { m.set(n.type, (m.get(n.type) ?? 0) + 1) })
    return m
  }, [data])

  // Edge counts
  const edgeCounts = useMemo(() => {
    const m = new Map<string, number>()
    data.links.forEach((l) => {
      const lbl = l.label ?? l.kind
      m.set(lbl, (m.get(lbl) ?? 0) + 1)
    })
    return m
  }, [data])

  // Main cytoscape init/teardown effect
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const nodeMap = new Map<string, GraphNode>(data.nodes.map((n) => [n.id, n]))
    nodeMapRef.current = nodeMap

    const W = container.clientWidth || 1000
    const H = container.clientHeight || 600

    const ets  = presentEntityTypes(data.nodes.map((n) => n.type))
    const lbls = [...new Set(data.links.map((l) => l.label ?? l.kind))]
    const elements = buildElements(data, W, H, !focusedEdges)
    const style    = buildStylesheet(ets, lbls)

    const cy = cytoscape({
      container,
      elements,
      style,
      layout: { name: 'preset' },
      minZoom: 0.05,
      maxZoom: 8,
      wheelSensitivity: 0.3,
    })
    cyRef.current = cy

    // Build adjacency for BFS / path query
    adjRef.current = buildAdjacency(data.links.map((l) => ({ source: l.source, target: l.target })))

    // In focused-edge mode the graph starts with nodes only. Direct connections are added on demand and
    // removed as a single small collection, so hover/click cost depends on one node's degree—not graph size.
    const incident = new Map<string, GraphLink[]>()
    if (focusedEdges) {
      for (const link of data.links) {
        const from = incident.get(link.source) ?? []
        from.push(link); incident.set(link.source, from)
        if (link.target !== link.source) {
          const to = incident.get(link.target) ?? []
          to.push(link); incident.set(link.target, to)
        }
      }
    }
    let pinnedNodeId: string | null = null
    const clearFocusedEdges = () => {
      if (!focusedEdges) return
      cy.batch(() => { cy.remove(cy.edges()) })
    }
    const showFocusedEdges = (nodeId: string, pin: boolean) => {
      if (!focusedEdges) return
      if (pin) pinnedNodeId = nodeId
      const links = (incident.get(nodeId) ?? []).slice(0, FOCUSED_EDGE_CAP)
      cy.batch(() => {
        cy.remove(cy.edges())
        if (links.length) cy.add(links.map(buildEdgeElement))
      })
    }
    const highlightFocusedNode = (nodeId: string) => {
      const neighborhood = bfsNeighborhood(adjRef.current, nodeId, 1)
      cy.nodes().removeClass('highlighted faded')
      cy.edges().removeClass('highlighted faded')
      for (const id of neighborhood) cy.getElementById(id).addClass('highlighted')
      cy.edges().addClass('highlighted')
      const selected = cy.getElementById(nodeId)
      if (selected.length) {
        setInfoNode({
          id: nodeId,
          label: selected.data('labelFull') || selected.data('label'),
          entity: selected.data('entity'),
        })
      }
    }
    focusNodeRef.current = focusedEdges ? (nodeId: string) => {
      showFocusedEdges(nodeId, true)
      highlightFocusedNode(nodeId)
    } : null

    const fitTimer = setTimeout(() => { try { cy.fit(cy.elements(), 60) } catch { /* ignore */ } }, 50)

    applyZoomLabels(cy, false)

    // Node single-tap: BFS neighbourhood highlight + info panel
    cy.on('tap', 'node', (evt) => {
      const tapped = evt.target as cytoscape.NodeSingular
      if (focusedEdges) {
        showFocusedEdges(tapped.id(), true)
        highlightFocusedNode(tapped.id())
        return
      }
      const neighborhood = bfsNeighborhood(adjRef.current, tapped.id(), 2)

      cy.nodes().removeClass('highlighted faded')
      cy.edges().removeClass('highlighted faded')

      cy.nodes().forEach((n) => {
        if (neighborhood.has(n.id())) n.addClass('highlighted')
        else n.addClass('faded')
      })
      cy.edges().forEach((e) => {
        const src = e.source().id(), tgt = e.target().id()
        if (neighborhood.has(src) && neighborhood.has(tgt)) e.addClass('highlighted')
        else e.addClass('faded')
      })

      // Update info panel
      setInfoNode({ id: tapped.id(), label: tapped.data('labelFull') || tapped.data('label'), entity: tapped.data('entity') })
    })

    // Background tap: clear highlight
    cy.on('tap', (evt) => {
      if (evt.target === cy) {
        pinnedNodeId = null
        clearFocusedEdges()
        cy.nodes().removeClass('highlighted faded')
        cy.edges().removeClass('highlighted faded')
        setInfoNode(null)
      }
    })

    // Hover previews direct links. A click pins them until the background or another node is clicked.
    if (focusedEdges) {
      cy.on('mouseover', 'node', (evt) => {
        if (pinnedNodeId) return
        showFocusedEdges((evt.target as cytoscape.NodeSingular).id(), false)
      })
      cy.on('mouseout', 'node', () => {
        if (!pinnedNodeId) clearFocusedEdges()
      })
    }

    // Double-tap: open node via callback
    cy.on('dbltap', 'node', (evt) => {
      const id = (evt.target as cytoscape.NodeSingular).id()
      const original = nodeMapRef.current.get(id)
      if (original) onNodeClickRef.current(original)
    })

    // Zoom-aware labels
    cy.on('zoom', () => applyZoomLabels(cy, alwaysLabelsRef.current))

    // Right-click (context tap): path query
    cy.on('cxttap', 'node', (evt) => {
      const id = (evt.target as cytoscape.NodeSingular).id()
      pathClickRef.current?.(id)
    })

    // Edge tooltip on mouseover/mouseout
    cy.on('mouseover', 'edge', (evt) => {
      const edge = evt.target as cytoscape.EdgeSingular
      showEdgeTooltip(edge.data() as Record<string, unknown>)
    })
    cy.on('mouseout', 'edge', () => hideEdgeTooltip())

    return () => {
      clearTimeout(fitTimer)
      hideEdgeTooltip()
      focusNodeRef.current = null
      cy.destroy()
      cyRef.current = null
    }
  }, [data, focusedEdges])

  return (
    <section className="panel graph-visualization">
      <header className="panel__header graph-visualization__header">
        <div>
          <h2>Graph Visualization</h2>
          <p>{focusedEdges
            ? `큰 그래프 최적화 · 노드 hover 시 직접 연결만 표시 (최대 ${FOCUSED_EDGE_CAP}개)`
            : 'Zoom, pan, and explore connected nodes'}</p>
        </div>
      </header>

      <div className="graph-visualization__body">
        {/* cy-canvas: Cytoscape mounts into this div */}
        <div ref={containerRef} className="cy-canvas" style={{ width: '100%', height: '100%', minHeight: 500 }} />

        {/* Draggable divider — resize the sidebar width */}
        <div
          className="graph-visualization__sidebar-resize"
          onMouseDown={startSidebarDrag}
          role="separator"
          aria-orientation="vertical"
          aria-label="사이드바 폭 조절"
          title="드래그해서 사이드바 폭 조절"
        />

        {/* Sidebar — search, filters, presets, path query, toggles, node info */}
        <aside className="graph-visualization__sidebar" aria-label="Graph controls" style={{ width: sidebarW, flexShrink: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8, padding: 8 }}>
          <SearchWidget
            cyRef={cyRef}
            adjRef={adjRef}
            onSelectNode={focusedEdges ? (id) => focusNodeRef.current?.(id) : undefined}
          />
          <Toggles cyRef={cyRef} alwaysLabelsRef={alwaysLabelsRef} showConfidenceToggle={!focusedEdges} />
          <EntityFilters entityTypes={entityTypes} counts={entityCounts} cyRef={cyRef} />
          {focusedEdges ? (
            <div className="sidebar-section graph-focus-help">
              <h4 className="sidebar-section__title">연결선 표시</h4>
              <p style={{ fontSize: '0.78em', color: '#aaa', margin: 0 }}>
                노드에 마우스를 올리면 직접 연결을 미리 보고, 클릭하면 연결선을 고정합니다.
                전체 {data.links.length.toLocaleString()}개 연결은 한꺼번에 렌더링하지 않습니다.
              </p>
            </div>
          ) : (
            <>
              <EdgeFilters groups={edgeGroups} counts={edgeCounts} cyRef={cyRef} />
              <PresetViews edgeGroups={edgeGroups} cyRef={cyRef} />
              <PathQuery cyRef={cyRef} adjRef={adjRef} pathClickRef={pathClickRef} />
            </>
          )}
          <NodeInfoPanel node={infoNode} onNodeClickRef={onNodeClickRef} nodeMapRef={nodeMapRef} />
        </aside>
      </div>
    </section>
  )
}
