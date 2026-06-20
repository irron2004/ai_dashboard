export type DomainId = 'project-docs' | 'paper'

/** Overlay seam: a domain parameterizes the harness. Plan 1 carries only identity + contract location;
 *  Plans 2–3 extend this with nodeSchema / buildExtractorPrompt / renderNode / validate. */
export interface DomainPack {
  id: DomainId
  /** Absolute path to the autosci contract dir (wiki-domains/<id>/runtime), or undefined for code-driven domains. */
  contractDir?: string
}
