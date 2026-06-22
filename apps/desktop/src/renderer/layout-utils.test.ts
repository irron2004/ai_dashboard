import { describe, expect, test } from 'vitest'
import { clampDockHeight, DOCK_MIN_H } from './layout-utils.js'

describe('clampDockHeight', () => {
  test('keeps a normal height, rounded to a whole pixel', () => {
    expect(clampDockHeight(280.6, 900)).toBe(281)
  })

  test('never shrinks below the minimum dock height', () => {
    expect(clampDockHeight(40, 900)).toBe(DOCK_MIN_H)
  })

  test('never grows past the viewport minus the reserved top area (160px)', () => {
    expect(clampDockHeight(5000, 700)).toBe(540)
  })

  test('a tiny viewport still yields at least the minimum (max clamp never goes below min)', () => {
    expect(clampDockHeight(300, 100)).toBe(DOCK_MIN_H)
  })
})
