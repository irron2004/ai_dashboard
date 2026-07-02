/**
 * Dedicated launcher entry-point for scripts/status-web.mjs.
 *
 * vite-node in non-`--script` mode does NOT set process.argv[1] to the entry
 * file, so the old `fileURLToPath(import.meta.url) === process.argv[1]` guard
 * in cli.ts was dead under the launcher.  This module is the solution: it
 * unconditionally calls main() at the top level without any guard.
 *
 * Only scripts/status-web.mjs may import this file.  Nothing else should.
 */
import { main } from './cli.js'

main(process.argv.slice(2), process.env)
