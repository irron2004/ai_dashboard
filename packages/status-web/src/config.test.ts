import { describe, expect, test } from 'vitest'
import { parseArgs, resolveConfig, defaultDbPath } from './config.js'

describe('parseArgs', () => {
  test('parses --key value pairs', () => {
    expect(parseArgs(['--db', '/a/apc.db', '--host', '0.0.0.0', '--port', '5000', '--token', 'abc']))
      .toEqual({ db: '/a/apc.db', host: '0.0.0.0', port: '5000', token: 'abc' })
  })
  test('ignores unknown/danging flags gracefully', () => {
    expect(parseArgs(['--db'])).toEqual({}) // no value → dropped
    expect(parseArgs([])).toEqual({})
  })
})

describe('resolveConfig', () => {
  test('applies defaults when nothing is passed', () => {
    const c = resolveConfig([], {})
    expect(c.host).toBe('127.0.0.1')
    expect(c.port).toBe(4319)
    expect(c.db).toBe(defaultDbPath())
    expect(c.token.length).toBeGreaterThan(16)
    expect(c.tokenGenerated).toBe(true)
  })
  test('--token overrides APC_STATUS_TOKEN and marks tokenGenerated false', () => {
    const c = resolveConfig(['--token', 'cli-token'], { APC_STATUS_TOKEN: 'env-token' })
    expect(c.token).toBe('cli-token')
    expect(c.tokenGenerated).toBe(false)
  })
  test('APC_STATUS_TOKEN is used when --token is absent', () => {
    const c = resolveConfig([], { APC_STATUS_TOKEN: 'env-token' })
    expect(c.token).toBe('env-token')
    expect(c.tokenGenerated).toBe(false)
  })
  test('--db/--host/--port override the defaults', () => {
    const c = resolveConfig(['--db', '/x/apc.db', '--host', '0.0.0.0', '--port', '5000'], {})
    expect(c.db).toBe('/x/apc.db')
    expect(c.host).toBe('0.0.0.0')
    expect(c.port).toBe(5000)
  })
})
