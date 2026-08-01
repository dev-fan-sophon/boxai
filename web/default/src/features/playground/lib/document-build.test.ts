import { describe, expect, it } from 'vitest'

import type { Message } from '../types'
import {
  buildDocumentConversationContext,
  extractDocumentBuildCode,
  toDocumentArtifacts,
} from './document-build'

const SCRIPT = "import docx\ndocx.Document().save('/workspace/out/a.docx')"

describe('extractDocumentBuildCode', () => {
  it('takes the script out of a fenced block surrounded by commentary', () => {
    expect(
      extractDocumentBuildCode(
        `Sure, here you go:\n\n\`\`\`python\n${SCRIPT}\n\`\`\`\n\nLet me know.`
      )
    ).toBe(SCRIPT)
  })

  it('prefers the last python block when the model sketches first', () => {
    expect(
      extractDocumentBuildCode(
        `\`\`\`python\nprint('sketch')\n\`\`\`\nNow the real one:\n\`\`\`python\n${SCRIPT}\n\`\`\``
      )
    ).toBe(SCRIPT)
  })

  it('accepts a fence with no language tag', () => {
    expect(extractDocumentBuildCode(`\`\`\`\n${SCRIPT}\n\`\`\``)).toBe(SCRIPT)
  })

  it('prefers a tagged python block over an untagged one', () => {
    expect(
      extractDocumentBuildCode(
        `\`\`\`\nnot the script\n\`\`\`\n\`\`\`python\n${SCRIPT}\n\`\`\``
      )
    ).toBe(SCRIPT)
  })

  it('accepts a bare script with no fence at all', () => {
    expect(extractDocumentBuildCode(SCRIPT)).toBe(SCRIPT)
  })

  it('returns nothing for a refusal', () => {
    expect(extractDocumentBuildCode('I cannot help with that.')).toBe('')
  })

  it('returns nothing for an empty fence', () => {
    expect(extractDocumentBuildCode('```python\n```')).toBe('')
  })
})

describe('toDocumentArtifacts', () => {
  it('marks the documents that failed to reopen', () => {
    const artifacts = toDocumentArtifacts(
      [
        {
          id: 1,
          name: 'report.docx',
          mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          size: 1024,
          kind: 'document',
        },
        {
          id: 2,
          name: 'chart.png',
          mime: 'image/png',
          size: 512,
          kind: 'image',
        },
      ],
      ['report.docx']
    )
    expect(artifacts.map((a) => [a.name, a.verified])).toEqual([
      ['report.docx', false],
      ['chart.png', true],
    ])
  })

  it('survives a build that produced nothing', () => {
    expect(toDocumentArtifacts(undefined, undefined)).toEqual([])
  })
})

describe('buildDocumentConversationContext', () => {
  const message = (from: 'user' | 'assistant', content: string): Message => ({
    key: `${from}-${content.slice(0, 8)}`,
    from,
    versions: [{ id: 'v1', content }],
  })

  it('turns the transcript into labeled blocks, skipping empty turns', () => {
    const context = buildDocumentConversationContext([
      message('user', '一周最佳AI新闻'),
      message('assistant', '本周要点：代理逃逸事件主导。'),
      message('assistant', ''),
    ])
    expect(context).toBe(
      'User:\n一周最佳AI新闻\n\nAssistant:\n本周要点：代理逃逸事件主导。'
    )
  })

  it('uses the version the user selected, not the latest', () => {
    const regenerated: Message = {
      key: 'a1',
      from: 'assistant',
      versions: [
        { id: 'v1', content: 'kept answer' },
        { id: 'v2', content: 'discarded regeneration' },
      ],
      activeVersion: 0,
    }
    expect(buildDocumentConversationContext([regenerated])).toBe(
      'Assistant:\nkept answer'
    )
  })

  it('keeps the tail when the transcript exceeds the cap', () => {
    const long = 'x'.repeat(13000)
    const context = buildDocumentConversationContext([
      message('user', long),
      message('assistant', 'the recent part'),
    ])
    expect(context.length).toBe(12000)
    expect(context.endsWith('Assistant:\nthe recent part')).toBe(true)
  })
})
