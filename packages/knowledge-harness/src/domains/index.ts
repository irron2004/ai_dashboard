import type { DomainId, DomainPack } from './types.js'
import { projectDocsPack } from './project-docs-pack.js'
import { paperPack } from './paper-pack.js'

export type { DomainId, DomainPack } from './types.js'
export { projectDocsPack, paperPack }

export function domainPackFor(domain: DomainId): DomainPack {
  return domain === 'paper' ? paperPack : projectDocsPack
}
