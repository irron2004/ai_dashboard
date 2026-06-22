// Ported from AutoSci app/modules/graph.js:obsidianForceLayout (L242-341).
// Deviation: NO Math.random — initial scatter and overlap nudges are index-derived so layouts are
// deterministic across renders and unit-testable.
export type LayoutNodeInput = { id: string }
export type LayoutEdgeInput = { source: string; target: string }
export type LayoutResult = {
  positions: Record<string, { x: number; y: number }>
  sizes: Record<string, { w: number; h: number; radius: number }>
}

export function obsidianForceLayout(
  nodesIn: LayoutNodeInput[], edgesIn: LayoutEdgeInput[], width: number, height: number,
): LayoutResult {
  const W = width || 1000, H = height || 600
  const N = nodesIn.length
  const nodes = nodesIn.map((n, i) => {
    const angle = (i / Math.max(N, 1)) * Math.PI * 2
    const r = 200 + (i % 5) * 25                 // was 200 + random*100
    const jitter = ((i % 7) - 3) * 12            // was (random-0.5)*80
    return { id: n.id, x: W / 2 + Math.cos(angle) * r + jitter, y: H / 2 + Math.sin(angle) * r + jitter, vx: 0, vy: 0, degree: 0 }
  })
  const nodeMap = new Map(nodes.map((n) => [n.id, n]))
  const edges = edgesIn
    .map((e) => ({ source: nodeMap.get(e.source), target: nodeMap.get(e.target) }))
    .filter((e): e is { source: typeof nodes[number]; target: typeof nodes[number] } => !!e.source && !!e.target)
  edges.forEach((e) => { e.source.degree++; e.target.degree++ })

  const densityScale = Math.min(2.2, 1 + Math.sqrt(Math.max(0, N - 20)) * 0.12)
  const REPULSION = 16000 * densityScale, LINK_STRENGTH = 0.003, LINK_DISTANCE = 320 * densityScale
  const GRAVITY = 0.010, DAMPING = 0.85, COLLISION_PAD = 28, MAX_SPEED = 40, ITERS = 1200
  const CENTER_X = W / 2, CENTER_Y = H / 2
  const baseRadius = (n: typeof nodes[number]) => Math.min(4 + Math.sqrt(n.degree) * 4, 20)

  for (let iter = 0; iter < ITERS; iter++) {
    for (let i = 0; i < N; i++) {
      for (let j = i + 1; j < N; j++) {
        const a = nodes[i], b = nodes[j]
        let dx = b.x - a.x, dy = b.y - a.y
        let d2 = dx * dx + dy * dy
        if (d2 < 1) { dx = ((i % 3) - 1) || 1; dy = ((j % 3) - 1) || 1; d2 = dx * dx + dy * dy } // deterministic nudge
        const d = Math.sqrt(d2), f = REPULSION / d2
        const fx = (dx / d) * f, fy = (dy / d) * f
        a.vx -= fx; a.vy -= fy; b.vx += fx; b.vy += fy
      }
    }
    for (const e of edges) {
      let dx = e.target.x - e.source.x, dy = e.target.y - e.source.y
      const d = Math.sqrt(dx * dx + dy * dy) || 1
      const f = (d - LINK_DISTANCE) * LINK_STRENGTH
      const fx = (dx / d) * f, fy = (dy / d) * f
      e.source.vx += fx; e.source.vy += fy; e.target.vx -= fx; e.target.vy -= fy
    }
    for (const nd of nodes) { nd.vx += (CENTER_X - nd.x) * GRAVITY; nd.vy += (CENTER_Y - nd.y) * GRAVITY }
    for (let i = 0; i < N; i++) {
      for (let j = i + 1; j < N; j++) {
        const a = nodes[i], b = nodes[j]
        const minDist = baseRadius(a) + baseRadius(b) + COLLISION_PAD
        const dx = b.x - a.x, dy = b.y - a.y
        const d = Math.sqrt(dx * dx + dy * dy) || 1
        if (d < minDist) {
          const overlap = (minDist - d) / 2, nx = dx / d, ny = dy / d
          a.x -= nx * overlap; a.y -= ny * overlap; b.x += nx * overlap; b.y += ny * overlap
        }
      }
    }
    for (const nd of nodes) {
      nd.vx *= DAMPING; nd.vy *= DAMPING
      const sp = Math.sqrt(nd.vx * nd.vx + nd.vy * nd.vy)
      if (sp > MAX_SPEED) { nd.vx = (nd.vx / sp) * MAX_SPEED; nd.vy = (nd.vy / sp) * MAX_SPEED }
      nd.x += nd.vx; nd.y += nd.vy
    }
  }

  const positions: LayoutResult['positions'] = {}, sizes: LayoutResult['sizes'] = {}
  for (const nd of nodes) {
    positions[nd.id] = { x: nd.x, y: nd.y }
    const r = baseRadius(nd)
    sizes[nd.id] = { w: r * 2, h: r * 2, radius: r }
  }
  return { positions, sizes }
}
