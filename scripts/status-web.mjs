#!/usr/bin/env node
/**
 * status-web.mjs
 * Usage: node scripts/status-web.mjs [--db <path>] [--vault <path>] [--token <t>] [--host <h>] [--port <n>]
 * Runs packages/status-web/src/cli.ts via vite-node (repo config: @apc/* aliases + node:sqlite shim).
 * Read-only remote status dashboard. Default bind 127.0.0.1; --host 0.0.0.0 to expose on the LAN.
 */
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const require = createRequire(import.meta.url)
const here = dirname(fileURLToPath(import.meta.url))
const config = resolve(here, '../vitest.config.ts')
const entry = resolve(here, '../packages/status-web/src/cli.ts')
const viteNode = require.resolve('vite-node/vite-node.mjs')

const args = [viteNode, '--config', config, entry, '--', ...process.argv.slice(2)]
const child = spawn(process.execPath, args, { stdio: 'inherit' })
child.on('exit', (code) => process.exit(code ?? 0))
