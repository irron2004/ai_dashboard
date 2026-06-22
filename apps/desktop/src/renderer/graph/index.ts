// graph/index.ts — public surface.
// The folder is self-contained: types, layout, algorithms, style, component.
// No imports from api/store/IPC/harness-utils. Lift this folder out to reuse it.
export { GraphVisualization } from './GraphVisualization.js'
export type { GraphData, GraphNode, GraphLink, GraphNodeType, GraphShape } from './graph-types.js'
export { obsidianForceLayout } from './graph-layout.js'
export { buildAdjacency, bfsNeighborhood, findPaths } from './graph-algorithms.js'
