import { createHash } from 'node:crypto'

export type ConflictInput = {
  targetPath: string
  previousVersion: string
  currentVersion: string
  proposedChange: string
}

export class ConflictManager {
  hash(content: string): string {
    return createHash('sha256').update(content, 'utf8').digest('hex')
  }

  /** True when the on-disk content no longer matches what the app last read. */
  detectConflict(lastReadHash: string, currentContent: string): boolean {
    return this.hash(currentContent) !== lastReadHash
  }

  buildConflictDoc(input: ConflictInput): string {
    return [
      '---',
      'type: conflict',
      `target: ${input.targetPath}`,
      '---',
      '',
      `# Conflict: ${input.targetPath}`,
      '',
      '## Previous version (app last knew)',
      '',
      '```markdown',
      input.previousVersion.trimEnd(),
      '```',
      '',
      '## Current version (on disk now)',
      '',
      '```markdown',
      input.currentVersion.trimEnd(),
      '```',
      '',
      '## LLM proposed change',
      '',
      '```markdown',
      input.proposedChange.trimEnd(),
      '```',
      '',
      '## Merge proposal',
      '',
      '- [ ] Keep current (on disk)',
      '- [ ] Accept LLM proposal',
      '- [ ] Merge manually below',
      '',
    ].join('\n')
  }
}
