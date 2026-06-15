import { describe, expect, test } from 'vitest'
import { parseRemoteDocBlocks } from './remote-docs.js'

const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64')

describe('parseRemoteDocBlocks', () => {
  test('decodes base64 blocks, strips leading ./, tolerates CRLF', () => {
    // Simulates the remote `find | base64` framed stream, with Windows CRLF line endings.
    const stdout = [
      '@@APCDOC@@./docs/a.md',
      b64('# Title\nbody'),
      '@@APCEND@@',
      '@@APCDOC@@./CLAUDE.md',
      b64('guide content'),
      '@@APCEND@@',
    ].join('\r\n')

    const docs = parseRemoteDocBlocks(stdout)
    expect(docs).toEqual([
      { rel: 'docs/a.md', content: '# Title\nbody' },
      { rel: 'CLAUDE.md', content: 'guide content' },
    ])
  })

  test('handles multi-line (wrapped) base64 and unicode content', () => {
    const big = '한글 내용 '.repeat(50)
    // GNU base64 wraps at 76 cols; emulate multiple lines.
    const wrapped = b64(big).replace(/(.{20})/g, '$1\n')
    const docs = parseRemoteDocBlocks(`@@APCDOC@@notes.txt\n${wrapped}\n@@APCEND@@\n`)
    expect(docs).toHaveLength(1)
    expect(docs[0]).toEqual({ rel: 'notes.txt', content: big })
  })

  test('empty stream → []', () => {
    expect(parseRemoteDocBlocks('')).toEqual([])
  })
})
