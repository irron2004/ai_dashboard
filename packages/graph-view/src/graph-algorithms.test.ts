import { describe, expect, test } from 'vitest'
import { buildAdjacency, bfsNeighborhood, findPaths } from './graph-algorithms.js'

const adj = buildAdjacency([
  { source: 'a', target: 'b' }, { source: 'b', target: 'c' }, { source: 'c', target: 'd' },
])

describe('graph-algorithms', () => {
  test('buildAdjacency is undirected', () => {
    expect(adj.get('a')?.has('b')).toBe(true)
    expect(adj.get('b')?.has('a')).toBe(true)
  })

  test('bfsNeighborhood respects depth and includes start', () => {
    expect(bfsNeighborhood(adj, 'a', 1)).toEqual(new Set(['a', 'b']))
    expect(bfsNeighborhood(adj, 'a', 2)).toEqual(new Set(['a', 'b', 'c']))
  })

  test('findPaths finds a path within depth', () => {
    const paths = findPaths(adj, 'a', 'd', 4, 20)
    expect(paths).toContainEqual(['a', 'b', 'c', 'd'])
  })

  test('findPaths returns empty when beyond maxDepth', () => {
    expect(findPaths(adj, 'a', 'd', 2, 20)).toEqual([])
  })
})
