import { readProjectWiki } from '@apc/graph-view/node'
import type { ReadWikiResult } from '@apc/graph-view/node'

/** Resolve the graph for a wiki location. `wikiDir` may be a repo (we look for <repo>/wiki) — readProjectWiki
 *  takes repoPaths, so pass it as a single-element repoPaths. Always 200 (available:false is a normal state). */
export function handleGraphRequest(wikiDir: string | undefined): { status: number; body: ReadWikiResult | { available: false; reason: string } } {
  if (!wikiDir) return { status: 200, body: { available: false as const, reason: 'WIKI_DIR not set' } }
  return { status: 200, body: readProjectWiki([wikiDir]) }
}
