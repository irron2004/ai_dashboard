import type { WikiSubstrate } from '@apc/wiki-substrate'
import type { KhKernelLintReport } from '@apc/shared'

export type DomainId = 'project-docs' | 'paper'

export type PaperEntityType = 'papers' | 'modules' | 'pipelines' | 'pipeline_trials'

/** A typed domain node ready to render. `fields` is the contract frontmatter (title/slug/type-specific);
 *  the kernel-lint gate (DomainPack.validate) is the authority on whether the fields satisfy the contract. */
export type TypedNode = { type: PaperEntityType; slug: string; fields: Record<string, unknown>; body?: string }

export type RenderedNode = { relPath: string; content: string }

/** Overlay seam: a domain parameterizes the harness. Plan 1 carries only identity + contract location;
 *  Plans 2–3 extend this with nodeSchema / buildExtractorPrompt / renderNode / validate. */
export interface DomainPack {
  id: DomainId
  /** Absolute path to the autosci contract dir (wiki-domains/<id>/runtime), or undefined for code-driven domains. */
  contractDir?: string
  /** Validate a generated wiki dir against this domain's contract. paper → kernel lint (authoritative);
   *  project-docs leaves this undefined and keeps its existing TS validators. The caller injects the
   *  substrate so the pack never spawns Python itself. */
  validate?(wikiDir: string, deps: { substrate: WikiSubstrate }): Promise<KhKernelLintReport>
  /** Render a typed node to this domain's vault layout. paper → wiki/<type>/<slug>.md with YAML
   *  frontmatter; project-docs leaves this undefined (its existing render path stays). */
  renderNode?(node: TypedNode): RenderedNode
}
