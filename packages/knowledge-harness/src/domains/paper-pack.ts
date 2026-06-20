import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import type { DomainPack } from './types.js'

// repo-root/wiki-domains/paper/runtime, resolved relative to this file
// (packages/knowledge-harness/src/domains/ -> up 4 to repo root).
const here = dirname(fileURLToPath(import.meta.url))
const contractDir = join(here, '..', '..', '..', '..', 'wiki-domains', 'paper', 'runtime')

export const paperPack: DomainPack = { id: 'paper', contractDir }
