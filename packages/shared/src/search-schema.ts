export type UnifiedSearchHit = {
  kind: string
  id: string
  title: string
  excerpt: string
  projectId: string
  score?: number
}
export type UnifiedSearchResponse = { query: string; hits: UnifiedSearchHit[] }
