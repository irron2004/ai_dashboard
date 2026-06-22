import { describe, expect, test } from 'vitest'
import { entityColor, workflowFor, edgeColor, directionFor, confidenceClass, presentEntityTypes, groupEdgeTypes } from './graph-style.js'

describe('graph-style', () => {
  test('entityColor covers both schemas and falls back to gray', () => {
    expect(entityColor('papers')).toBe('#4A90D9')
    expect(entityColor('run')).toMatch(/^#/)
    expect(entityColor('unknown-type')).toBe('#95A5A6')
  })

  test('paper edge types map to a workflow and a concrete color', () => {
    expect(workflowFor('uses_module')).not.toBe('')
    expect(edgeColor('uses_module')).toMatch(/^#/)
    expect(edgeColor('totally-unknown')).toMatch(/^#/) // never undefined
  })

  test('directionFor defaults directed; symmetric types are symmetric', () => {
    expect(directionFor('uses_module')).toBe('directed')
    expect(directionFor('alternative_to')).toBe('symmetric')
  })

  test('confidenceClass maps known levels, empty otherwise', () => {
    expect(confidenceClass('high')).toBe('conf-high')
    expect(confidenceClass('MEDIUM')).toBe('conf-medium')
    expect(confidenceClass(undefined)).toBe('')
    expect(confidenceClass('bogus')).toBe('')
  })

  test('presentEntityTypes keeps canonical order, only present types', () => {
    expect(presentEntityTypes(['modules', 'papers', 'papers'])).toEqual(['papers', 'modules'])
  })

  test('groupEdgeTypes buckets known types and collects leftovers under Other', () => {
    const groups = groupEdgeTypes(['uses_module', 'mystery_edge'])
    const flat = groups.flatMap((g) => g.types)
    expect(flat).toContain('uses_module')
    expect(groups.find((g) => g.group === 'Other')?.types).toContain('mystery_edge')
  })

  test('AutoSci entity types get concrete colors and order', () => {
    expect(entityColor('concepts')).toMatch(/^#/)
    expect(entityColor('methods')).toMatch(/^#/)
    expect(entityColor('people')).toMatch(/^#/)
    // present in canonical order (papers before concepts before methods)
    expect(presentEntityTypes(['methods', 'concepts', 'papers'])).toEqual(['papers', 'concepts', 'methods'])
  })
})
