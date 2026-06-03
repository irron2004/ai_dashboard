import { readFileSync } from 'node:fs'

/**
 * Compiled-in copy of `harness/harness-rules.md` — the preamble injected into every LLM agent prompt.
 * Boot reads from THIS constant, never the filesystem, so a bundled Electron app cannot fail to start
 * over a missing rules file (the old `import.meta.url` path-walk landed in the wrong dir once bundled).
 * `harness/harness-rules.md` stays the canonical, editable source; a drift test keeps the two identical.
 */
export const DEFAULT_PREAMBLE = `# Knowledge Harness Rules

## 1. Immutable Sources
- \`raw/\` 아래 원본은 절대 수정하지 않는다.
- \`raw/\` 아래 원본은 삭제하지 않는다.
- raw source는 evidence로만 사용한다.
- 민감정보가 포함된 raw source를 그대로 wiki/shared/canonical 문서로 승격하지 않는다.

## 2. Proposal First
- 모든 worker agent는 직접 문서를 수정하지 않는다.
- worker agent는 \`NodeProposal\`, \`DocumentIntentReport\`, \`TaskMappingReport\`만 생성한다.
- worker agent의 출력은 모두 \`inbox/proposals/\`에 저장한다.
- proposal에는 반드시 evidence가 있어야 한다.

## 3. Lead Merge
- \`WikiGraphLeadAgent\`만 proposal을 병합할 수 있다.
- Lead는 기존 node와 중복 여부를 반드시 확인한다.
- Lead는 기존 canonical 문서와 충돌 여부를 확인한다.
- Lead는 직접 문서를 쓰지 않고 \`WritePlan\`을 생성한다.

## 4. Shared Promotion
- shared 승격은 최소 2개 이상의 evidence 또는 2개 이상의 project relevance가 있어야 한다.
- shared 승격은 자동 적용하지 않는다.
- shared 승격은 human review가 필요하다.
- 프로젝트 특수 결정은 shared로 승격하지 않는다.

## 5. Safe Write
- \`ObsidianWikiWriterAgent\`는 승인된 \`WritePlan\`만 실행한다.
- \`current.md\`, \`PRD.md\`, \`ADR-*\` 문서는 직접 덮어쓰지 않고 diff proposal을 만든다.
- 삭제는 금지한다.
- 삭제가 필요하면 \`deprecated\` 또는 \`superseded\` 상태로 표시한다.

## 6. Evidence
- 모든 \`ConceptNode\`, \`DecisionNode\`, \`ExperimentNode\`는 source reference를 가져야 한다.
- 추론은 \`inference_note\`에 명시한다.
- evidence 없는 node는 canonical/shared/wiki에 반영하지 않고 proposal 상태로 둔다.
- evidence는 source path와 source id를 포함해야 한다.

## 7. Validation
- write 후 Markdown/YAML validation을 수행한다.
- Obsidian \`[[wiki-link]]\`가 깨졌는지 확인한다.
- graph node id와 문서 frontmatter의 \`node_id\`가 일치해야 한다.
- duplicate node, orphan node, broken backlink를 report로 남긴다.

## 8. Human Review
- shared 승격은 human review가 필요하다.
- canonical 문서 수정은 human review가 필요하다.
- secret/privacy 경고가 있는 proposal은 human review 전까지 적용하지 않는다.
`

/**
 * The harness-rules preamble. With no argument returns the compiled-in DEFAULT_PREAMBLE (fs-free boot).
 * Pass an explicit path to load an editable override from disk (dev / future packaged extraResource).
 */
export function loadPreamble(path?: string): string {
  return path === undefined ? DEFAULT_PREAMBLE : readFileSync(path, 'utf8')
}
