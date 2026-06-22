#!/usr/bin/env node
/**
 * graph-web.mjs
 * Usage: node scripts/graph-web.mjs <wikiPath>
 * Sets WIKI_DIR to the resolved absolute path and starts the @apc/graph-web dev server.
 * Cross-platform: uses spawn with shell:true so it works on both Windows and Unix.
 */
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

const rawPath = process.argv[2] ?? ''
const wikiDir = rawPath ? resolve(rawPath) : ''

if (!rawPath) {
  console.warn('[graph-web] No wikiPath provided — WIKI_DIR will be empty; the viewer will show the empty-state message.')
}

console.log(`[graph-web] WIKI_DIR=${wikiDir || '(empty)'}`)

const result = spawnSync(
  'pnpm',
  ['--filter', '@apc/graph-web', 'dev', '--open'],
  {
    stdio: 'inherit',
    shell: true,
    env: { ...process.env, WIKI_DIR: wikiDir },
  }
)

process.exit(result.status ?? 0)
