import { expect, test } from 'vitest'
import { VERSION } from './index.js'

test('shared package exports VERSION', () => {
  expect(VERSION).toBe('0.0.0')
})
